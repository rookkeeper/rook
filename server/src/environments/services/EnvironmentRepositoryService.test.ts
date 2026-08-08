// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hashEnvironmentBundle } from "./EnvironmentRepositoryService.js";
import type { EnvironmentBundle } from "../../shared/environmentRepository.js";

function makeBundle(bundlePath?: string): EnvironmentBundle {
  return {
    id: "web:example.com#mail",
    bundleId: "mail",
    environmentId: "web:example.com",
    repository: "test",
    bundlePath,
    valid: true,
    errors: [],
    agentsMd: "Confirm before sending.",
    skills: [{ id: "mail-search", files: {
      "mail-search/SKILL.md": "Search mail.",
      "mail-search/references/query.md": "from:example@example.com",
    } }],
    mcpServers: [],
    apps: [],
  };
}

describe("hashEnvironmentBundle", () => {
  it("does not depend on the bundle storage path", () => {
    expect(hashEnvironmentBundle(makeBundle("/one/.bundles/mail"))).toBe(hashEnvironmentBundle(makeBundle("/two/.bundles/mail")));
  });

  it("changes when agent-visible content changes", () => {
    const changed = makeBundle();
    changed.agentsMd = "Confirm before sending or deleting.";
    expect(hashEnvironmentBundle(changed)).not.toBe(hashEnvironmentBundle(makeBundle()));
  });
});
