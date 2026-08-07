import Foundation

/// Owns a dedicated WebSocket, blocks, run state, and streaming state for one
/// session.  Multiple handles coexist — switching sessions is just changing
/// which handle the UI observes.
@MainActor
public final class SessionHandle {
    public let sessionId: String

    public var onStateChange: (() -> Void)?
    public var onEnvironmentOffered: ((EnvironmentOffer) -> Void)?
    public var onEnvironmentOfferResolved: ((String, String) -> Void)?
    public var onEnvironmentEntered: ((String) -> Void)?
    public var onEnvironmentExited: ((String, String?) -> Void)?

    /// Called for every agent text chunk — iPhone uses this for voice synthesis buffering.
    public var onAgentTextChunk: ((String) -> Void)?

    private let api: RookAPI
    private let socket: AcpSocket

    // MARK: - Observable state (same shape ChatSessionController exposed)
    public private(set) var blocks: [ChatBlock] = [] { didSet { onStateChange?() } }
    public private(set) var queuedMessages: [QueuedChatMessage] = [] { didSet { onStateChange?() } }
    public private(set) var isRunning = false { didSet { onStateChange?() } }
    public private(set) var statusLine = "" { didSet { onStateChange?() } }
    public private(set) var socketConnected = false { didSet { onStateChange?() } }
    public var supportsImagePrompts: Bool { socket.supportsImagePrompts }
    public private(set) var reconnecting = false { didSet { onStateChange?() } }
    public private(set) var contextUsage: ContextUsageState? { didSet { onStateChange?() } }
    public private(set) var currentModes: AcpModesState? { didSet { onStateChange?() } }
    public private(set) var configOptions: [AcpConfigOption] = [] { didSet { onStateChange?() } }
    public private(set) var pendingPermission: PendingPermissionRequest? { didSet { onStateChange?() } }
    public private(set) var lastStopReason: String? { didSet { onStateChange?() } }
    public private(set) var autoScrollEnabled = true { didSet { onStateChange?() } }
    public private(set) var scrollTick = 0 { didSet { onStateChange?() } }

    /// True after the first successful `load()` — prevents re-sending
    /// `session/load` when switching back to an already-connected handle.
    public private(set) var isLoaded = false

    // MARK: - Private streaming / replay state
    private var blockCounter = 0
    private var enteredEnvironments: Set<String> = []
    private var userCancelledRun = false
    private var streamingTextAccumulator = ""
    private var streamingIsThinking = false
    private var streamingFlushTask: Task<Void, Never>?
    private var toolArgBuffers: [String: String] = [:]
    private var toolOutputBuffers: [String: String] = [:]
    private var reconnectTask: Task<Void, Never>?
    private var queuedMessageCounter = 0
    private var isReplaying = false
    private var replayUserBuffer = ""
    private var replayAssistantBuffer = ""
    private var replayThinkingBuffer = ""

    public init(sessionId: String, api: RookAPI, socket: AcpSocket? = nil, isLoaded: Bool = false, supportsImagePrompts: Bool? = nil) {
        self.sessionId = sessionId
        self.api = api
        self.socket = socket ?? AcpSocket()
        self.isLoaded = isLoaded
        if let supportsImagePrompts {
            self.socket.setSupportsImagePrompts(supportsImagePrompts)
        }
        self.socket.onEvent = { [weak self] event in
            self?.handleSocketEvent(event)
        }
        self.socket.onConnectionChange = { [weak self] connected in
            self?.handleSocketConnectionChange(connected)
        }
        self.socketConnected = self.socket.isConnected
    }

    // MARK: - Lifecycle

    public func connectAndLoad(title: String, cwd: String) async throws {
        try await ensureSocketConnected()
        _ = try await socket.createSession(runtimeId: "", title: title, cwd: cwd)
        isLoaded = true
    }

