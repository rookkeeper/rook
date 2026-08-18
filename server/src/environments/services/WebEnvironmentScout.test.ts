// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import type { GuardedFetchOptions, GuardedFetchResult } from "../../infrastructure/http/guardedFetch.js";
import { EnvironmentRepositoryDatastore } from "../datastores/EnvironmentRepositoryDatastore.js";
import { WebEnvironmentRepository } from "../repositories/WebEnvironmentRepository.js";
import { WebEnvironmentScout, type WebEnvironmentScoutOptions } from "./WebEnvironmentScout.js";

const HOST = "example.com";
const ENVIRONMENT_ID = `web:${HOST}`;
const LLMS_URL = `https://${HOST}/llms.txt`;
const AGENTS_URL = `https://${HOST}/AGENTS.md`;
const INDEX_URL = `https://${HOST}/.well-known/agent-skills/index.json`;
const START = Date.parse("2026-08-18T12:00:00.000Z");
const TTL_MS = 60_000;
const ERROR_TTL_MS = 10_000;

/** A route may leave `finalUrl` out; `respond` fills in the url that was requested. */
type Route = GuardedFetchResult | (Omit<Extract<GuardedFetchResult, { kind: "ok" }>, "finalUrl"> & { finalUrl?: string });

type Routes = Record<string, Route>;

function ok(body: string, validators: { etag?: string; lastModified?: string; finalUrl?: string } = {}): Route {
  return { kind: "ok", status: 200, body, ...validators };
}

/** The routed answer for one url, defaulting `finalUrl` to the url asked for. */
function respond(routes: Routes, url: string): GuardedFetchResult {
  const route = routes[url] ?? ABSENT;
  return route.kind === "ok" ? { ...route, finalUrl: route.finalUrl ?? url } : route;
}

function notModified(validators: { etag?: string; lastModified?: string } = {}): GuardedFetchResult {
  return { kind: "not_modified", ...validators };
}

const ABSENT: GuardedFetchResult = { kind: "absent", status: 404 };

function failed(message = "connection reset"): GuardedFetchResult {
  return { kind: "error", reason: "network", message };
}

function digestOf(body: string): string {
  return `sha256:${createHash("sha256").update(Buffer.from(body, "utf8")).digest("hex")}`;
}

function skillUrl(name: string): string {
  return `https://${HOST}/skills/${name}.md`;
}

function entry(name: string, body: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name,
    type: "skill-md",
    description: `Does ${name}.`,
    url: skillUrl(name),
    digest: digestOf(body),
    ...overrides,
  };
}

function indexBody(entries: unknown[], schema = "https://schemas.agentskills.io/discovery/v1"): string {
  return JSON.stringify({ $schema: schema, skills: entries });
}

