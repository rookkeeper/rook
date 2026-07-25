import AppKit
import Foundation
import OSLog
import RookKit

struct EnvironmentCandidate: Equatable {
    let id: String
    let metadata: [String: JSONValue]
}

@MainActor
protocol SpecializedEnvironmentProvider: AnyObject {
    var onStateChange: (() -> Void)? { get set }
    var currentAppEnvironmentId: String? { get }
    var currentSiteEnvironmentId: String? { get }

    func isActive(for app: ForegroundApp) -> Bool
    func activate(app: ForegroundApp, title: String?)
    func update(app: ForegroundApp, title: String?)
    func deactivate()
    func setServerOnline(_ online: Bool)
}

@MainActor
final class EnvironmentRegistrationController {
    private static let duplicateSuppressionWindow: TimeInterval = 60

    private let register: ([EnvironmentCandidate], String) -> Void
    private var timer: Timer?
    private var currentSignature: String?
    private var currentCandidates: [EnvironmentCandidate] = []
    private var currentReason = ""
    private var readyToEmit = false
    private var isServerOnline = false
    private var lastEmissionAtByEnvironmentId: [String: Date] = [:]

    init(register: @escaping ([EnvironmentCandidate], String) -> Void) {
        self.register = register
    }

    func setServerOnline(_ online: Bool) {
        isServerOnline = online
        flushIfPossible()
    }

    func update(candidates: [EnvironmentCandidate], delay: TimeInterval, reason: String) {
        let signature = Self.signature(for: candidates)
        guard !signature.isEmpty else {
            clear()
            return
        }
        currentCandidates = candidates
        currentReason = reason
        if signature == currentSignature {
            flushIfPossible()
            return
        }
        timer?.invalidate()
        timer = nil
        currentSignature = signature
        readyToEmit = false
        if delay <= 0 {
            readyToEmit = true
            flushIfPossible()
            return
        }
        timer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.readyToEmit = true
                self.flushIfPossible()
            }
        }
    }

    func emitNow(candidates: [EnvironmentCandidate], reason: String) {
        currentCandidates = candidates
        currentReason = reason
        readyToEmit = true
        flushIfPossible()
    }

    func clear() {
        timer?.invalidate()
        timer = nil
        currentSignature = nil
        currentCandidates = []
        currentReason = ""
        readyToEmit = false
    }

    private func flushIfPossible() {
        guard readyToEmit, isServerOnline, !currentCandidates.isEmpty else { return }
        let now = Date()
        let eligible = currentCandidates.filter { candidate in
            guard let lastEmission = lastEmissionAtByEnvironmentId[candidate.id] else {
                return true
            }
            return now.timeIntervalSince(lastEmission) >= Self.duplicateSuppressionWindow
        }
        guard !eligible.isEmpty else { return }
        for candidate in eligible {
            lastEmissionAtByEnvironmentId[candidate.id] = now
        }
        register(eligible, currentReason)
    }

    private static func signature(for candidates: [EnvironmentCandidate]) -> String {
        candidates.map(\.id).sorted().joined(separator: "|")
    }
}

private struct GenericEnvironmentObservation {
    let candidates: [EnvironmentCandidate]
    let normalizedIds: [String]
    let documentValues: [String]
    let webURL: String?
}

@MainActor
final class GenericEnvironmentProvider: SpecializedEnvironmentProvider {
    private static let pollInterval: TimeInterval = 5
    private static let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.rookery.rook", category: "GenericEnvironmentProvider")

    var onStateChange: (() -> Void)?
    var currentAppEnvironmentId: String? { nil }
    var currentSiteEnvironmentId: String? { nil }

    private let registration: EnvironmentRegistrationController
    private var pollTimer: Timer?
    private var currentApp: ForegroundApp?
    private var currentTitle: String?
    private var previousNormalizedIds: [String]?

    init(register: @escaping ([EnvironmentCandidate], String) -> Void) {
        self.registration = EnvironmentRegistrationController(register: register)
    }

    func isActive(for app: ForegroundApp) -> Bool {
        true
    }

    func activate(app: ForegroundApp, title: String?) {
        currentApp = app
        currentTitle = title
        previousNormalizedIds = nil
        startPolling()
        poll()
    }

    func update(app: ForegroundApp, title: String?) {
        currentApp = app
        currentTitle = title
    }

    func deactivate() {
        if let app = currentApp {
            let observation = Self.observation(for: app, title: currentTitle)
            registration.emitNow(candidates: observation.candidates, reason: "generic-final")
        }
        pollTimer?.invalidate()
        pollTimer = nil
        currentApp = nil
        currentTitle = nil
        previousNormalizedIds = nil
        registration.clear()
        onStateChange?()
    }

