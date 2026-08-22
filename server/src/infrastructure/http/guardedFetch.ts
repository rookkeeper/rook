import { lookup as dnsLookup } from "node:dns/promises";
import { SERVER_VERSION } from "../serverVersion.js";
import { isDisallowedAddress } from "./ipAddressPolicy.js";

/**
 * Guarded outbound HTTP for public HTTPS resources.
 *
 * Policy: `https:` only; the hostname must not resolve to a loopback, unspecified,
 * private, or link-local address; redirects are followed only to the same host and
 * only up to a hop limit; one deadline covers the whole call (DNS, every hop, and the
 * body read); responses have a size cap and a fixed `User-Agent`. Policy and network
 * conditions are returned as `error` results rather than thrown.
 *
 * DNS is checked before the request but the resolved address is not pinned for the
 * connection, so a DNS-rebinding attack is out of scope for this guard.
 *
 * Bodies are decoded as UTF-8 byte-for-byte: a leading BOM is preserved so `body` still
 * represents exactly what the server sent.
 */

export const DEFAULT_TIMEOUT_MS = 5_000;
export const DEFAULT_MAX_BYTES = 1_048_576;
export const DEFAULT_MAX_REDIRECTS = 3;
export const DEFAULT_ACCEPT = "text/plain, text/markdown, application/json;q=0.9, */*;q=0.1";

/** Fixed identifier sent on every guarded request. */
export const ROOK_USER_AGENT = `Rook/${SERVER_VERSION} (+https://github.com/rookkeeper/rook)`;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** DNS resolver shape — matches `dns.promises.lookup(hostname, { all: true })`. */
export type HostLookup = (hostname: string) => Promise<{ address: string; family: number }[]>;

export interface GuardedFetchOptions {
  /** Injectable for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Injectable for tests; defaults to `dns.promises.lookup` with `{ all: true }`. */
  lookup?: HostLookup;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  ifNoneMatch?: string;
  ifModifiedSince?: string;
  accept?: string;
}

export type GuardedFetchErrorReason = "policy" | "timeout" | "too_large" | "network" | "http";

export type GuardedFetchResult =
  | { kind: "ok"; status: number; body: string; etag?: string; lastModified?: string; contentType?: string; finalUrl: string }
  | { kind: "not_modified"; etag?: string; lastModified?: string }
  | { kind: "absent"; status: number }
  | { kind: "error"; reason: GuardedFetchErrorReason; status?: number; message: string };

function fail(reason: GuardedFetchErrorReason, message: string, status?: number): GuardedFetchResult {
  return status === undefined ? { kind: "error", reason, message } : { kind: "error", reason, status, message };
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Hostname without IPv6 brackets, lowercased. */
function hostnameOf(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

/** Discard an unread body so the connection can be reused. */
async function drain(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("deadline reached"));
      return;
    }
    signal.addEventListener("abort", () => reject(new Error("deadline reached")), { once: true });
  });
}

async function readCappedText(response: Response, maxBytes: number): Promise<{ capped: false; text: string } | { capped: true }> {
  if (!response.body) return { capped: false, text: "" };
  const reader = response.body.getReader();
  // `ignoreBOM` keeps a leading BOM in the decoded text instead of swallowing it, so the
  // string still stands for the exact bytes served — callers that hash a body against a
  // publisher's digest depend on that.
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
  let received = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { capped: true };
    }
    text += decoder.decode(value, { stream: true });
  }
  return { capped: false, text: text + decoder.decode() };
}

const defaultLookup: HostLookup = (hostname) => dnsLookup(hostname, { all: true });

