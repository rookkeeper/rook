import Foundation
import RookKit
import SwiftUI

enum ServerState: Equatable {
    case unknown
    case offline
    case online
}

/// iOS view-model: the portable chat/session/offer core of the macOS
/// `AgentStationModel`, with macOS-only services dropped. Location (Phase B),
/// voice (Phase C), and Live Activity (Phase D) attach here later.
@MainActor
final class RookModel: ObservableObject {
    // Server / control plane
    @Published var serverState: ServerState = .unknown
    @Published var agents: [AgentDefinition] = []
    @Published var agentsError = ""

    // Session selection
    @Published var sessions: [AgentSessionSummary] = []
    @Published var sessionsLoading = false
    @Published var sessionsError = ""
    @Published var startingSession = false

    // Chat
    @Published var currentSession: AgentSessionSummary?
    @Published var blocks: [ChatBlock] = []
    @Published var queuedMessages: [String] = []
    @Published var isRunning = false
    @Published var statusLine = ""
    @Published var socketConnected = false
    @Published var reconnecting = false
    @Published var contextUsage: (used: Int, size: Int)?
    @Published var scrollTick = 0

    // Environment offers
    @Published var pendingOffer: EnvironmentOffer?
    @Published var offerSkills: [SkillPreview] = []
    @Published var offerLoading = false
    @Published var offerError = ""

    // Location → place environment provider
    let placeStore = PlaceStore()
    let locationProvider = LocationProvider()
    @Published var placeEnvironmentId: String?
    @Published var currentPlaceName: String?

    // Voice
    private let voice = VoiceController()
    @Published var voiceAuthorized = false
    @Published var voiceListening = false
    @Published var voiceSpeaking = false
    @Published var voicePartial = ""
    private var voiceModeEnabled = false   // speak the reply when the prompt came by voice
    private var spokenTurnBuffer = ""

    // Server address (configurable for a physical device on the LAN; the
    // simulator reaches the Mac's localhost directly).
    @Published var baseURLString: String

    private(set) var api: AgentStationAPI
    private let socket = AcpSocket()
    private var healthTimer: Timer?
    private var blockCounter = 0
    private var enteredEnvironments: Set<String> = []
    private var autoResumeAttempted = false
    private var reconnectTask: Task<Void, Never>?
    private var userCancelledRun = false

    init() {
        let stored = UserDefaults.standard.string(forKey: "RookServerBaseURL")
        let urlString = stored?.isEmpty == false ? stored! : "http://127.0.0.1:3000"
        baseURLString = urlString
        api = AgentStationAPI(baseURL: URL(string: urlString) ?? URL(string: "http://127.0.0.1:3000")!)

        socket.onEvent = { [weak self] event in
            self?.handleSocketEvent(event)
        }
        socket.onConnectionChange = { [weak self] connected in
            self?.handleSocketConnectionChange(connected)
        }
        healthTimer = Timer.scheduledTimer(withTimeInterval: 4, repeats: true) { [weak self] _ in
            Task { @MainActor in
                await self?.refreshHealth()
            }
        }
        locationProvider.onRegionChange = { [weak self] place in
            self?.handlePlace(place)
        }
        locationProvider.updateMonitoredPlaces(placeStore.places)
        setupVoice()
        Task {
            await refreshHealth()
        }
    }

    // MARK: - Voice

    private func setupVoice() {
        voiceAuthorized = voice.authorized()
        voice.onTranscript = { [weak self] text in
            guard let self else { return }
            self.voicePartial = ""
            self.voiceModeEnabled = true   // spoke the prompt → speak the reply
            self.send(text)
        }
        voice.onListeningChanged = { [weak self] listening in
            self?.voiceListening = listening
            if !listening { self?.voicePartial = "" }
        }
        voice.onSpeakingChanged = { [weak self] speaking in
            self?.voiceSpeaking = speaking
        }
        voice.onPartial = { [weak self] partial in
            self?.voicePartial = partial
        }
        voice.onError = { [weak self] message in
            self?.voicePartial = ""
            self?.appendBlock(.system(text: "Voice: \(message)"))
        }
    }

