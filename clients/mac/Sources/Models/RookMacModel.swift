import AppKit
import Foundation
import RookKit
import SwiftUI

enum PanelMode: Equatable {
    case home
    case sessions(agentId: String)
    case chat
    case environmentOffer
    case capabilities
    case environments
}

enum ServerState: Equatable {
    case unknown
    case offline
    case starting
    case online
}

struct QueuedChatMessage: Identifiable, Equatable {
    let id: String
    var text: String
    var draftText: String
    var isEditing = false
}

struct PendingPermissionRequest: Equatable {
    var requestId: String
    var toolCall: AcpPermissionToolCall
    var options: [AcpPermissionOption]
}

struct ContextUsageState: Equatable {
    var used: Int
    var size: Int
    var cost: AcpUsageCost?
}

@MainActor
final class RookMacModel: ObservableObject {
    static weak var shared: RookMacModel?

    @Published var panelMode: PanelMode = .home

    // Server / control plane
    @Published var serverState: ServerState = .unknown
    @Published var managedServerRunning = false
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
    @Published var queuedMessages: [QueuedChatMessage] = []
    @Published var isRunning = false
    @Published var statusLine = ""
    @Published var socketConnected = false
    @Published var reconnecting = false
    @Published var contextUsage: ContextUsageState?
    @Published var currentModes: AcpModesState?
    @Published var configOptions: [AcpConfigOption] = []
    @Published var pendingPermission: PendingPermissionRequest?
    @Published var lastStopReason: String?
    @Published var autoScrollEnabled = true
    @Published var scrollTick = 0

    // Environment offers
    @Published var pendingOffers: [EnvironmentOffer] = []
    @Published var offerBundles: [EnvironmentBundlePreview] = []
    @Published var offerLoading = false
    @Published var offerError = ""

    // Environment join/leave
    @Published var environmentListItems: [EnvironmentListItem] = []
    @Published var enteredEnvironmentIds: Set<String> = []
    @Published var environmentsLoading = false
    @Published var environmentsError = ""

    var pendingOffer: EnvironmentOffer? { pendingOffers.first }
    var pendingOfferCount: Int { pendingOffers.count }

    // Foreground-app environment provider
    @Published var foregroundEnvironmentId: String?
    @Published var foregroundSiteEnvironmentId: String?
    @Published var foregroundAppName: String?
    @Published var foregroundWindowTitle: String?
    @Published var baseURLString: String
    @Published var authTokenString: String

    private(set) var api: RookAPI

    private let serverStateController: ServerStateController
    private let chatSessionController: ChatSessionController
    private let appEnvironmentProvider: AppEnvironmentProvider
    private let environmentOfferController: EnvironmentOfferController
    private let environmentListController: EnvironmentListController

    init(environmentFocusDelay: TimeInterval = 5) {
        let envBaseURL = ProcessInfo.processInfo.environment["ROOK_SERVER_BASE_URL"]?.trimmingCharacters(in: .whitespacesAndNewlines)
        let storedBaseURL = UserDefaults.standard.string(forKey: "RookServerBaseURL")?.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedBaseURL = (envBaseURL?.isEmpty == false ? envBaseURL : storedBaseURL) ?? "http://127.0.0.1:7665"
        if let envBaseURL, !envBaseURL.isEmpty, storedBaseURL != envBaseURL {
            UserDefaults.standard.set(envBaseURL, forKey: "RookServerBaseURL")
        }

        let envToken = ProcessInfo.processInfo.environment["ROOK_AUTH_TOKEN"]?.trimmingCharacters(in: .whitespacesAndNewlines)
        let storedToken = KeychainStore.string(for: "RookAuthToken")?.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedToken = (envToken?.isEmpty == false ? envToken : storedToken) ?? ""
        if let envToken, !envToken.isEmpty, storedToken != envToken {
            KeychainStore.setString(envToken, for: "RookAuthToken")
        }

        baseURLString = resolvedBaseURL
        authTokenString = resolvedToken
        api = RookAPI(baseURL: URL(string: resolvedBaseURL) ?? URL(string: "http://127.0.0.1:7665")!, authToken: resolvedToken)
        serverStateController = ServerStateController(api: api)
        chatSessionController = ChatSessionController(api: api)
        appEnvironmentProvider = AppEnvironmentProvider(api: api, environmentFocusDelay: environmentFocusDelay)
        environmentOfferController = EnvironmentOfferController()
        environmentListController = EnvironmentListController(api: api)

        RookMacModel.shared = self
        wireControllers()
        serverStateController.start()
        appEnvironmentProvider.start()
        Task {
            await refreshNow()
        }
    }

