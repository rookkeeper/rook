import AppKit
import Foundation
import RookKit

struct EnvironmentCandidate: Equatable {
    let id: String
    let sourceName: String
    let metadata: [String: JSONValue]
}

protocol SpecializedEnvironmentProvider {
    func isActive(for app: ForegroundApp) -> Bool
    func candidates(for app: ForegroundApp, title: String?) -> [EnvironmentCandidate]
}

struct ObsidianEnvironmentProvider: SpecializedEnvironmentProvider {
    func isActive(for app: ForegroundApp) -> Bool {
        app.bundleId == "md.obsidian"
    }

    func candidates(for app: ForegroundApp, title: String?) -> [EnvironmentCandidate] {
        guard let title, let vault = Self.vaultName(from: title) else {
            return []
        }
        var metadata: [String: JSONValue] = [
            "bundleId": .string(app.bundleId),
            "appName": .string(app.name),
            "windowTitle": .string(title),
            "vaultName": .string(vault),
        ]
        return [EnvironmentCandidate(
            id: "mac:\(app.bundleId)/\(EnvironmentIDEncoding.encodePathComponent(vault))",
            sourceName: "\(app.name) · \(vault)",
            metadata: metadata
        )]
    }

    /// Obsidian title parsing works backwards because note names may contain dashes.
    static func vaultName(from title: String) -> String? {
        guard let obsidianRange = title.range(of: " - Obsidian", options: .backwards) else {
            return nil
        }
        let prefix = String(title[..<obsidianRange.lowerBound]).trimmingCharacters(in: .whitespaces)
        guard !prefix.isEmpty else {
            return nil
        }
        if let split = prefix.range(of: " - ", options: .backwards) {
            let vault = String(prefix[split.upperBound...]).trimmingCharacters(in: .whitespaces)
            return vault.isEmpty ? nil : vault
        }
        return prefix
    }
}

struct BrowserEnvironmentProvider: SpecializedEnvironmentProvider {
    static let bundleIds: Set<String> = [
        "com.google.Chrome", "com.google.Chrome.beta", "com.google.Chrome.canary", "com.google.Chrome.dev",
        "com.apple.Safari", "com.apple.SafariTechnologyPreview",
        "company.thebrowser.Browser",
        "com.brave.Browser", "com.brave.Browser.beta", "com.brave.Browser.nightly",
        "com.microsoft.edgemac", "com.microsoft.edgemac.Beta",
        "com.vivaldi.Vivaldi", "com.operasoftware.Opera",
    ]

    func isActive(for app: ForegroundApp) -> Bool {
        Self.bundleIds.contains(app.bundleId)
    }

    func candidates(for app: ForegroundApp, title: String?) -> [EnvironmentCandidate] {
        guard let rawURL = AXReader.activeTabURL(pid: app.pid) else {
            return []
        }
        let ids = Self.webEnvironmentIds(from: rawURL)
        guard !ids.isEmpty else { return [] }
        var metadata: [String: JSONValue] = [
            "bundleId": .string(app.bundleId),
            "appName": .string(app.name),
            "url": .string(rawURL),
        ]
        if let title, !title.isEmpty {
            metadata["windowTitle"] = .string(title)
        }
        return ids.map { EnvironmentCandidate(id: $0, sourceName: rawURL, metadata: metadata) }
    }

    static func webEnvironmentIds(from rawURL: String) -> [String] {
        guard let components = URLComponents(string: rawURL),
              let scheme = components.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              let host = components.host?.lowercased(), !host.isEmpty else {
            return []
        }
        let segments = components.percentEncodedPath
            .split(separator: "/")
            .map(String.init)
            .filter { !$0.isEmpty }
        var ids = ["web:\(host)"]
        var current = host
        for segment in segments {
            current += "/\(segment)"
            ids.append("web:\(current)")
        }
        return ids
    }
}

enum EnvironmentIDEncoding {
    static func encodePathComponent(_ raw: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
        return raw.addingPercentEncoding(withAllowedCharacters: allowed) ?? raw
    }