    func toggleVoiceListening() {
        if !voice.authorized() {
            voice.requestPermissions { [weak self] granted in
                self?.voiceAuthorized = granted
                if granted {
                    self?.voice.startListening()
                } else {
                    self?.appendBlock(.system(text: "Voice needs Microphone + Speech Recognition permission (Settings → Rook)."))
                }
            }
            return
        }
        voice.toggleListening()
    }

    func stopSpeaking() {
        voice.stopSpeaking()
    }

    /// Typed messages should not be spoken back.
    func sendTyped(_ text: String) {
        voiceModeEnabled = false
        send(text)
    }

    // MARK: - Location → place environment

    func enableLocation() {
        locationProvider.requestAuthorization()
        refreshMonitoredPlaces()
    }

    func refreshMonitoredPlaces() {
        locationProvider.updateMonitoredPlaces(placeStore.places)
    }

    /// Mirrors `AgentStationModel.handleForegroundApp`: diff the current place
    /// against the registered environment, unavailable the old, register the new
    /// (only if the server has skills for it — the iOS analog of the Mac's
    /// on-disk skill-bundle guard, done via the preview endpoint).
    private func handlePlace(_ place: Place?) {
        currentPlaceName = place?.name
        let envId = place.map { "place:\($0.id)" }
        guard envId != placeEnvironmentId else {
            return
        }
        let previous = placeEnvironmentId
        placeEnvironmentId = envId
        Task {
            if let previous {
                try? await api.markEnvironmentUnavailable(id: previous)
            }
            guard let place, let envId else {
                return
            }
            let skills = (try? await api.skillPreviews(environmentId: envId)) ?? []
            guard !skills.isEmpty else {
                // No skills defined for this place — don't raise an empty offer.
                if placeEnvironmentId == envId {
                    placeEnvironmentId = nil
                }
                return
            }
            let metadata: [String: JSONValue] = [
                "slug": .string(place.id),
                "latitude": .number(place.latitude),
                "longitude": .number(place.longitude),
            ]
            try? await api.registerEnvironment(id: envId, sourceName: place.name, metadata: metadata)
        }
    }

    private func reannouncePlaceEnvironment() {
        guard let envId = placeEnvironmentId, let place = locationProvider.current else {
            return
        }
        Task {
            let metadata: [String: JSONValue] = [
                "slug": .string(place.id),
                "latitude": .number(place.latitude),
                "longitude": .number(place.longitude),
            ]
            try? await api.registerEnvironment(id: envId, sourceName: place.name, metadata: metadata)
        }
    }

