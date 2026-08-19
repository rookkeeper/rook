# Transcript and replay decisions

## Decision 1: bound server-to-client message size

The server must never send a client-facing ACP notification larger than **10 kB**. Before forwarding or replaying an ACP notification, oversized presentation content will be truncated to a bounded representation.

This applies to both live notifications and `session/load` replay. It is a client-presentation rule: it must not alter what the agent runtime receives or what the runtime considers its source history. Oversized raw input/output and content are replaced with a concise truncation marker while ACP identity fields such as update kind, tool-call id, status, title, and kind are retained.

## Decision 2: remove server transcript persistence completely

Rook will remove server-owned transcript storage and database-based transcript rehydration completely. ACP runtime history is the sole transcript source and `session/load` is the sole session-population path.

This is not a compatibility migration. Remove the repository, capture/normalization path, REST transcript API, client REST hydration path, and related tests/documentation. Do not leave fallback code, compatibility branches, or a second transcript representation.

Each client keeps loaded session state in its in-memory session handle. Switching away from a session and back to the same live handle must not call `session/load` again. A new client process/session handle loads through ACP; restoring a lost runtime also uses ACP `session/load` to restore agent state. Runtime restoration must not duplicate already-cached client blocks.

## Decision 3: background sessions retain their connections

Each loaded session handle retains its session-bound ACP WebSocket while the client remains alive, even when another session is displayed. Runtime notifications continue to flow into the background handle and are reduced into its in-memory blocks.

Switching views therefore does not require replay and does not lose events while the connection remains healthy. A session that was explicitly closed, a new handle after client restart, or a genuinely disconnected/suspended handle loads through ACP.

## Decision 4: retry transient load failures only

ACP load failures should be classified. Transient transport/server/runtime availability failures may retry with backoff. Permanent session, configuration, protocol, or missing/corrupt-history failures should stop retrying and be shown to the user.

The retry path must not append replayed events as new durable transcript work. With transcript persistence removed, retries do not grow a server transcript, but they still must not repeatedly append duplicate UI blocks or create unbounded client/server work.

## Decision 5: use the ACP request result as replay completion

ACP `session/load` has an explicit request/response lifecycle. The protocol requires the agent to restore history and stream the entire conversation through `session/update` notifications; the successful `session/load` result completes the request. ACP does not define a separate `replay_complete` notification.

Rook will use the completed `session/load` response as the replay boundary and remove the timing-based 80 ms quiet heuristic. Pi ACP specifically emits all replay notifications before returning the response. This must be tested for every configured runtime.

## Decision 6: remove old transcript tables, not database files

Existing application database files remain. The obsolete transcript tables and their rows will be physically deleted. The application will contain no compatibility path that reads or recreates them.

## Decision 7: common lifecycle guarantees across clients

Mac, iPhone, Android, and CLI will share the same session lifecycle contract:

- no REST transcript hydration;
- initial session population through ACP `session/load`;
- loaded handles retain their ACP connection and in-memory state while the client is alive;
- switching away/back on a live handle does not reload;
- client-facing ACP notifications are limited to 10 kB;
- successful replay replaces session state rather than appending duplicate blocks;
- transient retry and permanent-failure behavior is consistent.

Platform UI and presentation may differ.

## Decision 8: safely recover after disconnect or suspension

When a session handle experiences a genuine WebSocket disconnect or platform suspension, it will reconnect and use ACP `session/load` to resynchronize. Replay must be applied as a replacement of the cached session state, never appended to existing blocks. This explicitly removes the current reconnect bug where an already-loaded handle reloads into its existing UI state and duplicates the conversation.

## Still to decide

- Exact ACP error classification and retry backoff/limits.
