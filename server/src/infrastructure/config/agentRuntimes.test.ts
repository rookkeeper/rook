import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadAgentRuntimes } from "./agentRuntimes.js";

const originalPath = process.env.ROOK_AGENT_RUNTIMES_PATH;

afterEach(() => {
  if (originalPath === undefined) delete process.env.ROOK_AGENT_RUNTIMES_PATH;
  else process.env.ROOK_AGENT_RUNTIMES_PATH = originalPath;
});

describe("loadAgentRuntimes", () => {
  it("returns only explicit valid configured runtimes", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "rook-runtimes-"));
    const configPath = path.join(directory, "agent-runtimes.json");
    writeFileSync(configPath, JSON.stringify({
      profiles: [
        { id: "ConfiguredPi", type: "pi", args: ["--model", "gpt-5.4"] },
        { id: "Invalid", type: "not-a-runtime" },
      ],
    }));
    process.env.ROOK_AGENT_RUNTIMES_PATH = configPath;

    expect(loadAgentRuntimes()).toEqual([{ id: "ConfiguredPi", type: "pi", args: ["--model", "gpt-5.4"] }]);
  });
});
