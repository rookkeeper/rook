# Mac chat image attachments

## Scope

Add image paste and drag-and-drop to the native macOS chat composer. The user can place image thumbnails inline between text runs, preserve that order in the ACP prompt, and send the composed content to the selected agent.

## What the current code does

- `clients/mac/Sources/Views/ChatView.swift` wraps an AppKit `NSTextView` in `ChatComposeTextView`. It currently synchronizes only a `String`, submits on Return, and has no pasteboard or drag destination handling.
- `clients/RookKit/Sources/RookKit/Net/AcpSocket.swift` sends every prompt as one ACP `{ type: "text", text }` block. It does not model image blocks.
- `clients/RookKit/Sources/RookKit/Net/SessionHandle.swift` and `ChatState.swift` queue text-only messages, so attachments must travel through the same busy/offline queue rather than being discarded when the agent is running.
- `server/src/shared/acp.ts` defines only text prompt/content blocks. `server/src/runtime/routes/acpFacadeRoute.ts` advertises `promptCapabilities.image: false`.
- The server facade already forwards the prompt JSON to the selected runtime. `pi-acp` already translates ACP image blocks into Pi RPC image attachments, and Pi itself supports image content in its model messages.
- The existing server transcript normalization is text-oriented. If attachment previews are expected after a session reload or in a second viewer, the transcript path must preserve an image representation too.

## What Pi is actually doing

Pi's interactive TUI reads the native clipboard using its platform clipboard helper. For an image it writes the bytes to the operating-system temporary directory as a file named like `pi-clipboard-<uuid>.png`, then inserts that path into the editor. That is not the session working directory. The later prompt/file-processing path turns the image file into an image attachment. Dragged image files follow the same attachment-oriented path.

For Rook, the better protocol boundary is the standard ACP image content block:

```json
{
  "type": "image",
  "mimeType": "image/png",
  "data": "<base64>"
}
```

The Mac client may still use an OS temporary file as a staging/lifetime mechanism, but it should send image bytes over ACP rather than sending a local path. This works when the Rook server or runtime is remote, avoids coupling an attachment to `cwd`, and is already supported by `pi-acp`. The first implementation normalizes images directly in memory and does not create a persistent staging file.

## Implemented first-release shape

The current implementation accepts clipboard images and dropped image files in the Mac composer, normalizes them to bounded PNG attachments in memory, inserts small thumbnails inline with the draft text, preserves text/image order through ACP, and sends them as standard ACP image blocks. The server advertises support per runtime/session and rejects unsupported or malformed image prompts. Transcript persistence of full image bytes remains intentionally deferred; the local user bubble shows the ordered content for the current viewer.

## Proposed implementation

1. Add an attachment model in RookKit containing a stable ID, MIME type, and bounded image bytes. Keep the in-memory/queued representation bounded and make cleanup explicit.
2. Extend the ACP prompt model and `AcpSocket.sendPrompt` to accept text plus image blocks. Advertise image support only when the selected runtime can process it; do not globally claim that Claude, Cursor, and arbitrary ACP runtimes support images merely because Pi does.
3. Add a Mac-specific image intake path to `SubmitTextView`/its coordinator:
   - intercept paste before AppKit inserts a textual representation;
   - read image representations from `NSPasteboard` and normalize them to supported formats (initially PNG/JPEG, with a size/pixel limit);
   - register dragged image files and image pasteboard data;
   - reject unsupported files, duplicate drops, and oversized payloads with a visible composer error;
   - do not expose or retain source filenames; the image bytes are the attachment.
4. Insert a small image thumbnail at the current text insertion point. Keep ordinary text editing, Return, Shift+Return, and image deletion behavior. Enable Send when there is text or at least one image.
5. Thread attachments through `RookMacModel` → `ChatSessionController` → `SessionHandle`, including queued messages while a run is active or while reconnecting. Only clear attachments after the message has been accepted into immediate delivery or the queue.
6. Extend shared chat rendering enough to show the sent image in the user message. Decide whether this is a full persisted image preview or a lightweight “image attached” placeholder for the first release.
7. Extend server ACP types, validation, capability negotiation, transcript normalization, and tests. Enforce MIME, pixel/byte limits, and safe base64 handling at the server boundary. Preserve text-only fallback behavior for runtimes that do not advertise image support.
8. Update Mac/RookKit/server READMEs and the relevant as-built architecture notes after implementation. Product docs should only change if this introduces a durable concept such as general chat attachments.

## Important design choices

- Use standard ACP `ContentBlock::Image`; do not invent a Rook-specific prompt field.
- Do not put pasted images in the session `cwd`, environment repository, or project checkout. Use the OS temp directory only for client-side staging, then send bytes through ACP.
- Treat pasted images as user-controlled input: bound dimensions and encoded size, normalize formats, avoid retaining temp files indefinitely, and never execute or inspect image contents as files beyond decoding/validation.
- Keep the first release Mac-focused. Shared ACP support belongs in RookKit/server so Pi works correctly, while iPhone/Android UI can remain text-only until their attachment UX is designed.
- Verify Pi end-to-end first, then test a non-image runtime and a remote-server path so capability negotiation and fallback are real rather than assumed.
