import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runtimeLaunchPlan } from "./runtimeLaunchPlan.js";
import type { AgentRuntimeProfile } from "../infrastructure/config/agentRuntimes.js";

const generatedRoots: string[] = [];

afterEach(() => {
  for (const root of generatedRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("runtimeLaunchPlan", () => {
  it("passes the base system prompt to Pi through the generated launcher", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "rook-runtime-launch-plan-"));
    generatedRoots.push(repoRoot);
    const profile: AgentRuntimeProfile = { id: "test-pi", type: "pi", command: "pi", args: [] };
    const configuration = {
      enteredEnvironmentIds: [],
      skillPaths: [],
      extensionPaths: [],
      appendSystemPrompt: "## You are Rook",
    };

    const plan = runtimeLaunchPlan(profile, repoRoot, configuration);
    const launcher = plan.env?.PI_ACP_PI_COMMAND;
    expect(launcher).toBeDefined();
    expect(readFileSync(launcher!, "utf8")).toContain("--append-system-prompt");
    expect(readFileSync(launcher!, "utf8")).toContain("## You are Rook");
  });
});
