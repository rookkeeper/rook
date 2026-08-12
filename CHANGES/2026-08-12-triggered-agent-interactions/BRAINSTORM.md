# Triggered agent interactions

**Status: direction agreed; implementation planning follows**

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

The agreed first implementation is a **separate, very thin Zoom callback server** in a new GitHub repository in the `rookkeeper` organization. It will run on the Mac, receive and verify Zoom's transcript-ready webhook, and invoke the existing local `rook exec` CLI with configured runtime, session title, environments, and prompt values. The local Rook server remains the only Rook control plane; the resulting session should be visible to the normal Rook clients.

The Mac-only prototype accepts that callbacks are missed while the Mac is asleep or the callback/tunnel is unavailable. There will be no home-server processing, Obsidian synchronization, multi-server delegation, user notifications, or generic background-task UI in this first implementation. The transcript-processing behavior stays in the selected Rook environment and editable prompt rather than being designed into the callback server.

The first implementation should:

1. receive Zoom's `recording.transcript_completed` event and complete Zoom's validation challenge;
2. verify the Zoom HMAC signature and reject stale or malformed requests;
3. extract the meeting metadata and transcript download information;
4. invoke `rook exec` asynchronously with the fixed local configuration;
5. return a successful webhook response within Zoom's three-second limit;
6. include complete setup and operation documentation for Zoom, the callback server, Cloudflare Tunnel, local Rook, CLI configuration, secrets, and testing.

The callback server should remain a fixed Zoom-to-Rook adapter. It must not allow webhook payloads to select arbitrary executables, runtimes, environments, prompts, or server URLs. Transcript processing, Peeps structure, and Obsidian mutation remain environment/prompt concerns for later testing rather than callback-server concerns.

## Concrete callback example

A provisional first setup could be a separate, very small repository in the `rookkeeper` organization. It would run on this Mac, receive Zoom's HTTPS webhook, validate the request, and invoke the existing Rook CLI as a subprocess:

```text
Zoom
  ↓ HTTPS POST recording.transcript_completed
thin Zoom callback server on this Mac
  ↓ validate HMAC, extract meeting metadata and transcript download details
rook exec --runtime ... --title ... --join ... "..."
  ↓ REST + ACP WebSocket to the local Rook server
Rook session visible to the normal clients
```

The current CLI already accepts the important proposed parameters as a one-liner: `--runtime`, `--title`, `--server-url`, `--auth-token`, repeated `--join`/`--leave`, and a prompt. It does not expose a working-directory flag, which is consistent with the current direction not to make that part of the trigger configuration.

The callback service would need to decide whether to pass Zoom's temporary download URL/token to the agent or download the transcript itself and pass the agent a local path. Passing the credential through a prompt is simpler and matches the desired thin adapter, but exposes a short-lived secret to the runtime transcript and agent context. Downloading in the callback service gives the adapter more responsibility but lets the prompt contain only a local file path or server-owned artifact. If the credential is passed to the agent, the prompt must clearly identify the transcript as untrusted meeting data rather than instructions, and the token should be treated as sensitive even though it expires.

There is also a timing constraint: Zoom expects a 2xx response within three seconds. The callback cannot wait for `rook exec` or for the agent to finish. It must validate and launch/queue the work asynchronously, return success quickly, and make sure the background process has enough supervision and logging to survive after the HTTP handler returns. A plain detached child process is a useful prototype but is not durable if the Mac sleeps, crashes, or reboots.

The current CLI shape is close to the desired one. A concrete invocation could look like:

```bash
rook exec \\
  --runtime MyPiOpenAiAgent \\
  --title "Zoom · Project discussion · 2026-08-12" \\
  --join mac:md.obsidian/MyVault \\
  --server-url http://127.0.0.1:7665 \\
  --auth-token "$ROOK_AUTH_TOKEN" \\
  "Process this Zoom transcript..."
```

The CLI already supports `--runtime`, `--title`, `--server-url`, `--auth-token`, repeated `--join`/`--leave`, and a prompt. It creates the session, enters the requested environments, accepts the resulting environment offers, and then runs the prompt. It does not currently expose a working-directory flag, which matches the agreed direction not to make that part of the trigger configuration. The local Rook server must already be running for this to work.

`rook exec` is the correct one-shot shape for this prototype: it creates a session, sends one prompt, streams the turn, prints the session id when complete, and exits. The callback should launch it as a detached/background child rather than wait for completion. One caveat for implementation is that the current CLI's process exit behavior and environment-offer auto-accept timing need an integration test under the callback's non-interactive process environment. The callback should also pass the prompt as one safely constructed argument or use a temporary prompt file/stdin mechanism if the final prompt can exceed normal command-line limits.