    // MARK: - Wiring

    private func wireControllers() {
        serverStateController.onStateChange = { [weak self] in
            self?.syncServerState()
        }
        serverStateController.didBecomeOnline = { [weak self] in
            guard let self else { return }
            self.appEnvironmentProvider.setServerOnline(true)
            Task {
                await self.loadAgents()
                await self.chatSessionController.loadSessions()
                self.syncChatState()
                await self.chatSessionController.autoResumeRecentSessionIfNeeded()
                self.syncChatState()
            }
        }
        serverStateController.didBecomeOffline = { [weak self] in
            self?.appEnvironmentProvider.setServerOnline(false)
        }

        chatSessionController.onStateChange = { [weak self] in
            self?.syncChatState()
        }
        chatSessionController.onCurrentSessionChange = { [weak self] session in
            guard let self else { return }
            self.currentSession = session
            if let session {
                self.environmentListController.refreshEnvironmentList(sessionId: session.id, showLoading: true)
            } else {
                self.environmentListController.reset()
            }
            self.syncEnvironmentListState()
        }
        chatSessionController.onEnvironmentOffered = { [weak self] offer in
            self?.environmentOfferController.handleEnvironmentOffered(offer)
        }
        chatSessionController.onEnvironmentOfferResolved = { [weak self] _, bundleHash in
            self?.environmentOfferController.handleEnvironmentOfferResolved(bundleHash: bundleHash)
        }
        chatSessionController.onEnvironmentEntered = { [weak self] environmentId in
            self?.environmentListController.handleEntered(environmentId)
        }
        chatSessionController.onEnvironmentExited = { [weak self] environmentId, _ in
            self?.environmentListController.handleExited(environmentId)
        }

        appEnvironmentProvider.onStateChange = { [weak self] in
            self?.syncEnvironmentProviderState()
        }

        environmentOfferController.onStateChange = { [weak self] in
            self?.syncOfferState()
        }
        environmentOfferController.onWantsOfferView = { [weak self] in
            self?.panelMode = .environmentOffer
        }
        environmentOfferController.onDismissOfferView = { [weak self] in
            guard let self else { return }
            if self.panelMode == .environmentOffer {
                self.panelMode = self.currentSession != nil ? .chat : .home
            }
        }
        environmentOfferController.appendSystemMessage = { [weak self] text in
            self?.chatSessionController.appendSystemMessage(text)
        }
        environmentOfferController.resolveOffer = { [weak self] environmentId, bundleHash, decision in
            try await self?.chatSessionController.resolveEnvironmentOffer(environmentId: environmentId, bundleHash: bundleHash, decision: decision)
        }

        environmentListController.onStateChange = { [weak self] in
            self?.syncEnvironmentListState()
        }

        syncServerState()
        syncChatState()
        syncEnvironmentProviderState()
        syncOfferState()
        syncEnvironmentListState()
    }

    private func syncServerState() {
        serverState = serverStateController.serverState
        managedServerRunning = serverStateController.managedServerRunning
    }

