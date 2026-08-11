import ActivityKit
import Foundation
import RookKit
import SwiftUI

enum ServerState: Equatable {
    case unknown
    case offline
    case unauthorized
    case online
}

/// iOS view-model: the portable chat/session/offer core of the macOS
/// `RookMacModel`, with macOS-only services dropped. Location (Phase B),
/// voice (Phase C), and Live Activity (Phase D) attach here later.
@MainActor
final class RookModel: ObservableObject {
    private static let logger = RookLog.app

    // Server / control plane
    @Published var serverState: ServerState = .unknown
    @Published var serverDiagnostic = ""
    @Published var agents: [AgentDefinition] = []
    @Published var agentsError = ""

    // Session selection
    @Published var selectedAgentId: String?
    @Published var sessions: [AgentSessionSummary] = []
    @Published var sessionsLoading = false
    @Published var sessionsError = ""
    @Published var startingSession = false

    // Chat
    @Published var currentSession: AgentSessionSummary?
    // Whether the chat screen is actually presented. A session can be live
    // (auto-resumed/warmed) without the chat being on screen — that lands the
    // user on the agent list with a "Resume chat" affordance, like the Mac.
    @Published var chatVisible = false
    @Published var blocks: [ChatBlock] = []
    @Published var queuedMessages: [QueuedChatMessage] = []
    @Published var isRunning = false
    @Published var statusLine = ""
    @Published var socketConnected = false
    @Published var reconnecting = false
    @Published var contextUsage: (used: Int, size: Int)?
    @Published var scrollTick = 0

    // Environment offers
    @Published var pendingOffer: EnvironmentOffer?
    @Published var offerBundles: [EnvironmentBundlePreview] = []
    @Published var offerLoading = false
    @Published var offerError = ""

    // Environment join/leave
    @Published var environmentListItems: [EnvironmentListItem] = []
    @Published var environmentsLoading = false
    @Published var environmentsError = ""
    @Published var showEnvironments = false

    // Location → place environment provider
    let placeStore = PlaceStore()
    let locationProvider = LocationProvider()
    @Published var placeEnvironmentId: String?
    @Published var currentPlaceName: String?
    // slug → whether the server has a matching skill bundle (nil = not yet checked).
    // Surfaces slug↔bundle mismatches in the Places screen.
    @Published var placeSkillStatus: [String: Bool] = [:]
    // Candidate location: environments returned by the server for the current arrival
    // (issue #42, phase 1). Return-only: surfaced, not auto-registered.
    @Published var nearbyCandidates: [EnvironmentCandidate] = []

    // Voice
    private let voice = VoiceController()
    @Published var voiceAuthorized = false
    @Published var voiceListening = false
    @Published var voiceSpeaking = false
    @Published var voicePartial = ""
    private var voiceModeEnabled = false   // speak the reply when the prompt came by voice
    private var spokenTurnBuffer = ""

    // Live Activity (Dynamic Island)
    private var liveActivity: Activity<RookActivityAttributes>?

    // Server address + optional bearer token. The simulator usually reaches the
    // local Mac directly; a physical device often uses a remote-reachable URL.
    @Published var baseURLString: String
    @Published var authTokenString: String

    private(set) var api: RookAPI
    private var handles: [String: SessionHandle] = [:]
    private var healthTimer: Timer?
    private var environmentListAutoRefreshTask: Task<Void, Never>?
    private var autoResumeAttempted = false
    private var blockCounter = 0
    private var enteredEnvironments: Set<String> = []