For exposure, Cloudflare Tunnel is a strong first candidate because the Mac makes an outbound connection and no inbound port needs to be opened. The public route should expose only the webhook path, not the Rook server or CLI. Tailscale is useful for private administration; Tailscale Funnel could expose a public endpoint, but it adds a different public-ingress mechanism. Other options include putting a webhook receiver on a hosted platform and relaying privately to the Mac, but that adds another service and a second trust boundary. Cloudflare Access login protection is not directly suitable for Zoom's callback because Zoom cannot complete an interactive login; the endpoint needs to be public and protected by Zoom's HMAC verification, strict route handling, and rate/size limits.

HMAC verification authenticates the request; it does not make the Mac completely safe. The thin server should bind only to the tunnel/local interface, avoid exposing Rook's port, limit request size, verify the timestamp to prevent replay, compare signatures in constant time, handle Zoom's validation challenge, log no transcript/token contents, and launch only a fixed configured command or adapter. The public endpoint should acknowledge only after authenticating and accepting the event, not after agent execution.

Zoom's ordinary cloud-meeting event appears to be `recording.transcript_completed`. The payload includes meeting metadata and completed recording files, including a transcript file with `file_type: TRANSCRIPT` and a `download_url`; the webhook also provides a temporary `download_token`. Zoom documents that the token is valid for 24 hours, so the callback should either download immediately or deliberately hand off the token to the agent while it is still valid.

The callback endpoint must be publicly reachable over HTTPS. Cloudflare Tunnel is a plausible fit: the connector can make an outbound connection from the Mac while Cloudflare provides the public hostname and TLS edge. Tailscale is useful for private access and administration, but a normal tailnet address is not a public Zoom webhook endpoint; Tailscale Funnel would be a separate public-exposure option. HMAC verification is necessary request authentication, but it does not make the Mac completely safe: the public endpoint and callback process still need minimal exposure, input limits, dependency updates, secret protection, and a policy of returning quickly without doing long agent work inside the HTTP request.

## Questions to discuss

1. Should the webhook and agent work run on the home server, the Mac, or a home-server/Mac combination? A: to be determined, I need to learn more about what the Webb hook looks like and the cost and benefit of doing it in one place or the other if I do it on this machine then I don't have to worry about sinking, but of course this machine is not awake all the time so we'll miss work occasionally by doing them the server behind my couch. It's always up and running, but then I have to worry about sinking obsidian vaults together.
2. What should happen when the home server is down, the Mac is offline, or Zoom retries an event? A: TBD
3. Should the first trigger be a small external adapter or a Rook-native trigger and task system? A: use a separate thin server for the third-party callback and have it invoke the CLI client. Do not add a generic Rook trigger API yet. The callback adapter will translate Zoom's shape into a configured `rook exec` invocation, including the session name.
4. What durable task states, retry behavior, and deduplication keys do we need? A: this is worse, thinking a little bit about, but it needs to be pretty generic to duplication. Seems like it might be a good idea, but it also depends whatever is coming from the third-party callback.
5. Should each meeting get its own Rook session, and should that session remain available for follow-up? A: speaking genetically each time the callback is triggered then that should have its own associated session in session will remain available for follow up questions. It will be visible in the clients as one of the sessions.
6. Which runtime, working directory, prompt, and explicit environments should a triggered session use? A: the answer is any for all these arguments. They just need to be specify so I think for the CLI client we just make sure that each of these things is specifiable as a one liner and set the agent to work
7. Is the home server trusted to store full transcripts and derived notes? A: yes but I think for the time being we're not gonna use the home are quite yet.
8. Should meeting processing write automatically, or produce a reviewable proposal first? A: talk genetically because the important thing is to make this work genetically not just for the meeting processing to talk genetically whenever the agent is triggered with a task it is going to be triggered with the runtime the session name the environments and the prompt (although not the working directory) and the prompt will set it up to run, potentially arbitrary anything. It also has the opportunity to use skills from its environment.
9. What exactly is the Peeps structure and note schema in Obsidian? A: I think you have a skill associated with Obsidian peeps but if you're not, we can figure out where that comes from again, but that's all down the line a bit once we figure out the generic idea first.
10. Should Obsidian synchronization use Git, another file-sync mechanism, a Mac bridge, or an inbox/import flow? A: I think I'm gonna forgo Obsidian synchronization at this point and just keep it on my Mac and not worry about another machine.
11. How should users be notified about queued, running, completed, failed, or approval-needed work? A: for the time being he shouldn't be notified. We do need to think of that later, but that's complexity. I don't want to introduce quite yet.
12. Do clients need multi-server discovery, or should one Rook server remain the control plane? A: we're not going to worry about this one for now. It's just too complicated. Assume one Rook server everything happens on this machine.
13. Should one Rook server ever be able to invoke work on another, and what allowlist, credentials, and audit trail would make that safe? A: again out of scope.

