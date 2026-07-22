import Foundation
import RookKit

@MainActor
final class ChatSessionController {
    var onStateChange: (() -> Void)?
    var onCurrentSessionChange: ((AgentSessionSummary?) -> Void)?
    var onEnvironmentOffered: ((EnvironmentOffer) -> Void)?
    var onEnvironmentOfferResolved: ((String, String) -> Void)?
    var onEnvironmentEntered: ((String) -> Void)?
    var onEnvironmentExited: ((String, String?) -> Void)?

    private let api: RookAPI
    private let socket = AcpSocket()

    private(set) var sessions: [AgentSessionSummary] = [] { didSet { onStateChange?() } }
    private(set) var sessionsLoading = false { didSet { onStateChange?() } }
    private(set) var sessionsError = "" { didSet { onStateChange?() } }
    private(set) var startingSession = false { didSet { onStateChange?() } }

    private(set) var currentSession: AgentSessionSummary? {
        didSet {
            onStateChange?()
            onCurrentSessionChange?(currentSession)
        }
    }
    private(set) var blocks: [ChatBlock] = [] { didSet { onStateChange?() } }
    private(set) var queuedMessages: [QueuedChatMessage] = [] { didSet { onStateChange?() } }
    private(set) var isRunning = false { didSet { onStateChange?() } }
    private(set) var statusLine = "" { didSet { onStateChange?() } }
    private(set) var socketConnected = false { didSet { onStateChange?() } }
    private(set) var reconnecting = false { didSet { onStateChange?() } }
    private(set) var contextUsage: ContextUsageState? { didSet { onStateChange?() } }
    private(set) var currentModes: AcpModesState? { didSet { onStateChange?() } }
    private(set) var configOptions: [AcpConfigOption] = [] { didSet { onStateChange?() } }
    private(set) var pendingPermission: PendingPermissionRequest? { didSet { onStateChange?() } }
    private(set) var lastStopReason: String? { didSet { onStateChange?() } }
    private(set) var autoScrollEnabled = true { didSet { onStateChange?() } }
    private(set) var scrollTick = 0 { didSet { onStateChange?() } }

    private var blockCounter = 0
    private var enteredEnvironments: Set<String> = []
    private var userCancelledRun = false
    private var streamingTextAccumulator = ""
    private var streamingIsThinking = false
    private var streamingFlushTask: Task<Void, Never>?
    private var toolArgBuffers: [String: String] = [:]
    private var toolOutputBuffers: [String: String] = [:]
    private var autoResumeAttempted = false
    private var reconnectTask: Task<Void, Never>?
    private var queuedMessageCounter = 0
    private var isReplaying = false
    private var replayUserBuffer = ""
    private var replayAssistantBuffer = ""
    private var replayThinkingBuffer = ""

    init(api: RookAPI) {
        self.api = api
        socket.onEvent = { [weak self] event in
            self?.handleSocketEvent(event)
        }
        socket.onConnectionChange = { [weak self] connected in
            self?.handleSocketConnectionChange(connected)
        }
    }

    func stop() {
        socket.disconnect()
        reconnectTask?.cancel()
        streamingFlushTask?.cancel()
    }

    func loadSessions() async {
        sessionsLoading = true
        defer { sessionsLoading = false }
        do {
            try await ensureSocketConnected()
            sessions = try await socket.sessionList()
            sessionsError = ""
        } catch {
            sessionsError = error.localizedDescription
        }
    }

    func autoResumeRecentSessionIfNeeded() async {
        guard !autoResumeAttempted, currentSession == nil else { return }
        autoResumeAttempted = true
        do {
            try await ensureSocketConnected()
            if let recent = try await socket.sessionList().first {
                prepareForSessionResume(session: recent)
                try await socket.loadSession(recent.id)
                finishSessionResume(session: recent)
            }
        } catch {
            sessionsError = error.localizedDescription
        }
    }