    func setServerOnline(_ online: Bool) {
        registration.setServerOnline(online)
    }

    private func startPolling() {
        pollTimer?.invalidate()
        pollTimer = Timer.scheduledTimer(withTimeInterval: Self.pollInterval, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.poll()
            }
        }
    }

    private func poll() {
        guard let app = currentApp else { return }
        let observation = Self.observation(for: app, title: currentTitle)
        defer {
            previousNormalizedIds = observation.normalizedIds
            onStateChange?()
        }
        guard let previousNormalizedIds, previousNormalizedIds == observation.normalizedIds else {
            return
        }
        registration.emitNow(candidates: observation.candidates, reason: "generic")
    }

    private static func observation(for app: ForegroundApp, title: String?) -> GenericEnvironmentObservation {
        let documentValues = AXReader.focusedWindowDocumentValues(pid: app.pid)
        let webURL = AXReader.activeTabURL(pid: app.pid)
        var candidatesById: [String: EnvironmentCandidate] = [:]

        for rawValue in documentValues {
            if let normalizedPath = normalizedAbsolutePath(from: rawValue) {
                let candidate = directoryCandidate(path: normalizedPath, app: app, title: title, rawValue: rawValue)
                candidatesById[candidate.id] = candidate
                continue
            }
            let webCandidates = webCandidates(from: rawValue, app: app, title: title)
            if webCandidates.isEmpty {
                warningForNonAbsoluteDirectoryCandidate(rawValue: rawValue, app: app)
                continue
            }
            for candidate in webCandidates {
                candidatesById[candidate.id] = candidate
            }
        }

        if let webURL {
            for candidate in webCandidates(from: webURL, app: app, title: title) {
                candidatesById[candidate.id] = candidate
            }
        }

        let candidates = candidatesById.values.sorted { lhs, rhs in
            EnvironmentIDEncoding.depth(lhs.id) < EnvironmentIDEncoding.depth(rhs.id)
        }
        return GenericEnvironmentObservation(
            candidates: candidates,
            normalizedIds: candidates.map(\.id),
            documentValues: documentValues,
            webURL: webURL
        )
    }

    private static func directoryCandidate(path: String, app: ForegroundApp, title: String?, rawValue: String) -> EnvironmentCandidate {
        var metadata: [String: JSONValue] = [
            "bundleId": .string(app.bundleId),
            "appName": .string(app.name),
            "directoryPath": .string(path),
            "axDocument": .string(rawValue),
            "sourceName": .string(path),
        ]
        if let title, !title.isEmpty {
            metadata["windowTitle"] = .string(title)
        }
        return EnvironmentCandidate(id: "dir:\(path)", metadata: metadata)
    }

    private static func webCandidates(from rawURL: String, app: ForegroundApp, title: String?) -> [EnvironmentCandidate] {
        let ids = webEnvironmentIds(from: rawURL)
        guard !ids.isEmpty else { return [] }
        var metadata: [String: JSONValue] = [
            "bundleId": .string(app.bundleId),
            "appName": .string(app.name),
            "url": .string(rawURL),
            "sourceName": .string(rawURL),
            "canonicalSourceUrl": .string(rawURL),
        ]
        if let title, !title.isEmpty {
            metadata["windowTitle"] = .string(title)
        }
        return ids.map { EnvironmentCandidate(id: $0, metadata: metadata) }
    }

    private static func normalizedAbsolutePath(from rawValue: String) -> String? {
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if let url = URL(string: trimmed), url.isFileURL {
            return URL(fileURLWithPath: url.path).standardizedFileURL.path
        }
        guard trimmed.hasPrefix("/") else {
            return nil
        }
        return URL(fileURLWithPath: trimmed).standardizedFileURL.path
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

    static func warningForNonAbsoluteDirectoryCandidate(rawValue: String, app: ForegroundApp) {
        logger.warning("Skipping non-absolute directory candidate for bundleId=\(app.bundleId, privacy: .public): \(rawValue, privacy: .public)")
    }
}

@MainActor
final class ObsidianEnvironmentProvider: SpecializedEnvironmentProvider {
    private static let configURL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/obsidian/obsidian.json")
    private static let pollInterval: TimeInterval = 5

    var onStateChange: (() -> Void)?
    var currentAppEnvironmentId: String? { nil }
    var currentSiteEnvironmentId: String? { nil }