    public func load() async throws {
        if isLoaded {
            // Already connected and subscribed — just report current state.
            onStateChange?()
            return
        }
        try await ensureSocketConnected()
        isReplaying = true
        replayUserBuffer = ""
        replayAssistantBuffer = ""
        replayThinkingBuffer = ""
        socket.selectSession(sessionId)
        try await socket.loadSession(sessionId)
        isReplaying = false
        flushReplayBuffers()
        isRunning = false
        isLoaded = true
    }

    public func attach(transcript events: [JSONValue]) async throws {
        if isLoaded {
            onStateChange?()
            return
        }
        resetVisibleState()
        for event in events {
            applyTranscriptEvent(event)
        }
        try await ensureSocketConnected()
        socket.selectSession(sessionId)
        isLoaded = true
        onStateChange?()
    }

    public func close() {
        reconnectTask?.cancel()
        streamingFlushTask?.cancel()
        socket.disconnect()
        isLoaded = false
    }

    public func stopAgent() {
        guard isRunning else { return }
        userCancelledRun = true
        statusLine = "Stopping…"
        socket.sendCancel()
    }

    // MARK: - Messaging

    public func send(_ content: [ChatPromptContent]) {
        guard !content.isEmptyPrompt else { return }
        guard content.images.isEmpty || socket.supportsImagePrompts else {
            appendErrorBlock(source: "prompt", message: "The selected runtime does not support image prompts.")
            return
        }
        if isRunning || !socket.isConnected {
            queuedMessages.append(makeQueuedMessage(content))
            if !socket.isConnected {
                scheduleReconnect(delaySeconds: 0)
            }
            return
        }
        deliver(content)
    }

    public func removeQueuedMessage(at index: Int) {
        guard queuedMessages.indices.contains(index) else { return }
        queuedMessages.remove(at: index)
    }

    public func beginEditingQueuedMessage(_ id: String) {
        updateQueuedMessage(id) { $0.isEditing = true; $0.draftText = $0.text }
    }

    public func updateQueuedMessageDraft(_ id: String, text: String) {
        updateQueuedMessage(id) { $0.draftText = text }
    }

    public func cancelEditingQueuedMessage(_ id: String) {
        updateQueuedMessage(id) { $0.isEditing = false; $0.draftText = $0.text }
    }

