// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GuardedFetchResult } from "../../infrastructure/http/guardedFetch.js";
import type { CandidateEnvironmentRecord } from "../../shared/environment.js";
import { EnvironmentRepositoryDatastore } from "../datastores/EnvironmentRepositoryDatastore.js";
import { CompositeEnvironmentRepository } from "../repositories/CompositeEnvironmentRepository.js";
import { EnvironmentDecisionRepository } from "../repositories/EnvironmentDecisionRepository.js";
import { WebEnvironmentRepository } from "../repositories/WebEnvironmentRepository.js";
import type { EnvironmentEventListener } from "../support/types.js";
import { EnvironmentManager } from "./EnvironmentManager.js";
import { EnvironmentRepositoryService } from "./EnvironmentRepositoryService.js";
import { JsonlEnvironmentMetadataCaptureSink } from "./environmentMetadataCapture.js";
import { WebEnvironmentScout, type WebScoutOutcome } from "./WebEnvironmentScout.js";
import { WebScoutTrigger } from "./WebScoutTrigger.js";

const HOST = "example.com";
const CANDIDATE: CandidateEnvironmentRecord = { id: `web:${HOST}`, metadata: { displayName: "Example" } };

function fakeScout(outcome: WebScoutOutcome | Error) {
  const scout = vi.fn(async (_host: string, _options?: { force?: boolean }): Promise<WebScoutOutcome> => {
    if (outcome instanceof Error) throw outcome;
    return outcome;
  });
  return { scout } as unknown as WebEnvironmentScout & { scout: typeof scout };
}

function fakeManager() {
  return { registerCandidateEnvironment: vi.fn(async (_candidate: CandidateEnvironmentRecord) => {}) };
}