    init() {
        let env = ProcessInfo.processInfo.environment["ROOK_SERVER_BASE_URL"]?.trimmingCharacters(in: .whitespacesAndNewlines)
        let stored = UserDefaults.standard.string(forKey: "RookServerBaseURL")
        let urlString: String
        if let env, !env.isEmpty {
            urlString = env
            if stored != env {
                UserDefaults.standard.set(env, forKey: "RookServerBaseURL")
            }
        } else if let stored, !stored.isEmpty {
            urlString = stored
        } else {
            urlString = "http://127.0.0.1:7665"
        }
        let envToken = ProcessInfo.processInfo.environment["ROOK_AUTH_TOKEN"]?.trimmingCharacters(in: .whitespacesAndNewlines)
        let keychainToken = KeychainStore.string(for: "RookAuthToken")?.trimmingCharacters(in: .whitespacesAndNewlines)
        let storedToken = keychainToken?.isEmpty == false ? keychainToken : nil
        let authToken = (envToken?.isEmpty == false ? envToken : storedToken) ?? ""
        if let tokenToPersist = (envToken?.isEmpty == false ? envToken : storedToken), !tokenToPersist.isEmpty {
            KeychainStore.setString(tokenToPersist, for: "RookAuthToken")
        }
        let finalURL = URL(string: urlString) ?? URL(string: "http://127.0.0.1:7665")!
        baseURLString = urlString
        authTokenString = authToken
        api = RookAPI(
            baseURL: finalURL,
            authToken: authToken
        )
        Self.logger.info("iphone model init baseURL=\(urlString, privacy: .public)")

        healthTimer = Timer.scheduledTimer(withTimeInterval: 4, repeats: true) { [weak self] _ in
            Task { @MainActor in
                await self?.refreshHealth()
            }
        }
        locationProvider.onRegionChange = { [weak self] place in
            self?.handlePlace(place)
        }
        locationProvider.onVisitArrival = { [weak self] coord in
            self?.placeStore.recordVisit(latitude: coord.latitude, longitude: coord.longitude)
        }
        locationProvider.onArrival = { [weak self] context in
            self?.identifyEnvironments(at: context)
        }
        locationProvider.updateMonitoredPlaces(placeStore.places)
        if locationProvider.isAuthorized {
            locationProvider.startMonitoringVisits()
        }
        setupVoice()
        Task {
            await refreshHealth()
        }
        #if DEBUG
        // E2E hook: ROOK_SIMULATE_ARRIVAL="lat,lon" fires identify once the server is online
        // (CLVisit can't fire in the Simulator). Pass via SIMCTL_CHILD_ROOK_SIMULATE_ARRIVAL.
        if let raw = ProcessInfo.processInfo.environment["ROOK_SIMULATE_ARRIVAL"] {
            let parts = raw.split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
            if parts.count == 2 {
                Task { [weak self] in
                    for _ in 0..<30 where self?.serverState != .online {
                        try? await Task.sleep(nanoseconds: 500_000_000)
                        await self?.refreshHealth()
                    }
                    self?.locationProvider.simulateArrival(latitude: parts[0], longitude: parts[1])
                }
            }
        }
        #endif
    }

    // MARK: - Voice

    private func setupVoice() {
        voiceAuthorized = voice.authorized()
        voice.onTranscript = { [weak self] text in
            guard let self else { return }
            Self.logger.info("voice transcript received chars=\(text.count, privacy: .public)")
            self.voicePartial = ""
            self.voiceModeEnabled = true   // spoke the prompt → speak the reply
            self.send(text)
        }
        voice.onListeningChanged = { [weak self] listening in
            Self.logger.info("voice listening changed listening=\(listening, privacy: .public)")
            self?.voiceListening = listening
            if !listening { self?.voicePartial = "" }
        }
        voice.onSpeakingChanged = { [weak self] speaking in
            Self.logger.info("voice speaking changed speaking=\(speaking, privacy: .public)")
            self?.voiceSpeaking = speaking
        }
        voice.onPartial = { [weak self] partial in
            self?.voicePartial = partial
        }
        voice.onError = { [weak self] message in
            Self.logger.error("voice error message=\(message, privacy: .public)")
            self?.voicePartial = ""
            self?.appendBlock(.system(text: "Voice: \(message)"))
        }
    }

