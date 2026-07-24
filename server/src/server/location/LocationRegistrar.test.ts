// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { EnvironmentCandidate } from "../../shared/environment.js";
import { isDwellArrival, LocationRegistrar, type LocationEnvironmentSink } from "./LocationRegistrar.js";

function sink() {
  return {
    registerCandidateEnvironment: vi.fn(async () => {}),
    decideEnvironment: vi.fn(),
  } satisfies LocationEnvironmentSink;
}

function contextStore() {
  return { setContextBundle: vi.fn(), clear: vi.fn() };
}

function cand(id: string, over: Partial<EnvironmentCandidate> = {}): EnvironmentCandidate {
  return { environmentId: id, displayName: id, confidence: 0.9, matchReasons: [], hasKnownEnvironment: false, ...over };
}

const writeStub = () => "/tmp/ctx";

describe("LocationRegistrar", () => {
  it("registers current (with context skill + accept) and neighbors", async () => {
    const s = sink();
    const cs = contextStore();
    const reg = new LocationRegistrar(s, cs, writeStub);
    await reg.sync([
      cand("location:cicis.com/a", { website: "https://cicis.com/x" }),
      cand("location:gamestop.com/b"),
    ]);

    expect(s.registerCandidateEnvironment).toHaveBeenCalledTimes(2);
    expect(cs.setContextBundle).toHaveBeenCalledWith("location:cicis.com/a", "/tmp/ctx");
    expect(s.registerCandidateEnvironment).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: "location:cicis.com/a",
        metadata: expect.objectContaining({
          current: true,
          sourceName: "location:cicis.com/a",
          canonicalSourceUrl: "https://cicis.com/x",
          contextText: expect.stringContaining("location:cicis.com/a"),
        }),
      }),
    );
    expect(s.decideEnvironment).toHaveBeenCalledWith("location:cicis.com/a", "accept");
    expect(s.registerCandidateEnvironment).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: "location:gamestop.com/b",
        metadata: expect.objectContaining({ current: false, sourceName: "location:gamestop.com/b" }),
      }),
    );
  });

  it("skips work when the set is unchanged", async () => {
    const s = sink();
    const cs = contextStore();
    const reg = new LocationRegistrar(s, cs, writeStub);
    const set = [cand("location:a/1"), cand("location:b/2")];
    await reg.sync(set);
    s.registerCandidateEnvironment.mockClear();
    await reg.sync([cand("location:a/1"), cand("location:b/2")]);
    expect(s.registerCandidateEnvironment).not.toHaveBeenCalled();
  });

  it("registers the next current set when it changes", async () => {
    const s = sink();
    const cs = contextStore();
    const reg = new LocationRegistrar(s, cs, writeStub);
    await reg.sync([cand("location:a/1"), cand("location:b/2")]);
    s.registerCandidateEnvironment.mockClear();
    await reg.sync([cand("location:c/3")]);
    expect(s.registerCandidateEnvironment).toHaveBeenCalledTimes(1);
    expect(s.registerCandidateEnvironment).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "location:c/3",
        metadata: expect.objectContaining({ sourceName: "location:c/3", contextText: expect.any(String) }),
      }),
    );
  });

  it("does nothing when no candidates remain", async () => {
    const s = sink();
    const cs = contextStore();
    const reg = new LocationRegistrar(s, cs, writeStub);
    await reg.sync([cand("location:a/1")]);
    s.registerCandidateEnvironment.mockClear();
    await reg.sync([]);
    expect(s.registerCandidateEnvironment).not.toHaveBeenCalled();
  });

  it("does not register a drive-by (moving, not dwelled)", async () => {
    const s = sink();
    const cs = contextStore();
    const reg = new LocationRegistrar(s, cs, writeStub);
    await reg.sync([cand("location:a/1")], { isStationary: false, speedMetersPerSecond: 20, dwellSeconds: 2 });
    expect(s.registerCandidateEnvironment).not.toHaveBeenCalled();
  });

  it("registers a real dwell, then stops refreshing it when moving away", async () => {
    const s = sink();
    const cs = contextStore();
    const reg = new LocationRegistrar(s, cs, writeStub);
    await reg.sync([cand("location:a/1")], { isStationary: true });
    expect(s.registerCandidateEnvironment).toHaveBeenCalledTimes(1);
    s.registerCandidateEnvironment.mockClear();
    await reg.sync([cand("location:b/2")], { isStationary: false, speedMetersPerSecond: 18 });
    expect(s.registerCandidateEnvironment).not.toHaveBeenCalled();
  });
});

describe("isDwellArrival", () => {
  it("accepts stationary / dwelled / slow; rejects clearly moving", () => {
    expect(isDwellArrival({ isStationary: true })).toBe(true);
    expect(isDwellArrival({ dwellSeconds: 45 })).toBe(true);
    expect(isDwellArrival({ speedMetersPerSecond: 0.5 })).toBe(true);
    expect(isDwellArrival({ isStationary: false, speedMetersPerSecond: 20, dwellSeconds: 2 })).toBe(false);
    expect(isDwellArrival({ isStationary: false })).toBe(false);
  });
  it("is permissive with no usable motion signal (back-compat)", () => {
    expect(isDwellArrival(undefined)).toBe(true);
    expect(isDwellArrival({})).toBe(true);
  });
});
