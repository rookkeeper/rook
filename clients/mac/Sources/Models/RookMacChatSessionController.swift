import Foundation
import OSLog
import RookKit

/// Session lifecycle and registry.  One `SessionHandle` per session, each
/// with its own WebSocket.  Switching sessions changes which handle the UI
/// observes — background sessions keep running.
@MainActor
final class ChatSessionController {
    private static let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.rookery.Rook", category: "ChatSessionController")
    private static let timingLogsEnabled = ProcessInfo.processInfo.environment["ROOK_SESSION_TIMING_LOGS"] == "1"
    var onStateChange: (() -> Void)?
    var onCurrentSessionChange: ((AgentSessionSummary?) -> Void)?
    var onEnvironmentOffered: ((EnvironmentOffer) -> Void)?
    var onEnvironmentOfferResolved: ((String, String) -> Void)?
    var onEnvironmentEntered: ((String) -> Void)?
    var onEnvironmentExited: ((String, String?) -> Void)?

    private let api: RookAPI
    private var handles: [String: SessionHandle] = [:]

    // MARK: - Session list (REST, not WebSocket)
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

    private var autoResumeAttempted = false

    /// The handle for whichever session the UI is currently looking at.
    var currentHandle: SessionHandle? {
        guard let session = currentSession else { return nil }
        return handles[session.id]
    }

    // MARK: - Chat state (proxied from current handle)
    var blocks: [ChatBlock] { currentHandle?.blocks ?? [] }
    var queuedMessages: [QueuedChatMessage] { currentHandle?.queuedMessages ?? [] }
    var isRunning: Bool { currentHandle?.isRunning ?? false }
    var statusLine: String { currentHandle?.statusLine ?? "" }
    var socketConnected: Bool { currentHandle?.socketConnected ?? false }
    var supportsImagePrompts: Bool { currentHandle?.supportsImagePrompts ?? false }
    var reconnecting: Bool { currentHandle?.reconnecting ?? false }
    var contextUsage: ContextUsageState? { currentHandle?.contextUsage }
    var currentModes: AcpModesState? { currentHandle?.currentModes }
    var configOptions: [AcpConfigOption] { currentHandle?.configOptions ?? [] }
    var pendingPermission: PendingPermissionRequest? { currentHandle?.pendingPermission }
    var lastStopReason: String? { currentHandle?.lastStopReason }
    var autoScrollEnabled: Bool { currentHandle?.autoScrollEnabled ?? true }
    var scrollTick: Int { currentHandle?.scrollTick ?? 0 }

    init(api: RookAPI) {
        self.api = api
    }

    func stop() {
        for handle in handles.values { handle.close() }
        handles = [:]
    }

    func loadSessions() async {
        sessionsLoading = true
        defer { sessionsLoading = false }
        do {
            sessions = try await api.sessions()
            sessionsError = ""
        } catch {
            sessionsError = error.localizedDescription
        }
    }

    func autoResumeRecentSessionIfNeeded() async {
        guard !autoResumeAttempted, currentSession == nil else { return }
        autoResumeAttempted = true
        do {
            if sessions.isEmpty { sessions = try await api.sessions() }
            guard let recent = sessions.first else { return }
            resumeSession(recent)
        } catch {
            sessionsError = error.localizedDescription
        }
    }

