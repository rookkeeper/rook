import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getRookHomeDir } from "../config/configPaths.js";

/** One SQLite datastore for Rook's durable server-side state. */
export class RookDatastore {
  readonly db: DatabaseSync;

  constructor(location?: string) {
    const resolvedLocation = location ?? process.env.ROOK_DATABASE_PATH ?? path.join(getRookHomeDir(), "rook.sqlite");
    if (resolvedLocation !== ":memory:") mkdirSync(path.dirname(resolvedLocation), { recursive: true });
    this.db = new DatabaseSync(resolvedLocation);
  }

  close(): void {
    this.db.close();
  }
}
