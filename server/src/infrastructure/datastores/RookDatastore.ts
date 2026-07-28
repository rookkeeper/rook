import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { REPO_ROOT } from "../paths.js";

/** One SQLite datastore for Rook's durable server-side state. */
export class RookDatastore {
  readonly db: DatabaseSync;

  constructor(location = path.join(REPO_ROOT, ".var", "rook", "rook.sqlite")) {
    if (location !== ":memory:") mkdirSync(path.dirname(location), { recursive: true });
    this.db = new DatabaseSync(location);
  }

  close(): void {
    this.db.close();
  }
}
