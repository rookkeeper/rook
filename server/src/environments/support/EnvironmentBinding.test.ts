// @vitest-environment node
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensurePersonalEnvironmentBinding } from "./EnvironmentBinding.js";

describe("EnvironmentBinding", () => {
  let originalHome: string | undefined;
  let originalRookHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;
    originalRookHome = process.env.ROOK_HOME;
    delete process.env.ROOK_HOME;
    process.env.HOME = path.join(os.tmpdir(), `rook-binding-${Date.now()}`);
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalRookHome === undefined) delete process.env.ROOK_HOME;
    else process.env.ROOK_HOME = originalRookHome;
  });

  it("stores dir environment bindings under the user environment repository", () => {
    const binding = ensurePersonalEnvironmentBinding("dir:/Users/john/project/subdir");
    expect(binding).not.toBeNull();
    expect(binding?.environmentDir).toBe(path.join(process.env.HOME!, ".rook", "environment-repository", "dir", "Users", "john", "project", "subdir"));
  });

  it("uses ROOK_HOME when a launcher profile provides one", () => {
    const rookHome = path.join(os.tmpdir(), `rook-profile-${Date.now()}`);
    process.env.ROOK_HOME = rookHome;

    const binding = ensurePersonalEnvironmentBinding("web:example.com");

    expect(binding?.environmentDir).toBe(path.join(rookHome, "environment-repository", "web", "example.com"));
  });
});
