# Environment state management and notifications

This document separates the current environment lifecycle from future ambient-state work.

## Current state model

`EnvironmentManager` tracks, in memory:

- registered/available environments
- active and recent availability windows
- explicit session membership
- pending bundle offers
- ephemeral `accept`/`ignore` decisions
- listeners that trigger affected-session runtime restarts

Durable state lives elsewhere:

- session membership is stored with the session
- durable `approve`/`reject` decisions are keyed by bundle content hash
- environment, capability, and bundle-membership content lives in canonical/personal SQLite databases; membership deletion uses nullable timestamps

## Current runtime behavior

Environment entry is explicit and literal. When a session enters or leaves an environment, the server resolves effective bundles, updates shared/direct source links, regenerates the read-only aggregate instructions, and reloads the existing ACP session in a replacement runtime. When a persisted session is first used after a server restart, known repository-backed memberships are rehydrated before the same projection and runtime recovery steps; memberships whose environments no longer have valid bundles remain durable but are skipped. This preserves session identity and ACP-owned session history while keeping writable SQLite content shared across sessions.

Environment availability does not automatically enter an environment or inject capabilities. Providers may register candidates, and clients/users decide what to enter and which bundles to accept or approve.

## State delivered to the agent

The generated read-only `AGENTS.md` includes environment-tagged instruction sources, authoring guidance, concrete source paths, and a per-environment inventory of known skill names. Each personal environment has one linked `.agents/editable-per-environment/<environment-nickname>/` source containing both `AGENTS.md` and `.agents/skills/`; runtime skill paths are discovered from `.agents/skills` rather than injected into the prompt. Directory environments expose their concrete project paths instead of a personal authoring link.

Dynamic UI/client environment banners and bundle offers are separate from repository content. The server does not currently stream arbitrary environment state directly into the agent as user messages. Pi receives one-run approval for the generated session workspace so its non-interactive ACP process loads `.agents/skills`; this runtime trust is distinct from accepting or approving environment bundles.

## Safety and noise boundaries

Environment-provided text is agent-visible content and participates in the relevant bundle hash. Canonical/external materializations are read-only by filesystem policy. Arbitrary shell-capable agents can potentially bypass same-user permissions, so strong OS isolation and prompt-injection validation remain future work.

The system does not yet solve high-frequency ambient state, relevance filtering, proactive prompts, or cross-environment state summarization. Those should be pull-oriented or explicitly user-consented rather than unrestricted environment-originated messages.
