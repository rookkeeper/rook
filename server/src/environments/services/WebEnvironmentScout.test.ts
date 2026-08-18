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

type Routes = Record<string, GuardedFetchResult>;

function ok(body: string, validators: { etag?: string; lastModified?: string } = {}): GuardedFetchResult {
  return { kind: "ok", status: 200, body, finalUrl: "https://example.com/", ...validators };
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
        return routes[url] ?? ABSENT;
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

    expect(await scout.scout(HOST)).toEqual({ status: "scouted", changed: true });

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

      expect(await scout.scout(HOST)).toEqual({ status: "scouted", changed: true });
      const bundle = (await repository.getBundles(ENVIRONMENT_ID)).bundles[0];
      expect(bundle?.llmsTxt !== undefined).toBe(missing !== LLMS_URL);
      expect(bundle?.agentsMd !== undefined).toBe(missing !== AGENTS_URL);
      expect(bundle?.skills.length).toBe(missing === INDEX_URL ? 0 : 1);
    }

    const { scout, repository } = harness({});
    expect(await scout.scout(HOST)).toEqual({ status: "scouted", changed: false });
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

    expect(await scout.scout(HOST, { force: true })).toEqual({ status: "scouted", changed: false });
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

    expect(await scout.scout(HOST)).toEqual({ status: "scouted", changed: false });

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

    expect(await scout.scout(HOST)).toEqual({ status: "scouted", changed: true });

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

    expect(await scout.scout(HOST)).toEqual({ status: "scouted", changed: true });

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

    expect(await scout.scout(HOST)).toEqual({ status: "scouted", changed: false });
    expect(repository.getScoutState(HOST)).toMatchObject({ status: "error", fetchedAt: new Date(clock.now).toISOString() });
    expect(repository.getScoutState(HOST)?.errors).toHaveLength(3);
    expect((await repository.getBundles(ENVIRONMENT_ID)).bundles[0]).toMatchObject({ llmsTxt: "# Widgets", agentsMd: "Confirm first." });

    routes[AGENTS_URL] = notModified();
    routes[INDEX_URL] = ABSENT;
    clock.now = START + 2 * TTL_MS;

    expect(await scout.scout(HOST)).toEqual({ status: "scouted", changed: false });
    const state = repository.getScoutState(HOST);
    expect(state?.status).toBe("content");
    expect(state?.errors).toEqual([expect.objectContaining({ code: "unreachable_url", url: LLMS_URL })]);
    expect((await repository.getBundles(ENVIRONMENT_ID)).bundles[0]).toMatchObject({ llmsTxt: "# Widgets", agentsMd: "Confirm first." });
  });

  it("shares one pass between concurrent scouts of the same host", async () => {
    const { scout, urls } = harness({ [AGENTS_URL]: ok("Confirm first.") });

    const [left, right] = await Promise.all([scout.scout(HOST), scout.scout(HOST)]);

    expect(left).toEqual({ status: "scouted", changed: true });
    expect(right).toEqual(left);
    expect(urls()).toEqual([LLMS_URL, AGENTS_URL, INDEX_URL]);
  });

  it("refuses a host that is not a bare host before fetching anything", async () => {
    const { scout, calls } = harness({});

    await expect(scout.scout("user@evil.example")).rejects.toThrow(/Invalid web scout host/);
    await expect(scout.scout("exa mple.com")).rejects.toThrow(/Invalid web scout host/);
    await expect(scout.scout("example.com:8443")).rejects.toThrow(/Invalid web scout host/);
    expect(calls).toEqual([]);
  });
});
