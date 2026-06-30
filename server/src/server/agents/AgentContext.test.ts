import { describe, expect, it } from "vitest";
import { AgentContext } from "./AgentContext.js";

describe("AgentContext", () => {
  it("renders null when empty", () => {
    expect(new AgentContext().render()).toBeNull();
  });

  it("sets, dedupes, and reports change", () => {
    const ctx = new AgentContext();
    expect(ctx.set("location", "at Target")).toBe(true);
    expect(ctx.set("location", "at Target")).toBe(false); // unchanged
    expect(ctx.set("location", "  at Target  ")).toBe(false); // trimmed-equal
    expect(ctx.render()).toBe('<context source="location">\nat Target\n</context>');
  });

  it("clears a key with null/blank and reports removal", () => {
    const ctx = new AgentContext();
    ctx.set("location", "here");
    expect(ctx.set("location", null)).toBe(true);
    expect(ctx.isEmpty).toBe(true);
    expect(ctx.set("location", null)).toBe(false); // already gone
    expect(ctx.set("location", "   ")).toBe(false); // blank == removal of absent key
  });

  it("composes multiple sources, each labelled", () => {
    const ctx = new AgentContext();
    ctx.set("location", "at Target");
    ctx.set("voice", "speaking");
    expect(ctx.render()).toBe(
      '<context source="location">\nat Target\n</context>\n<context source="voice">\nspeaking\n</context>',
    );
  });
});
