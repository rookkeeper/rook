import path from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === "production";

export const parentMessageToolExtensionPath = isProduction
  ? path.join(serverDir, "..", "runtime", "extensions", "parentMessageTool.js")
  : path.join(serverDir, "..", "runtime", "extensions", "parentMessageTool.ts");

export { isProduction };
