import { describe, it, expect } from "vitest";
import { parseArgs } from "../src/index.mjs";

describe("parseArgs", () => {
  it("parses --runtime", () => {
    const args = parseArgs(["--runtime", "MyPiOpenAiAgent"]);
    expect(args.runtimeId).toBe("MyPiOpenAiAgent");
    expect(args.sessionId).toBe("");
  });

  it("parses --sessionId", () => {
    const args = parseArgs(["--sessionId", "abc-123"]);
    expect(args.sessionId).toBe("abc-123");
    expect(args.runtimeId).toBe("");
  });

  it("parses exec with prompt", () => {
    const args = parseArgs(["exec", "--runtime", "Mock", "hello world"]);
    expect(args.execPrompt).toBe("hello world");
    expect(args.runtimeId).toBe("Mock");
  });

  it("parses exec --last-message-only", () => {
    const args = parseArgs(["exec", "--last-message-only", "--runtime", "Mock", "hi"]);
    expect(args.lastMessageOnly).toBe(true);
    expect(args.execPrompt).toBe("hi");
  });

  it("parses --title", () => {
    const args = parseArgs(["--runtime", "Mock", "--title", "my-session"]);
    expect(args.title).toBe("my-session");
  });

  it("parses sessions command", () => {
    const args = parseArgs(["sessions", "--limit", "5"]);
    expect(args.sessions).toBe(true);
    expect(args.limit).toBe(5);
  });

  it("parses environments command", () => {
    const args = parseArgs(["environments", "--limit", "10"]);
    expect(args.environments).toBe(true);
    expect(args.limit).toBe(10);
  });

  it("parses --join", () => {
    const args = parseArgs(["--sessionId", "abc", "--join", "location:office", "--join", "mac:zed"]);
    expect(args.join).toEqual(["location:office", "mac:zed"]);
  });

  it("parses --leave", () => {
    const args = parseArgs(["--sessionId", "abc", "--leave", "web:example.com"]);
    expect(args.leave).toEqual(["web:example.com"]);
  });

  it("parses positional prompt without exec", () => {
    const args = parseArgs(["--runtime", "Mock", "tell me a joke"]);
    expect(args.execPrompt).toBe("tell me a joke");
    expect(args.runtimeId).toBe("Mock");
  });

  it("default limit is 0", () => {
    const args = parseArgs(["sessions"]);
    expect(args.limit).toBe(0);
  });

  it("--help sets help flag", () => {
    const args = parseArgs(["--help"]);
    expect(args.help).toBe(true);
  });

  it("unrecognized flags become positionals", () => {
    const args = parseArgs(["--unknown", "value"]);
    expect(args.execPrompt).toBe("--unknown value");
  });
});
