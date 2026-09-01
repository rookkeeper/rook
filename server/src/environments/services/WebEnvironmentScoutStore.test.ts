// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import type { EnvironmentBundle, RepositoryReadError } from "../../shared/environmentRepository.js";
import { EnvironmentRepositoryDatastore } from "../datastores/EnvironmentRepositoryDatastore.js";
import { SQLiteEnvironmentRepository } from "../repositories/SQLiteEnvironmentRepository.js";
import {
  hostForWebEnvironmentId,
  normalizeHost,
  WebEnvironmentScoutStore,
  webEnvironmentIdForHost,
} from "./WebEnvironmentScoutStore.js";

const HOST = "example.com";
const ENVIRONMENT_ID = `web:${HOST}`;
const FETCHED_AT = "2026-08-18T12:00:00.000Z";
const LATER = "2026-08-19T12:00:00.000Z";
const PERSONAL_BUNDLE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const READ_ERROR: RepositoryReadError = {
  code: "unreachable_url",
  message: "llms.txt timed out",
  repository: "personal",
  environmentId: ENVIRONMENT_ID,
  url: `https://${HOST}/llms.txt`,
};

function siteBundle(overrides: Partial<EnvironmentBundle> = {}): EnvironmentBundle {
  return {
    id: `${ENVIRONMENT_ID}#site`,
    bundleId: "site",
    environmentId: ENVIRONMENT_ID,
    repository: "personal",
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

describe("WebEnvironmentScoutStore", () => {
  const datastores: EnvironmentRepositoryDatastore[] = [];

  function open() {
    const datastore = new EnvironmentRepositoryDatastore(":memory:");
    datastores.push(datastore);
    const repository = new SQLiteEnvironmentRepository(datastore, "personal");
    const store = new WebEnvironmentScoutStore(datastore, repository);
    return { datastore, repository, store };
  }

  function record(store: WebEnvironmentScoutStore, overrides: Partial<Parameters<WebEnvironmentScoutStore["recordScout"]>[0]> = {}) {
    return store.recordScout({
      host: HOST,
      fetchedAt: FETCHED_AT,
      status: "content",
      validators: { "llms.txt": { etag: '"v1"' } },
      bundle: siteBundle(),
      ...overrides,
    });
  }

  afterEach(() => {
    for (const datastore of datastores) datastore.close();
    datastores.length = 0;
  });

  it("projects host-published content through the personal repository", async () => {
    const { datastore, repository, store } = open();

    expect(record(store)).toEqual({ changed: true });

    const loaded = await repository.getBundles(ENVIRONMENT_ID);
    expect(loaded.environment).toMatchObject({ id: ENVIRONMENT_ID, displayName: HOST, description: `Website ${HOST}` });
    expect(loaded.bundles).toHaveLength(1);
    expect(loaded.bundles[0]).toMatchObject({
      bundleId: "site",
      repository: "personal",
      publisher: HOST,
      scoutPublished: true,
      sourceUrl: `https://${HOST}/`,
      llmsTxt: "Reference material for widgets.",
    });
    expect(datastore.db.prepare("SELECT DISTINCT publisher FROM bundles").all()).toEqual([{ publisher: HOST }]);
  });

  it("lets user and site skills coexist on one environment row", async () => {
    const { datastore, repository, store } = open();
    repository.saveResult({
      environment: { id: ENVIRONMENT_ID, displayName: "My Example", description: "My website tools", metadata: { owner: "user" } },
      bundles: [{
        ...siteBundle(),
        id: `${ENVIRONMENT_ID}#${PERSONAL_BUNDLE_ID}`,
        bundleId: PERSONAL_BUNDLE_ID,
        skills: [{ id: "personal-widget", files: { "personal-widget/SKILL.md": "Personal instructions." } }],
        llmsTxt: undefined,
        agentsMd: undefined,
      }],
      errors: [],
    });
    record(store);

    const bundles = (await repository.getBundles(ENVIRONMENT_ID)).bundles;
    expect(bundles).toEqual(expect.arrayContaining([
      expect.objectContaining({ publisher: "default", scoutPublished: false, skills: [expect.objectContaining({ id: "personal-widget" })] }),
      expect.objectContaining({ publisher: HOST, scoutPublished: true, skills: [expect.objectContaining({ id: "order-widget" })] }),
    ]));
    expect(datastore.db.prepare("SELECT count(*) AS count FROM environments WHERE environment_id = ?").get(ENVIRONMENT_ID))
      .toEqual({ count: 1 });
  });

  it("refreshes and empties only the host publisher", async () => {
    const { repository, store } = open();
    repository.saveResult({
      environment: { id: ENVIRONMENT_ID, displayName: "Example", description: "User description", metadata: {} },
      bundles: [{
        ...siteBundle(),
        bundleId: PERSONAL_BUNDLE_ID,
        skills: [{ id: "personal-widget", files: { "personal-widget/SKILL.md": "Personal." } }],
        llmsTxt: undefined,
        agentsMd: undefined,
      }],
      errors: [],
    });
    record(store);
    record(store, { bundle: siteBundle({ skills: [{ id: "refreshed-widget", files: { "refreshed-widget/SKILL.md": "Refreshed." } }] }) });

    let bundles = (await repository.getBundles(ENVIRONMENT_ID)).bundles;
    expect(bundles.find((bundle) => bundle.scoutPublished)?.skills[0]?.id).toBe("refreshed-widget");
    expect(bundles.find((bundle) => !bundle.scoutPublished)?.skills[0]?.id).toBe("personal-widget");

    record(store, { status: "empty", bundle: null, validators: {} });
    bundles = (await repository.getBundles(ENVIRONMENT_ID)).bundles;
    expect(bundles).toHaveLength(1);
    expect(bundles[0]).toMatchObject({ publisher: "default", scoutPublished: false });
    expect(store.getScoutState(HOST)?.status).toBe("empty");
  });

  it("creates a user-published copy instead of editing a matching site capability", async () => {
    const { repository, store } = open();
    record(store);

    expect(await repository.replaceCapabilityFiles(
      ENVIRONMENT_ID,
      "site",
      "skill",
      "order-widget",
      { "order-widget/SKILL.md": "My personal version." },
    )).toBe(true);

    let bundles = (await repository.getBundles(ENVIRONMENT_ID)).bundles;
    expect(bundles.find((bundle) => bundle.scoutPublished)?.skills[0]?.files["order-widget/SKILL.md"]).toBe("Order a widget.");
    expect(bundles.find((bundle) => !bundle.scoutPublished)?.skills[0]?.files["order-widget/SKILL.md"]).toBe("My personal version.");

    record(store, { bundle: siteBundle({ skills: [{ id: "order-widget", files: { "order-widget/SKILL.md": "Site refresh." } }] }) });
    bundles = (await repository.getBundles(ENVIRONMENT_ID)).bundles;
    expect(bundles.find((bundle) => bundle.scoutPublished)?.skills[0]?.files["order-widget/SKILL.md"]).toBe("Site refresh.");
    expect(bundles.find((bundle) => !bundle.scoutPublished)?.skills[0]?.files["order-widget/SKILL.md"]).toBe("My personal version.");
  });

  it("keeps negative-cache rows out of environment listing and search", async () => {
    const { repository, store } = open();
    record(store, { status: "empty", bundle: null, validators: {} });

    expect((await repository.getBundles(ENVIRONMENT_ID)).environment?.id).toBe(ENVIRONMENT_ID);
    expect(await repository.listEnvironments()).toEqual([]);
    expect(await repository.searchBundles("example")).toEqual([]);
    expect(store.getScoutState(HOST)?.status).toBe("empty");
  });

  it("does not clobber user-authored environment labels or metadata", async () => {
    const { repository, store } = open();
    repository.saveResult({
      environment: { id: ENVIRONMENT_ID, displayName: "My Custom Name", description: "My custom description", metadata: { owner: "user" } },
      bundles: [{ ...siteBundle(), bundleId: PERSONAL_BUNDLE_ID }],
      errors: [],
    });

    record(store);

    expect((await repository.getBundles(ENVIRONMENT_ID)).environment).toMatchObject({
      displayName: "My Custom Name",
      description: "My custom description",
      metadata: { owner: "user", scout: expect.any(Object) },
    });
  });

  it("keeps validators on errors and replaces errors per pass", async () => {
    const { repository, store } = open();
    record(store, { errors: [READ_ERROR] });
    expect((await repository.getBundles(ENVIRONMENT_ID)).bundles[0]?.errors).toEqual([READ_ERROR]);

    expect(record(store, { status: "error", bundle: null, validators: {}, fetchedAt: LATER, errors: [] })).toEqual({ changed: false });
    expect(store.getScoutState(HOST)).toMatchObject({
      status: "error",
      fetchedAt: LATER,
      validators: { "llms.txt": { etag: '"v1"' } },
      errors: [],
    });
    expect((await repository.getBundles(ENVIRONMENT_ID)).bundles[0]?.errors).toEqual([]);
  });

  it("keeps stored rows when a content pass fully revalidates", async () => {
    const { repository, store } = open();
    record(store);

    expect(record(store, { bundle: null, fetchedAt: LATER, validators: { "llms.txt": { etag: '"v2"' } } })).toEqual({ changed: false });
    expect((await repository.getBundles(ENVIRONMENT_ID)).bundles[0]?.llmsTxt).toBe("Reference material for widgets.");
    expect(store.getScoutState(HOST)?.validators).toEqual({ "llms.txt": { etag: '"v2"' } });
  });

  it("uses the shorter error ttl", () => {
    const { store } = open();
    record(store, { status: "error", bundle: null, validators: {} });
    const fetchedAt = Date.parse(FETCHED_AT);

    expect(store.isStale(HOST, { ttlMs: 60_000, now: fetchedAt + 30_000 })).toBe(false);
    expect(store.isStale(HOST, { ttlMs: 60_000, errorTtlMs: 10_000, now: fetchedAt + 30_000 })).toBe(true);
  });

  it("guards host-rooted environment ids", () => {
    expect(webEnvironmentIdForHost("Example.COM")).toBe(ENVIRONMENT_ID);
    expect(hostForWebEnvironmentId("web:Example.COM")).toBe(HOST);
    expect(hostForWebEnvironmentId("web:example.com/docs")).toBeNull();
    expect(hostForWebEnvironmentId("dir:/Users/dev")).toBeNull();
    expect(normalizeHost("  Example.COM  ")).toBe(HOST);
    expect(normalizeHost("example.com/docs")).toBeNull();
  });
});