describe("WebEnvironmentScout", () => {
  const datastores: EnvironmentRepositoryDatastore[] = [];

  afterEach(() => {
    for (const datastore of datastores) datastore.close();
    datastores.length = 0;
  });

  function openRepository(): WebEnvironmentRepository {
    const datastore = new EnvironmentRepositoryDatastore(":memory:");
    datastores.push(datastore);
    return new WebEnvironmentRepository(datastore);
  }

  /** A scout wired to a mutable route table, plus the call log and a movable clock. */
  function harness(routes: Routes, overrides: Partial<WebEnvironmentScoutOptions> = {}) {
    const repository = overrides.repository ?? openRepository();
    const calls: { url: string; options: GuardedFetchOptions }[] = [];
    const clock = { now: START };
    const scout = new WebEnvironmentScout({
      repository,
      ttlMs: TTL_MS,
      errorTtlMs: ERROR_TTL_MS,
      now: () => clock.now,
      fetch: async (url, options) => {
        calls.push({ url, options });
        return respond(routes, url);
      },
      ...overrides,
    });
    return { scout, repository, calls, clock, urls: () => calls.map((call) => call.url) };
  }

  it("records llms.txt, AGENTS.md, and the indexed skills as one site bundle", async () => {
    const first = "---\nname: order-widget\n---\nOrder it.";
    const second = "---\nname: track-order\n---\nTrack it.";
    const { scout, repository, urls } = harness({
      [LLMS_URL]: ok("# Widgets\r\nSee the docs.\n\n", { etag: '"l1"' }),
      [AGENTS_URL]: ok("Confirm before ordering.\n", { lastModified: "Mon, 17 Aug 2026 10:00:00 GMT" }),
      [INDEX_URL]: ok(indexBody([entry("order-widget", first), entry("track-order", second)]), { etag: '"i1"' }),
      [skillUrl("order-widget")]: ok(first),
      [skillUrl("track-order")]: ok(second),
    });

    expect(await scout.scout(HOST)).toEqual({ status: "scouted", changed: true, result: "content" });

    const loaded = await repository.getBundles(ENVIRONMENT_ID);
    expect(loaded.bundles).toHaveLength(1);
    expect(loaded.bundles[0]).toMatchObject({
      id: `${ENVIRONMENT_ID}#site`,
      bundleId: "site",
      repository: "web",
      sourceUrl: `https://${HOST}/`,
      llmsTxt: "# Widgets\nSee the docs.",
      agentsMd: "Confirm before ordering.",
      errors: [],
    });
    expect(loaded.bundles[0]?.skills.map((skill) => [skill.id, skill.files[`${skill.id}/SKILL.md`]])).toEqual([
      ["order-widget", first],
      ["track-order", second],
    ]);
    expect(repository.getScoutState(HOST)).toMatchObject({
      status: "content",
      fetchedAt: new Date(START).toISOString(),
      validators: {
        "llms.txt": { etag: '"l1"' },
        "AGENTS.md": { lastModified: "Mon, 17 Aug 2026 10:00:00 GMT" },
        "skills-index": { etag: '"i1"' },
      },
    });
    expect(urls()).toHaveLength(5);
  });

  it("keeps whatever the site does publish when a resource is missing", async () => {
    const body = "---\nname: order-widget\n---\nOrder it.";
    const present: Routes = {
      [LLMS_URL]: ok("# Widgets"),
      [AGENTS_URL]: ok("Confirm first."),
      [INDEX_URL]: ok(indexBody([entry("order-widget", body)])),
      [skillUrl("order-widget")]: ok(body),
    };

    for (const missing of [LLMS_URL, AGENTS_URL, INDEX_URL]) {
      const routes = { ...present, [missing]: ABSENT };
      const { scout, repository } = harness(routes);

      expect(await scout.scout(HOST)).toEqual({ status: "scouted", changed: true, result: "content" });
      const bundle = (await repository.getBundles(ENVIRONMENT_ID)).bundles[0];
      expect(bundle?.llmsTxt !== undefined).toBe(missing !== LLMS_URL);
      expect(bundle?.agentsMd !== undefined).toBe(missing !== AGENTS_URL);
      expect(bundle?.skills.length).toBe(missing === INDEX_URL ? 0 : 1);
    }

    const { scout, repository } = harness({});
    expect(await scout.scout(HOST)).toEqual({ status: "scouted", changed: false, result: "empty" });
    expect(repository.getScoutState(HOST)?.status).toBe("empty");
    expect((await repository.getBundles(ENVIRONMENT_ID)).bundles).toEqual([]);
  });

  it("refuses an HTML fallback served in place of llms.txt", async () => {
    const { scout, repository } = harness({
      [LLMS_URL]: ok("<!DOCTYPE html>\n<html><body>Not found</body></html>"),
      [AGENTS_URL]: ok("Confirm first."),
    });

    await scout.scout(HOST);

    const bundle = (await repository.getBundles(ENVIRONMENT_ID)).bundles[0];
    expect(bundle?.llmsTxt).toBeUndefined();
    expect(bundle?.agentsMd).toBe("Confirm first.");
    expect(bundle?.errors).toEqual([expect.objectContaining({ code: "invalid_bundle_contents", url: LLMS_URL, bundleId: "site" })]);
    expect(repository.getScoutState(HOST)?.validators["llms.txt"]).toBeUndefined();
  });

  it("reports an unusable index and still takes the entries that validate", async () => {
    const good = "---\nname: good-skill\n---\nDo good.";

    const malformed = harness({ [AGENTS_URL]: ok("Confirm first."), [INDEX_URL]: ok("{ not json") });
    await malformed.scout.scout(HOST);
    expect(malformed.repository.getScoutState(HOST)?.errors).toEqual([
      expect.objectContaining({ code: "invalid_bundle_contents", url: INDEX_URL, message: expect.stringContaining("not valid JSON") }),
    ]);

    const unknownSchema = harness({ [AGENTS_URL]: ok("Confirm first."), [INDEX_URL]: ok(indexBody([], "https://example.com/other")) });
    await unknownSchema.scout.scout(HOST);
    expect(unknownSchema.repository.getScoutState(HOST)?.errors).toEqual([
      expect.objectContaining({ code: "invalid_bundle_contents", message: expect.stringContaining("$schema") }),
    ]);

    const mixed = harness({
      [INDEX_URL]: ok(indexBody([
        entry("good-skill", good),
        entry("Bad Name", good),
        entry("bad-digest", good, { digest: "sha256:nope" }),
        entry("good-skill", good, { description: "A second one." }),
      ])),
      [skillUrl("good-skill")]: ok(good),
    });

    await mixed.scout.scout(HOST);

    const bundle = (await mixed.repository.getBundles(ENVIRONMENT_ID)).bundles[0];
    expect(bundle?.skills.map((skill) => skill.id)).toEqual(["good-skill"]);
    expect(mixed.repository.getScoutState(HOST)?.errors.map((error) => error.message)).toEqual([
      expect.stringContaining("invalid name"),
      expect.stringContaining("invalid digest"),
      expect.stringContaining("more than once"),
    ]);
  });

  it("skips an archive skill but still takes its skill-md sibling", async () => {
    const body = "---\nname: order-widget\n---\nOrder it.";
    const { scout, repository, urls } = harness({
      [INDEX_URL]: ok(indexBody([
        entry("bundled-pack", body, { type: "archive", url: `https://${HOST}/skills/pack.tar.gz` }),
        entry("order-widget", body),
      ])),
      [skillUrl("order-widget")]: ok(body),
    });

    await scout.scout(HOST);

    const bundle = (await repository.getBundles(ENVIRONMENT_ID)).bundles[0];
    expect(bundle?.skills.map((skill) => skill.id)).toEqual(["order-widget"]);
    expect(repository.getScoutState(HOST)?.errors).toEqual([
      expect.objectContaining({ code: "unsupported_capability", url: `https://${HOST}/skills/pack.tar.gz`, message: expect.stringContaining("archive") }),
    ]);
    expect(urls()).not.toContain(`https://${HOST}/skills/pack.tar.gz`);
  });

  it("fetches a cross-origin skill url and drops a body that fails its digest", async () => {
    const trusted = "---\nname: trusted\n---\nTrusted.";
    const crossOriginUrl = "https://cdn.example.net/skills/trusted.md";
    const { scout, repository, urls } = harness({
      [INDEX_URL]: ok(indexBody([
        entry("trusted", trusted, { url: crossOriginUrl }),
        entry("tampered", trusted),
      ])),
      [crossOriginUrl]: ok(trusted),
      [skillUrl("tampered")]: ok("Something else entirely."),
    });

    await scout.scout(HOST);

    const bundle = (await repository.getBundles(ENVIRONMENT_ID)).bundles[0];
    expect(bundle?.skills.map((skill) => skill.id)).toEqual(["trusted"]);
    expect(urls()).toContain(crossOriginUrl);
    expect(repository.getScoutState(HOST)?.errors).toEqual([
      expect.objectContaining({ code: "invalid_bundle_contents", url: skillUrl("tampered"), message: expect.stringContaining("digest") }),
    ]);
  });

  it("stops at the skill cap and says so", async () => {
    const maxSkills = 3;
    const bodies = Array.from({ length: maxSkills + 1 }, (_index, position) => `---\nname: skill-${position}\n---\nDo ${position}.`);
    const routes: Routes = {
      [INDEX_URL]: ok(indexBody(bodies.map((body, position) => entry(`skill-${position}`, body)))),
    };
    for (const [position, body] of bodies.entries()) routes[skillUrl(`skill-${position}`)] = ok(body);
    const { scout, repository, urls } = harness(routes, { maxSkills });

    await scout.scout(HOST);

    const bundle = (await repository.getBundles(ENVIRONMENT_ID)).bundles[0];
    expect(bundle?.skills).toHaveLength(maxSkills);
    expect(urls()).not.toContain(skillUrl(`skill-${maxSkills}`));
    expect(repository.getScoutState(HOST)?.errors).toEqual([
      expect.objectContaining({ code: "invalid_bundle_contents", message: expect.stringContaining(`only the first ${maxSkills}`) }),
    ]);
  });

  it("skips a fresh host unless the caller forces a pass", async () => {
    const { scout, repository, clock, calls } = harness({ [AGENTS_URL]: ok("Confirm first.") });
    await scout.scout(HOST);
    const fetched = calls.length;

    clock.now = START + TTL_MS - 1;
    expect(await scout.scout(HOST)).toEqual({ status: "fresh", changed: false });
    expect(calls).toHaveLength(fetched);

    expect(await scout.scout(HOST, { force: true })).toEqual({ status: "scouted", changed: false, result: "content" });
    expect(calls.length).toBeGreaterThan(fetched);
    expect(repository.getScoutState(HOST)?.fetchedAt).toBe(new Date(clock.now).toISOString());
  });

  it("revalidates a stale host with the stored validators and keeps the bundle", async () => {
    const body = "---\nname: order-widget\n---\nOrder it.";
    const routes: Routes = {
      [LLMS_URL]: ok("# Widgets", { etag: '"l1"' }),
      [AGENTS_URL]: ok("Confirm first.", { lastModified: "Mon, 17 Aug 2026 10:00:00 GMT" }),
      [INDEX_URL]: ok(indexBody([entry("order-widget", body)]), { etag: '"i1"' }),
      [skillUrl("order-widget")]: ok(body),
    };
    const { scout, repository, clock, calls } = harness(routes);
    await scout.scout(HOST);
    const before = calls.length;

    routes[LLMS_URL] = notModified({ etag: '"l2"' });
    routes[AGENTS_URL] = notModified();
    routes[INDEX_URL] = notModified();
    clock.now = START + TTL_MS;

    expect(await scout.scout(HOST)).toEqual({ status: "scouted", changed: false, result: "content" });

    const conditional = calls.slice(before);
    expect(conditional.map((call) => [call.url, call.options.ifNoneMatch, call.options.ifModifiedSince])).toEqual([
      [LLMS_URL, '"l1"', undefined],
      [AGENTS_URL, undefined, "Mon, 17 Aug 2026 10:00:00 GMT"],
      [INDEX_URL, '"i1"', undefined],
    ]);
    const bundle = (await repository.getBundles(ENVIRONMENT_ID)).bundles[0];
    expect(bundle).toMatchObject({ llmsTxt: "# Widgets", agentsMd: "Confirm first." });
    expect(bundle?.skills[0]?.files["order-widget/SKILL.md"]).toBe(body);
    expect(repository.getScoutState(HOST)).toMatchObject({
      fetchedAt: new Date(START + TTL_MS).toISOString(),
      validators: { "llms.txt": { etag: '"l2"' } },
    });
  });

  it("merges a changed resource with the ones that revalidated", async () => {
    const routes: Routes = {
      [LLMS_URL]: ok("# Widgets", { etag: '"l1"' }),
      [AGENTS_URL]: ok("Confirm first.", { etag: '"a1"' }),
    };
    const { scout, repository, clock } = harness(routes);
    await scout.scout(HOST);

    routes[LLMS_URL] = notModified();
    routes[AGENTS_URL] = ok("Confirm twice.", { etag: '"a2"' });
    clock.now = START + TTL_MS;

    expect(await scout.scout(HOST)).toEqual({ status: "scouted", changed: true, result: "content" });

    expect((await repository.getBundles(ENVIRONMENT_ID)).bundles[0]).toMatchObject({
      llmsTxt: "# Widgets",
      agentsMd: "Confirm twice.",
    });
    expect(repository.getScoutState(HOST)?.validators).toEqual({ "llms.txt": { etag: '"l1"' }, "AGENTS.md": { etag: '"a2"' } });
  });

  it("carries the stored skills into a bundle rebuilt for changed instructions", async () => {
    const first = "---\nname: order-widget\n---\nOrder it.";
    const second = "---\nname: track-order\n---\nTrack it.";
    const routes: Routes = {
      [AGENTS_URL]: ok("Confirm first.", { etag: '"a1"' }),
      [INDEX_URL]: ok(indexBody([entry("order-widget", first), entry("track-order", second)]), { etag: '"i1"' }),
      [skillUrl("order-widget")]: ok(first),
      [skillUrl("track-order")]: ok(second),
    };
    const { scout, repository, clock, urls } = harness(routes);
    await scout.scout(HOST);
    const before = urls().length;

    routes[AGENTS_URL] = ok("Confirm twice.", { etag: '"a2"' });
    routes[INDEX_URL] = notModified();
    clock.now = START + TTL_MS;

    expect(await scout.scout(HOST)).toEqual({ status: "scouted", changed: true, result: "content" });

    const bundle = (await repository.getBundles(ENVIRONMENT_ID)).bundles[0];
    expect(bundle).toMatchObject({ agentsMd: "Confirm twice." });
    expect(bundle?.skills.map((skill) => [skill.id, skill.files[`${skill.id}/SKILL.md`]])).toEqual([
      ["order-widget", first],
      ["track-order", second],
    ]);
    // The unchanged index means the skills themselves are never refetched.
    expect(urls().slice(before)).toEqual([LLMS_URL, AGENTS_URL, INDEX_URL]);
  });

  it("keeps stored content when the site stops answering", async () => {
    const routes: Routes = { [LLMS_URL]: ok("# Widgets", { etag: '"l1"' }), [AGENTS_URL]: ok("Confirm first.", { etag: '"a1"' }) };
    const { scout, repository, clock } = harness(routes);
    await scout.scout(HOST);

    routes[LLMS_URL] = failed();
    routes[AGENTS_URL] = failed();
    routes[INDEX_URL] = failed();
    clock.now = START + TTL_MS;

    expect(await scout.scout(HOST)).toEqual({ status: "scouted", changed: false, result: "error" });
    expect(repository.getScoutState(HOST)).toMatchObject({ status: "error", fetchedAt: new Date(clock.now).toISOString() });
    expect(repository.getScoutState(HOST)?.errors).toHaveLength(3);
    expect((await repository.getBundles(ENVIRONMENT_ID)).bundles[0]).toMatchObject({ llmsTxt: "# Widgets", agentsMd: "Confirm first." });

    routes[AGENTS_URL] = notModified();
    routes[INDEX_URL] = ABSENT;
    clock.now = START + 2 * TTL_MS;

    expect(await scout.scout(HOST)).toEqual({ status: "scouted", changed: false, result: "content" });
    const state = repository.getScoutState(HOST);
    expect(state?.status).toBe("content");
    expect(state?.errors).toEqual([expect.objectContaining({ code: "unreachable_url", url: LLMS_URL })]);
    expect((await repository.getBundles(ENVIRONMENT_ID)).bundles[0]).toMatchObject({ llmsTxt: "# Widgets", agentsMd: "Confirm first." });
  });

  it("shares one pass between concurrent scouts of the same host", async () => {
    const { scout, urls } = harness({ [AGENTS_URL]: ok("Confirm first.") });

    const [left, right] = await Promise.all([scout.scout(HOST), scout.scout(HOST)]);

    expect(left).toEqual({ status: "scouted", changed: true, result: "content" });
    expect(right).toEqual(left);
    expect(urls()).toEqual([LLMS_URL, AGENTS_URL, INDEX_URL]);
  });

  it("skips a host shape it cannot probe, and throws only for a string that is no host", async () => {
    const { scout, calls } = harness({});

    for (const unscoutable of ["user@evil.example", "example.com:8443", "[2606:4700:4700::1111]"]) {
      expect(await scout.scout(unscoutable)).toEqual({ status: "skipped", changed: false });
    }
    await expect(scout.scout("exa mple.com")).rejects.toThrow(/Invalid web scout host/);
    await expect(scout.scout("")).rejects.toThrow(/Invalid web scout host/);
    expect(calls).toEqual([]);
  });

  it("records a transient failure as an error rather than durable emptiness", async () => {
    const { scout, repository, clock } = harness({ [LLMS_URL]: failed() });

    expect(await scout.scout(HOST)).toEqual({ status: "scouted", changed: false, result: "error" });

    expect(repository.getScoutState(HOST)).toMatchObject({ status: "error", fetchedAt: new Date(START).toISOString() });
    expect((await repository.getBundles(ENVIRONMENT_ID)).bundles).toEqual([]);
    // The shorter error TTL applies, so the host is retried long before a settled answer
    // would be refreshed.
    clock.now = START + ERROR_TTL_MS;
    expect(repository.isStale(HOST, { ttlMs: TTL_MS, errorTtlMs: ERROR_TTL_MS, now: clock.now })).toBe(true);
    expect(repository.isStale(HOST, { ttlMs: TTL_MS, now: clock.now })).toBe(false);
  });

  it("keeps the published skill when its fetch fails, and refetches the index next pass", async () => {
    const first = "---\nname: order-widget\n---\nOrder it.";
    const second = "---\nname: track-order\n---\nTrack it.";
    const routes: Routes = {
      [INDEX_URL]: ok(indexBody([entry("order-widget", first), entry("track-order", second)]), { etag: '"i1"' }),
      [skillUrl("order-widget")]: ok(first),
      [skillUrl("track-order")]: ok(second),
    };
    const { scout, repository, clock, calls } = harness(routes);
    await scout.scout(HOST);
    expect(repository.getScoutState(HOST)?.validators["skills-index"]).toEqual({ etag: '"i1"' });

    routes[skillUrl("track-order")] = failed();
    clock.now = START + TTL_MS;

    expect(await scout.scout(HOST)).toEqual({ status: "scouted", changed: false, result: "content" });

    // The skill that failed keeps the body the site published, and the failure is reported.
    const bundle = (await repository.getBundles(ENVIRONMENT_ID)).bundles[0];
    expect(bundle?.skills.map((skill) => [skill.id, skill.files[`${skill.id}/SKILL.md`]])).toEqual([
      ["order-widget", first],
      ["track-order", second],
    ]);
    expect(repository.getScoutState(HOST)?.errors).toEqual([
      expect.objectContaining({ code: "unreachable_url", url: skillUrl("track-order") }),
    ]);
    // Withholding the index validator is what makes the next pass retry the failed skill
    // instead of taking a 304 on the index and never looking again.
    expect(repository.getScoutState(HOST)?.validators["skills-index"]).toBeUndefined();

    routes[skillUrl("track-order")] = ok(second);
    clock.now = START + 2 * TTL_MS;
    const before = calls.length;
    await scout.scout(HOST);

    expect(calls.slice(before).filter((call) => call.url === INDEX_URL).map((call) => call.options.ifNoneMatch)).toEqual([undefined]);
    expect(repository.getScoutState(HOST)?.validators["skills-index"]).toEqual({ etag: '"i1"' });
    expect(repository.getScoutState(HOST)?.errors).toEqual([]);
  });

  it("keeps the published skill when its url has gone missing", async () => {
    const body = "---\nname: order-widget\n---\nOrder it.";
    const routes: Routes = {
      [INDEX_URL]: ok(indexBody([entry("order-widget", body)]), { etag: '"i1"' }),
      [skillUrl("order-widget")]: ok(body),
    };
    const { scout, repository, clock } = harness(routes);
    await scout.scout(HOST);

    routes[skillUrl("order-widget")] = ABSENT;
    clock.now = START + TTL_MS;

    expect(await scout.scout(HOST)).toEqual({ status: "scouted", changed: false, result: "content" });
    const bundle = (await repository.getBundles(ENVIRONMENT_ID)).bundles[0];
    expect(bundle?.skills[0]?.files["order-widget/SKILL.md"]).toBe(body);
    expect(repository.getScoutState(HOST)?.errors).toEqual([
      expect.objectContaining({ code: "unreachable_url", url: skillUrl("order-widget") }),
    ]);
  });

  it("takes a skill whose body carries a byte-order mark and stores it without one", async () => {
    const served = `\uFEFF---\nname: order-widget\n---\nOrder it.`;
    const { scout, repository } = harness({
      // The publisher's digest is over the bytes it serves, mark included.
      [INDEX_URL]: ok(indexBody([entry("order-widget", served)])),
      [skillUrl("order-widget")]: ok(served),
    });

    await scout.scout(HOST);

    const bundle = (await repository.getBundles(ENVIRONMENT_ID)).bundles[0];
    expect(bundle?.skills[0]?.files["order-widget/SKILL.md"]).toBe(served.slice(1));
    expect(repository.getScoutState(HOST)?.errors).toEqual([]);
  });

  it("resolves a relative skill url against the index url", async () => {
    const body = "---\nname: order-widget\n---\nOrder it.";
    const resolved = `https://${HOST}/.well-known/agent-skills/order-widget.md`;
    const { scout, repository, urls } = harness({
      [INDEX_URL]: ok(indexBody([entry("order-widget", body, { url: "order-widget.md" })])),
      [resolved]: ok(body),
    });

    await scout.scout(HOST);

    expect(urls()).toContain(resolved);
    expect((await repository.getBundles(ENVIRONMENT_ID)).bundles[0]?.skills[0]?.files["order-widget/SKILL.md"]).toBe(body);
  });

  it("resolves a relative skill url against the url the index was finally served from", async () => {
    const body = "---\nname: alpha\n---\nDo alpha.";
    const resolved = `https://${HOST}/skills/alpha/SKILL.md`;
    const { scout, repository, urls } = harness({
      // A redirect moved the index into /skills/, so its relative entries hang off there.
      [INDEX_URL]: ok(indexBody([entry("alpha", body, { url: "./alpha/SKILL.md" })]), { finalUrl: `https://${HOST}/skills/index.json` }),
      [resolved]: ok(body),
    });

    await scout.scout(HOST);

    expect(urls()).toContain(resolved);
    expect((await repository.getBundles(ENVIRONMENT_ID)).bundles[0]?.skills[0]?.files["alpha/SKILL.md"]).toBe(body);
  });

  it("records an error when the only content an index offered could not be fetched", async () => {
    const body = "---\nname: order-widget\n---\nOrder it.";
    const { scout, repository } = harness({
      [INDEX_URL]: ok(indexBody([entry("order-widget", body)]), { etag: '"i1"' }),
      [skillUrl("order-widget")]: failed(),
    });

    // Emptiness here is the failed skill fetch talking, not the site saying it publishes
    // nothing, so the pass is an error and gets retried on the shorter error TTL.
    expect(await scout.scout(HOST)).toEqual({ status: "scouted", changed: false, result: "error" });
    expect(repository.getScoutState(HOST)).toMatchObject({ status: "error" });
    expect(repository.getScoutState(HOST)?.errors).toEqual([
      expect.objectContaining({ code: "unreachable_url", url: skillUrl("order-widget") }),
    ]);
    expect((await repository.getBundles(ENVIRONMENT_ID)).bundles).toEqual([]);
  });

  it("drops llms.txt when the host starts serving an empty body for it", async () => {
    const routes: Routes = { [LLMS_URL]: ok("# Widgets", { etag: '"l1"' }), [AGENTS_URL]: ok("Confirm first.", { etag: '"a1"' }) };
    const { scout, repository, clock } = harness(routes);
    await scout.scout(HOST);

    routes[LLMS_URL] = ok("");
    clock.now = START + TTL_MS;

    expect(await scout.scout(HOST)).toEqual({ status: "scouted", changed: true, result: "content" });

    const bundle = (await repository.getBundles(ENVIRONMENT_ID)).bundles[0];
    expect(bundle?.llmsTxt).toBeUndefined();
    expect(bundle?.agentsMd).toBe("Confirm first.");
    expect(repository.getScoutState(HOST)?.validators["llms.txt"]).toBeUndefined();
  });

  it("fetches at most four skills at a time", async () => {
    const names = Array.from({ length: 8 }, (_value, position) => `skill-${position}`);
    const bodies = new Map(names.map((name) => [name, `---\nname: ${name}\n---\nDo it.`]));
    const routes: Routes = { [INDEX_URL]: ok(indexBody(names.map((name) => entry(name, bodies.get(name)!)))) };
    for (const name of names) routes[skillUrl(name)] = ok(bodies.get(name)!);

    let active = 0;
    let peak = 0;
    const { scout, repository } = harness(routes, {
      fetch: async (url) => {
        if (!url.startsWith(`https://${HOST}/skills/`)) return respond(routes, url);
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
        return respond(routes, url);
      },
    });

    await scout.scout(HOST);

    expect((await repository.getBundles(ENVIRONMENT_ID)).bundles[0]?.skills).toHaveLength(names.length);
    expect(peak).toBe(4);
  });

  it("leaves no in-flight entry behind when recording the pass throws", async () => {
    const repository = openRepository();
    const record = repository.recordScout.bind(repository);
    let failNext = true;
    repository.recordScout = (input) => {
      if (failNext) {
        failNext = false;
        throw new Error("store is busy");
      }
      return record(input);
    };
    const { scout, urls } = harness({ [AGENTS_URL]: ok("Confirm first.") }, { repository });

    await expect(scout.scout(HOST)).rejects.toThrow("store is busy");

    // A second visit must start a fresh pass rather than re-await the failed one.
    expect(await scout.scout(HOST)).toEqual({ status: "scouted", changed: true, result: "content" });
    expect(urls()).toEqual([LLMS_URL, AGENTS_URL, INDEX_URL, LLMS_URL, AGENTS_URL, INDEX_URL]);
  });
});
