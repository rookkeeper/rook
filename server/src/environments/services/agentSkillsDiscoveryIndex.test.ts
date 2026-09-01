// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseAgentSkillsDiscoveryIndex } from "./agentSkillsDiscoveryIndex.js";

const DIGEST = `sha256:${"a".repeat(64)}`;
const INDEX_URL = "https://example.com/.well-known/agent-skills/index.json";
const OPTIONS = { indexUrl: INDEX_URL, maxSkills: 20 };

function index(skills: unknown[], schema = "https://schemas.agentskills.io/discovery/v1"): string {
  return JSON.stringify({ $schema: schema, skills });
}

function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { name: "order-widget", type: "skill-md", description: "Order a widget.", url: "https://example.com/skills/order.md", digest: DIGEST, ...overrides };
}

describe("parseAgentSkillsDiscoveryIndex", () => {
  it("accepts a well-formed index", () => {
    const parsed = parseAgentSkillsDiscoveryIndex(index([entry(), entry({ name: "track-order" })]), OPTIONS);

    expect(parsed.problems).toEqual([]);
    expect(parsed.entries.map((skill) => skill.name)).toEqual(["order-widget", "track-order"]);
  });

  it("rejects a document that is not a discovery index", () => {
    const notObject = parseAgentSkillsDiscoveryIndex("[]", OPTIONS);
    const noSkills = parseAgentSkillsDiscoveryIndex(JSON.stringify({ $schema: "https://schemas.agentskills.io/discovery/v1" }), OPTIONS);

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
      entry({ url: `https://example.com/${"a".repeat(2100)}.md` }),
      entry({ digest: "sha512:abc" }),
    ]), OPTIONS);

    expect(parsed.entries).toEqual([]);
    expect(parsed.problems.map((problem) => problem.message)).toEqual([
      expect.stringContaining("not an object"),
      expect.stringContaining("invalid name"),
      expect.stringContaining("invalid name"),
      expect.stringContaining("unknown type"),
      expect.stringContaining("invalid description"),
      expect.stringContaining("invalid url"),
      expect.stringContaining("invalid url"),
      expect.stringContaining("invalid digest"),
    ]);
  });

  it("resolves entry urls against the index url and keeps only https ones", () => {
    const parsed = parseAgentSkillsDiscoveryIndex(index([
      entry({ name: "rooted", url: "/.well-known/agent-skills/rooted.tar.gz" }),
      entry({ name: "sibling", url: "sibling.md" }),
      entry({ name: "protocol-relative", url: "//cdn.example.net/skills/x.md" }),
      entry({ name: "insecure", url: "http://example.com/skills/x.md" }),
    ]), OPTIONS);

    expect(parsed.entries.map((skill) => skill.url)).toEqual([
      "https://example.com/.well-known/agent-skills/rooted.tar.gz",
      "https://example.com/.well-known/agent-skills/sibling.md",
      "https://cdn.example.net/skills/x.md",
    ]);
    expect(parsed.problems).toEqual([
      { code: "invalid_bundle_contents", message: expect.stringContaining("invalid url") },
    ]);
  });

  it("strips credentials from a resolved entry url", () => {
    const parsed = parseAgentSkillsDiscoveryIndex(index([
      entry({ name: "lookalike", url: "https://apple.com@evil.example/x.md" }),
      entry({ name: "credentialed", url: "https://user:pw@cdn.example/x.md" }),
    ]), OPTIONS);

    expect(parsed.problems).toEqual([]);
    for (const skill of parsed.entries) expect(skill.url).not.toContain("@");
    expect(parsed.entries.map((skill) => skill.url)).toEqual([
      "https://evil.example/x.md",
      "https://cdn.example/x.md",
    ]);
  });

  it("bounds the untrusted text it quotes back in a problem", () => {
    const parsed = parseAgentSkillsDiscoveryIndex(index([entry({ digest: "z".repeat(5000) })]), OPTIONS);

    const [problem] = parsed.problems;
    expect(problem?.message).toContain("invalid digest");
    expect(problem?.message.length).toBeLessThan(300);
    expect(problem?.message).toMatch(/z{200}…$/);
  });
});
