import Foundation
import RookKit

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
                        providerInfo("environment register ok reason=\(reason) id=\(candidate.id)")
                    } catch {
                        providerError("environment register failed reason=\(reason) id=\(candidate.id) error=\(error.localizedDescription)")
                    }
                }
            }
        }
        self.baseRegistration = EnvironmentRegistrationController(register: registerClosure)
        self.specializedProvidersByBundleId = SpecialistProviderRegistry.makeProviders(register: registerClosure)
        self.genericProvider = GenericEnvironmentProvider(register: registerClosure)

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
        providerInfo("app environment provider serverOnline=\(online)")
        isServerOnline = online
        baseRegistration.setServerOnline(online)
        activeProvider?.setServerOnline(online)
    }

    func refreshCurrentContext() {
        monitor.refreshTitleNow()
    }

    private func handleForegroundApp(_ app: ForegroundApp) {
        providerInfo("handle foreground app bundleId=\(app.bundleId) pid=\(app.pid)")
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
        providerInfo("handle context refresh bundleId=\(app.bundleId) title=\(title ?? "(null)")")
        logRawContext(app: app, title: title, reason: "context-refresh")
        foregroundAppName = app.name
        foregroundWindowTitle = title
        currentApp = app
        activeProvider?.update(app: app, title: title)
        syncPublishedEnvironmentState()
    }

    private func activateProviderIfNeeded(for app: ForegroundApp, title: String?) {
        let nextProvider = specializedProvidersByBundleId[app.bundleId] ?? genericProvider
        providerInfo("activate provider bundleId=\(app.bundleId) specialized=\(specializedProvidersByBundleId[app.bundleId] != nil)")
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
        var metadata = CandidateMetadata.base(app: app, title: title)
        metadata["displayName"] = .string(app.name)
        let candidate = EnvironmentCandidate(
            id: "mac:\(app.bundleId)",
            metadata: metadata
        )
        baseRegistration.update(candidates: [candidate], delay: environmentFocusDelay, reason: "app")
    }

    private func syncPublishedEnvironmentState() {
        foregroundEnvironmentId = activeProvider?.currentAppEnvironmentId ?? currentApp.map { "mac:\($0.bundleId)" }
        foregroundSiteEnvironmentId = activeProvider?.currentSiteEnvironmentId
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

        providerInfo("context reason=\(reason) app=\(app.name) bundleId=\(app.bundleId) pid=\(app.pid) titlePresent=\(title != nil) documents=\(documentValues.count) webURLPresent=\(webURL != nil) trustedAX=\(AXReader.isTrusted())")
        if RookLog.verboseEnabled {
            providerDebug("context raw reason=\(reason) app=\(app.name) bundleId=\(app.bundleId) title=\(title ?? "(null)") documents=\(documentValues.joined(separator: " | ")) webURL=\(webURL ?? "(null)")")
        }
    }

    private static func iso8601String(from date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
}
