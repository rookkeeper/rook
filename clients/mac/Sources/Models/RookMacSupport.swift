import Foundation
import RookKit

@MainActor
final class ServerStateController {
    private static let logger = RookLog.server

    var onStateChange: (() -> Void)?
    var didBecomeOnline: (() -> Void)?
    var didBecomeOffline: (() -> Void)?

    private let api: RookAPI
    private let serverController: ServerController
    private var healthTimer: Timer?

    private(set) var serverState: ServerState = .unknown {
        didSet {
            guard oldValue != serverState else { return }
            onStateChange?()
            if serverState == .online {
                didBecomeOnline?()
            } else if oldValue == .online {
                didBecomeOffline?()
            }
        }
    }

    private(set) var managedServerRunning = false {
        didSet {
            if oldValue != managedServerRunning {
                onStateChange?()
            }
        }
    }

    init(api: RookAPI, serverController: ServerController? = nil) {
        self.api = api
        self.serverController = serverController ?? ServerController()
        self.serverController.onTermination = { [weak self] in
            guard let self else { return }
            self.managedServerRunning = false
            Task {
                await self.refreshNow()
            }
        }
    }

    func start() {
        guard healthTimer == nil else { return }
        healthTimer = Timer.scheduledTimer(withTimeInterval: 4, repeats: true) { [weak self] _ in
            Task { @MainActor in
                await self?.refreshNow()
            }
        }
    }

    func stop() {
        healthTimer?.invalidate()
        healthTimer = nil
    }

    func refreshNow() async {
        let timed = RookPerformance.begin(
            "MacServerHealthRefresh",
            operation: "mac-server-health-refresh",
            logger: Self.logger,
            signposter: RookLog.serverSignposter
        )
        let previousState = serverState
        let healthy = await api.health()
        managedServerRunning = serverController.isManagedServerRunning
        if healthy {
            serverState = .online
        } else if serverState != .starting || !managedServerRunning {
            serverState = managedServerRunning ? .starting : .offline
        }
        if previousState != serverState {
            Self.logger.info("server state changed state=\(String(describing: self.serverState), privacy: .public) managed=\(self.managedServerRunning, privacy: .public)")
        } else if RookLog.verboseEnabled {
            Self.logger.debug("server state unchanged state=\(String(describing: self.serverState), privacy: .public) managed=\(self.managedServerRunning, privacy: .public)")
        }
        timed.finish(details: "state=\(String(describing: serverState)) managed=\(self.managedServerRunning)")
    }

    func startManagedServer() {
        guard serverState != .online else { return }
        Self.logger.info("server state controller start managed server")
        serverController.start()
        managedServerRunning = serverController.isManagedServerRunning
        if managedServerRunning {
            serverState = .starting
        }
    }

    func stopManagedServer() {
        Self.logger.info("server state controller stop managed server")
        serverController.stop()
        managedServerRunning = false
        Task {
            await refreshNow()
        }
    }
}

@MainActor
final class EnvironmentOfferController {
    private static let logger = RookLog.environment

    var onStateChange: (() -> Void)?
    var onWantsOfferView: (() -> Void)?
    var onDismissOfferView: (() -> Void)?
    var appendSystemMessage: ((String) -> Void)?
    var resolveOffer: ((String, String, String) async throws -> Void)?
    /// Fetches the environment preview (`GET /api/environments/preview`) so the
    /// offer view can show the bundle's actual content before the user decides.
    var loadPreview: ((String) async throws -> EnvironmentPreview)?

    private(set) var pendingOffers: [EnvironmentOffer] = [] { didSet { onStateChange?() } }
    private(set) var offerBundles: [EnvironmentBundlePreview] = [] { didSet { onStateChange?() } }
    private(set) var offerLoading = false { didSet { onStateChange?() } }
    private(set) var offerError = "" { didSet { onStateChange?() } }
    private(set) var offerPreviewError = "" { didSet { onStateChange?() } }
    /// User overrides for the content preview's collapsible sections, keyed by
    /// section id. Sections without an entry use the view's default.
    private(set) var offerSectionExpansion: [String: Bool] = [:] { didSet { onStateChange?() } }
    private var previewTask: Task<Void, Never>?

