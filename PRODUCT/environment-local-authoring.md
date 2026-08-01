# Environment-local authoring

When you're inside an environment, Rook can write skills, instructions, and tools directly into that environment's personal bundle. Whatever Rook writes will come back the next time you enter the environment.

## Personal bundles

Every environment has exactly one writable personal bundle in the personal SQLite repository. Rook may expose a compatibility filesystem projection for authoring, but the database is the source of truth.

Inside the personal bundle you can write these assets:

| Asset | Path |
|---|---|
| Skill | `.../.bundles/personal/skills/<skill-name>/SKILL.md` |
| AGENTS.md | `.../.bundles/personal/AGENTS.md` |
| MCP configuration/content | stored as a bundle artifact; runtime lifecycle is deferred |

The personal bundle is created automatically when you enter an environment — no setup needed.

## What Rook sees

When you enter an environment, Rook's system message is extended with three sections:

**1. Rook identity prompt.** Explains what Rook is, how environments and bundles work, and that Rook can write into any entered environment's personal bundle.

**2. Authoring instructions.** For each entered environment, Rook sees the exact projected paths where it can write personal skills and `AGENTS.md`, plus the existing capability files. Writable changes synchronize back to the personal repository; external/canonical projections are read-only.

**3. Environment metadata.** Each entered environment dumps its metadata (display name, app name, observed paths/URLs, window title, latitude/longitude, etc.) so Rook has context for what you're doing.

Because Rook may be in several environments at once, the instructions remind Rook to clarify which environment a skill or instruction belongs to before writing anything.

## AGENTS.md in bundles

Anyone can put an `AGENTS.md` at the root of a bundle directory:

```text
environment-repository/web/x.com/.bundles/using-x/AGENTS.md
```

When a bundle is accepted, its `AGENTS.md` content is injected into Rook's system message under a "Environment instructions" section. This is additive across bundles — you can have instructions from the canonical repo and the personal bundle all at once. Approval is tied to the bundle's exact content hash.

## Over time

This should settle into a rhythm. You do something with Rook in an environment. After a few rounds you tell Rook "remember this for next time." Rook writes a skill or updates `AGENTS.md`. Next time you're there, it just works.
