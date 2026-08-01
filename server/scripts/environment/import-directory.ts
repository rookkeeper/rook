import path from "node:path";
import { SQLiteEnvironmentRepository } from "../../src/environments/repositories/SQLiteEnvironmentRepository.js";

const [sourceRoot, databasePath, repositoryId = "canonical"] = process.argv.slice(2);
if (!sourceRoot || !databasePath) {
  console.error("Usage: npm exec tsx scripts/environment/import-directory.ts <source-root> <database-path> [repository-id]");
  process.exit(1);
}

const repository = new SQLiteEnvironmentRepository(path.resolve(databasePath), repositoryId);
try {
  const count = await repository.importDirectory(path.resolve(sourceRoot));
  console.log(`Imported ${count} environments into ${path.resolve(databasePath)} (${repositoryId}).`);
} finally {
  repository.close();
}
