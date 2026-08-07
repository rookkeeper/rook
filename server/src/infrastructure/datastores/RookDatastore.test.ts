// @vitest-environment node
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RookDatastore } from "./RookDatastore.js";

describe("RookDatastore", () => {
  const originalDatabasePath = process.env.ROOK_DATABASE_PATH;

  afterEach(() => {
    if (originalDatabasePath === undefined) delete process.env.ROOK_DATABASE_PATH;
    else process.env.ROOK_DATABASE_PATH = originalDatabasePath;
  });

  it("uses the launcher-selected database path when provided", () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "rook-datastore-"));
    const databasePath = path.join(tempRoot, "profile", "rook.sqlite");
    process.env.ROOK_DATABASE_PATH = databasePath;

    const datastore = new RookDatastore();
    datastore.close();

    expect(existsSync(databasePath)).toBe(true);
    rmSync(tempRoot, { recursive: true, force: true });
  });
});