function fakeLogger() {
  return { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

describe("WebScoutTrigger", () => {
  it("ignores candidates that are not host-rooted web environments", async () => {
    const scout = fakeScout({ status: "scouted", changed: true, result: "content" });
    const manager = fakeManager();
    const trigger = new WebScoutTrigger({ scout, environmentManager: manager });

    await trigger.handleCandidate({ id: "dir:/Users/me/project", metadata: {} });
    await trigger.handleCandidate({ id: `web:${HOST}/docs`, metadata: {} });
    await trigger.handleCandidate({ id: "mac:app.Safari", metadata: {} });

    expect(scout.scout).not.toHaveBeenCalled();
    expect(manager.registerCandidateEnvironment).not.toHaveBeenCalled();
  });

  it("scouts the host and re-registers the same candidate when the stored result changed", async () => {
    const scout = fakeScout({ status: "scouted", changed: true, result: "content" });
    const manager = fakeManager();
    const logger = fakeLogger();
    const trigger = new WebScoutTrigger({ scout, environmentManager: manager, logger });

    await trigger.handleCandidate(CANDIDATE);

    expect(scout.scout).toHaveBeenCalledTimes(1);
    expect(scout.scout.mock.calls[0]?.[0]).toBe(HOST);
    expect(manager.registerCandidateEnvironment).toHaveBeenCalledTimes(1);
    expect(manager.registerCandidateEnvironment).toHaveBeenCalledWith(CANDIDATE);
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it.each<WebScoutOutcome>([
    { status: "scouted", changed: false, result: "content" },
    { status: "scouted", changed: false, result: "empty" },
    { status: "fresh", changed: false },
    { status: "skipped", changed: false },
  ])("does not re-register when the outcome is %o", async (outcome) => {
    const scout = fakeScout(outcome);
    const manager = fakeManager();
    const trigger = new WebScoutTrigger({ scout, environmentManager: manager });

    await trigger.handleCandidate(CANDIDATE);

    expect(scout.scout).toHaveBeenCalledTimes(1);
    expect(manager.registerCandidateEnvironment).not.toHaveBeenCalled();
  });

  it("swallows a rejecting scout and warns instead of throwing", async () => {
    const scout = fakeScout(new Error("boom"));
    const manager = fakeManager();
    const logger = fakeLogger();
    const trigger = new WebScoutTrigger({ scout, environmentManager: manager, logger });

    await expect(trigger.handleCandidate(CANDIDATE)).resolves.toBeUndefined();

    expect(manager.registerCandidateEnvironment).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toMatchObject({ environmentId: CANDIDATE.id, error: expect.any(Error) });
  });

  it("swallows a rejecting re-registration and warns instead of throwing", async () => {
    const scout = fakeScout({ status: "scouted", changed: true, result: "content" });
    const manager = fakeManager();
    manager.registerCandidateEnvironment.mockRejectedValueOnce(new Error("manager down"));
    const logger = fakeLogger();
    const trigger = new WebScoutTrigger({ scout, environmentManager: manager, logger });

    await expect(trigger.handleCandidate(CANDIDATE)).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});

/**
 * End to end without network: a real manager over a composite repository holding a
 * `:memory:` web store, a real scout with a fake fetch, and the real trigger.
 */
describe("WebScoutTrigger with EnvironmentManager", () => {
  const LLMS_URL = `https://${HOST}/llms.txt`;
  const AGENTS_URL = `https://${HOST}/AGENTS.md`;
  const START = Date.parse("2026-08-18T12:00:00.000Z");

  let decisions: EnvironmentDecisionRepository;
  let datastore: EnvironmentRepositoryDatastore;
  let originalHome: string | undefined;
  let tempHome: string;
  let manager: EnvironmentManager;
  let nowMs: number;

  beforeEach(() => {
    nowMs = START;
    originalHome = process.env.HOME;
    tempHome = mkdtempSync(path.join(os.tmpdir(), "rook-home-"));
    process.env.HOME = tempHome;
    decisions = new EnvironmentDecisionRepository(":memory:");
    datastore = new EnvironmentRepositoryDatastore(":memory:");
  });

  afterEach(() => {
    manager?.close();
    decisions.close();
    datastore.close();
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(tempHome, { recursive: true, force: true });
  });

  function mockListener(): EnvironmentEventListener {
    return {
      onEnvironmentOffered: vi.fn(),
      onEnvironmentEntered: vi.fn(),
      onEnvironmentExited: vi.fn(),
      onEnvironmentResolved: vi.fn(),
    };
  }

  function harness(routes: Record<string, GuardedFetchResult>) {
    const webRepository = new WebEnvironmentRepository(datastore);
    const repositoryService = new EnvironmentRepositoryService(new CompositeEnvironmentRepository([webRepository]));
    manager = new EnvironmentManager(repositoryService, decisions, {
      activeEnvironmentWindowMs: 6 * 60_000,
      recentEnvironmentRetentionMs: 30 * 60_000,
      logger: { info: vi.fn() },
      now: () => nowMs,
      registrationCaptureSink: new JsonlEnvironmentMetadataCaptureSink(path.join(tempHome, "environment_metadata_captures")),
    });
    const fetchCalls: string[] = [];
    const scout = new WebEnvironmentScout({
      repository: webRepository,
      now: () => nowMs,
      fetch: async (url) => {
        fetchCalls.push(url);
        return routes[url] ?? { kind: "absent", status: 404 };
      },
    });
    const registerSpy = vi.spyOn(manager, "registerCandidateEnvironment");
    const trigger = new WebScoutTrigger({ scout, environmentManager: manager });
    return { trigger, registerSpy, fetchCalls };
  }

  it("re-registers the environment with the scouted bundle, offers it on entry, and stays quiet while fresh", async () => {
    const { trigger, registerSpy, fetchCalls } = harness({
      [LLMS_URL]: { kind: "ok", status: 200, body: "# Example\nRead the docs.\n", finalUrl: LLMS_URL },
      [AGENTS_URL]: { kind: "ok", status: 200, body: "Be brief.\n", finalUrl: AGENTS_URL },
    });

    // The route's order: register (nothing stored yet), then scout.
    await manager.registerCandidateEnvironment(CANDIDATE);
    expect(manager.environmentList("s1").find((entry) => entry.environmentId === CANDIDATE.id)?.bundleCount).toBe(0);

    await trigger.handleCandidate(CANDIDATE);

    expect(registerSpy).toHaveBeenCalledTimes(2);
    expect(registerSpy).toHaveBeenLastCalledWith(CANDIDATE);

    const preview = await manager.getEnvironmentPreview(CANDIDATE.id);
    expect(preview.bundles).toHaveLength(1);
    expect(preview.bundles[0]).toMatchObject({
      repository: "web",
      bundleId: "site",
      llmsTxt: "# Example\nRead the docs.",
      agentsMd: "Be brief.",
    });
    expect(manager.environmentList("s1").find((entry) => entry.environmentId === CANDIDATE.id)?.bundleCount).toBe(1);

    // A session entering the environment is offered the web bundle by hash.
    const listener = mockListener();
    manager.subscribe("s1", listener);
    await manager.enterEnvironment("s1", CANDIDATE.id);
    expect(listener.onEnvironmentOffered).toHaveBeenCalledTimes(1);
    expect(listener.onEnvironmentOffered).toHaveBeenCalledWith(expect.objectContaining({
      environmentId: CANDIDATE.id,
      bundleId: "site",
      bundleHash: preview.bundles[0]!.bundleHash,
    }));

    // Visiting again while the entry is fresh neither fetches nor re-registers.
    const fetchesSoFar = fetchCalls.length;
    await trigger.handleCandidate(CANDIDATE);
    expect(fetchCalls.length).toBe(fetchesSoFar);
    expect(registerSpy).toHaveBeenCalledTimes(2);
  });
});
