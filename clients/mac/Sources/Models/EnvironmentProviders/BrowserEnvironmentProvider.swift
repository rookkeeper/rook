import Foundation
import RookKit

@MainActor
final class BrowserEnvironmentProvider: SpecializedEnvironmentProvider {
    private static let pollInterval: TimeInterval = 5

    let supportedBundleIds = [
        "com.apple.Safari",
        "org.mozilla.firefox",
    ]
    var onStateChange: (() -> Void)?
    private(set) var currentAppEnvironmentId: String?
    private(set) var currentSiteEnvironmentId: String?

    private let registration: EnvironmentRegistrationController
    private var pollTimer: Timer?
    private var urlReadTask: Task<Void, Never>?
    private var currentApp: ForegroundApp?
    private var currentTitle: String?

    init(register: @escaping ([EnvironmentCandidate], String) -> Void) {
        self.registration = EnvironmentRegistrationController(register: register)
    }

    func activate(app: ForegroundApp, title: String?) {
        currentApp = app
        currentTitle = title
        currentAppEnvironmentId = Self.appEnvironmentId(bundleId: app.bundleId)
        startPolling()
        poll()
    }

    func update(app: ForegroundApp, title: String?) {
        currentApp = app
        currentTitle = title
        currentAppEnvironmentId = Self.appEnvironmentId(bundleId: app.bundleId)
        urlReadTask?.cancel()
    }

    func deactivate() {
        pollTimer?.invalidate()
        pollTimer = nil
        urlReadTask?.cancel()
        urlReadTask = nil
        currentApp = nil
        currentTitle = nil
        currentAppEnvironmentId = nil
        currentSiteEnvironmentId = nil
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
        currentAppEnvironmentId = Self.appEnvironmentId(bundleId: currentApp.bundleId)
        let app = currentApp
        urlReadTask?.cancel()
        urlReadTask = Task.detached { [weak self] in
            let url = AXReader.activeTabURL(pid: app.pid)
            guard !Task.isCancelled else { return }
            await self?.apply(url: url, for: app)
        }
    }

    private func apply(url: String?, for app: ForegroundApp) {
        guard currentApp == app else { return }
        currentSiteEnvironmentId = Self.siteEnvironmentId(from: url)
        registration.emitNow(candidates: Self.candidates(for: app, title: currentTitle, url: url), reason: "browser")
        onStateChange?()
    }

    static func appEnvironmentId(bundleId: String) -> String {
        "mac:\(bundleId)"
    }

    static func siteEnvironmentId(from url: String?) -> String? {
        guard let url else { return nil }
        return GenericEnvironmentProvider.webEnvironmentIds(from: url).last
    }

    static func candidates(for app: ForegroundApp, title: String?, url: String?) -> [EnvironmentCandidate] {
        guard let url,
              let environmentId = siteEnvironmentId(from: url) else {
            return []
        }

        var metadata = CandidateMetadata.base(app: app, title: title)
        metadata["url"] = .string(url)
        metadata["displayName"] = .string(environmentId.replacingOccurrences(of: "web:", with: ""))
        metadata["observedUrls"] = .array([.string(url)])
        return [EnvironmentCandidate(id: environmentId, metadata: metadata)]
    }
}