    func toggleVoiceListening() {
        Self.logger.info("toggle voice listening authorized=\(self.voice.authorized(), privacy: .public)")
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

    /// Best installed voice name (for the Settings screen).
    var voiceName: String { VoiceController.preferredVoiceName() }

    /// Request mic + speech permission without starting a listen (used by Settings).
    func requestVoicePermission() {
        Self.logger.info("request voice permission")
        voice.requestPermissions { [weak self] granted in
            Self.logger.info("voice permission result granted=\(granted, privacy: .public)")
            self?.voiceAuthorized = granted
        }
    }

    // MARK: - Live Activity (Dynamic Island)

    /// Start the activity when a session is active; update it on meaningful
    /// transitions (place, agent status). `Activity.request` is foreground-only,
    /// so this is called from the running app; APNs-driven updates while away
    /// are a post-MVP addition.
    func updateLiveActivity() {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            return
        }
        // Show the activity for an active chat OR an ambient place-with-skills —
        // arriving at a place loads skills even with no chat open, and the card is
        // exactly that "where am I / what's loaded" surface. End it when neither.
        guard currentSession != nil || placeEnvironmentId != nil else {
            endLiveActivity()
            return
        }
        let state = RookActivityAttributes.ContentState(
            placeName: currentPlaceName,
            skillsActive: placeEnvironmentId != nil,
            agentStatus: isRunning ? (statusLine.isEmpty ? "Working…" : statusLine) : "Idle",
            running: isRunning
        )
        if let activity = liveActivity {
            Task { await activity.update(ActivityContent(state: state, staleDate: nil)) }
        } else {
            // Activity.request only succeeds in the foreground; a background
            // arrival no-ops here and starts on next foreground (handleBecameActive).
            let attributes = RookActivityAttributes(agentName: currentSession?.agent ?? "Rook")
            liveActivity = try? Activity.request(attributes: attributes, content: ActivityContent(state: state, staleDate: nil))
        }
    }

    func endLiveActivity() {
        let activity = liveActivity
        liveActivity = nil
        Task { await activity?.end(nil, dismissalPolicy: .immediate) }
    }

    /// Typed messages should not be spoken back.
    func sendTyped(_ text: String) {
        voiceModeEnabled = false
        send(text)
    }

    // MARK: - Location → place environment

    func enableLocation() {
        Self.logger.info("enable location requested")
        locationProvider.requestAuthorization()
        refreshMonitoredPlaces()
        locationProvider.startMonitoringVisits()
    }

    func refreshMonitoredPlaces() {
        locationProvider.updateMonitoredPlaces(placeStore.places)
    }

    /// Pre-check each place against the server so the Places screen can show
    /// whether matching location capabilities exist before you physically arrive.
    func refreshPlaceSkillStatus() {
        guard serverState == .online else {
            Self.logger.info("refresh place skill status skipped serverState=\(String(describing: self.serverState), privacy: .public)")
            return
        }
        Task {
            let timed = RookPerformance.begin(
                "iPhoneRefreshPlaceSkillStatus",
                operation: "iphone-refresh-place-skill-status",
                description: "places=\(placeStore.places.count)",
                logger: Self.logger,
                signposter: RookLog.locationSignposter
            )
            var status: [String: Bool] = [:]
            for place in placeStore.places {
                let preview = try? await api.environmentPreview(environmentId: "location:\(place.id)")
                status[place.id] = !(preview?.bundles.isEmpty ?? true)
            }
            placeSkillStatus = status
            timed.finish(details: "statuses=\(status.count)")
        }
    }

    /// Ask the server which `location:` environments are likely available at an
    /// arrival that passed the dwell/motion gate. Identification only — the
    /// candidates are surfaced, not auto-registered (issue #42, phase 1).
    private func identifyEnvironments(at context: ArrivalContext) {
        guard serverState == .online else {
            Self.logger.info("identify environments skipped serverState=\(String(describing: self.serverState), privacy: .public)")
            return
        }
        Self.logger.info("identify environments latitude=\(context.coordinate.latitude, privacy: .public) longitude=\(context.coordinate.longitude, privacy: .public) dwellSeconds=\(context.dwellSeconds ?? -1, privacy: .public)")
        let observedAt = ISO8601DateFormatter().string(from: Date())
        let request = IdentifyAvailableRequest(
            latitude: context.coordinate.latitude,
            longitude: context.coordinate.longitude,
            horizontalAccuracy: context.horizontalAccuracy,
            source: "visit",
            dwellSeconds: context.dwellSeconds,
            isStationary: context.isStationary,
            speedMetersPerSecond: context.speedMetersPerSecond,
            observedAt: observedAt
        )
        Task {
            let timed = RookPerformance.begin(
                "iPhoneIdentifyEnvironments",
                operation: "iphone-identify-environments",
                logger: Self.logger,
                signposter: RookLog.locationSignposter
            )
            // Dwell/arrival is an auto-commit: register the identified set with the agent.
            guard let candidates = try? await api.registerLocation(request) else {
                timed.finish(details: "candidates=0 request-failed")
                return
            }
            nearbyCandidates = candidates
            guard let top = candidates.first else {
                timed.finish(details: "candidates=0")
                return
            }
            timed.finish(details: "candidates=\(candidates.count) top=\(top.environmentId)")
            let others = candidates.count > 1 ? " (+\(candidates.count - 1) more)" : ""
            appendBlock(.system(text: "You appear to be near \(top.displayName)\(others). Found \(candidates.count) nearby environment\(candidates.count == 1 ? "" : "s")."))
        }
    }

