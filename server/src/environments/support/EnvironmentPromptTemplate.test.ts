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

  it("does not expose the machine environment id", () => {
    const result = renderEnvironmentPrompt([makeEntry({ environmentId: "web:example.com", displayName: "Example" })]);
    expect(result!).toContain('<environment name="Example">');
    expect(result!).not.toContain('<environment name="web:example.com">');
  });

  it("includes personal bundle path", () => {
    const result = renderEnvironmentPrompt([makeEntry()]);
    expect(result!).toContain('<bundle name="Personal capabilities" editable="true">');
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

  it("includes display name in the environment tag", () => {
    const result = renderEnvironmentPrompt([makeEntry({ displayName: "Obsidian" })]);
    expect(result!).toContain('<environment name="Obsidian">');
  });

  it("uses a human fallback when display name is absent", () => {
    const result = renderEnvironmentPrompt([makeEntry({ displayName: undefined })]);
    expect(result!).toContain('<environment name="Current environment">');
  });

  it("renders useful metadata as context tags", () => {
    const meta = { registeredAt: "2026-01-01T00:00:00Z", appName: "TestApp", website: "https://example.com" };
    const result = renderEnvironmentPrompt([makeEntry({ metadata: meta })]);
    expect(result!).toContain("<app_name>TestApp</app_name>");
    expect(result!).toContain("<website>https://example.com</website>");
    expect(result!).not.toContain("registeredAt");
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
    expect(result!).toContain('<bundle name="Personal capabilities" editable="true">');
    expect(result!).toContain("Always say hello.");
    expect(result!).toContain('<bundle name="Environment capabilities">');
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
    const aIndex = result!.indexOf('<environment name="Current environment">');
    const zIndex = result!.lastIndexOf('<environment name="Current environment">');
    expect(aIndex).toBeLessThan(zIndex);
  });

  it("renders AGENTS.md content with proper indentation", () => {
    const result = renderEnvironmentPrompt([
      makeEntry({
        agentsMdBundles: [{ bundleId: "default", content: "Line one\nLine two" }],
      }),
    ]);
    // Content lines should remain readable inside pseudo-markup.
    expect(result!).toContain("      Line one");
    expect(result!).toContain("      Line two");
  });
});
