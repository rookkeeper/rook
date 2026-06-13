#!/usr/bin/env node
/**
 * Semantic TypeScript queries via the compiler API — a lightweight LSP substitute.
 *
 * Runs from repo root (or any subdirectory); auto-detects agent-server-client/.
 * File paths are resolved relative to agent-server-client/.
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Walk up from the skill's scripts/ directory to the repo root, then into agent-server-client/.
// Skill layout: .agents/skills/<name>/scripts/ts-query.mjs  →  ../../../../ = repo root
const SKILL_SCRIPTS_DIR = __dirname;
const REPO_ROOT = path.resolve(SKILL_SCRIPTS_DIR, "..", "..", "..", "..");
const agentClientRoot = path.join(REPO_ROOT, "agent-server-client");
const require = createRequire(path.join(agentClientRoot, "package.json"));
const ts = require("typescript");

// Auto-detect agent-server-client/.
let ROOT = agentClientRoot;
if (!fs.existsSync(path.join(ROOT, "tsconfig.json"))) {
  // Fall back to CWD.
  ROOT = path.resolve(".");
  if (!fs.existsSync(path.join(ROOT, "tsconfig.json"))) {
    // Walk up from CWD.
    let dir = ROOT;
    while (dir !== path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, "agent-server-client", "tsconfig.json"))) {
        ROOT = path.join(dir, "agent-server-client");
        break;
      }
      dir = path.dirname(dir);
    }
  }
}
if (!fs.existsSync(path.join(ROOT, "tsconfig.json"))) {
  console.error("Cannot find agent-server-client/tsconfig.json. Run from the repo root or agent-server-client/.");
  process.exit(1);
}
const CONFIG_PATH = path.join(ROOT, "tsconfig.json");

const { config } = ts.readConfigFile(CONFIG_PATH, ts.sys.readFile);
const { options, fileNames } = ts.parseJsonConfigFileContent(config, ts.sys, ROOT);

// Build project from ROOT so relative fileNames resolve correctly.
const prevCwd = process.cwd();
process.chdir(ROOT);
const program = ts.createProgram(fileNames, options);
process.chdir(prevCwd);
const checker = program.getTypeChecker();
// Use the program's full source list (includes transitive imports like src/shared/).
const sourceFiles = program.getSourceFiles().filter((sf) => !sf.isDeclarationFile);

// ── helpers ──────────────────────────────────────────────────────────

function resolveFile(input) {
  // Allow relative paths from ROOT or just the basename.
  const resolved = path.resolve(ROOT, input);
  if (fs.existsSync(resolved)) return resolved;
  const byName = sourceFiles.find(
    (sf) => path.resolve(sf.fileName).endsWith(input) || path.resolve(sf.fileName).endsWith("/" + input),
  );
  if (byName) return path.resolve(byName.fileName);
  return null;
}

/** Get the source file object, loading it if needed. */
function getSourceFile(filePath) {
  const resolved = path.resolve(filePath);
  return sourceFiles.find((sf) => path.resolve(sf.fileName) === resolved) ?? null;
}

/**
 * Find a top-level exported symbol in a source file by name.
 * Returns `{ symbol, declaration }` or null.
 */
function findExportedSymbol(sf, name) {
  const moduleSymbol = checker.getSymbolAtLocation(sf);
  if (!moduleSymbol) return null;
  const exports = checker.getExportsOfModule(moduleSymbol);
  for (const sym of exports) {
    if (sym.getName() === name) {
      const decl = sym.declarations?.[0] ?? null;
      return { symbol: sym, declaration: decl };
    }
  }
  return null;
}

function locationString(node) {
  const sf = node.getSourceFile();
  const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart());
  return `${sf.fileName}:${line + 1}:${character + 1}`;
}

/**
 * Compare two symbols — handles alias symbols that TypeScript creates at import
 * sites (where `symA === symB` is false even though they refer to the same
 * declaration).
 */
function isSameSymbol(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  // Follow aliases (only safe if the flag is set).
  const aAliased = a.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(a) : a;
  const bAliased = b.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(b) : b;
  return aAliased === bAliased;
}

// ── commands ─────────────────────────────────────────────────────────

function cmdRefs(filePath, symbolName) {
  const sf = getSourceFile(filePath);
  if (!sf) { console.error("File not in project:", filePath); return; }
  const found = findExportedSymbol(sf, symbolName);
  if (!found) { console.error(`Symbol "${symbolName}" not exported from ${filePath}`); return; }

  const results = [];
  for (const otherSf of sourceFiles) {
    ts.forEachChild(otherSf, function visit(node) {
      if (ts.isIdentifier(node) && node.text === symbolName) {
        const sym = checker.getSymbolAtLocation(node);
        if (sym && isSameSymbol(sym, found.symbol)) {
          results.push({
            file: otherSf.fileName,
            line: otherSf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            col: otherSf.getLineAndCharacterOfPosition(node.getStart()).character + 1,
          });
        }
      }
      ts.forEachChild(node, visit);
    });
  }

  if (results.length === 0) {
    console.log("No references found.");
  } else {
    for (const r of results) console.log(`${r.file}:${r.line}:${r.col}`);
  }
}

