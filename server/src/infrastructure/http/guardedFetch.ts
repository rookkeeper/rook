import { lookup as dnsLookup } from "node:dns/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SERVER_ROOT } from "../paths.js";

/**
 * Guarded outbound HTTP for public HTTPS resources.
 *
 * Policy: `https:` only; the hostname must not resolve to a loopback, unspecified,
 * private, or link-local address; redirects are followed only to the same host and
 * only up to a hop limit; every request has a timeout, a response size cap, and a
 * fixed `User-Agent`. Policy and network conditions are returned as `error` results
 * rather than thrown.
 *
 * DNS is checked before the request but the resolved address is not pinned for the
 * connection, so a DNS-rebinding attack is out of scope for this guard.
 */

export const DEFAULT_TIMEOUT_MS = 5_000;
export const DEFAULT_MAX_BYTES = 1_048_576;
export const DEFAULT_MAX_REDIRECTS = 3;
export const DEFAULT_ACCEPT = "text/plain, text/markdown, application/json;q=0.9, */*;q=0.1";

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
  | { kind: "not_modified" }
  | { kind: "absent"; status: number }
  | { kind: "error"; reason: GuardedFetchErrorReason; status?: number; message: string };

function readServerVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(path.join(SERVER_ROOT, "package.json"), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Fixed identifier sent on every guarded request. */
export const ROOK_USER_AGENT = `Rook/${readServerVersion()} (+https://github.com/rookkeeper/rook)`;

function parseIpv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : -1));
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null;
}

/** Expand an IPv6 literal (including the `::ffff:1.2.3.4` form) into eight 16-bit groups. */
function parseIpv6(address: string): number[] | null {
  const bare = address.split("%")[0]!.toLowerCase();
  if (!bare.includes(":")) return null;
  const halves = bare.split("::");
  if (halves.length > 2) return null;

  const expand = (half: string): number[] | null => {
    if (half === "") return [];
    const groups: number[] = [];
    const parts = half.split(":");
    for (const [index, part] of parts.entries()) {
      if (part.includes(".")) {
        if (index !== parts.length - 1) return null;
        const octets = parseIpv4(part);
        if (!octets) return null;
        groups.push((octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      groups.push(Number.parseInt(part, 16));
    }
    return groups;
  };

  const head = expand(halves[0]!);
  const tail = halves.length === 2 ? expand(halves[1]!) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - tail.length;
  if (fill < 1) return null;
  return [...head, ...Array<number>(fill).fill(0), ...tail];
}

function isDisallowedIpv4(octets: number[]): boolean {
  const [a, b] = octets as [number, number, number, number];
  if (a === 0) return true; // unspecified / "this network"
  if (a === 127) return true; // loopback
  if (a === 10) return true; // private
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 169 && b === 254) return true; // link-local
  return false;
}

/**
 * True when an IP literal is loopback, unspecified, private, link-local, or an
 * IPv4-mapped IPv6 address embedding one of those. Unparseable input fails closed.
 */
export function isDisallowedAddress(address: string): boolean {
  const ipv4 = parseIpv4(address);
  if (ipv4) return isDisallowedIpv4(ipv4);

  const groups = parseIpv6(address);
  if (!groups) return true;

  const isMapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  if (isMapped) {
    return isDisallowedIpv4([groups[6]! >> 8, groups[6]! & 0xff, groups[7]! >> 8, groups[7]! & 0xff]);
  }
  if (groups.every((group) => group === 0)) return true; // ::
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true; // ::1
  if ((groups[0]! & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((groups[0]! & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  return false;
}

function fail(reason: GuardedFetchErrorReason, message: string, status?: number): GuardedFetchResult {
  return status === undefined ? { kind: "error", reason, message } : { kind: "error", reason, status, message };
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Hostname without IPv6 brackets, lowercased. */
function hostnameOf(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

async function readCappedText(response: Response, maxBytes: number): Promise<{ capped: false; text: string } | { capped: true }> {
  if (!response.body) return { capped: false, text: "" };
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
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
  const originHost = hostnameOf(target);

  for (let hop = 0; ; hop += 1) {
    if (target.protocol !== "https:") return fail("policy", `Only https: URLs are allowed, got ${target.protocol}//`);
    const hostname = hostnameOf(target);
    if (!hostname) return fail("policy", `URL has no hostname: ${target.href}`);
    if (hostname !== originHost) return fail("policy", `Redirect to a different host is not allowed: ${originHost} -> ${hostname}`);

    let addresses: { address: string; family: number }[];
    try {
      addresses = await lookup(hostname);
    } catch (cause) {
      return fail("network", `DNS lookup failed for ${hostname}: ${describe(cause)}`);
    }
    if (addresses.length === 0) return fail("network", `DNS lookup returned no addresses for ${hostname}`);
    const disallowed = addresses.find((entry) => isDisallowedAddress(entry.address));
    if (disallowed) return fail("policy", `${hostname} resolves to a disallowed address: ${disallowed.address}`);

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      let response: Response;
      try {
        response = await doFetch(target.toString(), { method: "GET", redirect: "manual", signal: controller.signal, headers });
      } catch (cause) {
        if (timedOut) return fail("timeout", `Request to ${target.href} timed out after ${timeoutMs}ms`);
        return fail("network", `Request to ${target.href} failed: ${describe(cause)}`);
      }

      if (REDIRECT_STATUSES.has(response.status)) {
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
      if (response.status === 304) return { kind: "not_modified" };
      if (response.status === 404 || response.status === 410) return { kind: "absent", status: response.status };
      if (response.status < 200 || response.status > 299) {
        return fail("http", `Unexpected status ${response.status} from ${target.href}`, response.status);
      }

      let read: Awaited<ReturnType<typeof readCappedText>>;
      try {
        read = await readCappedText(response, maxBytes);
      } catch (cause) {
        if (timedOut) return fail("timeout", `Reading ${target.href} timed out after ${timeoutMs}ms`);
        return fail("network", `Reading ${target.href} failed: ${describe(cause)}`);
      }
      if (read.capped) {
        controller.abort();
        return fail("too_large", `Response from ${target.href} exceeded ${maxBytes} bytes`);
      }

      return {
        kind: "ok",
        status: response.status,
        body: read.text,
        etag: response.headers.get("etag") ?? undefined,
        lastModified: response.headers.get("last-modified") ?? undefined,
        contentType: response.headers.get("content-type") ?? undefined,
        finalUrl: target.toString(),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
