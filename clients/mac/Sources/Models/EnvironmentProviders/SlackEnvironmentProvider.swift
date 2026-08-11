import Foundation
import RookKit

@MainActor
final class SlackEnvironmentProvider: SpecializedEnvironmentProvider {
    private static let pollInterval: TimeInterval = 5

    let supportedBundleIds = ["com.tinyspeck.slackmacgap"]
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
        let title = currentTitle
        currentAppEnvironmentId = Self.currentEnvironmentId(bundleId: currentApp.bundleId, title: title)
        let candidates = Self.candidates(for: currentApp, title: title)
        registration.emitNow(candidates: candidates, reason: "slack")
        onStateChange?()
    }

    static func currentEnvironmentId(bundleId: String, title: String?) -> String? {
        guard let title, let context = titleContext(from: title) else { return nil }
        if let channelName = context.channelName {
            return channelEnvironmentId(bundleId: bundleId, workspaceName: context.workspaceName, channelName: channelName)
        }
        return teamEnvironmentId(bundleId: bundleId, workspaceName: context.workspaceName)
    }

    static func candidates(for app: ForegroundApp, title: String?) -> [EnvironmentCandidate] {
        guard let title, let context = titleContext(from: title) else {
            return []
        }

        var candidates: [EnvironmentCandidate] = []
        var workspaceMetadata = CandidateMetadata.base(app: app, title: title)
        workspaceMetadata["workspaceName"] = .string(context.workspaceName)
        workspaceMetadata["displayName"] = .string("\(app.name) · \(context.workspaceName)")
        let workspaceId = teamEnvironmentId(bundleId: app.bundleId, workspaceName: context.workspaceName)
        candidates.append(EnvironmentCandidate(id: workspaceId, metadata: workspaceMetadata))

        if let channelName = context.channelName {
            var channelMetadata = workspaceMetadata
            channelMetadata["channelName"] = .string(channelName)
            channelMetadata["displayName"] = .string("\(app.name) · \(context.workspaceName) · #\(channelName)")
            let channelId = channelEnvironmentId(bundleId: app.bundleId, workspaceName: context.workspaceName, channelName: channelName)
            candidates.append(EnvironmentCandidate(id: channelId, metadata: channelMetadata))
        }

        return candidates
    }

    static func titleContext(from title: String) -> SlackTitleContext? {
        let suffix = " - Slack"
        guard title.hasSuffix(suffix) else { return nil }
        let trimmed = String(title.dropLast(suffix.count))
        let segments = trimmed.components(separatedBy: " - ")
        guard segments.count >= 2 else { return nil }
        let leading = segments[0].trimmingCharacters(in: .whitespacesAndNewlines)
        let workspaceName = segments[1].trimmingCharacters(in: .whitespacesAndNewlines)
        guard !workspaceName.isEmpty else { return nil }

        guard let openParen = leading.lastIndex(of: "("),
              leading.hasSuffix(")") else {
            return SlackTitleContext(workspaceName: workspaceName, channelName: nil)
        }

        let kindStart = leading.index(after: openParen)
        let kind = leading[kindStart..<leading.index(before: leading.endIndex)].trimmingCharacters(in: .whitespacesAndNewlines)
        let name = leading[..<openParen].trimmingCharacters(in: .whitespacesAndNewlines)
        guard kind.caseInsensitiveCompare("Channel") == .orderedSame, !name.isEmpty else {
            return SlackTitleContext(workspaceName: workspaceName, channelName: nil)
        }
        return SlackTitleContext(workspaceName: workspaceName, channelName: name)
    }

    static func teamEnvironmentId(bundleId: String, workspaceName: String) -> String {
        "mac:\(bundleId)/\(EnvironmentIDEncoding.encodePathComponent(workspaceName))"
    }

    static func channelEnvironmentId(bundleId: String, workspaceName: String, channelName: String) -> String {
        "\(teamEnvironmentId(bundleId: bundleId, workspaceName: workspaceName))/\(EnvironmentIDEncoding.encodePathComponent(channelName))"
    }
}

struct SlackTitleContext: Equatable {
    let workspaceName: String
    let channelName: String?
}