    private func syncChatState() {
        sessions = chatSessionController.sessions
        sessionsLoading = chatSessionController.sessionsLoading
        sessionsError = chatSessionController.sessionsError
        startingSession = chatSessionController.startingSession
        currentSession = chatSessionController.currentSession
        blocks = chatSessionController.blocks
        queuedMessages = chatSessionController.queuedMessages
        isRunning = chatSessionController.isRunning
        statusLine = chatSessionController.statusLine
        socketConnected = chatSessionController.socketConnected
        reconnecting = chatSessionController.reconnecting
        contextUsage = chatSessionController.contextUsage
        currentModes = chatSessionController.currentModes
        configOptions = chatSessionController.configOptions
        pendingPermission = chatSessionController.pendingPermission
        lastStopReason = chatSessionController.lastStopReason
        autoScrollEnabled = chatSessionController.autoScrollEnabled
        scrollTick = chatSessionController.scrollTick
    }

    private func syncEnvironmentProviderState() {
        foregroundEnvironmentId = appEnvironmentProvider.foregroundEnvironmentId
        foregroundSiteEnvironmentId = appEnvironmentProvider.foregroundSiteEnvironmentId
        foregroundAppName = appEnvironmentProvider.foregroundAppName
        foregroundWindowTitle = appEnvironmentProvider.foregroundWindowTitle
    }

    private func syncOfferState() {
        pendingOffers = environmentOfferController.pendingOffers
        offerBundles = environmentOfferController.offerBundles
        offerLoading = environmentOfferController.offerLoading
        offerError = environmentOfferController.offerError
    }

    private func syncEnvironmentListState() {
        environmentListItems = environmentListController.environmentListItems
        enteredEnvironmentIds = environmentListController.enteredEnvironmentIds
        environmentsLoading = environmentListController.environmentsLoading
        environmentsError = environmentListController.environmentsError
    }

    // MARK: - Menu bar status

    var menuBarHelp: String {
        switch serverState {
        case .online:
            if let session = currentSession {
                return "Rook — \(session.agent) · \(session.name)"
            }
            return "Rook — server online"
        case .starting:
            return "Rook — server starting…"
        default:
            return "Rook — server offline"
        }
    }

    var serverStatusTint: Color {
        switch serverState {
        case .online:
            return PanelPalette.success
        case .starting:
            return PanelPalette.warning
        case .offline:
            return PanelPalette.danger
        case .unknown:
            return PanelPalette.secondaryText
        }
    }