    func startNewSession(agentId: String, name: String, completion: (() -> Void)? = nil) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let title = trimmed.isEmpty ? "session" : trimmed
        startingSession = true
        Task {
            defer { self.startingSession = false; completion?() }
            let startedAt = Date().timeIntervalSinceReferenceDate
            do {
                let socket = AcpSocket()
                let connectStartedAt = Date().timeIntervalSinceReferenceDate
                _ = try await socket.connect(request: api.webSocketRequest())
                Self.timingLog("connect complete", elapsedMs: Date().timeIntervalSinceReferenceDate - connectStartedAt, runtimeId: agentId)
                let createStartedAt = Date().timeIntervalSinceReferenceDate
                let sessionId = try await socket.createSession(
                    runtimeId: agentId,
                    title: title,
                    cwd: FileManager.default.currentDirectoryPath
                )
                Self.timingLog("session/new complete", elapsedMs: Date().timeIntervalSinceReferenceDate - createStartedAt, runtimeId: agentId, sessionId: sessionId)

                let summary = AgentSessionSummary(raw: .object([
                    "sessionId": .string(sessionId),
                    "title": .string(title),
                    "updatedAt": .string(ISO8601DateFormatter().string(from: Date())),
                    "running": .bool(true),
                    "_meta": .object([
                        "runtimeId": .string(agentId),
                        "startedAt": .string(ISO8601DateFormatter().string(from: Date())),
                    ]),
                ]))
                let handle = SessionHandle(sessionId: sessionId, api: api, socket: socket, isLoaded: true)
                handles[sessionId] = handle
                wireHandle(handle)
                currentSession = summary
                let refreshStartedAt = Date().timeIntervalSinceReferenceDate
                await loadSessions()
                Self.timingLog("loadSessions complete", elapsedMs: Date().timeIntervalSinceReferenceDate - refreshStartedAt, runtimeId: agentId, sessionId: sessionId)
                if let refreshed = sessions.first(where: { $0.id == sessionId }) {
                    currentSession = refreshed
                }
                Self.timingLog("startNewSession complete", elapsedMs: Date().timeIntervalSinceReferenceDate - startedAt, runtimeId: agentId, sessionId: sessionId)
            } catch {
                Self.timingLog("startNewSession failed", elapsedMs: Date().timeIntervalSinceReferenceDate - startedAt, runtimeId: agentId, error: error.localizedDescription)
                sessionsError = error.localizedDescription
            }
        }
    }

    func resumeSession(_ session: AgentSessionSummary, completion: (() -> Void)? = nil) {
        startingSession = true
        Task {
            defer { self.startingSession = false; completion?() }
            do {
                let handle = getOrCreateHandle(for: session)
                currentSession = session
                wireHandle(handle)
                if handle.isLoaded {
                    try await handle.load()
                } else if session.running {
                    let events = try await api.sessionTranscript(sessionId: session.id)
                    try await handle.attach(transcript: events)
                } else {
                    try await handle.load()
                }
            } catch {
                sessionsError = error.localizedDescription
            }
        }
    }

    func send(_ content: [ChatPromptContent]) { currentHandle?.send(content) }
    func stopAgent() { currentHandle?.stopAgent() }
    func removeQueuedMessage(at index: Int) { currentHandle?.removeQueuedMessage(at: index) }
    func beginEditingQueuedMessage(_ id: String) { currentHandle?.beginEditingQueuedMessage(id) }
    func updateQueuedMessageDraft(_ id: String, text: String) { currentHandle?.updateQueuedMessageDraft(id, text: text) }
    func cancelEditingQueuedMessage(_ id: String) { currentHandle?.cancelEditingQueuedMessage(id) }
    func saveQueuedMessageEdit(_ id: String) { currentHandle?.saveQueuedMessageEdit(id) }
    func decidePermission(optionId: String?) { currentHandle?.decidePermission(optionId: optionId) }
    func setMode(_ modeId: String) { currentHandle?.setMode(modeId) }
    func setConfigOption(_ configId: String, value: String) { currentHandle?.setConfigOption(configId, value: value) }
    func resolveEnvironmentOffer(environmentId: String, bundleHash: String, decision: String) async throws {
        try await currentHandle?.resolveEnvironmentOffer(environmentId: environmentId, bundleHash: bundleHash, decision: decision)
    }
    func refreshForCurrentSessionReset() { currentHandle?.refreshForCurrentSessionReset() }
    func resumeAutoScroll() { currentHandle?.resumeAutoScroll() }
    func pauseAutoScroll() { currentHandle?.pauseAutoScroll() }
    func appendSystemMessage(_ text: String) { currentHandle?.appendSystemMessage(text) }

    // MARK: - Private

    private func getOrCreateHandle(for session: AgentSessionSummary) -> SessionHandle {
        if let existing = handles[session.id] { return existing }
        let handle = SessionHandle(sessionId: session.id, api: api, supportsImagePrompts: session.supportsImagePrompts)
        handles[session.id] = handle
        return handle
    }

    private func wireHandle(_ handle: SessionHandle) {
        handle.onStateChange = { [weak self] in self?.onStateChange?() }
        handle.onEnvironmentOffered = { [weak self] in self?.onEnvironmentOffered?($0) }
        handle.onEnvironmentOfferResolved = { [weak self] in self?.onEnvironmentOfferResolved?($0, $1) }
        handle.onEnvironmentEntered = { [weak self] in self?.onEnvironmentEntered?($0) }
        handle.onEnvironmentExited = { [weak self] in self?.onEnvironmentExited?($0, $1) }
    }

    private static func timingLog(_ message: String, elapsedMs: CFTimeInterval, runtimeId: String, sessionId: String? = nil, error: String? = nil) {
        guard timingLogsEnabled else { return }
        let rounded = (elapsedMs * 1000).rounded() / 1000
        if let sessionId, let error {
            logger.info("timing \(message, privacy: .public) runtime=\(runtimeId, privacy: .public) session=\(sessionId, privacy: .public) elapsedMs=\(rounded, privacy: .public) error=\(error, privacy: .public)")
        } else if let sessionId {
            logger.info("timing \(message, privacy: .public) runtime=\(runtimeId, privacy: .public) session=\(sessionId, privacy: .public) elapsedMs=\(rounded, privacy: .public)")
        } else if let error {
            logger.info("timing \(message, privacy: .public) runtime=\(runtimeId, privacy: .public) elapsedMs=\(rounded, privacy: .public) error=\(error, privacy: .public)")
        } else {
            logger.info("timing \(message, privacy: .public) runtime=\(runtimeId, privacy: .public) elapsedMs=\(rounded, privacy: .public)")
        }
    }
}
