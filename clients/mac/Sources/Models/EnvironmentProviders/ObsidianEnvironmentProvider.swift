import Foundation
import RookKit

@MainActor
final class ObsidianEnvironmentProvider: SpecializedEnvironmentProvider {
    static let configURL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/obsidian/obsidian.json")

    private static let pollInterval: TimeInterval = 5

    let supportedBundleIds = ["md.obsidian"]
    var onStateChange: (() -> Void)?
    private(set) var currentAppEnvironmentId: String?
    var currentSiteEnvironmentId: String? { nil }

    private let registration: EnvironmentRegistrationController
    private var pollTimer: Timer?
    private var currentApp: ForegroundApp?
    private var currentTitle: String?

    init(register: @escaping ([EnvironmentCandidate], String) -> Void) {
        self.registration = EnvironmentRegistrationController(register: register)
    }

    func activate(app: ForegroundApp, title: String?) {
        currentApp = app
        currentTitle = title
        currentAppEnvironmentId = Self.currentVaultEnvironmentId(bundleId: app.bundleId, title: title)
        startPolling()
        poll()
    }

    func update(app: ForegroundApp, title: String?) {
        currentApp = app
        currentTitle = title
        currentAppEnvironmentId = Self.currentVaultEnvironmentId(bundleId: app.bundleId, title: title)
    }

    func deactivate() {
        pollTimer?.invalidate()
        pollTimer = nil
        currentApp = nil
        currentTitle = nil
        currentAppEnvironmentId = nil
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
        let title = currentTitle
        currentAppEnvironmentId = Self.currentVaultEnvironmentId(bundleId: currentApp.bundleId, title: title)
        let candidates = Self.candidates(for: currentApp, title: title)
        registration.emitNow(candidates: candidates, reason: "obsidian")
        onStateChange?()
    }

    static func vaultName(from title: String) -> String? {
        let suffix = " - Obsidian"
        guard title.hasSuffix(suffix) else { return nil }
        let trimmed = String(title.dropLast(suffix.count)).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if let range = trimmed.range(of: " - ", options: .backwards) {
            let candidate = trimmed[range.upperBound...].trimmingCharacters(in: .whitespacesAndNewlines)
            return candidate.isEmpty ? nil : candidate
        }
        return trimmed
    }

    static func currentVaultEnvironmentId(bundleId: String, title: String?) -> String? {
        guard let title, let vaultName = vaultName(from: title) else { return nil }
        return "mac:\(bundleId)/\(EnvironmentIDEncoding.encodePathComponent(vaultName))"
    }

    static func candidates(for app: ForegroundApp, title: String?) -> [EnvironmentCandidate] {
        candidates(for: app, title: title, configURL: configURL)
    }

    static func candidates(for app: ForegroundApp, title: String?, configURL: URL) -> [EnvironmentCandidate] {
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
            var vaultMetadata = CandidateMetadata.base(app: app, title: title)
            vaultMetadata["vaultName"] = .string(vaultName)
            vaultMetadata["vaultPath"] = .string(vaultPath)
            vaultMetadata["displayName"] = .string("\(app.name) · \(vaultName)")
            let vaultCandidate = EnvironmentCandidate(
                id: "mac:\(app.bundleId)/\(EnvironmentIDEncoding.encodePathComponent(vaultName))",
                metadata: vaultMetadata
            )
            candidatesById[vaultCandidate.id] = vaultCandidate

            for pluginId in enabledCommunityPlugins(vaultPath: vaultPath) {
                var pluginMetadata = CandidateMetadata.base(app: app, title: title)
                pluginMetadata["pluginId"] = .string(pluginId)
                pluginMetadata["displayName"] = .string("\(app.name) Plugin · \(pluginId)")
                let pluginCandidate = EnvironmentCandidate(
                    id: "mac:\(app.bundleId)/_plugin/\(EnvironmentIDEncoding.encodePathComponent(pluginId))",
                    metadata: pluginMetadata
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