    func startNewSession(agentId: String, name: String, completion: (() -> Void)? = nil) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let title = trimmed.isEmpty ? "session" : trimmed
        startingSession = true
        Task {
            defer {
                self.startingSession = false
                completion?()
            }
            do {
                try await ensureSocketConnected()
                let sessionId = try await socket.createSession(runtimeId: agentId, title: title, cwd: FileManager.default.currentDirectoryPath)
                await loadSessions()
                let session = sessions.first(where: { $0.id == sessionId })
                    ?? AgentSessionSummary(raw: .object([
                        "sessionId": .string(sessionId),
                        "title": .string(title),
                        "_meta": .object(["runtimeId": .string(agentId)]),
                    ]))
                enterChat(session: session)
            } catch {
                sessionsError = error.localizedDescription
                appendErrorBlock(source: "session", message: error.localizedDescription)
            }
        }
    }

    func resumeSession(_ session: AgentSessionSummary, completion: (() -> Void)? = nil) {
        startingSession = true
        Task {
            defer {
                self.startingSession = false
                completion?()
            }
            do {
                try await ensureSocketConnected()
                prepareForSessionResume(session: session)
                try await socket.loadSession(session.id)
                finishSessionResume(session: session)
            } catch {
                sessionsError = error.localizedDescription
                appendErrorBlock(source: "session", message: "Failed to load session: \(error.localizedDescription)")
            }
        }
    }

    func send(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, currentSession != nil else {
            return
        }
        if isRunning || !socket.isConnected {
            queuedMessages.append(makeQueuedMessage(trimmed))
            if !socket.isConnected {
                scheduleReconnect(delaySeconds: 0)
            }
            return
        }
        deliver(trimmed)
    }

    func stopAgent() {
        guard isRunning else {
            return
        }
        userCancelledRun = true
        statusLine = "Stopping…"
        socket.sendCancel()
    }

    func removeQueuedMessage(at index: Int) {
        guard queuedMessages.indices.contains(index) else {
            return
        }
        queuedMessages.remove(at: index)
    }

    func beginEditingQueuedMessage(_ id: String) {
        updateQueuedMessage(id) { message in
            message.isEditing = true
            message.draftText = message.text
        }
    }

    func updateQueuedMessageDraft(_ id: String, text: String) {
        updateQueuedMessage(id) { message in
            message.draftText = text
        }
    }

    func cancelEditingQueuedMessage(_ id: String) {
        updateQueuedMessage(id) { message in
            message.isEditing = false
            message.draftText = message.text
        }
    }

    func saveQueuedMessageEdit(_ id: String) {
        updateQueuedMessage(id) { message in
            let trimmed = message.draftText.trimmingCharacters(in: .whitespacesAndNewlines)
            message.text = trimmed.isEmpty ? message.text : trimmed
            message.draftText = message.text
            message.isEditing = false
        }
    }

    func decidePermission(optionId: String?) {
        guard let pendingPermission else {
            return
        }
        self.pendingPermission = nil
        do {
            try socket.respondToPermissionRequest(requestId: pendingPermission.requestId, optionId: optionId)
        } catch {
            appendErrorBlock(source: "protocol", message: error.localizedDescription)
        }
    }

    func setMode(_ modeId: String) {
        Task {
            do {
                try await socket.setMode(modeId)
            } catch {
                appendErrorBlock(source: "protocol", message: error.localizedDescription)
            }
        }
    }

    func setConfigOption(_ configId: String, value: String) {
        Task {
            do {
                try await socket.setConfigOption(configId: configId, value: value)
            } catch {
                appendErrorBlock(source: "protocol", message: error.localizedDescription)
            }
        }
    }

    func resolveEnvironmentOffer(environmentId: String, bundleHash: String, decision: String) async throws {
        try await socket.resolveEnvironmentOffer(environmentId: environmentId, bundleHash: bundleHash, decision: decision)
    }

    func refreshForCurrentSessionReset() {
        enteredEnvironments = []
    }

    func resumeAutoScroll() {
        let wasEnabled = autoScrollEnabled
        autoScrollEnabled = true
        if !wasEnabled {
            scrollTick += 1
        }
    }

    func pauseAutoScroll() {
        autoScrollEnabled = false
    }

    private func ensureSocketConnected() async throws {
        _ = try await socket.connect(request: api.webSocketRequest())
    }

    private func prepareForSessionResume(session: AgentSessionSummary) {
        reconnectTask?.cancel()
        currentSession = session
        blocks = []
        queuedMessages = []
        isRunning = false
        statusLine = ""
        contextUsage = nil
        currentModes = nil
        configOptions = []
        pendingPermission = nil
        lastStopReason = nil
        enteredEnvironments = []
        isReplaying = true
        replayUserBuffer = ""
        replayAssistantBuffer = ""
        replayThinkingBuffer = ""
        socket.selectSession(session.id)
    }

    private func finishSessionResume(session: AgentSessionSummary) {
        isReplaying = false
        flushReplayBuffers()
        isRunning = false
    }

    private func enterChat(session: AgentSessionSummary) {
        reconnectTask?.cancel()
        currentSession = session
        blocks = []
        queuedMessages = []
        isRunning = false
        statusLine = ""
        contextUsage = nil
        currentModes = nil
        configOptions = []
        pendingPermission = nil
        lastStopReason = nil
        enteredEnvironments = []
        socket.selectSession(session.id)
    }

    private func flushReplayBuffers() {
        if !replayUserBuffer.isEmpty {
            appendBlock(.user(text: replayUserBuffer))
            replayUserBuffer = ""
        }
        if !replayThinkingBuffer.isEmpty {
            appendBlock(.thinking(text: replayThinkingBuffer, streaming: false))
            replayThinkingBuffer = ""
        }
        if !replayAssistantBuffer.isEmpty {
            appendBlock(.assistantText(text: replayAssistantBuffer, streaming: false))
            replayAssistantBuffer = ""
        }
    }

    private func replayFlushIncompatibleSection(_ next: String) {
        if next == "user" {
            if !replayAssistantBuffer.isEmpty { flushReplaySection("assistant") }
            if !replayThinkingBuffer.isEmpty { flushReplaySection("thinking") }
        } else if next == "thinking" {
            if !replayUserBuffer.isEmpty { flushReplaySection("user") }
            if !replayAssistantBuffer.isEmpty { flushReplaySection("assistant") }
        } else if next == "assistant" {
            if !replayUserBuffer.isEmpty { flushReplaySection("user") }
            if !replayThinkingBuffer.isEmpty { flushReplaySection("thinking") }
        } else {
            if !replayUserBuffer.isEmpty { flushReplaySection("user") }
            if !replayThinkingBuffer.isEmpty { flushReplaySection("thinking") }
            if !replayAssistantBuffer.isEmpty { flushReplaySection("assistant") }
        }
    }

    private func flushReplaySection(_ section: String) {
        switch section {
        case "user":
            if !replayUserBuffer.isEmpty {
                appendBlock(.user(text: replayUserBuffer))
                replayUserBuffer = ""
            }
        case "thinking":
            if !replayThinkingBuffer.isEmpty {
                appendBlock(.thinking(text: replayThinkingBuffer, streaming: false))
                replayThinkingBuffer = ""
            }
        case "assistant":
            if !replayAssistantBuffer.isEmpty {
                appendBlock(.assistantText(text: replayAssistantBuffer, streaming: false))
                replayAssistantBuffer = ""
            }
        default:
            break
        }
    }

    private func deliver(_ text: String) {
        finalizeStreamingBlocks()
        appendBlock(.user(text: text))
        isRunning = true
        statusLine = "Agent is working…"
        lastStopReason = nil
        autoScrollEnabled = true
        socket.sendPrompt(text: text)
    }

    private func deliverNextQueuedIfIdle() {
        guard !isRunning, socket.isConnected, !queuedMessages.isEmpty else {
            return
        }
        let next = queuedMessages.removeFirst()
        Task {
            try? await Task.sleep(nanoseconds: 120_000_000)
            guard !isRunning, socket.isConnected else {
                queuedMessages.insert(next, at: 0)
                return
            }
            deliver(next.text)
        }
    }

    private func scheduleReconnect(delaySeconds: Double) {
        guard currentSession != nil else {
            return
        }
        reconnectTask?.cancel()
        reconnecting = true
        reconnectTask = Task {
            if delaySeconds > 0 {
                try? await Task.sleep(nanoseconds: UInt64(delaySeconds * 1_000_000_000))
            }
            guard !Task.isCancelled, let session = currentSession else {
                return
            }
            if await api.health() {
                do {
                    try await ensureSocketConnected()
                    try await socket.loadSession(session.id)
                    guard !Task.isCancelled else { return }
                    reconnecting = false
                    deliverNextQueuedIfIdle()
                } catch {
                    if !Task.isCancelled {
                        scheduleReconnect(delaySeconds: 3)
                    }
                }
            } else if !Task.isCancelled {
                scheduleReconnect(delaySeconds: 3)
            }
        }
    }

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
        if currentSession != nil {
            scheduleReconnect(delaySeconds: 2)
        }
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
                if let toolName, tool.title.isEmpty {
                    tool.title = toolName
                }
                switch status {
                case "pending":
                    advanceToolStatus(&tool, to: .pending)
                case "in_progress":
                    advanceToolStatus(&tool, to: .running)
                    if let output { tool.output = output }
                case "completed":
                    advanceToolStatus(&tool, to: .completed)
                    if let output { tool.output = output }
                case "failed":
                    advanceToolStatus(&tool, to: .failed)
                    if let output { tool.output = output }
                case "cancelled":
                    advanceToolStatus(&tool, to: .cancelled)
                default:
                    break
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
            if isReplaying {
                updateTool(toolCallId) { tool in
                    advanceToolStatus(&tool, to: .ready)
                }
                return
            }
            flushLiveIncompatibleSection()
            updateTool(toolCallId) { tool in
                advanceToolStatus(&tool, to: .ready)
            }
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
            if let currentModes {
                self.currentModes = AcpModesState(currentModeId: modeId, availableModes: currentModes.availableModes)
            }
        case .configOptionUpdate(let configOptions):
            self.configOptions = configOptions
        case .runCompleted(let stopReason):
            if isReplaying { flushReplayBuffers(); return }
            finalizeStreamingBlocks()
            if stopReason == "cancelled" {
                finalizeActiveTools(as: .cancelled)
            }
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

    private func makeQueuedMessage(_ text: String) -> QueuedChatMessage {
        queuedMessageCounter += 1
        return QueuedChatMessage(id: "queued-\(queuedMessageCounter)", text: text, draftText: text)
    }

    private func updateQueuedMessage(_ id: String, mutate: (inout QueuedChatMessage) -> Void) {
        guard let index = queuedMessages.firstIndex(where: { $0.id == id }) else {
            return
        }
        mutate(&queuedMessages[index])
    }

    private func appendBlock(_ kind: ChatBlockKind, id: String? = nil) {
        blockCounter += 1
        blocks.append(ChatBlock(id: id ?? "block-\(blockCounter)", kind: kind))
    }

    private func appendErrorBlock(source: String, message: String) {
        if case .error(let lastSource, let lastMessage)? = blocks.last?.kind,
           lastSource == source, lastMessage == message {
            return
        }
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
                default:
                    break
                }
            }
            if !streamingTextAccumulator.isEmpty {
                if streamingIsThinking {
                    appendBlock(.thinking(text: streamingTextAccumulator, streaming: true))
                } else {
                    appendBlock(.assistantText(text: streamingTextAccumulator, streaming: true))
                }
                streamingTextAccumulator = ""
            }
        }

        if !toolArgBuffers.isEmpty {
            let snap = toolArgBuffers
            toolArgBuffers = [:]
            for (toolCallId, text) in snap {
                updateTool(toolCallId) { tool in
                    advanceToolStatus(&tool, to: .inputStreaming)
                    tool.arguments = text
                }
            }
        }
        if !toolOutputBuffers.isEmpty {
            let snap = toolOutputBuffers
            toolOutputBuffers = [:]
            for (toolCallId, text) in snap {
                updateTool(toolCallId) { tool in
                    advanceToolStatus(&tool, to: .running)
                    tool.output = text
                }
            }
        }
    }

    private func appendStreamingText(_ text: String, isThinking: Bool) {
        if streamingIsThinking != isThinking && !streamingTextAccumulator.isEmpty {
            applyStreamingFlush()
        }
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
            case .assistantText(let text, true):
                blocks[index].kind = .assistantText(text: text, streaming: false)
            case .thinking(let text, true):
                blocks[index].kind = .thinking(text: text, streaming: false)
            default:
                break
            }
        }
    }

    private func toolStatusRank(_ status: ToolBlockStatus) -> Int {
        switch status {
        case .pending:
            return 0
        case .inputStreaming:
            return 1
        case .ready:
            return 2
        case .running:
            return 3
        case .completed, .failed, .cancelled:
            return 4
        }
    }

    private func advanceToolStatus(_ tool: inout ToolBlockState, to next: ToolBlockStatus) {
        guard !tool.status.isTerminal else { return }
        if next.isTerminal || toolStatusRank(next) >= toolStatusRank(tool.status) {
            tool.status = next
        }
    }

    func appendSystemMessage(_ text: String) {
        appendBlock(.system(text: text))
    }

    func finalizeActiveTools(as finalStatus: ToolBlockStatus) {
        for index in blocks.indices {
            guard case .tool(var state) = blocks[index].kind else { continue }
            guard !state.status.isTerminal else { continue }
            state.status = finalStatus
            blocks[index].kind = .tool(state)
        }
    }

    private func updateTool(_ toolCallId: String, _ mutate: (inout ToolBlockState) -> Void) {
        for index in blocks.indices.reversed() {
            if case .tool(var state) = blocks[index].kind, state.toolCallId == toolCallId {
                mutate(&state)
                blocks[index].kind = .tool(state)
                return
            }
        }
        var state = ToolBlockState(
            toolCallId: toolCallId,
            title: "Tool",
            kindLabel: "",
            status: .running,
            arguments: "",
            output: ""
        )
        mutate(&state)
        appendBlock(.tool(state), id: "tool-\(toolCallId)-\(blockCounter)")
    }

    private func upsertPlanBlock(_ entries: [PlanEntry]) {
        for index in blocks.indices.reversed() {
            if case .plan = blocks[index].kind {
                blocks[index].kind = .plan(entries: entries)
                return
            }
        }
        appendBlock(.plan(entries: entries))
    }
}
