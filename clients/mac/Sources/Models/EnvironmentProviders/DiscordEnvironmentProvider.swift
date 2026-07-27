import Foundation
import RookKit

@MainActor
final class DiscordEnvironmentProvider: SpecializedEnvironmentProvider {
    private static let pollInterval: TimeInterval = 5

    let supportedBundleIds = ["com.hnc.Discord"]
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
        registration.emitNow(candidates: candidates, reason: "discord")
        onStateChange?()
    }

    static func currentEnvironmentId(bundleId: String, title: String?) -> String? {
        guard let title, let context = titleContext(from: title) else { return nil }
        switch context {
        case let .serverChannel(serverName, channelName):
            return channelEnvironmentId(bundleId: bundleId, serverName: serverName, channelName: channelName)
        case let .directMessage(name):
            return directMessageEnvironmentId(bundleId: bundleId, name: name)
        }
    }

    static func candidates(for app: ForegroundApp, title: String?) -> [EnvironmentCandidate] {
        guard let title, let context = titleContext(from: title) else { return [] }

        switch context {
        case let .serverChannel(serverName, channelName):
            var serverMetadata = CandidateMetadata.base(app: app, title: title)
            serverMetadata["serverName"] = .string(serverName)
            serverMetadata["sourceName"] = .string("\(app.name) · \(serverName)")
            let serverId = serverEnvironmentId(bundleId: app.bundleId, serverName: serverName)

            var channelMetadata = serverMetadata
            channelMetadata["channelName"] = .string(channelName)
            channelMetadata["sourceName"] = .string("\(app.name) · \(serverName) · #\(channelName)")
            let channelId = channelEnvironmentId(bundleId: app.bundleId, serverName: serverName, channelName: channelName)

            return [
                EnvironmentCandidate(id: serverId, metadata: serverMetadata),
                EnvironmentCandidate(id: channelId, metadata: channelMetadata),
            ]

        case let .directMessage(name):
            var metadata = CandidateMetadata.base(app: app, title: title)
            metadata["dmName"] = .string(name)
            metadata["sourceName"] = .string("\(app.name) · \(name)")
            return [
                EnvironmentCandidate(
                    id: directMessageEnvironmentId(bundleId: app.bundleId, name: name),
                    metadata: metadata
                )
            ]
        }
    }

    static func titleContext(from title: String) -> DiscordTitleContext? {
        let suffix = " - Discord"
        guard title.hasSuffix(suffix) else { return nil }
        let trimmed = String(title.dropLast(suffix.count)).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        let parts = trimmed.components(separatedBy: " | ")
        if parts.count == 2 {
            let rawChannelName = parts[0].trimmingCharacters(in: .whitespacesAndNewlines)
            let serverName = parts[1].trimmingCharacters(in: .whitespacesAndNewlines)
            let channelName = rawChannelName.hasPrefix("#") ? String(rawChannelName.dropFirst()) : rawChannelName
            guard !channelName.isEmpty, !serverName.isEmpty else { return nil }
            return .serverChannel(serverName: serverName, channelName: channelName)
        }

        if trimmed.hasPrefix("@") {
            return .directMessage(name: trimmed)
        }

        return nil
    }

    static func serverEnvironmentId(bundleId: String, serverName: String) -> String {
        "mac:\(bundleId)/\(EnvironmentIDEncoding.encodePathComponent(serverName))"
    }

    static func channelEnvironmentId(bundleId: String, serverName: String, channelName: String) -> String {
        "\(serverEnvironmentId(bundleId: bundleId, serverName: serverName))/\(EnvironmentIDEncoding.encodePathComponent(channelName))"
    }

    static func directMessageEnvironmentId(bundleId: String, name: String) -> String {
        "mac:\(bundleId)/_dm/\(EnvironmentIDEncoding.encodePathComponent(name))"
    }
}

enum DiscordTitleContext: Equatable {
    case serverChannel(serverName: String, channelName: String)
    case directMessage(name: String)
}