    func setBaseURL(_ string: String) {
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed), url.scheme != nil else {
            return
        }
        baseURLString = trimmed
        UserDefaults.standard.set(trimmed, forKey: "RookServerBaseURL")
        api = AgentStationAPI(baseURL: url)
        socket.disconnect()
        currentSession = nil
        Task { await refreshHealth() }
    }

    // MARK: - Server lifecycle

    func refreshHealth() async {
        let healthy = await api.health()
        if healthy {
            let wasOnline = serverState == .online
            serverState = .online
            if !wasOnline {
                await loadAgents()
                reannouncePlaceEnvironment()
                await autoResumeRecentSessionIfNeeded()
            }
        } else {
            serverState = .offline
        }
    }

    var serverStatusLabel: String {
        switch serverState {
        case .online: return isRunning ? "working" : "online"
        case .offline: return "offline"
        case .unknown: return "checking…"
        }
    }

    var serverStatusTint: Color {
        switch serverState {
        case .online: return PanelPalette.success
        case .offline: return PanelPalette.danger
        case .unknown: return PanelPalette.secondaryText
        }
    }

    // MARK: - Agents & sessions

    func loadAgents() async {
        do {
            agents = try await api.agents()
            agentsError = ""
        } catch {
            agentsError = error.localizedDescription
        }
    }

    /// Roots first, profile children directly after their parent, with indent depth.
    var agentTree: [(agent: AgentDefinition, depth: Int)] {
        let roots = agents.filter { $0.parentId == nil }
        var result: [(AgentDefinition, Int)] = []
        func append(_ agent: AgentDefinition, depth: Int) {
            result.append((agent, depth))
            for child in agents where child.parentId == agent.id {
                append(child, depth: depth + 1)
            }
        }
        for root in roots {
            append(root, depth: 0)
        }
        for agent in agents where !result.contains(where: { $0.0.id == agent.id }) {
            result.append((agent, 0))
        }
        return result
    }

    private func autoResumeRecentSessionIfNeeded() async {
        guard !autoResumeAttempted, currentSession == nil else {
            return
        }
        autoResumeAttempted = true
        guard let recent = try? await api.recentSession() else {
            return
        }
        await resumeSession(recent)
    }

    func loadSessions(agentId: String) async {
        sessionsLoading = true
        defer {
            sessionsLoading = false
        }
        do {
            sessions = try await api.sessions(agent: agentId)
            sessionsError = ""
        } catch {
            sessionsError = error.localizedDescription
        }
    }

    func startNewSession(agentId: String, name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        startingSession = true
        Task {
            defer { startingSession = false }
            do {
                let session = try await api.startSession(agent: agentId, sessionName: trimmed.isEmpty ? nil : trimmed)
                enterChat(session: session, resumed: false)
            } catch {
                sessionsError = error.localizedDescription
            }
        }
    }

    func resumeSession(_ session: AgentSessionSummary) {
        startingSession = true
        Task {
            defer { startingSession = false }
            await resumeSession(session)
        }
    }

    private func resumeSession(_ session: AgentSessionSummary) async {
        do {
            let started = try await api.resumeSession(session)
            enterChat(session: started, resumed: true)
        } catch {
            sessionsError = error.localizedDescription
        }
    }

    private func enterChat(session: AgentSessionSummary, resumed: Bool) {
        reconnectTask?.cancel()
        currentSession = session
        blocks = []
        queuedMessages = []
        isRunning = false
        statusLine = ""
        contextUsage = nil
        enteredEnvironments = []
        if resumed {
            appendBlock(.system(text: "Resumed session — earlier messages aren't replayed."))
        }
        socket.connect(sessionId: session.id, webSocketURL: api.webSocketURL)
    }

    func leaveChat() {
        socket.disconnect()
        reconnectTask?.cancel()
        currentSession = nil
    }

    // MARK: - Chat

    func send(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, currentSession != nil else {
            return
        }
        if isRunning || !socket.isConnected {
            queuedMessages.append(trimmed)
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
        voice.stopSpeaking()
        spokenTurnBuffer = ""
        socket.sendCancel()
    }

    func removeQueuedMessage(at index: Int) {
        guard queuedMessages.indices.contains(index) else {
            return
        }
        queuedMessages.remove(at: index)
    }

    private func deliver(_ text: String) {
        finalizeStreamingBlocks()
        appendBlock(.user(text: text))
        isRunning = true
        statusLine = "Agent is working…"
        spokenTurnBuffer = ""
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
            deliver(next)
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
                _ = try? await api.resumeSession(session)
                guard !Task.isCancelled else {
                    return
                }
                socket.connect(sessionId: session.id, webSocketURL: api.webSocketURL)
                reconnecting = false
                deliverNextQueuedIfIdle()
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

    // MARK: - Event reduction

    private func handleSocketEvent(_ event: AcpClientEvent) {
        switch event {
        case .agentMessageChunk(let text):
            statusLine = "Responding…"
            appendStreamingText(text, isThinking: false)
            if voiceModeEnabled {
                spokenTurnBuffer += text
            }
        case .agentThoughtChunk(let text):
            statusLine = "Thinking…"
            appendStreamingText(text, isThinking: true)
        case .toolCallStarted(let toolCallId, let title, let kind, let status, let rawInput):
            statusLine = "Using tool: \(title)"
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
            updateTool(toolCallId) { tool in
                if let toolName, tool.title.isEmpty {
                    tool.title = toolName
                }
                switch status {
                case "pending": tool.status = .pending
                case "in_progress":
                    tool.status = .running
                    if let output { tool.output = output }
                case "completed":
                    tool.status = .completed
                    if let output { tool.output = output }
                case "failed":
                    tool.status = .failed
                    if let output { tool.output = output }
                case "cancelled": tool.status = .cancelled
                default: break
                }
            }
        case .toolInputDelta(let toolCallId, _, let delta):
            updateTool(toolCallId) { tool in
                tool.status = .inputStreaming
                tool.arguments += delta
            }
        case .toolCallReady(let toolCallId, _):
            updateTool(toolCallId) { tool in
                tool.status = .ready
            }
        case .toolOutputDelta(let toolCallId, _, let delta):
            updateTool(toolCallId) { tool in
                tool.status = .running
                tool.output += delta
            }
        case .planUpdate(let entries):
            upsertPlanBlock(entries)
        case .usageUpdate(let used, let size):
            contextUsage = (used, size)
        case .runCompleted:
            finalizeStreamingBlocks()
            isRunning = false
            statusLine = ""
            userCancelledRun = false
            if voiceModeEnabled, !spokenTurnBuffer.isEmpty {
                voice.speak(spokenTurnBuffer)
            }
            spokenTurnBuffer = ""
            deliverNextQueuedIfIdle()
        case .runFailed(let message):
            finalizeStreamingBlocks()
            isRunning = false
            statusLine = ""
            spokenTurnBuffer = ""
            if userCancelledRun {
                userCancelledRun = false
                appendBlock(.system(text: "Stopped."))
            } else {
                appendErrorBlock(source: "run", message: message)
            }
            deliverNextQueuedIfIdle()
        case .protocolError(let message):
            appendErrorBlock(source: "protocol", message: message)
        case .connectionError(let message):
            appendErrorBlock(source: "connection", message: message)
        case .environmentOffered(let offer):
            handleEnvironmentOffered(offer)
        case .environmentOfferResolved(let environmentId):
            handleEnvironmentOfferResolved(environmentId)
        case .environmentEntered(let environmentId):
            if enteredEnvironments.insert(environmentId).inserted {
                appendBlock(.system(text: "Entered environment \(environmentId) — skills loaded."))
            }
        case .environmentExited(let environmentId, let error):
            if enteredEnvironments.remove(environmentId) != nil {
                let suffix = error.map { " (\($0))" } ?? ""
                appendBlock(.system(text: "Exited environment \(environmentId)\(suffix)."))
            }
        }
        scrollTick += 1
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

    private func appendStreamingText(_ text: String, isThinking: Bool) {
        if let last = blocks.indices.last {
            switch blocks[last].kind {
            case .assistantText(let existing, true) where !isThinking:
                blocks[last].kind = .assistantText(text: existing + text, streaming: true)
                return
            case .thinking(let existing, true) where isThinking:
                blocks[last].kind = .thinking(text: existing + text, streaming: true)
                return
            default:
                break
            }
        }
        if isThinking {
            appendBlock(.thinking(text: text, streaming: true))
        } else {
            appendBlock(.assistantText(text: text, streaming: true))
        }
    }

    private func finalizeStreamingBlocks() {
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

    private func updateTool(_ toolCallId: String, _ mutate: (inout ToolBlockState) -> Void) {
        for index in blocks.indices.reversed() {
            if case .tool(var state) = blocks[index].kind, state.toolCallId == toolCallId {
                mutate(&state)
                blocks[index].kind = .tool(state)
                return
            }
        }
        var state = ToolBlockState(toolCallId: toolCallId, title: "Tool", kindLabel: "", status: .running, arguments: "", output: "")
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

    // MARK: - Environment offers

    private func handleEnvironmentOffered(_ offer: EnvironmentOffer) {
        guard pendingOffer?.environmentId != offer.environmentId else {
            return
        }
        pendingOffer = offer
        offerSkills = []
        offerError = ""
        offerLoading = true
        Task {
            do {
                offerSkills = try await api.skillPreviews(environmentId: offer.environmentId)
            } catch {
                offerError = error.localizedDescription
            }
            offerLoading = false
        }
    }

    private func handleEnvironmentOfferResolved(_ environmentId: String) {
        guard pendingOffer?.environmentId == environmentId else {
            return
        }
        clearOffer()
    }

    func decideEnvironment(_ decision: String) {
        guard let offer = pendingOffer else {
            return
        }
        Task {
            do {
                try await api.decideEnvironment(environmentId: offer.environmentId, decision: decision)
                if decision == "accept" || decision == "approve" {
                    appendBlock(.system(text: "Environment \(offer.environmentId) allowed — agent reloads its skills when idle."))
                }
            } catch {
                offerError = error.localizedDescription
                return
            }
            clearOffer()
        }
    }

    func clearOffer() {
        pendingOffer = nil
        offerSkills = []
        offerError = ""
    }
}
