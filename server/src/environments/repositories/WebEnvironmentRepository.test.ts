// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { EnvironmentBundle } from "../../shared/environmentRepository.js";
import { EnvironmentRepositoryDatastore } from "../datastores/EnvironmentRepositoryDatastore.js";
import { hostForWebEnvironmentId, WebEnvironmentRepository, webEnvironmentIdForHost } from "./WebEnvironmentRepository.js";

const HOST = "example.com";
const FETCHED_AT = "2026-08-18T12:00:00.000Z";

function siteBundle(overrides: Partial<EnvironmentBundle> = {}): EnvironmentBundle {
  return {
    id: `web:${HOST}#site`,
    bundleId: "site",
    environmentId: `web:${HOST}`,
    repository: "web",
    llmsTxt: "Reference material for widgets.",
    agentsMd: "Confirm before ordering.",
    skills: [{ id: "order-widget", files: { "order-widget/SKILL.md": "Order a widget." } }],
    mcpServers: [],
    apps: [],
    valid: true,
    errors: [],
    ...overrides,
  };
}

describe("WebEnvironmentRepository", () => {
  const datastores: EnvironmentRepositoryDatastore[] = [];
  const tempDirs: string[] = [];

  function open(location = ":memory:"): { repository: WebEnvironmentRepository; datastore: EnvironmentRepositoryDatastore } {
    const datastore = new EnvironmentRepositoryDatastore(location);
    datastores.push(datastore);
    return { repository: new WebEnvironmentRepository(datastore), datastore };
  }

  function record(repository: WebEnvironmentRepository, overrides: Partial<Parameters<WebEnvironmentRepository["recordScout"]>[0]> = {}) {
    return repository.recordScout({
      host: HOST,
      fetchedAt: FETCHED_AT,
      status: "content",
      validators: { "llms.txt": { etag: '"v1"' } },
      bundle: siteBundle(),
      ...overrides,
    });
  }

  afterEach(async () => {
    for (const datastore of datastores) datastore.close();
    datastores.length = 0;
    await Promise.all(tempDirs.map((directory) => rm(directory, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("does not claim non-web or path-scoped environment ids", async () => {
    const { repository } = open();

    expect(await repository.getBundles("dir:/Users/dev/project")).toEqual({ environment: null, bundles: [], errors: [] });
    expect(await repository.getBundles(`web:${HOST}/docs`)).toEqual({ environment: null, bundles: [], errors: [] });
  });

  it("treats an unscouted host as unknown", async () => {
    const { repository } = open();

    expect(await repository.getBundles("web:unknown.example")).toEqual({ environment: null, bundles: [], errors: [] });
    expect(repository.getScoutState("unknown.example")).toBeNull();
    expect(repository.isStale("unknown.example", 24 * 60 * 60_000)).toBe(true);
  });

  it("serves a scouted host as one site bundle published by the host", async () => {
    const { repository, datastore } = open();

    expect(record(repository)).toEqual({ changed: true });

    const loaded = await repository.getBundles(`web:${HOST}`);
    expect(loaded.environment).toMatchObject({ id: `web:${HOST}`, displayName: HOST, description: `Website ${HOST}` });
    expect(loaded.bundles).toHaveLength(1);
    expect(loaded.bundles[0]).toMatchObject({
      id: `web:${HOST}#site`,
      bundleId: "site",
      repository: "web",
      sourceUrl: `https://${HOST}/`,
      llmsTxt: "Reference material for widgets.",
      agentsMd: "Confirm before ordering.",
    });
    expect(loaded.bundles[0]?.skills[0]?.files["order-widget/SKILL.md"]).toBe("Order a widget.");
    expect(datastore.db.prepare("SELECT DISTINCT publisher FROM bundles").all()).toEqual([{ publisher: HOST }]);
  });

  it("reports whether re-scouting changed the stored content", async () => {
    const { repository, datastore } = open();
    record(repository);

    expect(record(repository, { fetchedAt: "2026-08-19T12:00:00.000Z" })).toEqual({ changed: false });
    expect(record(repository, { bundle: siteBundle({ llmsTxt: "Rewritten reference." }) })).toEqual({ changed: true });

    const loaded = await repository.getBundles(`web:${HOST}`);
    expect(loaded.bundles[0]?.llmsTxt).toBe("Rewritten reference.");
    expect(datastore.db.prepare("SELECT count(*) AS count FROM capabilities WHERE files_json LIKE '%widgets%'").get()).toMatchObject({ count: 0 });
  });

  it("forgets bundle rows for a host scouted with nothing to offer", async () => {
    const { repository, datastore } = open();
    record(repository);

    expect(record(repository, { status: "empty", bundle: null, validators: {} })).toEqual({ changed: true });

    const loaded = await repository.getBundles(`web:${HOST}`);
    expect(loaded.environment?.id).toBe(`web:${HOST}`);
    expect(loaded.bundles).toEqual([]);
    expect(await repository.listEnvironments()).toEqual([]);
    expect(repository.getScoutState(HOST)?.status).toBe("empty");
    expect(datastore.db.prepare("SELECT count(*) AS count FROM capabilities").get()).toMatchObject({ count: 0 });
  });

  it("forgets bundle rows for a host whose scout failed", async () => {
    const { repository, datastore } = open();
    record(repository);

    expect(record(repository, { status: "error", bundle: null, validators: {} })).toEqual({ changed: true });

    const loaded = await repository.getBundles(`web:${HOST}`);
    expect(loaded.environment?.id).toBe(`web:${HOST}`);
    expect(loaded.bundles).toEqual([]);
    expect(repository.getScoutState(HOST)?.status).toBe("error");
    expect(datastore.db.prepare("SELECT count(*) AS count FROM bundles").get()).toMatchObject({ count: 0 });
  });

  it("rejects a content scout with no bundle", () => {
    const { repository } = open();

    expect(() => record(repository, { status: "content", bundle: null })).toThrow(/requires a bundle/);
  });

  it("round-trips conditional-request validators and answers staleness from them", () => {
    const { repository } = open();
    record(repository, {
      validators: {
        "llms.txt": { etag: '"v1"' },
        "AGENTS.md": { lastModified: "Mon, 17 Aug 2026 10:00:00 GMT" },
        "skill:order-widget": { etag: '"s1"', lastModified: "Mon, 17 Aug 2026 11:00:00 GMT" },
      },
    });

    const state = repository.getScoutState(HOST);
    expect(state).toMatchObject({ host: HOST, fetchedAt: FETCHED_AT, status: "content" });
    expect(state?.validators).toEqual({
      "llms.txt": { etag: '"v1"' },
      "AGENTS.md": { lastModified: "Mon, 17 Aug 2026 10:00:00 GMT" },
      "skill:order-widget": { etag: '"s1"', lastModified: "Mon, 17 Aug 2026 11:00:00 GMT" },
    });

    const fetchedAt = Date.parse(FETCHED_AT);
    expect(repository.isStale(HOST, 60_000, fetchedAt + 30_000)).toBe(false);
    expect(repository.isStale(HOST, 60_000, fetchedAt + 60_000)).toBe(true);
  });

  it("refuses every capability write", async () => {
    const { repository } = open();
    record(repository);
    const files = { "order-widget/SKILL.md": "Hijacked." };

    expect(await repository.replaceCapabilityFiles(`web:${HOST}`, "site", "skill", "order-widget", files)).toBe(false);
    expect(await repository.createCapabilityFiles(`web:${HOST}`, "site", "skill", "new-skill", files)).toBe(false);
    expect(await repository.deleteCapability(`web:${HOST}`, "site", "skill", "order-widget")).toBe(false);
    expect(await repository.restoreCapability(`web:${HOST}`, "site", "skill", "order-widget")).toBe(false);
    expect((await repository.getBundles(`web:${HOST}`)).bundles[0]?.skills[0]?.files["order-widget/SKILL.md"]).toBe("Order a widget.");
  });

  it("searches scouted content and stays out of other repositories' searches", async () => {
    const { repository } = open();
    record(repository);

    expect((await repository.searchBundles("widgets")).map((bundle) => bundle.bundleId)).toEqual(["site"]);
    expect(await repository.searchBundles("widgets", "personal")).toEqual([]);
  });

  it("keeps scouted content across a close and reopen", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "rook-web-repo-"));
    tempDirs.push(directory);
    const location = path.join(directory, "web-environment-repository.db");
    const first = new WebEnvironmentRepository(location);
    record(first);
    first.close();

    const reopened = new WebEnvironmentRepository(location);
    expect((await reopened.getBundles(`web:${HOST}`)).bundles[0]?.agentsMd).toBe("Confirm before ordering.");
    expect(reopened.getScoutState(HOST)).toMatchObject({ host: HOST, status: "content", validators: { "llms.txt": { etag: '"v1"' } } });
    reopened.close();
  });

  it("maps hosts to host-rooted web environment ids and back", () => {
    expect(webEnvironmentIdForHost("Example.COM")).toBe("web:example.com");
    expect(hostForWebEnvironmentId("web:Example.COM")).toBe("example.com");
    expect(hostForWebEnvironmentId("web:example.com/docs")).toBeNull();
    expect(hostForWebEnvironmentId("web:")).toBeNull();
    expect(hostForWebEnvironmentId("dir:/Users/dev")).toBeNull();
  });
});