    static func depth(_ id: String) -> Int {
        id.split(separator: "/").count
    }
}

@MainActor
final class AppEnvironmentProvider {
    var onStateChange: (() -> Void)?

    private let api: RookAPI
    private let monitor = ForegroundAppMonitor()
    private let environmentFocusDelay: TimeInterval
    private let specializedProviders: [SpecializedEnvironmentProvider]
    private var focusedEnvironmentTimer: Timer?
    private var focusedEnvironmentSignature: String?
    private var focusedEnvironmentCandidates: [EnvironmentCandidate] = []
    private var focusedEnvironmentHasMetDwell = false
    private var focusedEnvironmentEmitted = false
    private var isServerOnline = false

    private var lastLoggedTitle: String?
    private var lastLoggedURL: String?
    private var lastLoggedBundleId: String?
    private var hasLoggedContext = false

    private(set) var foregroundEnvironmentId: String?
    private(set) var foregroundSiteEnvironmentId: String?
    private(set) var foregroundAppName: String?
    private(set) var foregroundWindowTitle: String?

    init(
        api: RookAPI,
        environmentFocusDelay: TimeInterval = 5,
        specializedProviders: [SpecializedEnvironmentProvider] = [ObsidianEnvironmentProvider(), BrowserEnvironmentProvider()]
    ) {
        self.api = api
        self.environmentFocusDelay = environmentFocusDelay
        self.specializedProviders = specializedProviders

        monitor.onForegroundChange = { [weak self] app in
            self?.handleForegroundApp(app)
        }
        monitor.onContextRefresh = { [weak self] app, title in
            self?.handleContextRefresh(app: app, title: title)
        }
    }

    func start() {
        monitor.start()
    }

    func stop() {
        monitor.stop()
        focusedEnvironmentTimer?.invalidate()
        focusedEnvironmentTimer = nil
    }

    func setServerOnline(_ online: Bool) {
        isServerOnline = online
        if online {
            emitFocusedEnvironmentIfEligible(reason: "server-online")
        }
    }

    func refreshCurrentContext() {
        monitor.refreshTitleNow()
    }

    private func handleForegroundApp(_ app: ForegroundApp) {
        AXReader.primeAccessibility(pid: app.pid)
        let title = AXReader.focusedWindowTitle(pid: app.pid)
        logRawContext(app: app, title: title, reason: "app-switch")
        foregroundAppName = app.name
        foregroundWindowTitle = title
        observeCurrentEnvironments(app: app, title: title)
    }

    private func handleContextRefresh(app: ForegroundApp, title: String?) {
        logRawContext(app: app, title: title, reason: "context-refresh")
        foregroundAppName = app.name
        foregroundWindowTitle = title
        observeCurrentEnvironments(app: app, title: title)
    }

    private func observeCurrentEnvironments(app: ForegroundApp, title: String?) {
        let candidates = deriveForegroundEnvironmentCandidates(app: app, title: title)
        let appCandidates = candidates.filter { $0.id.hasPrefix("mac:") }
        let webCandidates = candidates.filter { $0.id.hasPrefix("web:") }
        foregroundEnvironmentId = appCandidates.last?.id
        foregroundSiteEnvironmentId = webCandidates.last?.id
        providerLog("foreground: \(app.name) [\(app.bundleId)] title=\(title ?? "nil") -> \(candidates.map(\.id).joined(separator: ", "))")
        updateFocusedEnvironment(candidates, reason: "foreground")
        onStateChange?()
    }

