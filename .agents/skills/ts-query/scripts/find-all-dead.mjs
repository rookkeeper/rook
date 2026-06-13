#!/usr/bin/env node
/**
 * Batch dead-export scanner — finds all unused exports project-wide.
 * Outputs one line per dead export:  file  symbolName
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const SKILL_SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SKILL_SCRIPTS_DIR, "..", "..", "..", "..");
const ROOT = path.join(REPO_ROOT, "agent-server-client");
const require = createRequire(path.join(ROOT, "package.json"));
const ts = require("typescript");

const configPath = ts.findConfigFile(ROOT, ts.sys.fileExists, "tsconfig.json");
if (!configPath) { console.error("No tsconfig.json"); process.exit(1); }
const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
const { options, fileNames } = ts.parseJsonConfigFileContent(config, ts.sys, ROOT);

const prevCwd = process.cwd();
process.chdir(ROOT);
const program = ts.createProgram(fileNames, options);
process.chdir(prevCwd);
const checker = program.getTypeChecker();
const sourceFiles = program.getSourceFiles().filter((sf) => !sf.isDeclarationFile);

function isSameSymbol(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const aAliased = a.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(a) : a;
  const bAliased = b.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(b) : b;
  return aAliased === bAliased;
}

const results = [];

for (const sf of sourceFiles) {
  const moduleSymbol = checker.getSymbolAtLocation(sf);
  if (!moduleSymbol) continue;
  const exports = checker.getExportsOfModule(moduleSymbol);
  if (exports.length === 0) continue;

  for (const sym of exports) {
    const name = sym.getName();
    let usedExternally = false;
    for (const otherSf of sourceFiles) {
      if (path.resolve(otherSf.fileName) === path.resolve(sf.fileName)) continue;
      let found = false;
      ts.forEachChild(otherSf, function visit(node) {
        if (found) return;
        if (ts.isIdentifier(node) && node.text === name) {
          const s = checker.getSymbolAtLocation(node);
          if (s && isSameSymbol(s, sym)) found = true;
        }
        if (!found) ts.forEachChild(node, visit);
      });
      if (found) { usedExternally = true; break; }
    }
    if (!usedExternally) {
      const rel = path.relative(ROOT, sf.fileName);
      results.push(`${rel}  ${name}`);
    }
  }
}

const filterDir = process.argv[2] ?? "";

for (const line of results.sort()) {
  if (!filterDir || line.startsWith(filterDir)) console.log(line);
}