    var serverPrimaryLine: String {
        switch serverState {
        case .online:
            return agents.isEmpty ? "Server online" : "Server online · \(agents.count) agents"
        case .starting:
            return "Server starting…"
        case .offline:
            return "Server offline"
        case .unknown:
            return "Checking server…"
        }
    }

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
        for agent in agents where !result.contains(where: { $0.0.id == agent.id }) {
            result.append((agent, 0))
        }
        return result
    }

    // MARK: - Server lifecycle

    func refreshNow() async {
        await serverStateController.refreshNow()
        syncServerState()
        if serverState == .online {
            await loadAgents()
        }
    }

    func refreshNow() {
        Task {
            await refreshNow()
        }
    }

    func startServer() {
        serverStateController.startManagedServer()
        syncServerState()
    }

    func stopServer() {
        serverStateController.stopManagedServer()
        syncServerState()
    }

    func loadAgents() async {
        do {
            agents = try await api.agents()
            agentsError = ""
        } catch {
            agentsError = error.localizedDescription
        }
    }

    func openWebApp() {
        NSWorkspace.shared.open(api.webAppURL)
    }

    private var logViewerWindow: NSPanel?

    func openServerLog() {
        if let existing = logViewerWindow {
            existing.makeKeyAndOrderFront(nil)
            return
        }
        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 620, height: 420),
            styleMask: [.titled, .closable, .resizable, .miniaturizable, .fullSizeContentView, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.title = "Rook Log"
        panel.titlebarAppearsTransparent = true
        panel.titleVisibility = .hidden
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isReleasedWhenClosed = false
        panel.contentViewController = NSHostingController(rootView: LogViewerView())
        panel.center()
        panel.makeKeyAndOrderFront(nil)
        logViewerWindow = panel
    }

    func quitApp() {
        chatSessionController.stop()
        appEnvironmentProvider.stop()
        serverStateController.stop()
        environmentListController.stopAutoRefresh()
        Task {
            if managedServerRunning {
                serverStateController.stopManagedServer()
            }
            NSApplication.shared.terminate(nil)
        }
    }

    // MARK: - Navigation

    func goHome() {
        stopEnvironmentListAutoRefresh()
        panelMode = .home
    }

    func openCapabilities() {
        stopEnvironmentListAutoRefresh()
        panelMode = .capabilities
    }

    func openEnvironments() {
        panelMode = .environments
        startEnvironmentListAutoRefresh()
    }

    func closeEnvironments() {
        stopEnvironmentListAutoRefresh()
        panelMode = currentSession != nil ? .chat : .home
    }

    func openChat() {
        guard currentSession != nil else { return }
        stopEnvironmentListAutoRefresh()
        panelMode = .chat
    }

    // MARK: - Sessions / chat

    func loadSessions() async {
        await chatSessionController.loadSessions()
        syncChatState()
    }

    func startNewSession(agentId: String, name: String) {
        chatSessionController.startNewSession(agentId: agentId, name: name) { [weak self] in
            self?.panelMode = .chat
        }
    }

    func resumeSession(_ session: AgentSessionSummary) {
        chatSessionController.resumeSession(session) { [weak self] in
            self?.panelMode = .chat
        }
    }

    func send(_ text: String) {
        chatSessionController.send(text)
    }

    func stopAgent() {
        chatSessionController.stopAgent()
    }

    func removeQueuedMessage(at index: Int) {
        chatSessionController.removeQueuedMessage(at: index)
    }

    func beginEditingQueuedMessage(_ id: String) {
        chatSessionController.beginEditingQueuedMessage(id)
    }

    func updateQueuedMessageDraft(_ id: String, text: String) {
        chatSessionController.updateQueuedMessageDraft(id, text: text)
    }

    func cancelEditingQueuedMessage(_ id: String) {
        chatSessionController.cancelEditingQueuedMessage(id)
    }

    func saveQueuedMessageEdit(_ id: String) {
        chatSessionController.saveQueuedMessageEdit(id)
    }

    func decidePermission(optionId: String?) {
        chatSessionController.decidePermission(optionId: optionId)
    }

    func setMode(_ modeId: String) {
        chatSessionController.setMode(modeId)
    }

    func setConfigOption(_ configId: String, value: String) {
        chatSessionController.setConfigOption(configId, value: value)
    }

    func resumeAutoScroll() {
        chatSessionController.resumeAutoScroll()
    }

    func pauseAutoScroll() {
        chatSessionController.pauseAutoScroll()
    }

    // MARK: - Environment offers

    func reviewPendingOffer() {
        guard pendingOffer != nil else { return }
        panelMode = .environmentOffer
    }

    func decideEnvironment(_ decision: String) {
        environmentOfferController.decideEnvironment(decision)
    }

    func dismissOfferView() {
        panelMode = currentSession != nil ? .chat : .home
    }

    // MARK: - Environment join / leave

    func refreshEnvironmentList(showLoading: Bool = true) {
        environmentListController.refreshEnvironmentList(sessionId: currentSession?.id, showLoading: showLoading)
    }

    func startEnvironmentListAutoRefresh() {
        environmentListController.startAutoRefresh { [weak self] in
            self?.currentSession?.id
        }
    }

    func stopEnvironmentListAutoRefresh() {
        environmentListController.stopAutoRefresh()
    }

    func joinEnvironment(_ environmentId: String) {
        environmentListController.joinEnvironment(sessionId: currentSession?.id, environmentId: environmentId)
    }

    func leaveEnvironment(_ environmentId: String) {
        environmentListController.leaveEnvironment(sessionId: currentSession?.id, environmentId: environmentId)
    }
}
