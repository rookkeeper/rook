// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { EnvironmentRepositoryDatastore } from "../datastores/EnvironmentRepositoryDatastore.js";
import { WebEnvironmentRepository, webEnvironmentIdForHost } from "../repositories/WebEnvironmentRepository.js";
import { WebEnvironmentScout } from "./WebEnvironmentScout.js";

/**
 * Live scouting of real public sites through the real guarded fetch. Gated behind
 * ROOK_WEB_SCOUT_LIVE=1 so CI stays hermetic. Sites change, so this asserts shape and
 * presence, never exact counts.
 *
 * Run: ROOK_WEB_SCOUT_LIVE=1 npx vitest run WebEnvironmentScout.live
 */
const LIVE = process.env.ROOK_WEB_SCOUT_LIVE === "1";

describe.runIf(LIVE)("WebEnvironmentScout (live)", () => {
  const datastores: EnvironmentRepositoryDatastore[] = [];

  afterEach(() => {
    for (const datastore of datastores) datastore.close();
    datastores.length = 0;
  });

  function harness() {
    const datastore = new EnvironmentRepositoryDatastore(":memory:");
    datastores.push(datastore);
    const repository = new WebEnvironmentRepository(datastore);
    return { repository, scout: new WebEnvironmentScout({ repository }) };
  }

  it("scouts evilmartians.com: llms.txt plus skill-md skills, with archive entries reported", async () => {
    const { repository, scout } = harness();
    const host = "evilmartians.com";

    expect(await scout.scout(host)).toEqual({ status: "scouted", changed: true, result: "content" });

    const { bundles } = await repository.getBundles(webEnvironmentIdForHost(host));
    expect(bundles).toHaveLength(1);
    expect(bundles[0]?.llmsTxt).toBeTruthy();
    expect(bundles[0]?.skills.length).toBeGreaterThanOrEqual(1);
    for (const skill of bundles[0]!.skills) {
      expect(skill.files[`${skill.id}/SKILL.md`]).toBeTruthy();
    }
    // The site publishes `archive` entries alongside `skill-md`; those are skipped and reported.
    const codes = repository.getScoutState(host)?.errors.map((error) => error.code) ?? [];
    expect(codes).toContain("unsupported_capability");
  }, 30_000);

  it("scouts developers.cloudflare.com: relative skill URLs in the index resolve", async () => {
    const { repository, scout } = harness();
    const host = "developers.cloudflare.com";

    expect(await scout.scout(host)).toMatchObject({ status: "scouted", result: "content" });

    const { bundles } = await repository.getBundles(webEnvironmentIdForHost(host));
    expect(bundles).toHaveLength(1);
    expect(bundles[0]?.skills.length).toBeGreaterThanOrEqual(1);
    // Only skills whose relative index urls resolved and fetched cleanly are stored.
    for (const skill of bundles[0]!.skills) {
      expect(skill.files[`${skill.id}/SKILL.md`]).toBeTruthy();
    }
  }, 30_000);
});