function cmdImports(filePath, symbolName) {
  const resolvedPath = path.resolve(filePath);
  const sf = getSourceFile(filePath);
  if (!sf) { console.error("File not in project:", filePath); return; }
  const found = findExportedSymbol(sf, symbolName);
  if (!found) { console.error(`Symbol "${symbolName}" not exported from ${filePath}`); return; }

  const results = new Set();
  for (const otherSf of sourceFiles) {
    if (path.resolve(otherSf.fileName) === resolvedPath) continue;
    let hasImport = false;
    ts.forEachChild(otherSf, function visit(node) {
      if (hasImport) return;
      if (ts.isIdentifier(node) && node.text === symbolName) {
        const sym = checker.getSymbolAtLocation(node);
        if (sym && isSameSymbol(sym, found.symbol)) hasImport = true;
      }
      if (!hasImport) ts.forEachChild(node, visit);
    });
    if (hasImport) results.add(otherSf.fileName);
  }

  if (results.size === 0) {
    console.log("No imports found.");
  } else {
    for (const f of [...results].sort()) console.log(f);
  }
}

function cmdDead(filePath) {
  const resolvedPath = path.resolve(filePath);
  const sf = getSourceFile(filePath);
  if (!sf) { console.error("File not in project:", filePath); return; }
  const moduleSymbol = checker.getSymbolAtLocation(sf);
  if (!moduleSymbol) { console.error("No module symbol for", filePath); return; }
  const exports = checker.getExportsOfModule(moduleSymbol);

  const dead = [];
  for (const sym of exports) {
    const name = sym.getName();
    let usedExternally = false;
    for (const otherSf of sourceFiles) {
      if (path.resolve(otherSf.fileName) === resolvedPath) continue;
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
    if (!usedExternally) dead.push(name);
  }

  if (dead.length === 0) {
    console.log("All exports are used externally.");
  } else {
    for (const name of dead) console.log(name);
  }
}

function cmdExports(filePath) {
  const sf = getSourceFile(filePath);
  if (!sf) { console.error("File not in project:", filePath); return; }
  const moduleSymbol = checker.getSymbolAtLocation(sf);
  if (!moduleSymbol) { console.error("No module symbol for", filePath); return; }
  const exports = checker.getExportsOfModule(moduleSymbol);
  for (const sym of exports) {
    const decl = sym.declarations?.[0];
    const loc = decl ? locationString(decl) : "?";
    const flags = ts.SymbolFlags;
    let kind = "?";
    if (sym.flags & flags.Interface) kind = "interface";
    else if (sym.flags & flags.TypeAlias) kind = "type";
    else if (sym.flags & flags.Class) kind = "class";
    else if (sym.flags & flags.Function) kind = "function";
    else if (sym.flags & flags.Variable) kind = "const";
    else if (sym.flags & flags.Enum) kind = "enum";
    console.log(`${kind} ${sym.getName()}  ${loc}`);
  }
}

function cmdCheck(filePath) {
  const sf = getSourceFile(filePath);
  if (!sf) { console.error("File not in project:", filePath); return; }
  // Reuse diagnostics already collected by the program (includes syntactic + semantic).
  const diagnostics = [
    ...program.getSyntacticDiagnostics(sf),
    ...program.getSemanticDiagnostics(sf),
  ];
  if (diagnostics.length === 0) {
    console.log("No errors.");
    return;
  }
  for (const d of diagnostics) {
    const pos = sf.getLineAndCharacterOfPosition(d.start ?? 0);
    const msg = ts.flattenDiagnosticMessageText(d.messageText, "\n");
    console.log(`${sf.fileName}:${pos.line + 1}:${pos.character + 1}  ${msg}`);
  }
}

// ── main ─────────────────────────────────────────────────────────────

const [,, cmd, ...args] = process.argv;

if (!cmd || cmd === "--help" || cmd === "-h") {
  console.log(`ts-query — semantic TypeScript queries

  refs     <file> <symbol>   Find all references to an exported symbol
  imports  <file> <symbol>   Find files that import an exported symbol
  dead     <file>            List exports with no external references
  exports  <file>            List all top-level exports
  check    <file>            Show diagnostics for a file`);
  process.exit(0);
}

const fileArg = args[0];
if (!fileArg) { console.error("Missing file argument."); process.exit(1); }
const filePath = resolveFile(fileArg);
if (!filePath) { console.error("File not found in project:", fileArg); process.exit(1); }

switch (cmd) {
  case "refs":
    if (!args[1]) { console.error("Missing symbol name."); process.exit(1); }
    cmdRefs(filePath, args[1]);
    break;
  case "imports":
    if (!args[1]) { console.error("Missing symbol name."); process.exit(1); }
    cmdImports(filePath, args[1]);
    break;
  case "dead":
    cmdDead(filePath);
    break;
  case "exports":
    cmdExports(filePath);
    break;
  case "check":
    cmdCheck(filePath);
    break;
  default:
    console.error(`Unknown command: ${cmd}`);
    process.exit(1);
}