    public func saveQueuedMessageEdit(_ id: String) {
        updateQueuedMessage(id) { message in
            let trimmed = message.draftText.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                message.content = message.content.replacingText(with: trimmed)
            }
            message.draftText = message.text
            message.isEditing = false
        }
    }

    public func decidePermission(optionId: String?) {
        guard let pendingPermission else { return }
        self.pendingPermission = nil
        do {
            try socket.respondToPermissionRequest(requestId: pendingPermission.requestId, optionId: optionId)
        } catch {
            appendErrorBlock(source: "protocol", message: error.localizedDescription)
        }
    }

    public func setMode(_ modeId: String) {
        Task {
            do { try await socket.setMode(modeId) }
            catch { appendErrorBlock(source: "protocol", message: error.localizedDescription) }
        }
    }

    public func setConfigOption(_ configId: String, value: String) {
        Task {
            do { try await socket.setConfigOption(configId: configId, value: value) }
            catch { appendErrorBlock(source: "protocol", message: error.localizedDescription) }
        }
    }

    public func resolveEnvironmentOffer(environmentId: String, bundleHash: String, decision: String) async throws {
        try await socket.resolveEnvironmentOffer(environmentId: environmentId, bundleHash: bundleHash, decision: decision)
    }

    public func refreshForCurrentSessionReset() {
        enteredEnvironments = []
    }

    public func resumeAutoScroll() {
        let wasEnabled = autoScrollEnabled
        autoScrollEnabled = true
        if !wasEnabled { scrollTick += 1 }
    }

    public func pauseAutoScroll() {
        autoScrollEnabled = false
    }

    public func appendSystemMessage(_ text: String) {
        appendBlock(.system(text: text))
    }

    public func finalizeActiveTools(as finalStatus: ToolBlockStatus) {
        for index in blocks.indices {
            guard case .tool(var state) = blocks[index].kind else { continue }
            guard !state.status.isTerminal else { continue }
            state.status = finalStatus
            blocks[index].kind = .tool(state)
        }
    }

    private func resetVisibleState() {
        blocks = []
        queuedMessages = []
        isRunning = false
        statusLine = ""
        contextUsage = nil
        currentModes = nil
        configOptions = []
        pendingPermission = nil
        lastStopReason = nil
        autoScrollEnabled = true
        enteredEnvironments = []
        blockCounter = 0
        scrollTick = 0
    }

    private func applyTranscriptEvent(_ event: JSONValue) {
        let kind = event["kind"]?.stringValue ?? ""
        switch kind {
        case "user_message_chunk":
            if let text = event["text"]?.stringValue { appendBlock(.user(text: text)) }
        case "agent_message_chunk":
            if let text = event["text"]?.stringValue { appendBlock(.assistantText(text: text, streaming: false)) }
        case "agent_thought_chunk":
            if let text = event["text"]?.stringValue { appendBlock(.thinking(text: text, streaming: false)) }
        case "tool_call":
            guard let toolCallId = event["toolCallId"]?.stringValue else { return }
            let state = ToolBlockState(
                toolCallId: toolCallId,
                title: event["title"]?.stringValue ?? "Tool",
                kindLabel: event["toolKind"]?.stringValue ?? "",
                status: transcriptStatus(event["status"]?.stringValue),
                arguments: stringifyTranscriptJSON(event["rawInput"]),
                output: ""
            )
            appendBlock(.tool(state), id: "tool-\(toolCallId)-\(blockCounter)")
        case "tool_call_update":
            guard let toolCallId = event["toolCallId"]?.stringValue else { return }
            updateTool(toolCallId) { tool in
                if let toolName = event["toolName"]?.stringValue, tool.title.isEmpty { tool.title = toolName }
                if event["rawInput"] != nil {
                    tool.arguments = stringifyTranscriptJSON(event["rawInput"])
                }
                let outputDelta = event["outputDelta"]?.stringValue
                switch event["status"]?.stringValue {
                case "pending": advanceToolStatus(&tool, to: .pending)
                case "in_progress":
                    advanceToolStatus(&tool, to: .running)
                    if let outputDelta { tool.output += outputDelta }
                    else if event["rawOutput"] != nil { tool.output = stringifyTranscriptJSON(event["rawOutput"]) }
                case "completed":
                    advanceToolStatus(&tool, to: .completed)
                    if let outputDelta { tool.output += outputDelta }
                    else if event["rawOutput"] != nil { tool.output = stringifyTranscriptJSON(event["rawOutput"]) }
                case "failed":
                    advanceToolStatus(&tool, to: .failed)
                    if let outputDelta { tool.output += outputDelta }
                    else if event["rawOutput"] != nil { tool.output = stringifyTranscriptJSON(event["rawOutput"]) }
                case "cancelled": advanceToolStatus(&tool, to: .cancelled)
                default: break
                }
            }
        case "plan_update":
            if case .array(let entries)? = event["entries"] {
                let planEntries = entries.enumerated().compactMap { index, item -> PlanEntry? in
                    guard let content = item["content"]?.stringValue ?? item["text"]?.stringValue else { return nil }
                    return PlanEntry(id: Int(item["id"]?.numberValue ?? Double(index)), content: content, priority: item["priority"]?.stringValue ?? "", status: item["status"]?.stringValue ?? "")
                }
                upsertPlanBlock(planEntries)
            }
        case "usage_update":
            if let used = event["used"]?.numberValue, let size = event["size"]?.numberValue {
                contextUsage = ContextUsageState(used: Int(used), size: Int(size), cost: nil)
            }
        case "run_completed":
            isRunning = false
            statusLine = ""
        case "run_failed":
            isRunning = false
            statusLine = ""
            if let message = event["message"]?.stringValue { appendErrorBlock(source: "run", message: message) }
        default:
            break
        }
    }

    private func transcriptStatus(_ raw: String?) -> ToolBlockStatus {
        switch raw {
        case "in_progress": return .running
        case "completed": return .completed
        case "failed": return .failed
        case "cancelled": return .cancelled
        case "ready": return .ready
        case "input_streaming": return .inputStreaming
        default: return .pending
        }
    }

    private func stringifyTranscriptJSON(_ value: JSONValue?) -> String {
        guard let value else { return "" }
        if case .string(let text) = value { return text }
        if case .null = value { return "" }
        if let data = try? JSONEncoder().encode(value), let text = String(data: data, encoding: .utf8) { return text }
        return ""
    }

    // MARK: - Private: connection

    private func ensureSocketConnected() async throws {
        _ = try await socket.connect(request: api.webSocketRequest(sessionId: sessionId))
    }

    private func scheduleReconnect(delaySeconds: Double) {
        reconnectTask?.cancel()
        reconnecting = true
        reconnectTask = Task {
            if delaySeconds > 0 {
                try? await Task.sleep(nanoseconds: UInt64(delaySeconds * 1_000_000_000))
            }
            guard !Task.isCancelled else { return }
            if await api.health() {
                do {
                    try await ensureSocketConnected()
                    try await socket.loadSession(sessionId)
                    guard !Task.isCancelled else { return }
                    reconnecting = false
                    deliverNextQueuedIfIdle()
                } catch {
                    if !Task.isCancelled { scheduleReconnect(delaySeconds: 3) }
                }
            } else if !Task.isCancelled {
                scheduleReconnect(delaySeconds: 3)
            }
        }
    }

    // MARK: - Private: delivery

    private func deliver(_ content: [ChatPromptContent]) {
        finalizeStreamingBlocks()
        appendBlock(.userContent(content))
        isRunning = true
        statusLine = "Agent is working…"
        lastStopReason = nil
        autoScrollEnabled = true
        socket.sendPrompt(content: content)
    }

    private func deliverNextQueuedIfIdle() {
        guard !isRunning, socket.isConnected, !queuedMessages.isEmpty else { return }
        let next = queuedMessages.removeFirst()
        Task {
            try? await Task.sleep(nanoseconds: 120_000_000)
            guard !isRunning, socket.isConnected else {
                queuedMessages.insert(next, at: 0)
                return
            }
            deliver(next.content)
        }
    }

    // MARK: - Private: event handling

    private func handleSocketConnectionChange(_ connected: Bool) {
        socketConnected = connected
        if connected {
            reconnectTask?.cancel()
            reconnectTask = nil
            reconnecting = false
            return
        }
        if isRunning {
            isRunning = false
            statusLine = ""
            finalizeStreamingBlocks()
            appendErrorBlock(source: "connection", message: "Connection lost while the agent was running.")
        }
        scheduleReconnect(delaySeconds: 2)
    }

    private func handleSocketEvent(_ event: AcpClientEvent) {
        switch event {
        case .userMessageChunk(let text):
            if isReplaying {
                replayFlushIncompatibleSection("user")
                replayUserBuffer += text
            } else {
                appendBlock(.user(text: text))
            }
        case .agentMessageChunk(let text):
            if isReplaying {
                replayFlushIncompatibleSection("assistant")
                replayAssistantBuffer += text
            } else {
                statusLine = "Responding…"
                appendStreamingText(text, isThinking: false)
                onAgentTextChunk?(text)
            }
        case .agentThoughtChunk(let text):
            if isReplaying {
                replayFlushIncompatibleSection("thinking")
                replayThinkingBuffer += text
            } else {
                statusLine = "Thinking…"
                appendStreamingText(text, isThinking: true)
            }
        case .toolCallStarted(let toolCallId, let title, let kind, let status, let rawInput):
            if isReplaying {
                replayFlushIncompatibleSection("tool")
            } else {
                flushLiveIncompatibleSection()
                statusLine = "Using tool: \(title)"
            }
            let state = ToolBlockState(
                toolCallId: toolCallId,
                title: title,
                kindLabel: kind,
                status: status == "in_progress" ? .running : .pending,
                arguments: rawInput ?? "",
                output: ""
            )
            appendBlock(.tool(state), id: "tool-\(toolCallId)-\(blockCounter)")
        case .toolCallUpdate(let toolCallId, let status, let toolName, let output):
            if isReplaying {
                replayFlushIncompatibleSection("tool")
            } else {
                flushLiveIncompatibleSection()
            }
            updateTool(toolCallId) { tool in
                if let toolName, tool.title.isEmpty { tool.title = toolName }
                switch status {
                case "pending": advanceToolStatus(&tool, to: .pending)
                case "in_progress": advanceToolStatus(&tool, to: .running); if let output { tool.output = output }
                case "completed": advanceToolStatus(&tool, to: .completed); if let output { tool.output = output }
                case "failed": advanceToolStatus(&tool, to: .failed); if let output { tool.output = output }
                case "cancelled": advanceToolStatus(&tool, to: .cancelled)
                default: break
                }
            }
        case .toolInputSnapshot(let toolCallId, _, let text):
            if isReplaying { updateTool(toolCallId) { $0.arguments = text }; return }
            toolArgBuffers[toolCallId] = text
            scheduleStreamingFlush()
        case .toolInputDelta(let toolCallId, _, let delta):
            if isReplaying { updateTool(toolCallId) { $0.arguments += delta }; return }
            toolArgBuffers[toolCallId, default: ""] += delta
            scheduleStreamingFlush()
        case .toolCallReady(let toolCallId, _):
            if isReplaying { updateTool(toolCallId) { advanceToolStatus(&$0, to: .ready) }; return }
            flushLiveIncompatibleSection()
            updateTool(toolCallId) { advanceToolStatus(&$0, to: .ready) }
        case .toolOutputSnapshot(let toolCallId, _, let text):
            if isReplaying { updateTool(toolCallId) { $0.output = text }; return }
            toolOutputBuffers[toolCallId] = text
            scheduleStreamingFlush()
        case .toolOutputDelta(let toolCallId, _, let delta):
            if isReplaying { updateTool(toolCallId) { $0.output += delta }; return }
            toolOutputBuffers[toolCallId, default: ""] += delta
            scheduleStreamingFlush()
        case .permissionRequest(let requestId, let toolCall, let options):
            if isReplaying { return }
            pendingPermission = PendingPermissionRequest(requestId: requestId, toolCall: toolCall, options: options)
            statusLine = "Permission needed: \(toolCall.title)"
        case .planUpdate(let entries):
            upsertPlanBlock(entries)
        case .usageUpdate(let used, let size, let cost):
            contextUsage = ContextUsageState(used: used, size: size, cost: cost)
        case .modesState(let currentModeId, let availableModes):
            currentModes = AcpModesState(currentModeId: currentModeId, availableModes: availableModes)
        case .currentModeUpdate(let modeId):
            if let currentModes { self.currentModes = AcpModesState(currentModeId: modeId, availableModes: currentModes.availableModes) }
        case .configOptionUpdate(let configOptions):
            self.configOptions = configOptions
        case .runCompleted(let stopReason):
            if isReplaying { flushReplayBuffers(); return }
            finalizeStreamingBlocks()
            if stopReason == "cancelled" { finalizeActiveTools(as: .cancelled) }
            isRunning = false
            statusLine = ""
            lastStopReason = stopReason
            pendingPermission = nil
            userCancelledRun = false
            deliverNextQueuedIfIdle()
        case .runFailed(let message):
            if isReplaying { flushReplayBuffers(); return }
            finalizeStreamingBlocks()
            isRunning = false
            statusLine = ""
            pendingPermission = nil
            if userCancelledRun || message.lowercased().contains("cancel") {
                finalizeActiveTools(as: .cancelled)
                userCancelledRun = false
                lastStopReason = "cancelled"
                appendBlock(.system(text: "Stopped."))
            } else {
                lastStopReason = "failed"
                appendErrorBlock(source: "run", message: message)
            }
            deliverNextQueuedIfIdle()
        case .protocolError(let message):
            appendErrorBlock(source: "protocol", message: message)
        case .connectionError(let message):
            appendErrorBlock(source: "connection", message: message)
        case .environmentOffered(let offer):
            onEnvironmentOffered?(offer)
        case .environmentOfferResolved(let environmentId, let bundleHash):
            onEnvironmentOfferResolved?(environmentId, bundleHash)
        case .environmentEntered(let environmentId):
            if enteredEnvironments.insert(environmentId).inserted {
                onEnvironmentEntered?(environmentId)
                appendBlock(.system(text: "Entered environment \(environmentId)."))
            }
        case .environmentExited(let environmentId, let error):
            if enteredEnvironments.remove(environmentId) != nil {
                onEnvironmentExited?(environmentId, error)
                let suffix = error.map { " (\($0))" } ?? ""
                appendBlock(.system(text: "Exited environment \(environmentId)\(suffix)."))
            }
        }
        scrollTick += 1
    }

    // MARK: - Private: blocks / streaming

    private func makeQueuedMessage(_ content: [ChatPromptContent]) -> QueuedChatMessage {
        queuedMessageCounter += 1
        return QueuedChatMessage(id: "queued-\(queuedMessageCounter)", content: content)
    }

    private func updateQueuedMessage(_ id: String, mutate: (inout QueuedChatMessage) -> Void) {
        guard let index = queuedMessages.firstIndex(where: { $0.id == id }) else { return }
        mutate(&queuedMessages[index])
    }

    private func appendBlock(_ kind: ChatBlockKind, id: String? = nil) {
        blockCounter += 1
        blocks.append(ChatBlock(id: id ?? "block-\(blockCounter)", kind: kind))
    }

    private func appendErrorBlock(source: String, message: String) {
        if case .error(let lastSource, let lastMessage)? = blocks.last?.kind,
           lastSource == source, lastMessage == message { return }
        appendBlock(.error(source: source, message: message))
    }

    private func scheduleStreamingFlush() {
        streamingFlushTask?.cancel()
        streamingFlushTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 16_000_000)
            guard !Task.isCancelled else { return }
            applyStreamingFlush()
        }
    }

    private func flushLiveIncompatibleSection() {
        streamingFlushTask?.cancel()
        streamingFlushTask = nil
        applyStreamingFlush()
    }

    private func applyStreamingFlush() {
        if !streamingTextAccumulator.isEmpty {
            if let last = blocks.indices.last {
                switch blocks[last].kind {
                case .assistantText(let existing, true) where !streamingIsThinking:
                    blocks[last].kind = .assistantText(text: existing + streamingTextAccumulator, streaming: true)
                    streamingTextAccumulator = ""
                case .thinking(let existing, true) where streamingIsThinking:
                    blocks[last].kind = .thinking(text: existing + streamingTextAccumulator, streaming: true)
                    streamingTextAccumulator = ""
                default: break
                }
            }
            if !streamingTextAccumulator.isEmpty {
                if streamingIsThinking { appendBlock(.thinking(text: streamingTextAccumulator, streaming: true)) }
                else { appendBlock(.assistantText(text: streamingTextAccumulator, streaming: true)) }
                streamingTextAccumulator = ""
            }
        }
        if !toolArgBuffers.isEmpty {
            let snap = toolArgBuffers; toolArgBuffers = [:]
            for (toolCallId, text) in snap {
                updateTool(toolCallId) { tool in advanceToolStatus(&tool, to: .inputStreaming); tool.arguments = text }
            }
        }
        if !toolOutputBuffers.isEmpty {
            let snap = toolOutputBuffers; toolOutputBuffers = [:]
            for (toolCallId, text) in snap {
                updateTool(toolCallId) { tool in advanceToolStatus(&tool, to: .running); tool.output = text }
            }
        }
    }

    private func appendStreamingText(_ text: String, isThinking: Bool) {
        if streamingIsThinking != isThinking && !streamingTextAccumulator.isEmpty { applyStreamingFlush() }
        streamingTextAccumulator += text
        streamingIsThinking = isThinking
        scheduleStreamingFlush()
    }

    private func finalizeStreamingBlocks() {
        flushLiveIncompatibleSection()
        streamingTextAccumulator = ""
        toolArgBuffers = [:]
        toolOutputBuffers = [:]
        for index in blocks.indices {
            switch blocks[index].kind {
            case .assistantText(let text, true): blocks[index].kind = .assistantText(text: text, streaming: false)
            case .thinking(let text, true): blocks[index].kind = .thinking(text: text, streaming: false)
            default: break
            }
        }
    }

    private func toolStatusRank(_ status: ToolBlockStatus) -> Int {
        switch status {
        case .pending: return 0
        case .inputStreaming: return 1
        case .ready: return 2
        case .running: return 3
        case .completed, .failed, .cancelled: return 4
        }
    }

    private func advanceToolStatus(_ tool: inout ToolBlockState, to next: ToolBlockStatus) {
        guard !tool.status.isTerminal else { return }
        if next.isTerminal || toolStatusRank(next) >= toolStatusRank(tool.status) { tool.status = next }
    }

    private func updateTool(_ toolCallId: String, _ mutate: (inout ToolBlockState) -> Void) {
        for index in blocks.indices.reversed() {
            if case .tool(var state) = blocks[index].kind, state.toolCallId == toolCallId {
                mutate(&state); blocks[index].kind = .tool(state); return
            }
        }
        var state = ToolBlockState(toolCallId: toolCallId, title: "Tool", kindLabel: "", status: .running, arguments: "", output: "")
        mutate(&state)
        appendBlock(.tool(state), id: "tool-\(toolCallId)-\(blockCounter)")
    }

    private func upsertPlanBlock(_ entries: [PlanEntry]) {
        for index in blocks.indices.reversed() {
            if case .plan = blocks[index].kind { blocks[index].kind = .plan(entries: entries); return }
        }
        appendBlock(.plan(entries: entries))
    }

    // MARK: - Private: replay

    private func flushReplayBuffers() {
        if !replayUserBuffer.isEmpty { appendBlock(.user(text: replayUserBuffer)); replayUserBuffer = "" }
        if !replayThinkingBuffer.isEmpty { appendBlock(.thinking(text: replayThinkingBuffer, streaming: false)); replayThinkingBuffer = "" }
        if !replayAssistantBuffer.isEmpty { appendBlock(.assistantText(text: replayAssistantBuffer, streaming: false)); replayAssistantBuffer = "" }
    }

    private func replayFlushIncompatibleSection(_ next: String) {
        switch next {
        case "user":
            if !replayAssistantBuffer.isEmpty { flushReplaySection("assistant") }
            if !replayThinkingBuffer.isEmpty { flushReplaySection("thinking") }
        case "thinking":
            if !replayUserBuffer.isEmpty { flushReplaySection("user") }
            if !replayAssistantBuffer.isEmpty { flushReplaySection("assistant") }
        case "assistant":
            if !replayUserBuffer.isEmpty { flushReplaySection("user") }
            if !replayThinkingBuffer.isEmpty { flushReplaySection("thinking") }
        default:
            if !replayUserBuffer.isEmpty { flushReplaySection("user") }
            if !replayThinkingBuffer.isEmpty { flushReplaySection("thinking") }
            if !replayAssistantBuffer.isEmpty { flushReplaySection("assistant") }
        }
    }

    private func flushReplaySection(_ section: String) {
        switch section {
        case "user": if !replayUserBuffer.isEmpty { appendBlock(.user(text: replayUserBuffer)); replayUserBuffer = "" }
        case "thinking": if !replayThinkingBuffer.isEmpty { appendBlock(.thinking(text: replayThinkingBuffer, streaming: false)); replayThinkingBuffer = "" }
        case "assistant": if !replayAssistantBuffer.isEmpty { appendBlock(.assistantText(text: replayAssistantBuffer, streaming: false)); replayAssistantBuffer = "" }
        default: break
        }
    }
}
