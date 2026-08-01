# Goals of Rook

Rook is intended to be a personal assistant that can accompany the user across devices, agents, applications, websites, projects, and physical places.

## Product priorities

- **Bring your own agent.** Users can choose the runtime they trust. Rook provides the client, environment, session, approval, and persistence layers without requiring one built-in model/runtime.
- **Rook is personal.** It should learn user preferences through explicit, inspectable skills and instructions rather than opaque memory alone.
- **Rook goes everywhere.** Mac, iPhone, Android, and future clients share the server/session contract while supplying platform-specific environment signals.
- **Rook understands context.** Websites, apps, directories, projects, locations, and other contexts can become explicit environments with discoverable capabilities.
- **Rook is capable in context.** Environment bundles can provide skills, instructions, facts, references, app metadata, and eventually controlled tools.
- **Rook is transparent and safe.** Users review external bundle content, approve exact revisions, retain writable personal content, and receive file-backed runtime projections that can be inspected.

## Current implementation boundary

The environment repository migration makes SQLite the source of truth for canonical and personal bundle content while preserving file-backed ACP runtimes. Each session gets a fresh workspace. Personal content can be edited and written back; canonical/external projections are read-only by current filesystem policy.

The current system does not yet provide strong OS sandboxing, repository prompt-injection validation, signed publishers, capability-level approval, or complete MCP lifecycle management. Those are explicit future goals rather than hidden assumptions.

## Longer-term direction

Rook may eventually support scheduled work, inbound hooks, interactive artifacts, participatory skill authoring, richer bridge operations, and multi-agent collaboration. Those features should preserve the same principles: explicit user-visible artifacts, inspectable state, scoped permissions, and agent/runtime interchangeability.
