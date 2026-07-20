// @vitest-environment node
import { describe, expect, it } from "vitest";
import { renderEnvironmentPrompt } from "./EnvironmentPromptTemplate.js";
import type { EnvironmentPromptEntry } from "./EnvironmentPromptTemplate.js";

function makeEntry(overrides: Partial<EnvironmentPromptEntry> = {}): EnvironmentPromptEntry {
  return {
    environmentId: "web:example.com",
    metadata: { registeredAt: "2026-01-01T00:00:00Z" },
    bindingDir: "/tmp/.rook/env/web/example.com/.bundles/personal",
    skillsDir: "/tmp/.rook/env/web/example.com/.bundles/personal/skills",
    existingSkills: [],
    agentsMdBundles: [],
    ...overrides,
  };
}

describe("renderEnvironmentPrompt", () => {
  it("returns undefined for empty entries", () => {
    expect(renderEnvironmentPrompt([])).toBeUndefined();
  });

  it("renders intro section", () => {
    const result = renderEnvironmentPrompt([makeEntry()]);
    expect(result).toBeDefined();
    expect(result!).toContain("## Currently entered environments");
    expect(result!).toContain("## Attaching memories and capabilities to an environment");
  });

  it("includes environmentId in header", () => {
    const result = renderEnvironmentPrompt([makeEntry({ environmentId: "web:example.com" })]);
    expect(result!).toContain("### `web:example.com`");
  });

  it("includes personal bundle path", () => {
    const result = renderEnvironmentPrompt([makeEntry()]);
    expect(result!).toContain("Personal bundle:");
    expect(result!).toContain("/tmp/.rook/env/web/example.com/.bundles/personal");
  });

  it("includes skills directory path", () => {
    const result = renderEnvironmentPrompt([makeEntry()]);
    expect(result!).toContain("Write skills to:");
    expect(result!).toContain("/tmp/.rook/env/web/example.com/.bundles/personal/skills");
  });

  it("shows existing skills list", () => {
    const result = renderEnvironmentPrompt([makeEntry({ existingSkills: ["skill-a", "skill-b"] })]);
    expect(result!).toContain("`skill-a`, `skill-b`");
  });

  it("shows (none yet) for empty skills", () => {
    const result = renderEnvironmentPrompt([makeEntry({ existingSkills: [] })]);
    expect(result!).toContain("(none yet)");
  });

  it("includes source name when provided", () => {
    const result = renderEnvironmentPrompt([makeEntry({ sourceName: "Obsidian" })]);
    expect(result!).toContain("Source name: Obsidian");
  });

  it("omits source name line when absent", () => {
    const result = renderEnvironmentPrompt([makeEntry({ sourceName: undefined })]);
    expect(result!).not.toContain("Source name:");
  });

  it("includes canonical source URL when provided", () => {
    const result = renderEnvironmentPrompt([makeEntry({ canonicalSourceUrl: "https://example.com" })]);
    expect(result!).toContain("Canonical source URL: https://example.com");
  });

  it("includes context text when provided", () => {
    const result = renderEnvironmentPrompt([makeEntry({ contextText: "The user is browsing" })]);
    expect(result!).toContain("Current environment context: The user is browsing");
  });

  it("renders metadata as JSON block", () => {
    const meta = { registeredAt: "2026-01-01T00:00:00Z", appName: "TestApp" };
    const result = renderEnvironmentPrompt([makeEntry({ metadata: meta })]);
    expect(result!).toContain("```json");
    expect(result!).toContain('"registeredAt"');
    expect(result!).toContain('"appName": "TestApp"');
  });

  it("includes AGENTS.md bundles when present", () => {
    const result = renderEnvironmentPrompt([
      makeEntry({
        agentsMdBundles: [
          { bundleId: "default", content: "Always say hello." },
          { bundleId: "extra", content: "Keep track of todos." },
        ],
      }),
    ]);
    expect(result!).toContain("Environment instructions:");
    expect(result!).toContain("**personal**");
    expect(result!).toContain("Always say hello.");
    expect(result!).toContain("**extra**");
    expect(result!).toContain("Keep track of todos.");
  });

  it("omits environment instructions section when no AGENTS.md bundles", () => {
    const result = renderEnvironmentPrompt([makeEntry({ agentsMdBundles: [] })]);
    expect(result!).not.toContain("Environment instructions:");
  });

  it("renders multiple environments sorted by environmentId", () => {
    const result = renderEnvironmentPrompt([
      makeEntry({ environmentId: "web:z.com" }),
      makeEntry({ environmentId: "web:a.com" }),
    ]);
    const aIndex = result!.indexOf("### `web:a.com`");
    const zIndex = result!.indexOf("### `web:z.com`");
    expect(aIndex).toBeLessThan(zIndex);
  });

  it("renders AGENTS.md content with proper indentation", () => {
    const result = renderEnvironmentPrompt([
      makeEntry({
        agentsMdBundles: [{ bundleId: "default", content: "Line one\nLine two" }],
      }),
    ]);
    // Content lines should be indented with 4 spaces
    expect(result!).toContain("    Line one");
    expect(result!).toContain("    Line two");
  });
});