    var pendingOffer: EnvironmentOffer? { pendingOffers.first }
    var pendingOfferCount: Int { pendingOffers.count }

    /// The loaded preview bundle for the head offer, matched by hash (the exact
    /// content being approved) and falling back to the bundle id.
    var offerPreviewBundle: EnvironmentBundlePreview? {
        guard let offer = pendingOffer else { return nil }
        return offerBundles.first { $0.bundleHash == offer.bundleHash }
            ?? offerBundles.first { $0.bundleId == offer.bundleId }
    }

    func handleEnvironmentOffered(_ offer: EnvironmentOffer) {
        guard !pendingOffers.contains(where: { $0.bundleHash == offer.bundleHash }) else {
            Self.logger.info("environment offer duplicate ignored bundleHash=\(offer.bundleHash, privacy: .public)")
            return
        }
        Self.logger.info("environment offer queued environment=\(offer.environmentId, privacy: .public) bundleId=\(offer.bundleId, privacy: .public)")
        let wasEmpty = pendingOffers.isEmpty
        pendingOffers.append(offer)
        if wasEmpty {
            loadCurrentOfferPreview()
            onWantsOfferView?()
        }
    }

    func handleEnvironmentOfferResolved(bundleHash: String) {
        Self.logger.info("environment offer resolved bundleHash=\(bundleHash, privacy: .public)")
        let removedHead = pendingOffer?.bundleHash == bundleHash
        pendingOffers.removeAll { $0.bundleHash == bundleHash }
        guard removedHead else { return }
        advanceOfferQueueOrDismissIfNeeded()
    }

    func decideEnvironment(_ decision: String) {
        guard let offer = pendingOffer else { return }
        Self.logger.info("environment offer decision decision=\(decision, privacy: .public) environment=\(offer.environmentId, privacy: .public) bundleId=\(offer.bundleId, privacy: .public)")
        Task {
            do {
                try await resolveOffer?(offer.environmentId, offer.bundleHash, decision)
                if decision == "accept" || decision == "approve" {
                    appendSystemMessage?("Bundle \(offer.bundleId) allowed for \(offer.environmentId).")
                }
            } catch {
                offerError = error.localizedDescription
                return
            }
            if pendingOffer?.bundleHash == offer.bundleHash {
                pendingOffers.removeFirst()
            } else {
                pendingOffers.removeAll { $0.bundleHash == offer.bundleHash }
            }
            advanceOfferQueueOrDismissIfNeeded()
        }
    }

    func clearOfferViewState() {
        previewTask?.cancel()
        previewTask = nil
        offerBundles = []
        offerError = ""
        offerPreviewError = ""
        offerLoading = false
        offerSectionExpansion = [:]
    }

    /// Reloads the head offer's preview (used by the view's Retry button and
    /// when the offer view is reopened after being dismissed).
    func reloadOfferPreview() {
        loadCurrentOfferPreview()
    }

    func ensureOfferPreviewLoaded() {
        guard pendingOffer != nil, offerBundles.isEmpty, !offerLoading, offerPreviewError.isEmpty else { return }
        loadCurrentOfferPreview()
    }

    func setOfferSection(_ id: String, expanded: Bool) {
        offerSectionExpansion[id] = expanded
    }

    private func loadCurrentOfferPreview() {
        clearOfferViewState()
        guard let offer = pendingOffer, let loadPreview else { return }
        offerLoading = true
        previewTask = Task { [weak self] in
            let result: Result<EnvironmentPreview, Error>
            do {
                result = .success(try await loadPreview(offer.environmentId))
            } catch {
                result = .failure(error)
            }
            guard let self, !Task.isCancelled, self.pendingOffer?.bundleHash == offer.bundleHash else { return }
            switch result {
            case .success(let preview):
                Self.logger.info("environment offer preview loaded environment=\(offer.environmentId, privacy: .public) bundles=\(preview.bundles.count, privacy: .public)")
                self.offerBundles = preview.bundles
            case .failure(let error):
                Self.logger.error("environment offer preview failed environment=\(offer.environmentId, privacy: .public) error=\(error.localizedDescription, privacy: .public)")
                self.offerPreviewError = error.localizedDescription
            }
            self.offerLoading = false
            self.previewTask = nil
        }
    }

