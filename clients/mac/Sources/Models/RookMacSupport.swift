import Foundation
import RookKit

@MainActor
final class ServerStateController {
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
        let healthy = await api.health()
        managedServerRunning = serverController.isManagedServerRunning
        if healthy {
            serverState = .online
        } else if serverState != .starting || !managedServerRunning {
            serverState = managedServerRunning ? .starting : .offline
        }
    }

    func startManagedServer() {
        guard serverState != .online else { return }
        serverController.start()
        managedServerRunning = serverController.isManagedServerRunning
        if managedServerRunning {
            serverState = .starting
        }
    }

    func stopManagedServer() {
        serverController.stop()
        managedServerRunning = false
        Task {
            await refreshNow()
        }
    }
}

@MainActor
final class EnvironmentOfferController {
    var onStateChange: (() -> Void)?
    var onWantsOfferView: (() -> Void)?
    var onDismissOfferView: (() -> Void)?
    var appendSystemMessage: ((String) -> Void)?
    var resolveOffer: ((String, String, String) async throws -> Void)?

    private(set) var pendingOffers: [EnvironmentOffer] = [] { didSet { onStateChange?() } }
    private(set) var offerBundles: [EnvironmentBundlePreview] = [] { didSet { onStateChange?() } }
    private(set) var offerLoading = false { didSet { onStateChange?() } }
    private(set) var offerError = "" { didSet { onStateChange?() } }

    var pendingOffer: EnvironmentOffer? { pendingOffers.first }
    var pendingOfferCount: Int { pendingOffers.count }

    func handleEnvironmentOffered(_ offer: EnvironmentOffer) {
        guard !pendingOffers.contains(where: { $0.bundleHash == offer.bundleHash }) else {
            return
        }
        let wasEmpty = pendingOffers.isEmpty
        pendingOffers.append(offer)
        if wasEmpty {
            loadCurrentOfferPreview()
            onWantsOfferView?()
        }
    }

    func handleEnvironmentOfferResolved(bundleHash: String) {
        let removedHead = pendingOffer?.bundleHash == bundleHash
        pendingOffers.removeAll { $0.bundleHash == bundleHash }
        guard removedHead else { return }
        advanceOfferQueueOrDismissIfNeeded()
    }

    func decideEnvironment(_ decision: String) {
        guard let offer = pendingOffer else { return }
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
        offerBundles = []
        offerError = ""
        offerLoading = false
    }

    private func loadCurrentOfferPreview() {
        guard pendingOffer != nil else {
            clearOfferViewState()
            return
        }
        clearOfferViewState()
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
            environmentListItems = []
            enteredEnvironmentIds = []
            return
        }
        if showLoading && environmentListItems.isEmpty {
            environmentsLoading = true
        }
        Task {
            defer { environmentsLoading = false }
            do {
                let refreshedItems = try await api.environmentList(sessionId: sessionId)
                EnvironmentListPresentation.apply(refreshedItems, to: &environmentListItems)
                enteredEnvironmentIds = Set(refreshedItems.filter(\.entered).map(\.environmentId))
                environmentsError = ""
            } catch {
                environmentsError = error.localizedDescription
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