    /// Mirrors `RookMacModel.handleForegroundApp`: diff the current place
    /// against the registered environment and register the new one
    /// (only if the server has skills for it — the iOS analog of the Mac's
    /// on-disk skill-bundle guard, done via the preview endpoint).
    private func handlePlace(_ place: Place?) {
        Self.logger.info("handle place place=\(place?.id ?? "(none)", privacy: .public)")
        currentPlaceName = place?.name
        let envId = place.map { "location:\($0.id)" }
        guard envId != placeEnvironmentId else {
            return
        }
        placeEnvironmentId = envId
        updateLiveActivity()
        Task {
            guard let place, let envId else {
                return
            }
            let timed = RookPerformance.begin(
                "iPhoneHandlePlace",
                operation: "iphone-handle-place",
                description: envId,
                logger: Self.logger,
                signposter: RookLog.locationSignposter
            )
            let preview = try? await api.environmentPreview(environmentId: envId)
            guard let preview, !preview.bundles.isEmpty else {
                timed.finish(details: "bundles=0")
                Self.logger.info("place preview empty envId=\(envId, privacy: .public)")

                // No skills defined for this place — don't raise an empty offer.
                if placeEnvironmentId == envId {
                    placeEnvironmentId = nil
                    updateLiveActivity()
                }
                return
            }
            timed.finish(details: "bundles=\(preview.bundles.count)")
            Self.logger.info("place register envId=\(envId, privacy: .public) bundles=\(preview.bundles.count, privacy: .public)")
            let metadata: [String: JSONValue] = [
                "slug": .string(place.id),
                "latitude": .number(place.latitude),
                "longitude": .number(place.longitude),
                "radiusMeters": .number(place.radius),
                "displayName": .string(place.name),
            ]
            try? await api.registerEnvironment(CandidateEnvironmentRecord(id: envId, metadata: metadata))
        }
    }

    private func reannouncePlaceEnvironment() {
        guard let envId = placeEnvironmentId, let place = locationProvider.current else {
            return
        }
        Self.logger.info("reannounce place environment envId=\(envId, privacy: .public)")
        Task {
            let metadata: [String: JSONValue] = [
                "slug": .string(place.id),
                "latitude": .number(place.latitude),
                "longitude": .number(place.longitude),
                "radiusMeters": .number(place.radius),
                "displayName": .string(place.name),
            ]
            try? await api.registerEnvironment(CandidateEnvironmentRecord(id: envId, metadata: metadata))
        }
    }

