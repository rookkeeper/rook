import Foundation
import RookKit

@MainActor
final class OBSStudioEnvironmentProvider: SpecializedEnvironmentProvider {
    private static let pollInterval: TimeInterval = 5
    private static let configRoot = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/obs-studio/basic")

    let supportedBundleIds = ["com.obsproject.obs-studio"]
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
        currentAppEnvironmentId = Self.currentEnvironmentId(bundleId: app.bundleId, title: title)
        startPolling()
        poll()
    }

    func update(app: ForegroundApp, title: String?) {
        currentApp = app
        currentTitle = title
        currentAppEnvironmentId = Self.currentEnvironmentId(bundleId: app.bundleId, title: title)
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
        let title = AXReader.focusedWindowTitle(pid: currentApp.pid) ?? currentTitle
        currentTitle = title
        currentAppEnvironmentId = Self.currentEnvironmentId(bundleId: currentApp.bundleId, title: title)
        let candidates = Self.candidates(for: currentApp, title: title)
        registration.emitNow(candidates: candidates, reason: "obs-studio")
        onStateChange?()
    }

    static func currentEnvironmentId(bundleId: String, title: String?) -> String? {
        guard let title, let context = titleContext(from: title) else { return nil }
        return sceneCollectionEnvironmentId(bundleId: bundleId, sceneCollectionName: context.sceneCollectionName)
    }

    static func candidates(for app: ForegroundApp, title: String?) -> [EnvironmentCandidate] {
        guard let title, let context = titleContext(from: title) else {
            return []
        }

        var metadata = CandidateMetadata.base(app: app, title: title)
        metadata["sceneCollectionName"] = .string(context.sceneCollectionName)
        metadata["profileName"] = .string(context.profileName)
        metadata["displayName"] = .string("\(app.name) · \(context.sceneCollectionName)")

        let sceneCollectionPath = configRoot
            .appendingPathComponent("scenes")
            .appendingPathComponent("\(context.sceneCollectionName).json")
            .path
        if FileManager.default.fileExists(atPath: sceneCollectionPath) {
            metadata["sceneCollectionPath"] = .string(sceneCollectionPath)
        }

        let profilePath = configRoot
            .appendingPathComponent("profiles")
            .appendingPathComponent(context.profileName)
            .path
        if FileManager.default.fileExists(atPath: profilePath) {
            metadata["profilePath"] = .string(profilePath)
        }

        return [
            EnvironmentCandidate(
                id: sceneCollectionEnvironmentId(bundleId: app.bundleId, sceneCollectionName: context.sceneCollectionName),
                metadata: metadata
            )
        ]
    }

    static func titleContext(from title: String) -> OBSTitleContext? {
        let parts = title.components(separatedBy: " - ")
        guard parts.count >= 3 else { return nil }

        var profileName: String?
        var sceneCollectionName: String?
        for part in parts {
            if part.hasPrefix("Profile: ") {
                profileName = String(part.dropFirst("Profile: ".count)).trimmingCharacters(in: .whitespacesAndNewlines)
            } else if part.hasPrefix("Scenes: ") {
                sceneCollectionName = String(part.dropFirst("Scenes: ".count)).trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }

        guard let profileName, !profileName.isEmpty,
              let sceneCollectionName, !sceneCollectionName.isEmpty else {
            return nil
        }
        return OBSTitleContext(profileName: profileName, sceneCollectionName: sceneCollectionName)
    }

    static func sceneCollectionEnvironmentId(bundleId: String, sceneCollectionName: String) -> String {
        "mac:\(bundleId)/\(EnvironmentIDEncoding.encodePathComponent(sceneCollectionName))"
    }
}

struct OBSTitleContext: Equatable {
    let profileName: String
    let sceneCollectionName: String
}
