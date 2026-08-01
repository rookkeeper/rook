# Environment repository

This document is the terse product-level description of the environment repository architecture and filesystem shape.

## Purpose

An environment repository is the catalog of environment-linked bundles that Rook can discover and review.

It is intentionally broader than a skill repository.

An environment may have one or more bundles, and a bundle may contain:
- skills
- MCP server configuration/content
- app-related instructions / metadata
- facts
- `llms.txt` references
- other environment-bound artifacts later

## Layered architecture

```text
API / controllers
    ↓
Service
    ↓
EnvironmentRepository
    ↓
Storage
```

Current intent by layer:
- **API / controllers** — optional for now; if present, exposes environment/bundle inspection to clients
- **Service** — thin business-logic layer that looks up an environment and returns its bundles
- **EnvironmentRepository** — repository abstraction for reading environments/bundles from one or more backing stores
- **Storage** — SQLite is the live canonical/personal repository store; filesystem directories remain import and authoring sources where needed

## Repository model

We want a shared repository abstraction:
- `EnvironmentRepository`

First implementations:
- `SQLiteEnvironmentRepository`
- `DirectoryEnvironmentRepository` (legacy import and compatible external source)
- `ProjectDirectoryEnvironmentRepository` (project-owned authoring source)
- `CompositeEnvironmentRepository`

The canonical repository is stored in `environment-repository.db`; the user-local/personal repository is stored separately under the Rook data directory. Directory bundles remain importable, and writable personal/project content is synchronized back to its source files.

At runtime these are presented as one logical union repository. SQLite revisions retain content hashes, fetch/source metadata, and provenance so approval applies to exact agent-visible content.

## Environment ids

Environment ids use:

```text
<type>:<uri-like-path>
```

Current top-level environment types we want to standardize around:
- `location`
- `web`
- `mac`
- `dir`
- `iphone`
- `android`
- `windows`

Examples:
- `mac:md.obsidian`
- `mac:md.obsidian/reading_vault`
- `web:example.com`
- `web:example.com/stuff`
- `location:office`
- `dir:/Users/johnberryman/projects/github/rookkeeper/rook`

## Filesystem shape

Top level is organized by environment type:

```text
environment-repository/
├── android/
├── dir/
├── iphone/
├── location/
├── mac/
├── web/
└── windows/
```

Environment ids map directly to nested directories under those type roots.

Examples:
- `mac:md.obsidian` → `mac/md.obsidian/`
- `mac:md.obsidian/reading_vault` → `mac/md.obsidian/reading_vault/`
- `location:office` → `location/office/`
- `dir:/Users/johnberryman/projects/github/rookkeeper/rook` → `dir/Users/johnberryman/projects/github/rookkeeper/rook/`
- `web:example.com` → `web/example.com/`

## Bundles

Each environment directory may contain:

```text
.bundles/
```

Bundles live at:

```text
<environment>/.bundles/<bundle-id>/
```

Bundle ids are local to the environment.

Bundle identifiers conceptually use:

```text
<environment-id>#<bundle-id>
```

## Bundle contents

Bundle contents are grouped by type inside the bundle directory.

Current first-pass content directories are:
- `skills/`
- `mcp-servers/`
- `apps/`
- `facts/` (large fact sets may be represented as pseudo-skills)
- `llms.txt` (materialized as a generated reference skill)

Examples:
- `skills/<skill-name>/SKILL.md`
- `mcp-servers/config.json`
- `apps/instructions.md`

A bundle may contain only the content groups it needs.

## Example layout

```text
environment-repository/
├── mac/
│   └── md.obsidian/
│       ├── .bundles/
│       │   └── using-obsidian/
│       │       ├── .manifest
│       │       ├── apps/
│       │       │   └── instructions.md
│       │       └── skills/
│       │           └── obsidian-cli/
│       │               └── SKILL.md
│       ├── .manifest
│       └── reading_vault/
│           ├── .bundles/
│           │   ├── save-documents-to-read/
│           │   │   └── skills/
│           │   │       └── save-documents-to-read/
│           │   │           └── SKILL.md
│           │   └── identify-next-most-important-read/
│           │       └── skills/
│           │           └── identify-next-most-important-read/
│           │               ├── references/
│           │               ├── scripts/
│           │               └── SKILL.md
│           └── .manifest
├── location/
└── web/
```

## Database and authoring projections

SQLite is the source of truth for published bundle content and immutable revisions. Runtime agents still receive file-backed projections: generated instructions, nested skills, and read-only external capability areas. Personal skills and instruction files remain writable and synchronize back to the personal database. Project-directory environments read existing project files without copying them into the repository.

## Other dot-paths

Other environment-level and bundle-level metadata should live in dot-paths.

Current expected locations:
- environment manifest: `<environment>/.manifest`
- bundle manifest: `<environment>/.bundles/<bundle>/.manifest`

## Preview / review intent

The repository itself does not store separate preview files.

Review UI should render the actual contents of a bundle as a filesystem-style review:
- file tree on the left
- file contents on the right
- bundle errors shown per-bundle