/** Fetch a public HTTPS resource under the policy documented at the top of this module. */
export async function guardedFetch(url: string, options: GuardedFetchOptions = {}): Promise<GuardedFetchResult> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const lookup = options.lookup ?? defaultLookup;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  const headers: Record<string, string> = { "user-agent": ROOK_USER_AGENT, accept: options.accept ?? DEFAULT_ACCEPT };
  if (options.ifNoneMatch) headers["if-none-match"] = options.ifNoneMatch;
  if (options.ifModifiedSince) headers["if-modified-since"] = options.ifModifiedSince;

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return fail("policy", `Not a valid URL: ${url}`);
  }
  const originHost = target.host.toLowerCase();

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    let screened = false;
    for (let hop = 0; ; hop += 1) {
      // The deadline is enforced here too, so an injected fetch that ignores the abort
      // signal cannot keep the redirect loop alive past it.
      if (timedOut) return fail("timeout", `Request to ${url} timed out after ${timeoutMs}ms`);
      if (target.protocol !== "https:") return fail("policy", `Only https: URLs are allowed, got ${target.protocol}//`);
      const hostname = hostnameOf(target);
      if (!hostname) return fail("policy", `URL has no hostname: ${target.href}`);
      if (target.host.toLowerCase() !== originHost) {
        return fail("policy", `Redirect to a different host is not allowed: ${originHost} -> ${target.host.toLowerCase()}`);
      }

      // Redirects never leave the host, so one lookup screens every hop.
      if (!screened) {
        let addresses: { address: string; family: number }[];
        try {
          addresses = await Promise.race([lookup(hostname), rejectOnAbort(controller.signal)]);
        } catch (cause) {
          if (timedOut) return fail("timeout", `DNS lookup for ${hostname} timed out after ${timeoutMs}ms`);
          return fail("network", `DNS lookup failed for ${hostname}: ${errorMessage(cause)}`);
        }
        if (addresses.length === 0) return fail("network", `DNS lookup returned no addresses for ${hostname}`);
        const disallowed = addresses.find((entry) => isDisallowedAddress(entry.address));
        if (disallowed) return fail("policy", `${hostname} resolves to a disallowed address: ${disallowed.address}`);
        screened = true;
      }

      let response: Response;
      try {
        response = await doFetch(target.toString(), { method: "GET", redirect: "manual", signal: controller.signal, headers });
      } catch (cause) {
        if (timedOut) return fail("timeout", `Request to ${target.href} timed out after ${timeoutMs}ms`);
        return fail("network", `Request to ${target.href} failed: ${errorMessage(cause)}`);
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        await drain(response);
        const location = response.headers.get("location");
        if (!location) return fail("http", `Redirect ${response.status} from ${target.href} had no Location header`, response.status);
        if (hop >= maxRedirects) return fail("policy", `Exceeded the redirect limit of ${maxRedirects} for ${url}`);
        try {
          target = new URL(location, target);
        } catch {
          return fail("policy", `Redirect target is not a valid URL: ${location}`);
        }
        continue;
      }
      if (response.status < 200 || response.status > 299) {
        await drain(response); // no non-2xx body is consumed
        if (response.status === 304) {
          const etag = response.headers.get("etag") ?? undefined;
          return { kind: "not_modified", etag, lastModified: response.headers.get("last-modified") ?? undefined };
        }
        if (response.status === 404 || response.status === 410) return { kind: "absent", status: response.status };
        return fail("http", `Unexpected status ${response.status} from ${target.href}`, response.status);
      }

      let read: Awaited<ReturnType<typeof readCappedText>>;
      try {
        read = await readCappedText(response, maxBytes);
      } catch (cause) {
        if (timedOut) return fail("timeout", `Reading ${target.href} timed out after ${timeoutMs}ms`);
        return fail("network", `Reading ${target.href} failed: ${errorMessage(cause)}`);
      }
      if (read.capped) return fail("too_large", `Response from ${target.href} exceeded ${maxBytes} bytes`);

      return {
        kind: "ok",
        status: response.status,
        body: read.text,
        etag: response.headers.get("etag") ?? undefined,
        lastModified: response.headers.get("last-modified") ?? undefined,
        contentType: response.headers.get("content-type") ?? undefined,
        finalUrl: target.toString(),
      };
    }
  } finally {
    clearTimeout(timer);
  }
}