## Zoom and tunnel setup prerequisites

These are setup items to document for the prototype and eventually for a generally reusable local setup guide.

### Zoom

For the ordinary Zoom cloud-meeting path, the `recording.transcript_completed` event requires:

- a Business, Education, or Enterprise Zoom license;
- cloud recording enabled for the relevant users;
- audio transcription enabled for cloud recordings;
- a Zoom Marketplace app with Event Subscriptions enabled;
- a valid Event Notification Endpoint URL;
- the Recording transcript files have completed subscription enabled under the Recording event;
- the recording-read scope appropriate to the installation. Zoom lists `recording:read`, `recording:read:admin`, and `recording:master`, with corresponding granular cloud-recording scopes; the least-privilege choice needs to be confirmed during app setup;
- a webhook secret token for signature verification.

The endpoint must be a publicly reachable HTTPS FQDN with a valid CA-issued certificate, accept JSON POST requests, pass Zoom's `endpoint.url_validation` challenge, and return a 2xx response within three seconds. Zoom periodically revalidates the endpoint. Normal events should be HMAC-verified using `x-zm-request-timestamp`, `x-zm-signature`, the raw body, and the webhook secret token.

The callback should expect a `download_token` and a `recording_files` entry representing the transcript. The agreed prototype will pass the relevant download information to the configured agent prompt so the agent can download and process the transcript. The token is temporary, and the setup should document that putting it in the Rook prompt means it may be retained in the durable session transcript. The real setup should verify the actual file type/extension and payload against a captured fixture rather than assuming every recording contains a transcript.

### Cloudflare Tunnel

Cloudflare Tunnel is a strong first candidate for a local Mac setup. Its prerequisites are a Cloudflare account, a domain managed by Cloudflare if using a stable named public hostname, and `cloudflared` installed on the Mac. The tunnel creates an outbound connection, so the Mac does not need an inbound firewall port opened. A published application route maps a public hostname such as `zoom-hook.example.com` to a narrowly bound local callback service such as `http://127.0.0.1:8787`.

The setup guide should create a dedicated hostname and route only the callback path. It should not publish the Rook server port. A named tunnel is preferable to a temporary quick tunnel because Zoom needs a stable endpoint and periodically revalidates it. Cloudflare Access interactive authentication should not be placed in front of the Zoom callback; Zoom cannot log in interactively, so the callback's HMAC verification is the application-level gate.

Tailscale remains useful for private administration and checking the Mac, but an ordinary tailnet address is not a public Zoom endpoint. Tailscale Funnel could be evaluated as an alternative public ingress, but it has a different account, hostname, availability, and operational model. The documentation should describe the tunnel contract—stable public HTTPS hostname to a local HTTP JSON endpoint—rather than hard-coding Cloudflare into the generic callback design.

## Outstanding concerns

The agent's transcript-processing instructions can remain in an entered environment, and the trigger prompt can stay generic and editable. That removes the need to design the meeting-summary or Peeps workflow now. The remaining concerns are mostly delivery, security, and integration mechanics:

1. **Mac availability:** if the Mac sleeps or the callback/tunnel is stopped, Zoom retries only a limited number of times—documented as attempts after roughly 5, 20, and 60 minutes for eligible failures—then stops. The prototype explicitly accepts dropping events that arrive while the Mac is unavailable; a local inbox cannot receive an event the sleeping Mac never saw.
2. **Asynchronous execution:** the callback must return within three seconds and cannot wait for `rook exec` or agent completion. It needs a safe launch strategy, process logging, and a way to discover failures even though notifications are intentionally out of scope.
3. **Secret handling:** the Zoom webhook secret, Rook auth token, Cloudflare tunnel credential, and any temporary Zoom download token must not appear in source control, ordinary logs, or an agent prompt unless that is explicitly accepted. Passing the download token to the agent is thinner; downloading the transcript in the callback is safer.
4. **Fixed trigger policy:** the public Zoom payload must not choose an arbitrary runtime, environment, server URL, executable, or prompt. Those should come from local configuration. The webhook adapter should be a fixed Zoom-to-one-configured-Rook workflow.
5. **CLI and Rook prerequisites:** the local Rook server must already be running, the configured runtime must exist, the CLI must be invocable by the callback process, and the requested environment ids must resolve locally. Environment offers and the current CLI's delayed auto-accept behavior should be tested in a headless invocation.
6. **Duplicate and replay events:** Zoom retries and duplicate deliveries need an idempotency policy. At minimum, retain a short-lived record keyed by event plus meeting/file identifiers, and reject stale signed requests. A process restart must not erase whatever duplicate state the policy depends on.
7. **Session lifecycle:** `rook exec` can create a session with a title and leave that session visible in Rook, but the prototype should confirm what happens when the agent fails, when the same meeting is delivered again, and whether a repeated transcript should create a new session or resume the existing one.
8. **Payload and transcript limits:** enforce request-size, URL, timeout, download-size, and transcript-size limits. Treat the transcript as untrusted data and prevent it from changing the callback's command-line arguments or configuration.
9. **Operational supervision:** the callback and `cloudflared` need launch-at-login/service supervision, health checks, and clear logs. Otherwise the system will silently stop after a reboot or crash.
10. **Zoom account/app ambiguity:** confirm whether the selected Marketplace app type and OAuth installation are sufficient for the listed scopes and webhook download token, and test with the actual account plan and recording settings.
11. **Privacy and retention:** even without designing processing, decide where temporary transcript files live, how long they remain, and whether the Rook session's durable transcript retains the Zoom content.

