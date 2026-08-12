# Triggered agent interactions

**Status: provisional — not an implementation decision**

This document records exploration only. Recommendations and preferred directions remain uncommitted until the developer explicitly confirms them.

## Problem

Rook should be able to receive an external event, initially a Zoom meeting transcript becoming available, and safely start agent work without the user manually typing into a client. The first workflow should summarize the meeting, identify people, write useful meeting material, and update a Peeps area in an Obsidian vault.

The event may arrive while the user's Mac is offline or unavailable. A home server is a better always-on ingress/worker candidate, but it does not currently run Rook. The design therefore has to address deployment, synchronization, authorization, user notification, and the distinction between server-side processing and Mac-side mutations.

## Investigation

The current Rook server is a Fastify service with REST control routes and an ACP WebSocket facade. It owns one ACP runtime subprocess per public session, durable session/transcript state in SQLite, and explicit environment membership. The CLI is a thin ACP client that can create/resume sessions, send prompts, and enter/leave environments; it is not currently an event worker or durable task manager.

The current server has no inbound trigger endpoint, event queue, task model, background worker, task notification stream, or cross-server delegation protocol. Server authentication is a single optional Bearer token. Environment entry is explicit; environment availability does not automatically enter an environment. Obsidian is detected by the Mac client as an environment, and the product direction describes a future narrow environment bridge, but there is no universal Obsidian write bridge in the current server.

Zoom documentation indicates that meeting webhooks can notify an HTTPS endpoint when recording/transcript material is ready. Relevant variants include ordinary meeting recording events with transcript recording files and Video SDK transcript-completed events. Webhooks require public endpoint configuration, validation, appropriate Zoom scopes, and careful handling of temporary download URLs/tokens.

## Options and questions

### Where should ingress and processing run?

1. **Mac-only:** simplest access to the local Obsidian vault, but unavailable when the Mac sleeps/offline and unsuitable for an always-on webhook.
2. **Home server worker:** reliable ingress and processing, but requires a controlled way to write or propose changes to the Mac's vault.
3. **Home server ingress plus Mac worker:** home server stores/queues the event; a Mac-side worker consumes it and writes Obsidian. More reliable than Mac-only while keeping vault mutation local.
4. **Shared Git repository:** home server and Mac synchronize a vault or selected generated content through Git. This provides history and transport but introduces merge/conflict, privacy, and concurrent-edit complexity. Git should likely be the durable synchronization layer for generated notes only, not a blind replacement for Obsidian's entire live vault on day one.

### What is the first trigger shape?

- A webhook receiver should acknowledge quickly, verify authenticity, normalize the Zoom payload, deduplicate by source event/meeting/file id, and enqueue durable work.
- The worker should fetch the transcript before Zoom's temporary access expires, store the original input, and create a task record.
- Agent execution should use a new session per meeting, with deterministic correlation to the meeting UUID and retry state.
- The initial event adapter can live outside the core server to validate the workflow, but a durable Rook-native trigger/task service is the likely product direction.

### How should the agent get environments?

A triggered session needs declared environment bindings rather than relying on whichever client happens to be foreground. For the first workflow, likely bindings are:

- a meeting-processing environment/skill containing the output schema and privacy rules;
- an Obsidian vault environment, only if the worker has an approved, narrow capability to write there;
- possibly a people/CRM environment later.

The trigger must not implicitly grant all Mac or Obsidian capabilities. Environment entry should be represented in task configuration and audited.

### How should Obsidian changes synchronize?

Candidate approaches:

- **Git-backed vault or generated-note repository:** transparent history, easy server pull/push, good rollback; requires conflict policy and secrets/PII decisions.
- **Syncthing/iCloud/Dropbox-style file sync:** convenient, but weaker auditability and potentially dangerous concurrent writes.
- **Mac bridge:** server creates a proposal/event; Mac client asks for approval and performs the write locally. Strongest boundary, more implementation work.
- **Append-only inbox:** server writes artifacts to a server inbox; Mac imports or approves them. Safest MVP, least automatic.

A likely staged direction is: server-side durable inbox + generated Markdown artifacts first; explicit Mac-side import/approval; Git synchronization after the note schema and conflict policy are understood. Avoid treating Google Docs backup as the synchronization mechanism for Markdown vault state.

### How should users learn about unsolicited work?

The first version can notify through a durable task status plus an existing channel (CLI output, log, or a simple notification). The product direction should be a task/activity surface showing queued, running, completed, failed, and awaiting-approval work. Notifications must not be confused with agent messages in an unrelated interactive session.

Open questions:

- Is the home server trusted to hold full transcripts and derived notes, or only encrypted queued payloads?
- Should meeting processing be allowed to write automatically, or always produce a reviewable patch?
- Does “Peeps” mean a folder of Markdown files, a specific note schema, or a Dataview/Base convention?
- Should a meeting session remain available for follow-up, and where should its transcript/session artifacts live?
- What happens when the home server is down, the Mac is offline, Zoom retries, or the same meeting produces updated transcript data?
- Do clients need multi-server discovery, or should one designated Rook home server be the control plane?
- Can one Rook server ever call another? If so, it should be an explicit, authenticated, allowlisted capability—not arbitrary agent network access.

## Direction

For brainstorming and an eventual first implementation, prefer a **single designated home Rook server as ingress and task coordinator**, with a durable trigger/task inbox and per-meeting agent sessions. Keep the Mac as a separately authorized Obsidian mutation endpoint rather than allowing the home-server agent arbitrary access to the Mac.

Start with an end-to-end vertical slice that can:

1. receive and verify a Zoom transcript-ready event;
2. persist and deduplicate it;
3. download and retain the transcript;
4. enqueue/start a meeting-specific Rook session with a declared meeting-processing environment;
5. produce a structured summary and people candidates;
6. write to a server-side reviewable Markdown artifact/inbox;
7. expose task state and failure/retry information.

Do not begin with multi-server agent delegation, automatic whole-vault synchronization, or unrestricted Obsidian writes. Those are separate architecture decisions that depend on the first workflow's privacy, approval, and conflict requirements.
