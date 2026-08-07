# Mac chat image attachments TODO

## Discovery and decisions

- [x] Confirm the first-release behavior: paste and drag image files into the composer, preview them, and send them with optional text.
- [x] Decide that the first release shows current-viewer image previews but defers full image-byte transcript hydration.
- [x] Set a 12 MB normalized PNG limit and 4096-pixel maximum dimension; accept PNG/JPEG/WebP/GIF at the server boundary.
- [x] Keep normalized image bytes in the attachment value instead of creating persistent staging files.
- [x] Define capability negotiation for a selected runtime so image support is not advertised for runtimes that cannot consume it.

## ACP and server contract

- [x] Extend `server/src/shared/acp.ts` with standard ACP image content blocks and prompt content unions.
- [x] Extend `clients/RookKit/Sources/RookKit/Net/AcpSocket.swift` to send text plus `{ type: "image", mimeType, data }` blocks.
- [x] Update `server/src/runtime/routes/acpFacadeRoute.ts` to advertise image support based on the selected/available runtime contract rather than the current hard-coded `false`.
- [x] Ensure `AgentRuntimeManager`/`SessionRuntime` preserve image blocks unchanged when forwarding `session/prompt` to `pi-acp`.
- [x] Validate image MIME types, base64 shape, and byte limits at the server boundary.
- [x] Intentionally omit image bytes from normalized transcript events for this release; document the retention decision.
- [x] Add server tests for image prompt forwarding, capability reporting, invalid data, and text-only runtime fallback.
- [ ] Add an end-to-end Pi ACP test proving that an image prompt reaches Pi as an image attachment.

## Shared Apple messaging state

- [x] Add a RookKit attachment value type with stable identity, MIME type, and base64 data.
- [x] Thread attachments through `SessionHandle.send`, immediate delivery, reconnect delivery, and queued-message storage.
- [x] Keep attachment bytes available through queued delivery and deletion with no persistent staging resource.
- [x] Add ordered prompt content to `ChatBlock`/`ChatBlockKind` and render current-viewer user text/image order.
- [x] Keep transcript hydration text-only for this release without creating a misleading persisted image duplicate.
- [x] Keep the iPhone client compiling and text-only.
- [x] Add RookKit tests for attachment decoding and queue preservation.

## Mac paste and drag/drop intake

- [x] Extend `ChatComposeTextView`/`SubmitTextView` to detect image pasteboard data before inserting a text fallback.
- [x] Read native macOS clipboard image types (`public.png`, `public.jpeg`, and compatible image representations) without depending on a textual file path.
- [x] Add drag destination handling for image files and image data.
- [x] Normalize image data to PNG and enforce the chosen dimensions/byte limits.
- [x] Keep source filenames out of the attachment model and visible composer UI.
- [x] Insert small image thumbnails inline at the composer caret, including between text runs.
- [x] Allow submission with image-only prompts and keep the existing Return/Shift+Return behavior.
- [x] Show recoverable preparation/validation errors in the composer without losing existing text or attachments.
- [ ] Verify accessibility labels, keyboard focus, inline thumbnail deletion behavior, and dark/light appearance.

## Model/controller integration

- [x] Update `ChatDetail.submit()` so it submits text and attachments atomically and clears local state only after handoff.
- [x] Update `RookMacModel` and `ChatSessionController` APIs to accept attachments.
- [x] Ensure an attachment sent while the agent is running appears in the queue and is delivered with the text after the turn completes.
- [x] Ensure an attachment sent while disconnected survives reconnect or fails visibly with cleanup.
- [x] Prevent duplicate sends from the Return key and Send button.
- [x] Add Mac tests for paste/drop intake and invalid/text-only handling.

## Verification and documentation

- [x] Run RookKit tests and Mac tests/build on macOS.
- [x] Run server typecheck and test suites.
- [ ] Manually verify clipboard paste from Screenshot/Preview, Finder drag-and-drop, image-only prompts, multi-line text plus image, and queued prompts.
- [ ] Verify Pi receives the image and a vision-capable configured model can describe it.
- [x] Verify a text-only runtime receives a clear unsupported behavior rather than a silent failure through server tests.
- [x] Keep remote server operation independent of any Mac temporary path by sending image bytes over ACP.
- [x] Update `clients/mac/README.md`, `server/README.md`, and relevant `AS-BUILT-ARCHITECTURE/` files.
- [x] Review `PRODUCT/` and document the ACP image-block decision.
- [x] Review the final diff for temporary-file leaks, oversized base64 payloads, and accidental changes to the existing text chat flow.
