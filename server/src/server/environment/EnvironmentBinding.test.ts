// @vitest-environment node
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensurePersonalEnvironmentBinding } from "./EnvironmentBinding.js";

describe("EnvironmentBinding", () => {
  let originalHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;
    process.env.HOME = path.join(os.tmpdir(), `rook-binding-${Date.now()}`);
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
  });

  it("stores dir environment bindings under the user environment repository", () => {
    const binding = ensurePersonalEnvironmentBinding("dir:/Users/john/project/subdir");
    expect(binding).not.toBeNull();
    expect(binding?.environmentDir).toBe(path.join(process.env.HOME!, ".rook", "environment-repository", "dir", "Users", "john", "project", "subdir"));
  });
});
