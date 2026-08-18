// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseAgentSkillsDiscoveryIndex } from "./agentSkillsDiscoveryIndex.js";

const DIGEST = `sha256:${"a".repeat(64)}`;

function index(skills: unknown[], schema = "https://schemas.agentskills.io/discovery/v1"): string {
  return JSON.stringify({ $schema: schema, skills });
}

function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { name: "order-widget", type: "skill-md", description: "Order a widget.", url: "https://example.com/skills/order.md", digest: DIGEST, ...overrides };
}

describe("parseAgentSkillsDiscoveryIndex", () => {
  it("accepts a well-formed index", () => {
    const parsed = parseAgentSkillsDiscoveryIndex(index([entry(), entry({ name: "track-order" })]), { maxSkills: 20 });

    expect(parsed.problems).toEqual([]);
    expect(parsed.entries.map((skill) => skill.name)).toEqual(["order-widget", "track-order"]);
  });

  it("rejects a document that is not a discovery index", () => {
    const notObject = parseAgentSkillsDiscoveryIndex("[]", { maxSkills: 20 });
    const noSkills = parseAgentSkillsDiscoveryIndex(JSON.stringify({ $schema: "https://schemas.agentskills.io/discovery/v1" }), { maxSkills: 20 });

    expect(notObject).toMatchObject({ entries: [], problems: [{ message: expect.stringContaining("not a JSON object") }] });
    expect(noSkills).toMatchObject({ entries: [], problems: [{ message: expect.stringContaining("'skills' array") }] });
  });

  it("rejects entries that break the field rules", () => {
    const parsed = parseAgentSkillsDiscoveryIndex(index([
      "not-an-object",
      entry({ name: "a".repeat(65) }),
      entry({ name: "trailing-" }),
      entry({ type: "container" }),
      entry({ description: "x".repeat(1025) }),
      entry({ url: "http://example.com/skills/order.md" }),
      entry({ digest: "sha512:abc" }),
    ]), { maxSkills: 20 });

    expect(parsed.entries).toEqual([]);
    expect(parsed.problems.map((problem) => problem.message)).toEqual([
      expect.stringContaining("not an object"),
      expect.stringContaining("invalid name"),
      expect.stringContaining("invalid name"),
      expect.stringContaining("unknown type"),
      expect.stringContaining("invalid description"),
      expect.stringContaining("invalid url"),
      expect.stringContaining("invalid digest"),
    ]);
  });
});