    private func advanceOfferQueueOrDismissIfNeeded() {
        if pendingOffer != nil {
            loadCurrentOfferPreview()
            return
        }
        clearOfferViewState()
        onDismissOfferView?()
    }
}

@MainActor
final class EnvironmentListController {
    private static let logger = RookLog.environment

    var onStateChange: (() -> Void)?

    private let api: RookAPI
    private var autoRefreshTask: Task<Void, Never>?

    private(set) var environmentListItems: [EnvironmentListItem] = [] { didSet { onStateChange?() } }
    private(set) var enteredEnvironmentIds: Set<String> = [] { didSet { onStateChange?() } }
    private(set) var environmentsLoading = false { didSet { onStateChange?() } }
    private(set) var environmentsError = "" { didSet { onStateChange?() } }

    init(api: RookAPI) {
        self.api = api
    }

    func reset() {
        environmentListItems = []
        enteredEnvironmentIds = []
        environmentsLoading = false
        environmentsError = ""
    }

    func refreshEnvironmentList(sessionId: String?, showLoading: Bool = true) {
        guard let sessionId else {
            Self.logger.info("environment list refresh cleared no session")
            environmentListItems = []
            enteredEnvironmentIds = []
            return
        }
        if showLoading && environmentListItems.isEmpty {
            environmentsLoading = true
        }
        Task {
            let timed = RookPerformance.begin(
                "EnvironmentListRefresh",
                operation: "environment-list-refresh",
                description: "session=\(sessionId)",
                logger: Self.logger,
                signposter: RookLog.environmentSignposter
            )
            defer { environmentsLoading = false }
            do {
                let refreshedItems = try await api.environmentList(sessionId: sessionId)
                EnvironmentListPresentation.apply(refreshedItems, to: &environmentListItems)
                enteredEnvironmentIds = Set(refreshedItems.filter(\.entered).map(\.environmentId))
                environmentsError = ""
                timed.finish(details: "items=\(refreshedItems.count) entered=\(enteredEnvironmentIds.count)")
            } catch {
                environmentsError = error.localizedDescription
                timed.fail(error)
            }
        }
    }

    func startAutoRefresh(sessionId: @escaping @MainActor () -> String?) {
        guard autoRefreshTask == nil else { return }
        refreshEnvironmentList(sessionId: sessionId(), showLoading: true)
        autoRefreshTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                guard !Task.isCancelled else { break }
                await MainActor.run {
                    self.refreshEnvironmentList(sessionId: sessionId(), showLoading: false)
                }
            }
        }
    }

    func stopAutoRefresh() {
        autoRefreshTask?.cancel()
        autoRefreshTask = nil
    }

    func joinEnvironment(sessionId: String?, environmentId: String) {
        guard let sessionId else { return }
        Self.logger.info("environment list join session=\(sessionId, privacy: .public) environment=\(environmentId, privacy: .public)")
        Task {
            do {
                let entered = try await api.enterEnvironment(sessionId: sessionId, environmentId: environmentId)
                enteredEnvironmentIds = Set(entered)
                refreshEnvironmentList(sessionId: sessionId)
            } catch {
                environmentsError = error.localizedDescription
            }
        }
    }

    func leaveEnvironment(sessionId: String?, environmentId: String) {
        guard let sessionId else { return }
        Self.logger.info("environment list leave session=\(sessionId, privacy: .public) environment=\(environmentId, privacy: .public)")
        Task {
            do {
                let entered = try await api.exitEnvironment(sessionId: sessionId, environmentId: environmentId)
                enteredEnvironmentIds = Set(entered)
                refreshEnvironmentList(sessionId: sessionId)
            } catch {
                environmentsError = error.localizedDescription
            }
        }
    }

    func handleEntered(_ environmentId: String) {
        enteredEnvironmentIds.insert(environmentId)
    }

    func handleExited(_ environmentId: String) {
        enteredEnvironmentIds.remove(environmentId)
    }
}