    private let registration: EnvironmentRegistrationController
    private var pollTimer: Timer?
    private var currentApp: ForegroundApp?

    init(register: @escaping ([EnvironmentCandidate], String) -> Void) {
        self.registration = EnvironmentRegistrationController(register: register)
    }

    func isActive(for app: ForegroundApp) -> Bool {
        app.bundleId == "md.obsidian"
    }

    func activate(app: ForegroundApp, title: String?) {
        currentApp = app
        startPolling()
        poll()
    }

    func update(app: ForegroundApp, title: String?) {
        currentApp = app
    }

    func deactivate() {
        pollTimer?.invalidate()
        pollTimer = nil
        currentApp = nil
        registration.clear()
        onStateChange?()
    }

    func setServerOnline(_ online: Bool) {
        registration.setServerOnline(online)
    }

    private func startPolling() {
        pollTimer?.invalidate()
        pollTimer = Timer.scheduledTimer(withTimeInterval: Self.pollInterval, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.poll()
            }
        }
    }

    private func poll() {
        guard let currentApp else { return }
        let candidates = Self.candidates(for: currentApp)
        registration.emitNow(candidates: candidates, reason: "obsidian")
        onStateChange?()
    }

    static func candidates(for app: ForegroundApp) -> [EnvironmentCandidate] {
        guard let data = try? Data(contentsOf: configURL),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let vaults = root["vaults"] as? [String: Any] else {
            return []
        }

        var candidatesById: [String: EnvironmentCandidate] = [:]
        for value in vaults.values {
            guard let entry = value as? [String: Any],
                  let isOpen = entry["open"] as? Bool, isOpen,
                  let path = entry["path"] as? String, !path.isEmpty else {
                continue
            }
            let vaultPath = URL(fileURLWithPath: path).standardizedFileURL.path
            let vaultName = URL(fileURLWithPath: vaultPath).lastPathComponent
            let vaultMetadata: [String: JSONValue] = [
                "bundleId": .string(app.bundleId),
                "appName": .string(app.name),
                "vaultName": .string(vaultName),
                "vaultPath": .string(vaultPath),
                "sourceName": .string("\(app.name) · \(vaultName)"),
            ]
            let vaultCandidate = EnvironmentCandidate(
                id: "mac:\(app.bundleId)/\(EnvironmentIDEncoding.encodePathComponent(vaultName))",
                metadata: vaultMetadata
            )
            candidatesById[vaultCandidate.id] = vaultCandidate

            for pluginId in enabledCommunityPlugins(vaultPath: vaultPath) {
                let pluginCandidate = EnvironmentCandidate(
                    id: "mac:\(app.bundleId)/_plugin/\(EnvironmentIDEncoding.encodePathComponent(pluginId))",
                    metadata: [
                        "bundleId": .string(app.bundleId),
                        "appName": .string(app.name),
                        "pluginId": .string(pluginId),
                        "sourceName": .string("\(app.name) Plugin · \(pluginId)"),
                    ]
                )
                candidatesById[pluginCandidate.id] = pluginCandidate
            }
        }

        return candidatesById.values.sorted { lhs, rhs in
            EnvironmentIDEncoding.depth(lhs.id) < EnvironmentIDEncoding.depth(rhs.id)
        }
    }

    private static func enabledCommunityPlugins(vaultPath: String) -> [String] {
        let pluginsURL = URL(fileURLWithPath: vaultPath)
            .appendingPathComponent(".obsidian/community-plugins.json")
        guard let data = try? Data(contentsOf: pluginsURL),
              let plugins = try? JSONSerialization.jsonObject(with: data) as? [String] else {
            return []
        }
        return Array(Set(plugins.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })).sorted()
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
    private let specializedProvidersByBundleId: [String: SpecializedEnvironmentProvider]
    private let genericProvider: SpecializedEnvironmentProvider
    private let baseRegistration: EnvironmentRegistrationController
    private var activeProvider: SpecializedEnvironmentProvider?
    private var currentApp: ForegroundApp?
    private var isServerOnline = false

    private var lastLoggedTitle: String?
    private var lastLoggedURL: String?
    private var lastLoggedDocumentValues: [String] = []
    private var lastLoggedBundleId: String?
    private var hasLoggedContext = false

    private(set) var foregroundEnvironmentId: String?
    private(set) var foregroundSiteEnvironmentId: String?
    private(set) var foregroundAppName: String?
    private(set) var foregroundWindowTitle: String?

    init(api: RookAPI, environmentFocusDelay: TimeInterval = 1) {
        self.api = api
        self.environmentFocusDelay = environmentFocusDelay
        let registerClosure: ([EnvironmentCandidate], String) -> Void = { candidates, reason in
            Task {
                for candidate in candidates {
                    do {
                        var metadata = candidate.metadata
                        metadata["registeredAt"] = .string(Self.iso8601String(from: Date()))
                        try await api.registerEnvironment(CandidateEnvironmentRecord(id: candidate.id, metadata: metadata))
                        providerLog("register ok [\(reason)]: \(candidate.id)")
                    } catch {
                        providerLog("register error [\(reason)]: \(error.localizedDescription)")
                    }
                }
            }
        }
        self.baseRegistration = EnvironmentRegistrationController(register: registerClosure)
        let obsidianProvider = ObsidianEnvironmentProvider(register: registerClosure)
        let genericProvider = GenericEnvironmentProvider(register: registerClosure)
        self.specializedProvidersByBundleId = ["md.obsidian": obsidianProvider]
        self.genericProvider = genericProvider

        for provider in Array(self.specializedProvidersByBundleId.values) + [self.genericProvider] {
            provider.onStateChange = { [weak self] in
                self?.syncPublishedEnvironmentState()
            }
        }

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
        baseRegistration.clear()
        activeProvider?.deactivate()
    }

    func setServerOnline(_ online: Bool) {
        isServerOnline = online
        baseRegistration.setServerOnline(online)
        activeProvider?.setServerOnline(online)
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
        currentApp = app
        activateProviderIfNeeded(for: app, title: title)
        updateBaseEnvironment(for: app, title: title)
        syncPublishedEnvironmentState()
    }

    private func handleContextRefresh(app: ForegroundApp, title: String?) {
        logRawContext(app: app, title: title, reason: "context-refresh")
        foregroundAppName = app.name
        foregroundWindowTitle = title
        currentApp = app
        activeProvider?.update(app: app, title: title)
        syncPublishedEnvironmentState()
    }

    private func activateProviderIfNeeded(for app: ForegroundApp, title: String?) {
        let nextProvider = specializedProvidersByBundleId[app.bundleId] ?? genericProvider
        if let activeProvider, activeProvider === nextProvider {
            activeProvider.update(app: app, title: title)
            return
        }
        activeProvider?.deactivate()
        activeProvider = nextProvider
        activeProvider?.setServerOnline(isServerOnline)
        activeProvider?.activate(app: app, title: title)
    }

    private func updateBaseEnvironment(for app: ForegroundApp, title: String?) {
        var metadata: [String: JSONValue] = [
            "bundleId": .string(app.bundleId),
            "appName": .string(app.name),
        ]
        if let title, !title.isEmpty {
            metadata["windowTitle"] = .string(title)
        }
        let candidate = EnvironmentCandidate(
            id: "mac:\(app.bundleId)",
            metadata: metadata.merging(["sourceName": .string(app.name)]) { _, new in new }
        )
        baseRegistration.update(candidates: [candidate], delay: environmentFocusDelay, reason: "app")
    }

    private func syncPublishedEnvironmentState() {
        foregroundEnvironmentId = currentApp.map { "mac:\($0.bundleId)" }
        foregroundSiteEnvironmentId = nil
        onStateChange?()
    }

    private func logRawContext(app: ForegroundApp, title: String?, reason: String) {
        let documentValues = AXReader.focusedWindowDocumentValues(pid: app.pid)
        let webURL = AXReader.activeTabURL(pid: app.pid)
        let appChanged = app.bundleId != lastLoggedBundleId
        let titleChanged = title != lastLoggedTitle
        let urlChanged = webURL != lastLoggedURL
        let documentChanged = documentValues != lastLoggedDocumentValues
        if hasLoggedContext, !appChanged, !titleChanged, !urlChanged, !documentChanged {
            return
        }
        hasLoggedContext = true
        lastLoggedBundleId = app.bundleId
        lastLoggedTitle = title
        lastLoggedURL = webURL
        lastLoggedDocumentValues = documentValues

        var lines: [String] = []
        lines.append("[RAW-CONTEXT] reason=\(reason)")
        lines.append("  mac:          \(app.name)  bundleId=\(app.bundleId)  pid=\(app.pid)")
        let titleText = title.map { "\"\($0)\"" } ?? "(null)"
        lines.append("  windowTitle:  \(titleText)")
        lines.append("  axDocument:   \(documentValues.isEmpty ? "(none)" : documentValues.joined(separator: " | "))")
        if let webURL {
            lines.append("  axWebURL:     \(webURL)")
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