    private func deriveForegroundEnvironmentCandidates(app: ForegroundApp, title: String?) -> [EnvironmentCandidate] {
        var candidates: [EnvironmentCandidate] = []
        var metadata: [String: JSONValue] = [
            "bundleId": .string(app.bundleId),
            "appName": .string(app.name),
        ]
        if let title, !title.isEmpty {
            metadata["windowTitle"] = .string(title)
        }
        candidates.append(EnvironmentCandidate(id: "mac:\(app.bundleId)", sourceName: app.name, metadata: metadata))
        for provider in specializedProviders where provider.isActive(for: app) {
            candidates.append(contentsOf: provider.candidates(for: app, title: title))
        }
        let deduped = Dictionary(candidates.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first }).values
        return deduped.sorted { EnvironmentIDEncoding.depth($0.id) < EnvironmentIDEncoding.depth($1.id) }
    }

    private func updateFocusedEnvironment(_ candidates: [EnvironmentCandidate], reason: String) {
        let signature = candidates.map(\.id).joined(separator: "|")
        if signature.isEmpty {
            focusedEnvironmentTimer?.invalidate()
            focusedEnvironmentTimer = nil
            focusedEnvironmentSignature = nil
            focusedEnvironmentCandidates = []
            focusedEnvironmentHasMetDwell = false
            focusedEnvironmentEmitted = false
            return
        }

        if focusedEnvironmentSignature == signature {
            focusedEnvironmentCandidates = candidates
            emitFocusedEnvironmentIfEligible(reason: reason)
            return
        }

        focusedEnvironmentTimer?.invalidate()
        focusedEnvironmentTimer = nil
        focusedEnvironmentSignature = signature
        focusedEnvironmentCandidates = candidates
        focusedEnvironmentHasMetDwell = false
        focusedEnvironmentEmitted = false
        providerLog("focus episode start [\(reason)]: \(candidates.map(\.id).joined(separator: ", "))")
        focusedEnvironmentTimer = Timer.scheduledTimer(withTimeInterval: environmentFocusDelay, repeats: false) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.focusedEnvironmentHasMetDwell = true
                self.emitFocusedEnvironmentIfEligible(reason: "dwell")
            }
        }
    }

    private func emitFocusedEnvironmentIfEligible(reason: String) {
        guard focusedEnvironmentHasMetDwell,
              !focusedEnvironmentEmitted,
              !focusedEnvironmentCandidates.isEmpty,
              isServerOnline else {
            return
        }

        focusedEnvironmentEmitted = true
        let candidates = focusedEnvironmentCandidates
        Task {
            for candidate in candidates {
                do {
                    var metadata = candidate.metadata
                    metadata["registeredAt"] = .string(Self.iso8601String(from: Date()))
                    try await api.registerEnvironment(id: candidate.id, sourceName: candidate.sourceName, metadata: metadata)
                    providerLog("register ok [\(reason)]: \(candidate.id)")
                } catch {
                    providerLog("register error [\(reason)]: \(error.localizedDescription)")
                }
            }
        }
    }

    private func logRawContext(app: ForegroundApp, title: String?, reason: String) {
        let isBrowser = BrowserEnvironmentProvider.bundleIds.contains(app.bundleId)
        let browserURL = isBrowser ? AXReader.activeTabURL(pid: app.pid) : nil
        let appChanged = app.bundleId != lastLoggedBundleId
        let urlChanged = browserURL != lastLoggedURL
        let titleChanged = title != lastLoggedTitle
        if hasLoggedContext, !appChanged, !titleChanged, !urlChanged {
            return
        }
        hasLoggedContext = true
        lastLoggedBundleId = app.bundleId
        lastLoggedTitle = title
        lastLoggedURL = browserURL

        var lines: [String] = []
        lines.append("[RAW-CONTEXT] reason=\(reason)")
        lines.append("  mac:          \(app.name)  bundleId=\(app.bundleId)  pid=\(app.pid)")
        lines.append("  isBrowser:    \(isBrowser)")
        let titleText = title.map { "\"\($0)\"" } ?? "(null)"
        lines.append("  windowTitle:  \(titleText)")
        if isBrowser {
            let browserURLText = browserURL ?? "(null — AX web-content tree not ready or not a browser tab)"
            lines.append("  browserURL:   \(browserURLText)")
        }
        lines.append("  trustedAX:    \(AXReader.isTrusted())")
        for line in lines {
            providerLog(line)
        }
    }

    private static func iso8601String(from date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
}

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
                try? await Task.sleep(nanoseconds: 5_000_000_000)
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
