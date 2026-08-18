// @vitest-environment node
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RookDatastore } from "./RookDatastore.js";

describe("RookDatastore", () => {
  const originalDatabasePath = process.env.ROOK_DATABASE_PATH;
  const originalRookHome = process.env.ROOK_HOME;

  afterEach(() => {
    if (originalDatabasePath === undefined) delete process.env.ROOK_DATABASE_PATH;
    else process.env.ROOK_DATABASE_PATH = originalDatabasePath;
    if (originalRookHome === undefined) delete process.env.ROOK_HOME;
    else process.env.ROOK_HOME = originalRookHome;
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

  it("removes the obsolete transcript table while retaining the application database", () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "rook-datastore-cleanup-"));
    const databasePath = path.join(tempRoot, "rook.sqlite");
    const initial = new RookDatastore(databasePath);
    initial.db.exec("CREATE TABLE session_transcript_events (sequence INTEGER PRIMARY KEY)");
    initial.close();

    const datastore = new RookDatastore(databasePath);
    const table = datastore.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_transcript_events'").get();
    datastore.close();

    expect(table).toBeUndefined();
    expect(existsSync(databasePath)).toBe(true);
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("defaults to ROOK_HOME/rook.sqlite when no explicit database path is set", () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "rook-datastore-home-"));
    const rookHome = path.join(tempRoot, "rook-home");
    const databasePath = path.join(rookHome, "rook.sqlite");
    delete process.env.ROOK_DATABASE_PATH;
    process.env.ROOK_HOME = rookHome;

    const datastore = new RookDatastore();
    datastore.close();

    expect(existsSync(databasePath)).toBe(true);
    rmSync(tempRoot, { recursive: true, force: true });
  });
});
