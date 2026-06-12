import Foundation

/// JSON-RPC 2.0 websocket client for `/api/ws?sessionId=...`.
///
/// Sends `session/prompt` requests and parses `session/update` notifications
/// into flat `AcpClientEvent`s. Mirrors the React client's dedupe strategy:
/// `user_message_chunk` echoes and `_rookery_run_*`/`_rookery_status_changed`
/// updates are ignored; turn completion comes from the JSON-RPC response that
/// resolves the prompt request id.
@MainActor
final class AcpSocket {
    var onEvent: ((AcpClientEvent) -> Void)?
    var onConnectionChange: ((Bool) -> Void)?

    private(set) var isConnected = false

    private var task: URLSessionWebSocketTask?
    private var sessionId: String?
    private var generation = 0
    private var promptCounter = 0
    private var pendingPromptIds: Set<String> = []

    func connect(sessionId: String, webSocketURL: URL) {
        teardown()
        generation += 1
        let currentGeneration = generation
        self.sessionId = sessionId

        var components = URLComponents(url: webSocketURL, resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "sessionId", value: sessionId)]
        let task = URLSession.shared.webSocketTask(with: components.url!)
        self.task = task
        task.resume()
        setConnected(true)
        receiveLoop(task: task, generation: currentGeneration)
    }

    func disconnect() {
        teardown()
    }

    /// Cancel the in-flight turn (ACP `session/cancel` notification). The
    /// pending prompt then resolves with a cancellation error.
    func sendCancel() {
        guard let task, let sessionId else {
            return
        }
        let frame: [String: Any] = [
            "jsonrpc": "2.0",
            "method": "session/cancel",
            "params": ["sessionId": sessionId],
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: frame),
              let json = String(data: data, encoding: .utf8) else {
            return
        }
        task.send(.string(json)) { _ in }
    }

    /// Intentional teardown is silent: `onConnectionChange(false)` is reserved
    /// for genuine transport failures, so replacing the socket (e.g. switching
    /// sessions) never looks like a connection loss to the model.
    private func teardown() {
        generation += 1
        pendingPromptIds.removeAll()
        task?.cancel(with: .normalClosure, reason: nil)
        task = nil
        sessionId = nil
        isConnected = false
    }

    func sendPrompt(text: String) {
        guard let task, let sessionId else {
            onEvent?(.connectionError(message: "Not connected to the session"))
            return
        }
        promptCounter += 1
        let requestId = "prompt-\(promptCounter)"
        pendingPromptIds.insert(requestId)
        let frame: [String: Any] = [
            "jsonrpc": "2.0",
            "id": requestId,
            "method": "session/prompt",
            "params": [
                "sessionId": sessionId,
                "prompt": [["type": "text", "text": text]],
            ],
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: frame),
              let json = String(data: data, encoding: .utf8) else {
            onEvent?(.protocolError(message: "Failed to encode prompt"))
            return
        }
        task.send(.string(json)) { [weak self] error in
            guard let error else {
                return
            }
            Task { @MainActor in
                self?.handleTransportFailure(error)
            }
        }
    }

    // MARK: - Receive

    private func receiveLoop(task: URLSessionWebSocketTask, generation: Int) {
        Task { [weak self] in
            while true {
                guard let self, self.generation == generation else {
                    return
                }
                do {
                    let message = try await task.receive()
                    guard self.generation == generation else {
                        return
                    }
                    self.handleMessage(message)
                } catch {
                    if self.generation == generation {
                        self.handleTransportFailure(error)
                    }
                    return
                }
            }
        }
    }

    private func handleTransportFailure(_ error: Error) {
        guard isConnected else {
            return
        }
        pendingPromptIds.removeAll()
        task = nil
        setConnected(false)
    }

    private func setConnected(_ connected: Bool) {
        guard isConnected != connected else {
            return
        }
        isConnected = connected
        onConnectionChange?(connected)
    }

    private func handleMessage(_ message: URLSessionWebSocketTask.Message) {
        let text: String
        switch message {
        case .string(let value):
            text = value
        case .data(let value):
            text = String(data: value, encoding: .utf8) ?? ""
        @unknown default:
            return
        }
        guard let data = text.data(using: .utf8),
              let frame = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return
        }
        handleFrame(frame)
    }

    private func handleFrame(_ frame: [String: Any]) {
        if frame["method"] as? String == "session/update",
           let params = frame["params"] as? [String: Any],
           let update = params["update"] as? [String: Any] {
            handleUpdate(update)
            return
        }

        // Responses / errors for our prompt requests resolve the turn.
        if let requestId = frame["id"] as? String, pendingPromptIds.contains(requestId) {
            pendingPromptIds.remove(requestId)
            if let result = frame["result"] as? [String: Any] {
                onEvent?(.runCompleted(stopReason: result["stopReason"] as? String ?? "end_turn"))
            } else if let error = frame["error"] as? [String: Any] {
                onEvent?(.runFailed(message: error["message"] as? String ?? "Run failed"))
            }
            return
        }

        // Errors with a null/unknown id (e.g. "Unknown or inactive session").
        if let error = frame["error"] as? [String: Any] {
            onEvent?(.connectionError(message: error["message"] as? String ?? "Server error"))
        }
    }

    private func handleUpdate(_ update: [String: Any]) {
        guard let kind = update["sessionUpdate"] as? String else {
            return
        }
        switch kind {
        case "agent_message_chunk":
            if let text = contentText(update["content"]) {
                onEvent?(.agentMessageChunk(text: text))
            }
        case "agent_thought_chunk":
            if let text = contentText(update["content"]) {
                onEvent?(.agentThoughtChunk(text: text))
            }
        case "tool_call":
            guard let toolCallId = update["toolCallId"] as? String else {
                return
            }
            onEvent?(.toolCallStarted(
                toolCallId: toolCallId,
                title: update["title"] as? String ?? "Tool",
                kind: update["kind"] as? String ?? "",
                status: update["status"] as? String ?? "pending",
                rawInput: rookeryMeta(update)?["rawInput"] as? String
            ))
        case "tool_call_update":
            guard let toolCallId = update["toolCallId"] as? String else {
                return
            }
            onEvent?(.toolCallUpdate(
                toolCallId: toolCallId,
                status: update["status"] as? String ?? "in_progress",
                toolName: rookeryMeta(update)?["toolName"] as? String,
                output: contentItemsText(update["content"])
            ))
        case "_rookery_tool_input_delta":
            guard let toolCallId = update["toolCallId"] as? String,
                  let delta = update["delta"] as? String else {
                return
            }
            onEvent?(.toolInputDelta(
                toolCallId: toolCallId,
                toolName: update["toolName"] as? String,
                delta: delta
            ))
        case "_rookery_tool_call_ready":
            guard let toolCallId = update["toolCallId"] as? String else {
                return
            }
            onEvent?(.toolCallReady(toolCallId: toolCallId, toolName: update["toolName"] as? String))
        case "_rookery_tool_output_delta":
            guard let toolCallId = update["toolCallId"] as? String,
                  let delta = update["delta"] as? String else {
                return
            }
            onEvent?(.toolOutputDelta(
                toolCallId: toolCallId,
                toolName: update["toolName"] as? String,
                delta: delta
            ))
        case "plan":
            guard let rawEntries = update["entries"] as? [[String: Any]] else {
                return
            }
            let entries = rawEntries.enumerated().map { index, entry in
                PlanEntry(
                    id: index,
                    content: entry["content"] as? String ?? "",
                    priority: entry["priority"] as? String ?? "medium",
                    status: entry["status"] as? String ?? "pending"
                )
            }
            onEvent?(.planUpdate(entries: entries))
        case "usage_update":
            guard let used = update["used"] as? Int, let size = update["size"] as? Int else {
                return
            }
            onEvent?(.usageUpdate(used: used, size: size))
        case "_rookery_environment_event":
            handleEnvironmentEvent(update)
        case "_rookery_protocol_error":
            onEvent?(.protocolError(message: update["error"] as? String ?? "Protocol error"))
        case "_rookery_connection_error":
            onEvent?(.connectionError(message: update["error"] as? String ?? "Connection error"))
        default:
            // user_message_chunk echoes, _rookery_run_*, _rookery_status_changed,
            // _rookery_assistant_*, current_mode_update, config_option_update —
            // intentionally ignored (duplicated or unused), matching the web client.
            break
        }
    }

    private func handleEnvironmentEvent(_ update: [String: Any]) {
        guard let kind = update["kind"] as? String else {
            return
        }
        let payload = update["payload"] as? [String: Any] ?? [:]
        guard let environmentId = payload["environmentId"] as? String else {
            return
        }
        switch kind {
        case "environment_offer_available":
            onEvent?(.environmentOffered(EnvironmentOffer(
                environmentId: environmentId,
                sourceName: payload["sourceName"] as? String,
                canonicalSourceUrl: payload["canonicalSourceUrl"] as? String
            )))
        case "environment_offer_resolved":
            onEvent?(.environmentOfferResolved(environmentId: environmentId))
        case "environment_entered":
            onEvent?(.environmentEntered(environmentId: environmentId))
        case "environment_exited":
            onEvent?(.environmentExited(environmentId: environmentId, error: payload["error"] as? String))
        default:
            break
        }
    }

    private func rookeryMeta(_ update: [String: Any]) -> [String: Any]? {
        (update["_meta"] as? [String: Any])?["rookery"] as? [String: Any]
    }

    /// `content` on message chunks: `{ type: "text", text }`.
    private func contentText(_ value: Any?) -> String? {
        guard let content = value as? [String: Any] else {
            return nil
        }
        return content["text"] as? String
    }

    /// `content` on tool calls: `[{ type: "content", content: { type: "text", text } }]`.
    private func contentItemsText(_ value: Any?) -> String? {
        guard let items = value as? [[String: Any]] else {
            return nil
        }
        let texts = items.compactMap { item -> String? in
            if let nested = item["content"] as? [String: Any] {
                return nested["text"] as? String
            }
            return item["text"] as? String
        }
        guard !texts.isEmpty else {
            return nil
        }
        return texts.joined(separator: "\n")
    }
}
