// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_ACCEPT, guardedFetch, type HostLookup } from "./guardedFetch.js";

const PUBLIC_LOOKUP: HostLookup = async () => [{ address: "93.184.216.34", family: 4 }];

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return handler(String(input), init ?? {});
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function headersOf(init: RequestInit): Record<string, string> {
  return init.headers as Record<string, string>;
}

describe("guardedFetch", () => {
  it("returns ok with the body, validators, and final URL for a 2xx response", async () => {
    const { impl } = stubFetch(() => new Response("# llms", {
      status: 200,
      headers: { etag: '"v1"', "last-modified": "Mon, 17 Aug 2026 12:00:00 GMT", "content-type": "text/markdown" },
    }));

    const result = await guardedFetch("https://example.com/llms.txt", { fetch: impl, lookup: PUBLIC_LOOKUP });

    expect(result).toEqual({
      kind: "ok",
      status: 200,
      body: "# llms",
      etag: '"v1"',
      lastModified: "Mon, 17 Aug 2026 12:00:00 GMT",
      contentType: "text/markdown",
      finalUrl: "https://example.com/llms.txt",
    });
  });

  it("maps 304, 404, and 500 responses to not_modified, absent, and an http error", async () => {
    const call = async (status: number, headers?: Record<string, string>) => {
      const { impl } = stubFetch(() => new Response(status === 304 ? null : "body", { status, headers }));
      return guardedFetch("https://example.com/AGENTS.md", { fetch: impl, lookup: PUBLIC_LOOKUP });
    };

    expect(await call(304, { etag: '"v1"', "last-modified": "Mon, 17 Aug 2026 12:00:00 GMT" })).toEqual({
      kind: "not_modified",
      etag: '"v1"',
      lastModified: "Mon, 17 Aug 2026 12:00:00 GMT",
    });
    expect(await call(404)).toEqual({ kind: "absent", status: 404 });
    expect(await call(500)).toMatchObject({ kind: "error", reason: "http", status: 500 });
  });

  it("refuses non-https URLs without making a request", async () => {
    const { impl, calls } = stubFetch(() => new Response("nope"));

    const result = await guardedFetch("http://example.com/llms.txt", { fetch: impl, lookup: PUBLIC_LOOKUP });

    expect(result).toMatchObject({ kind: "error", reason: "policy" });
    expect(calls).toHaveLength(0);
  });

  it("refuses a string that is not a URL", async () => {
    const { impl, calls } = stubFetch(() => new Response("nope"));

    const result = await guardedFetch("not a url", { fetch: impl, lookup: PUBLIC_LOOKUP });

    expect(result).toMatchObject({ kind: "error", reason: "policy" });
    expect(calls).toHaveLength(0);
  });

  it("refuses a host that resolves to a private address without making a request", async () => {
    const { impl, calls } = stubFetch(() => new Response("nope"));

    const result = await guardedFetch("https://intranet.example.com/llms.txt", {
      fetch: impl,
      lookup: async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }],
    });

    expect(result).toMatchObject({ kind: "error", reason: "policy" });
    expect(calls).toHaveLength(0);
  });

  it("refuses loopback literals through the default resolver", async () => {
    for (const url of ["https://127.0.0.1/llms.txt", "https://[::1]/llms.txt"]) {
      const { impl, calls } = stubFetch(() => new Response("nope"));

      const result = await guardedFetch(url, { fetch: impl });

      expect(result).toMatchObject({ kind: "error", reason: "policy" });
      expect(calls).toHaveLength(0);
    }
  });

  it("reports a failing DNS lookup as a network error", async () => {
    const { impl, calls } = stubFetch(() => new Response("nope"));

    const result = await guardedFetch("https://example.com/llms.txt", {
      fetch: impl,
      lookup: async () => { throw new Error("ENOTFOUND"); },
    });

    expect(result).toMatchObject({ kind: "error", reason: "network" });
    expect(calls).toHaveLength(0);
  });

  it("follows a same-host redirect", async () => {
    const { impl, calls } = stubFetch((url) => (url === "https://example.com/llms.txt"
      ? new Response(null, { status: 301, headers: { location: "https://example.com/docs/llms.txt" } })
      : new Response("moved body", { status: 200 })));

    const result = await guardedFetch("https://example.com/llms.txt", { fetch: impl, lookup: PUBLIC_LOOKUP });

    expect(calls.map((call) => call.url)).toEqual(["https://example.com/llms.txt", "https://example.com/docs/llms.txt"]);
    expect(result).toMatchObject({ kind: "ok", body: "moved body", finalUrl: "https://example.com/docs/llms.txt" });
  });

  it("refuses a redirect to a different host", async () => {
    const { impl } = stubFetch(() => new Response(null, { status: 302, headers: { location: "https://cdn.other.com/llms.txt" } }));

    const result = await guardedFetch("https://example.com/llms.txt", { fetch: impl, lookup: PUBLIC_LOOKUP });

    expect(result).toMatchObject({ kind: "error", reason: "policy" });
  });

  it("refuses a redirect to a different port on the same hostname", async () => {
    const { impl } = stubFetch(() => new Response(null, { status: 302, headers: { location: "https://example.com:8443/llms.txt" } }));

    const result = await guardedFetch("https://example.com/llms.txt", { fetch: impl, lookup: PUBLIC_LOOKUP });

    expect(result).toMatchObject({ kind: "error", reason: "policy" });
  });

  it("reports a redirect without a Location header as an http error", async () => {
    const { impl } = stubFetch(() => new Response(null, { status: 301 }));

    const result = await guardedFetch("https://example.com/llms.txt", { fetch: impl, lookup: PUBLIC_LOOKUP });

    expect(result).toMatchObject({ kind: "error", reason: "http", status: 301 });
  });

  it("refuses more redirects than the hop limit", async () => {
    let hop = 0;
    const { impl, calls } = stubFetch(() => {
      hop += 1;
      return new Response(null, { status: 307, headers: { location: `https://example.com/hop-${hop}` } });
    });

    const result = await guardedFetch("https://example.com/llms.txt", { fetch: impl, lookup: PUBLIC_LOOKUP, maxRedirects: 2 });

    expect(calls).toHaveLength(3);
    expect(result).toMatchObject({ kind: "error", reason: "policy" });
  });

  it("refuses the first redirect when the hop limit is zero", async () => {
    const { impl, calls } = stubFetch(() => new Response(null, { status: 308, headers: { location: "https://example.com/docs/llms.txt" } }));

    const result = await guardedFetch("https://example.com/llms.txt", { fetch: impl, lookup: PUBLIC_LOOKUP, maxRedirects: 0 });

    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ kind: "error", reason: "policy" });
  });

  it("reports a timeout when the request is aborted by the deadline", async () => {
    const { impl } = stubFetch((_url, init) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => {
        const error = new Error("This operation was aborted");
        error.name = "AbortError";
        reject(error);
      });
    }));

    const result = await guardedFetch("https://example.com/llms.txt", { fetch: impl, lookup: PUBLIC_LOOKUP, timeoutMs: 5 });

    expect(result).toMatchObject({ kind: "error", reason: "timeout" });
  });

  it("stops an endless redirect chain at the deadline even when the fetch ignores the signal", async () => {
    let hop = 0;
    const { impl } = stubFetch(async () => {
      hop += 1;
      await new Promise((resolve) => setTimeout(resolve, 1));
      return new Response(null, { status: 302, headers: { location: `https://example.com/hop-${hop}` } });
    });

    const result = await guardedFetch("https://example.com/llms.txt", {
      fetch: impl,
      lookup: PUBLIC_LOOKUP,
      timeoutMs: 5,
      maxRedirects: 1_000,
    });

    expect(result).toMatchObject({ kind: "error", reason: "timeout" });
    expect(hop).toBeLessThan(1_000);
  });

  it("applies the deadline to the DNS lookup too", async () => {
    const { impl, calls } = stubFetch(() => new Response("never reached"));

    const result = await guardedFetch("https://example.com/llms.txt", {
      fetch: impl,
      lookup: () => new Promise(() => {}),
      timeoutMs: 5,
    });

    expect(result).toMatchObject({ kind: "error", reason: "timeout" });
    expect(calls).toHaveLength(0);
  });

  it("stops reading once the response exceeds the size cap", async () => {
    const chunk = new TextEncoder().encode("x".repeat(64));
    let emitted = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        emitted += 1;
        if (emitted > 100) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const { impl } = stubFetch(() => new Response(body, { status: 200 }));

    const result = await guardedFetch("https://example.com/llms.txt", { fetch: impl, lookup: PUBLIC_LOOKUP, maxBytes: 128 });

    expect(result).toMatchObject({ kind: "error", reason: "too_large" });
    expect(emitted).toBeLessThan(10);
  });

  it("sends the fixed user agent and the supplied conditional headers", async () => {
    const { impl, calls } = stubFetch(() => new Response(null, { status: 304 }));

    await guardedFetch("https://example.com/llms.txt", {
      fetch: impl,
      lookup: PUBLIC_LOOKUP,
      ifNoneMatch: '"v1"',
      ifModifiedSince: "Mon, 17 Aug 2026 12:00:00 GMT",
      accept: "text/plain",
    });

    expect(calls[0]!.init.redirect).toBe("manual");
    const { "user-agent": userAgent, ...rest } = headersOf(calls[0]!.init);
    expect(userAgent).toMatch(/^Rook\/\S+ \(\+https:\/\/github\.com\/rookkeeper\/rook\)$/);
    expect(rest).toEqual({
      accept: "text/plain",
      "if-none-match": '"v1"',
      "if-modified-since": "Mon, 17 Aug 2026 12:00:00 GMT",
    });
  });

  it("sends the default Accept header when none is supplied", async () => {
    const { impl, calls } = stubFetch(() => new Response("body", { status: 200 }));

    await guardedFetch("https://example.com/llms.txt", { fetch: impl, lookup: PUBLIC_LOOKUP });

    expect(headersOf(calls[0]!.init).accept).toBe(DEFAULT_ACCEPT);
  });
});