    func setServerConnection(baseURL string: String, authToken token: String) {
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed), url.scheme != nil else {
            return
        }
        let trimmedToken = token.trimmingCharacters(in: .whitespacesAndNewlines)
        baseURLString = trimmed
        authTokenString = trimmedToken
        UserDefaults.standard.set(trimmed, forKey: "RookServerBaseURL")
        if trimmedToken.isEmpty {
            KeychainStore.removeString(for: "RookAuthToken")
        } else {
            KeychainStore.setString(trimmedToken, for: "RookAuthToken")
        }
        api = RookAPI(baseURL: url, authToken: trimmedToken)
        Self.logger.info("set server connection baseURL=\(trimmed, privacy: .public) tokenPresent=\(!trimmedToken.isEmpty, privacy: .public)")
        currentHandle?.close()
        currentSession = nil
        Task { await refreshHealth() }
    }

    // MARK: - Server lifecycle

    func refreshHealth() async {
        let timed = RookPerformance.begin(
            "iPhoneRefreshHealth",
            operation: "iphone-refresh-health",
            logger: Self.logger,
            signposter: RookLog.appSignposter
        )
        switch await api.healthResult() {
        case .ok:
            let wasOnline = serverState == .online
            serverState = .online
            serverDiagnostic = ""
            if !wasOnline {
                await loadAgents()
                await loadSessions()
                reannouncePlaceEnvironment()
                await autoResumeRecentSessionIfNeeded()
            }
            timed.finish(details: "state=online")
        case .unauthorized:
            serverState = .unauthorized
            serverDiagnostic = "Authorization header was rejected."
            timed.finish(details: "state=unauthorized")
        case .httpStatus(let code):
            serverState = .offline
            serverDiagnostic = "HTTP \(code)"
            timed.finish(details: "state=offline status=\(code)")
        case .transportError(let message):
            serverState = .offline
            serverDiagnostic = message
            timed.finish(details: "state=offline transport=\(message)")
        }
    }

    var serverStatusLabel: String {
        switch serverState {
        case .online: return isRunning ? "working" : "online"
        case .offline: return "offline"
        case .unauthorized: return "unauthorized"
        case .unknown: return "checking…"
        }
    }

    var serverStatusTint: Color {
        switch serverState {
        case .online: return PanelPalette.success
        case .offline, .unauthorized: return PanelPalette.danger
        case .unknown: return PanelPalette.secondaryText
        }
    }

    // MARK: - Runtimes & sessions

    private var currentHandle: SessionHandle? {
        guard let session = currentSession else { return nil }
        return handles[session.id]
    }

    func loadAgents() async {
        let timed = RookPerformance.begin(
            "iPhoneLoadAgents",
            operation: "iphone-load-agents",
            logger: Self.logger,
            signposter: RookLog.appSignposter
        )
        do {
            agents = try await api.agents()
            agentsError = ""
            timed.finish(details: "agents=\(self.agents.count)")
        } catch {
            agentsError = error.localizedDescription
            timed.fail(error)
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
        for root in roots { append(root, depth: 0) }
        for agent in agents where !result.contains(where: { $0.0.id == agent.id }) { result.append((agent, 0)) }
        return result
    }

    private func autoResumeRecentSessionIfNeeded() async {
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

    func openAgentSessions(_ agentId: String) {}
    func closeAgentSessions() { selectedAgentId = nil }

    func loadSessions(agentId _: String = "") async {
        sessionsLoading = true
        let timed = RookPerformance.begin(
            "iPhoneLoadSessions",
            operation: "iphone-load-sessions",
            logger: Self.logger,
            signposter: RookLog.sessionSignposter
        )
        defer { sessionsLoading = false }
        do {
            sessions = try await api.sessions()
            sessionsError = ""
            timed.finish(details: "sessions=\(sessions.count)")
        } catch {
            sessionsError = error.localizedDescription
            timed.fail(error)
        }
    }

    private func replaceSessionSummary(_ summary: AgentSessionSummary) {
        guard let index = sessions.firstIndex(where: { $0.id == summary.id }) else { return }
        sessions[index] = summary
    }

    private func applyLocalSessionTitle(_ title: String, to sessionId: String) {
        let normalizedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "session" : title.trimmingCharacters(in: .whitespacesAndNewlines)
        sessions = sessions.map { existing in
            existing.id == sessionId ? existing.updating(title: normalizedTitle) : existing
        }
        if currentSession?.id == sessionId {
            currentSession = currentSession?.updating(title: normalizedTitle)
        }
    }

    func startNewSession(agentId: String, name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        Self.logger.info("iphone start new session runtime=\(agentId, privacy: .public) name=\(name, privacy: .public)")
        startingSession = true
        Task {
            defer { startingSession = false }
            do {
                let title = trimmed.isEmpty ? "session" : trimmed
                let socket = AcpSocket()
                _ = try await socket.connect(request: api.webSocketRequest())
                let sessionId = try await socket.createSession(runtimeId: agentId, title: title, cwd: FileManager.default.currentDirectoryPath)
                let now = ISO8601DateFormatter().string(from: Date())
                let session = AgentSessionSummary(raw: .object([
                    "sessionId": .string(sessionId),
                    "title": .string(title),
                    "updatedAt": .string(now),
                    "runtimeId": .string(agentId),
                    "startedAt": .string(now),
                    "running": .bool(true),
                ]))
                let handle = SessionHandle(sessionId: sessionId, api: api, socket: socket, isLoaded: true)
                handles[sessionId] = handle
                wireHandle(handle)
                currentSession = session
                syncChatState()
                selectedAgentId = nil
                chatVisible = true
                enteredEnvironments = []
                environmentListItems = []
                updateLiveActivity()
                refreshEnvironmentList()
                await loadSessions()
                if let refreshed = sessions.first(where: { $0.id == sessionId }) {
                    currentSession = refreshed
                    syncChatState()
                }
            } catch {
                sessionsError = error.localizedDescription
            }
        }
    }

    func resumeSession(_ session: AgentSessionSummary) {
        Self.logger.info("iphone resume session=\(session.id, privacy: .public) runtime=\(session.agent, privacy: .public) running=\(session.running, privacy: .public)")
        startingSession = true
        Task {
            defer { startingSession = false }
            do {
                let handle = getOrCreateHandle(for: session)
                wireHandle(handle)
                currentSession = session
                if handle.isLoaded {
                    try await handle.load()
                } else if session.running {
                    let events = try await api.sessionTranscript(sessionId: session.id)
                    try await handle.attach(transcript: events)
                } else {
                    try await handle.load()
                }
                let touched = try await api.touchSession(sessionId: session.id)
                currentSession = touched
                await loadSessions()
                if let refreshed = sessions.first(where: { $0.id == session.id }) {
                    currentSession = refreshed
                }
                selectedAgentId = nil
                chatVisible = true
                enteredEnvironments = []
                environmentListItems = []
                updateLiveActivity()
                refreshEnvironmentList()
            } catch {
                sessionsError = error.localizedDescription
            }
        }
    }

    func renameSession(_ session: AgentSessionSummary, title: String) {
        Task {
            applyLocalSessionTitle(title, to: session.id)
            do {
                let renamed = try await api.renameSession(sessionId: session.id, title: title)
                replaceSessionSummary(renamed)
                if currentSession?.id == session.id {
                    currentSession = renamed
                }
                await loadSessions()
                if currentSession?.id == session.id, let refreshed = sessions.first(where: { $0.id == session.id }) {
                    currentSession = refreshed
                }
                updateLiveActivity()
            } catch {
                sessionsError = error.localizedDescription
                await loadSessions()
                if currentSession?.id == session.id, let refreshed = sessions.first(where: { $0.id == session.id }) {
                    currentSession = refreshed
                }
            }
        }
    }

    func deleteSession(_ session: AgentSessionSummary) {
        Task {
            do {
                try await api.deleteSession(sessionId: session.id)
                handles.removeValue(forKey: session.id)?.close()
                if currentSession?.id == session.id {
                    currentSession = nil
                    chatVisible = false
                    selectedAgentId = nil
                    environmentListItems = []
                    enteredEnvironments = []
                }
                sessions.removeAll { $0.id == session.id }
                await loadSessions()
                updateLiveActivity()
            } catch {
                sessionsError = error.localizedDescription
            }
        }
    }

    func touchCurrentSession() {
        guard let session = currentSession else { return }
        Task {
            do {
                let touched = try await api.touchSession(sessionId: session.id)
                currentSession = touched
                await loadSessions()
                if let refreshed = sessions.first(where: { $0.id == session.id }) {
                    currentSession = refreshed
                }
            } catch {
                sessionsError = error.localizedDescription
            }
        }
    }

    /// Bring the (already live) current session's chat on screen — used by the
    /// "Resume chat" affordance and the Live Activity deep link.
    func openChat() {
        guard currentSession != nil else {
            return
        }
        touchCurrentSession()
        selectedAgentId = nil
        chatVisible = true
    }

    func leaveChat() {
        for handle in handles.values { handle.close() }
        handles = [:]
        currentSession = nil
        chatVisible = false
        updateLiveActivity()
    }

    private func getOrCreateHandle(for session: AgentSessionSummary) -> SessionHandle {
        if let existing = handles[session.id] { return existing }
        let handle = SessionHandle(sessionId: session.id, api: api)
        handles[session.id] = handle
        return handle
    }

    private func wireHandle(_ handle: SessionHandle) {
        handle.onStateChange = { [weak self] in self?.syncChatState() }
        handle.onAgentTextChunk = { [weak self] text in
            guard let self, self.voiceModeEnabled else { return }
            self.spokenTurnBuffer += text
        }
        handle.onEnvironmentOffered = { [weak self] offer in
            self?.pendingOffer = offer
            self?.offerBundles = []
            self?.offerError = ""
            self?.offerLoading = false
        }
        handle.onEnvironmentOfferResolved = { [weak self] _, _ in
            self?.pendingOffer = nil
            self?.offerBundles = []
        }
        handle.onEnvironmentEntered = { [weak self] environmentId in
            self?.enteredEnvironments.insert(environmentId)
        }
        handle.onEnvironmentExited = { [weak self] environmentId, _ in
            self?.enteredEnvironments.remove(environmentId)
        }
    }

    private func syncChatState() {
        guard let handle = currentHandle else { return }
        blocks = handle.blocks
        queuedMessages = handle.queuedMessages
        isRunning = handle.isRunning
        statusLine = handle.statusLine
        socketConnected = handle.socketConnected
        reconnecting = handle.reconnecting
        if let usage = handle.contextUsage {
            contextUsage = (usage.used, usage.size)
        } else {
            contextUsage = nil
        }
        scrollTick = handle.scrollTick
    }

    // MARK: - App lifecycle (scenePhase)

    func handleBecameActive() {
        Self.logger.info("iphone became active")
        reannouncePlaceEnvironment()
        updateLiveActivity()
        Task { await refreshHealth() }
    }

    // MARK: - Chat

    func send(_ text: String) {
        Self.logger.info("iphone send currentSession=\(self.currentSession?.id ?? "(none)", privacy: .public) chars=\(text.count, privacy: .public)")
        currentHandle?.send([.text(text)])
        updateLiveActivity()
    }

    func stopAgent() {
        guard isRunning else { return }
        voice.stopSpeaking()
        spokenTurnBuffer = ""
        currentHandle?.stopAgent()
    }

    func removeQueuedMessage(at index: Int) {
        currentHandle?.removeQueuedMessage(at: index)
    }






    /// Banner label for an entered location: the business name when one match is clearly
    /// best, "Surrounding businesses" when ambiguous, or nil (generic) when unknown.
    /// Applies the client confidence heuristic for the location banner.
    func locationBannerLabel(entered: EnvironmentCandidate?, candidates: [EnvironmentCandidate]) -> String? {
        guard let top = candidates.first else { return entered?.displayName }
        let ambiguous = top.confidence < 0.7 || (candidates.count >= 2 && top.confidence - candidates[1].confidence < 0.15)
        if ambiguous { return "Surrounding businesses" }
        return entered?.displayName ?? top.displayName
    }

    /// Website URLs for the entered-business favicon row: the entered business first,
    /// then nearby candidates that have a website, deduped by host.
    func orderedUniqueWebsites(entered: EnvironmentCandidate?, all: [EnvironmentCandidate]) -> [String] {
        let ordered = ([entered].compactMap { $0 } + all.filter { $0.environmentId != entered?.environmentId })
        var seenHosts = Set<String>()
        var result: [String] = []
        for candidate in ordered {
            guard let website = candidate.website, !website.isEmpty else { continue }
            let key = URLComponents(string: website.contains("://") ? website : "https://\(website)")?.host ?? website
            if seenHosts.insert(key.lowercased()).inserted {
                result.append(website)
            }
        }
        return result
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

    func finalizeActiveTools(as finalStatus: ToolBlockStatus) {
        for index in blocks.indices {
            guard case .tool(var state) = blocks[index].kind else { continue }
            guard !state.status.isTerminal else { continue }
            state.status = finalStatus
            blocks[index].kind = .tool(state)
        }
    }

    func handleSocketEvent(_ event: AcpClientEvent) {
        switch event {
        case .toolCallStarted(let toolCallId, let title, let kind, let status, let rawInput):
            let toolStatus: ToolBlockStatus = status == "in_progress" ? .running : .pending
            let state = ToolBlockState(toolCallId: toolCallId, title: title, kindLabel: kind, status: toolStatus, arguments: rawInput ?? "", output: "")
            appendBlock(.tool(state), id: "tool-\(toolCallId)-\(blockCounter)")
        case .toolCallUpdate(let toolCallId, let status, let toolName, let output):
            updateTool(toolCallId) { tool in
                if let toolName, tool.title.isEmpty { tool.title = toolName }
                switch status {
                case "pending": tool.status = .pending
                case "in_progress": tool.status = .running; if let output { tool.output = output }
                case "completed": tool.status = .completed; if let output { tool.output = output }
                case "failed": tool.status = .failed; if let output { tool.output = output }
                case "cancelled": tool.status = .cancelled
                default: break
                }
            }
        case .toolInputSnapshot(let toolCallId, _, let text):
            updateTool(toolCallId) { tool in
                tool.status = .inputStreaming
                tool.arguments = text
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
        case .toolOutputSnapshot(let toolCallId, _, let text):
            updateTool(toolCallId) { tool in
                tool.status = .running
                tool.output = text
            }
        case .toolOutputDelta(let toolCallId, _, let delta):
            updateTool(toolCallId) { tool in
                tool.status = .running
                tool.output += delta
            }
        default:
            return
        }
    }

    private func updateTool(_ toolCallId: String, mutate: (inout ToolBlockState) -> Void) {
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

    // MARK: - Environment offers



    func decideEnvironment(_ decision: String) {
        guard let offer = pendingOffer, currentSession != nil else {
            return
        }
        Task {
            do {
                try await currentHandle?.resolveEnvironmentOffer(environmentId: offer.environmentId, bundleHash: offer.bundleHash, decision: decision)
                if decision == "accept" || decision == "approve" {
                    appendBlock(.system(text: "Bundle \(offer.bundleId) allowed for \(offer.environmentId)."))
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
        offerBundles = []
        offerError = ""
    }

    // MARK: - Environment join / leave

    func refreshEnvironmentList(showLoading: Bool = true) {
        guard let session = currentSession else {
            environmentListItems = []
            return
        }
        if showLoading && environmentListItems.isEmpty {
            environmentsLoading = true
        }
        Task {
            defer { environmentsLoading = false }
            do {
                let refreshedItems = try await api.environmentList(sessionId: session.id)
                EnvironmentListPresentation.apply(refreshedItems, to: &environmentListItems)
                environmentsError = ""
            } catch {
                environmentsError = error.localizedDescription
            }
        }
    }

    func startEnvironmentListAutoRefresh() {
        EnvironmentListPresentation.startAutoRefresh(task: &environmentListAutoRefreshTask) { [weak self] showLoading in
            self?.refreshEnvironmentList(showLoading: showLoading)
        }
    }

    func stopEnvironmentListAutoRefresh() {
        EnvironmentListPresentation.stopAutoRefresh(task: &environmentListAutoRefreshTask)
    }

    func joinEnvironment(_ environmentId: String) {
        guard let session = currentSession else { return }
        Task {
            do {
                _ = try await api.enterEnvironment(sessionId: session.id, environmentId: environmentId)
                refreshEnvironmentList()
            } catch {
                environmentsError = error.localizedDescription
            }
        }
    }

    func leaveEnvironment(_ environmentId: String) {
        guard let session = currentSession else { return }
        Task {
            do {
                _ = try await api.exitEnvironment(sessionId: session.id, environmentId: environmentId)
                refreshEnvironmentList()
            } catch {
                environmentsError = error.localizedDescription
            }
        }
    }
}
