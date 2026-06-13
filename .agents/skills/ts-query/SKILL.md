---
name: ts-query
description: Semantic TypeScript queries (find references, dead exports, imports, diagnostics) using the compiler API. Use when finding all usages of a symbol, checking what imports an export, detecting dead code, listing exports, or checking for errors — especially during refactoring or cleanup work in a TypeScript monorepo.
---

# ts-query — semantic TypeScript queries

Runs from repo root. All file paths are relative to `agent-server-client/`.

```
.agents/skills/ts-query/scripts/ts-query.mjs <command> <file> [symbol]
```

## Commands

### `refs` — find all references
```
ts-query.mjs refs src/shared/agent.ts AgentRunStatus
```
Prints `file:line:col` for every reference, including the definition. Handles re-exports and alias symbols correctly.

### `imports` — find importing files
```
ts-query.mjs imports src/shared/realtime.ts EnvironmentEventPayload
```
Lists files that import the symbol. Faster than `refs` when you only need to know *where* it's used, not exactly which line.

### `dead` — find unused exports
```
ts-query.mjs dead src/shared/agent.ts
```
Lists exports with zero external references. Caveat: exports consumed only through function signatures (return/parameter types) will be flagged — use human judgment.

### `exports` — list all exports
```
ts-query.mjs exports src/server/agents/agentDiscovery.ts
```
Prints `kind name  file:line:col` for every top-level export.

### `check` — diagnostics
```
ts-query.mjs check src/server/agents/BaseAgent.ts
```
Shows syntactic + semantic TypeScript errors for a file. Prints "No errors." if clean.

## When to use

Prefer this over `rg`/grep when you need:
- All references to a symbol (not just string matches)
- To know if an export is dead code
- To see what files depend on a module
- Semantic errors that `tsc --noEmit` catches but grep can't

For simple text searches, `rg` is faster. Use `ts-query` when you need the type checker's understanding of the code.

## Batch dead-symbol scan

```
# Full project
.agents/skills/ts-query/scripts/find-all-dead.mjs

# Filter to a directory
.agents/skills/ts-query/scripts/find-all-dead.mjs src/client
.agents/skills/ts-query/scripts/find-all-dead.mjs src/shared
.agents/skills/ts-query/scripts/find-all-dead.mjs src/server/agents
```

Scans every source file for exports with zero **named imports** and outputs
`file  symbol` for each. Filter by passing a directory prefix argument.

### False positives — investigate every result

The scanner only detects explicitly named imports. TypeScript can consume a type
without ever naming it. Every result must be investigated — do not blindly
delete. Check each candidate with `refs` to confirm:

```bash
ts-query.mjs refs <file> <symbol>
```

Known false-positive patterns (symbol will show zero refs but is still in use):

| Pattern | Example | Why invisible |
|---------|---------|---------------|
| **Union members** | `export type Foo = A \| B` — `B` is never imported by name | Consumers import `Foo`, not `B` |
| **JSX prop interfaces** | `<Modal open />` — Props consumed through JSX | No `import { ModalProps }` anywhere |
| **Return/param types** | `export function build(): Options` | Callers get `Options` via type inference |
| **Barrel re-exports** | `export type { X } from './src'` | Consumers import `X` from original location |
| **Tool config exports** | `export default defineConfig({...})` | Vite/CLI reads it, not source files |

Write findings to `.var/dead_symbols.md` and categorize each entry with a notes
column explaining whether it's truly dead or a false positive.
