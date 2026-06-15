import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../paths";
import { CursorAgent } from "./CursorAgent";

class InspectableCursorAgent extends CursorAgent {
  inspectRegisterSession(): Promise<unknown> {
    return this.registerSession();
  }
}

describe("CursorAgent", () => {
  it("spawns 'agent acp' directly with no wrapper package", () => {
    const agent = new CursorAgent({
      cwd: REPO_ROOT,
      agentName: "MyCursorAgent",
    });

    const options = agent as unknown as { options: { command: string; args: string[]; cwd: string } };
    expect(options.options.command).toBe("agent");
    expect(options.options.args).toEqual(["acp"]);
    expect(options.options.cwd).toBe(REPO_ROOT);
  });

  it("uses a custom command path when provided", () => {
    const agent = new CursorAgent({
      command: "/usr/local/bin/cursor-agent",
      cwd: "/tmp",
      agentName: "CustomCursorAgent",
    });

    const options = agent as unknown as { options: { command: string } };
    expect(options.options.command).toBe("/usr/local/bin/cursor-agent");
  });

  it("defaults command to 'agent' when empty or whitespace", () => {
    for (const command of [undefined, "", "  "]) {
      const agent = new CursorAgent({ command });
      const options = agent as unknown as { options: { command: string } };
      expect(options.options.command).toBe("agent");
    }
  });

  it("stores model option for session/set_config_option", () => {
    const agent = new CursorAgent({ model: "default[]" });
    expect((agent as unknown as { cursorModel: string }).cursorModel).toBe("default[]");
  });

  it("ignores empty/whitespace model", () => {
    for (const model of [undefined, "", "  "]) {
      const agent = new CursorAgent({ model });
      expect((agent as unknown as { cursorModel?: string }).cursorModel).toBeUndefined();
    }
  });
});
