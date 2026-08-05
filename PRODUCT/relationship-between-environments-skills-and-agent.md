# Environments, capabilities, and the Rook agent

Rook is separated from environment internals by a repository, approval, and runtime-materialization boundary. The agent receives ordinary files and instructions in its session workspace; it does not depend on repository storage paths.

## Environment

An environment is a recognizable context with an id such as:

- `web:example.com`
- `mac:md.obsidian/MyVault`
- `location:office`
- `dir:/Users/johnberryman/projects/github/rookkeeper/rook`

An environment has metadata and can have one or more capability bundles. Registration and entry are literal, although observed paths and URLs may discover additional known repository environments.

## Environment repositories

An environment repository is a searchable catalog of environment metadata and bundle revisions. The live logical view combines canonical SQLite content, personal SQLite content, direct project-directory content, and synthetic sources such as location context.

A bundle remains the unit of publication, review, approval, and runtime loading. It may contain skills, nested skill files, instructions, facts, `llms.txt`, app metadata, and MCP configuration/content.

The canonical approval boundary is the exact agent-visible content hash. Personal content is writable and does not require approval; canonical/external content is immutable to the user.

## Capability materialization

For an entered environment, approved or personal bundle content is projected into the session workspace:

- skills become `.agents/skills/<name>/`
- instructions become generated `AGENTS.md` sections
- small facts become inline facts; large facts become pseudo-skills
- `llms.txt` becomes a generated reference skill
- MCP content becomes a separate read-only area

The runtime is restarted for environment changes only after the existing ACP session has been loaded into the replacement process. The workspace is rebuilt instead of trusting stale files. Pi receives one-run project approval for the generated workspace so non-interactive ACP startup discovers `.agents/skills`; this is separate from Rook's bundle approval boundary.

## EnvironmentManager

`EnvironmentManager` coordinates availability, offers, decisions, entry, and runtime bundle resolution. It distinguishes temporary `accept`/`ignore` decisions from durable `approve`/`reject` decisions keyed by exact bundle hash. Sessions do not automatically enter every available environment.

## Narrow environment bridge

The long-term interaction model is that skills describe narrow environment operations rather than granting arbitrary environment access. The current migration does not implement a universal `interact_with_environment` tool; the Mac bridge and other platform mechanisms remain separate runtime/client features. MCP lifecycle and a stronger capability permission model are future work.