## Questions to answer

1. If the Mac sleeps or the callback/tunnel stops, is it acceptable to miss a meeting after Zoom's limited retries? A callback running on the sleeping Mac cannot maintain an inbox or receive the request; a durable inbox would require the receiver itself to run somewhere always available, such as the home server or a hosted edge service. A local inbox would only help after the Mac has received the callback, for example if `rook exec` or the agent later fails. A: We just drop the event if the Mac is asleep or unavailable.
2. How should the asynchronous callback launch `rook exec`, capture its output, and expose failures while notifications remain out of scope? A: launch it without waiting for agent completion; capture useful local logs for setup/debugging, but do not build user notifications or a task UI yet.
3. Where should the Zoom webhook secret, Rook auth token, Cloudflare tunnel credential, and temporary Zoom download token live, and which must never appear in logs or prompts?
4. Should the callback be permanently configured for one Zoom-to-Rook workflow, rather than accepting runtime, environment, executable, or prompt choices from the webhook payload? A: yes. Use local configuration for the runtime, title format, environments, Rook URL/auth, and editable prompt. The Zoom payload supplies only the meeting data inserted into that prompt.
5. What must be running locally for the workflow to work: Rook server, configured runtime, CLI installation, environment bundles, and tunnel? A: document and test the complete local prerequisites, including the Rook server, configured runtime, linked `rook` CLI, selected environment, callback server, and Cloudflare Tunnel.
6. How should duplicate or replayed Zoom events be recognized and handled across callback-server restarts? A: duplicate handling is not a first-release durability feature; reject stale or invalid signatures and document that duplicate deliveries may trigger duplicate sessions during the prototype.
7. If the same meeting callback arrives twice, should it create one session, resume the existing session, or create a new session for each delivery? A: each accepted callback creates its own new session for now.
8. What request, download, transcript, and execution time/size limits should the callback enforce? A: use conservative limits suitable for the prototype and document them; do not design a general task system around them yet.
9. How should the callback server and Cloudflare Tunnel start on login, restart after failure, and expose enough logs for debugging? A: provide setup documentation and a practical local launch/supervision approach; elaborate notification and task-management behavior later.
10. Which Zoom Marketplace app type, OAuth installation, scopes, account plan, and recording settings will we use for the first real test? A: document the prerequisites from Zoom's `recording.transcript_completed` documentation and walk through the actual account/app setup during testing.
11. Where should temporary transcript files be stored, how long should they remain, and should the Zoom content remain in Rook's durable session transcript? A: the callback will not own transcript processing or retention in the prototype; the agent will download it, and the prompt/session retention implications should be documented as a known concern.

## Candidate prototype work

These are candidate work items for discussion, not an agreed implementation checklist:

1. Create a separate thin Zoom callback repository in the `rookkeeper` organization.
2. Implement a minimal HTTPS POST endpoint for Zoom's validation challenge and `recording.transcript_completed` event.
3. Verify Zoom's HMAC signature, reject stale requests, enforce a small JSON body limit, and avoid logging secrets or transcript contents.
4. Extract the meeting title, UUID, transcript recording file, download URL, and temporary download token.
5. Start `rook exec` asynchronously with configured values for runtime, session title, Rook server URL, auth token, environments, and prompt.
6. Decide whether the prompt contains the Zoom URL/token or whether the callback downloads the transcript first and gives the agent a local path.
7. Use Cloudflare Tunnel as the first public exposure candidate, while keeping Rook's own port private and using Tailscale for administration.
8. Test the callback locally with Zoom fixture payloads, including validation, valid/invalid signatures, stale requests, duplicate deliveries, missing transcript files, and slow/failing agent launches.
9. Test the full path with a fake or test Rook runtime before connecting the real Zoom app.
10. Document how the callback server, Cloudflare Tunnel, and local Rook server are started and supervised on the Mac.
