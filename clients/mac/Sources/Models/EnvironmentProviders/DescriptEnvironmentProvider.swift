import Foundation
import RookKit

@MainActor
final class DescriptEnvironmentProvider: SpecializedEnvironmentProvider {
    static let configURL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/Descript/config.json")

    private static let pollInterval: TimeInterval = 5

    let supportedBundleIds = ["com.descript.beachcube"]
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
        registration.emitNow(candidates: candidates, reason: "descript")
        onStateChange?()
    }

    static func currentEnvironmentId(bundleId: String, title: String?) -> String? {
        guard let title, let projectName = projectName(from: title) else { return nil }
        return projectEnvironmentId(bundleId: bundleId, projectName: projectName)
    }

    static func projectName(from title: String) -> String? {
        let suffix = " - Descript"
        guard title.hasSuffix(suffix) else { return nil }
        let trimmed = String(title.dropLast(suffix.count)).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if let range = trimmed.range(of: " - ") {
            let project = trimmed[..<range.lowerBound].trimmingCharacters(in: .whitespacesAndNewlines)
            return project.isEmpty ? nil : project
        }
        return trimmed
    }

    static func candidates(for app: ForegroundApp, title: String?) -> [EnvironmentCandidate] {
        candidates(for: app, title: title, configURL: configURL)
    }

    static func candidates(for app: ForegroundApp, title: String?, configURL: URL) -> [EnvironmentCandidate] {
        guard let title, let projectName = projectName(from: title) else { return [] }

        var metadata = CandidateMetadata.base(app: app, title: title)
        metadata["projectName"] = .string(projectName)
        metadata["displayName"] = .string("\(app.name) · \(projectName)")

        if let route = focusedRoute(from: configURL) {
            metadata["route"] = .string(route)
            if let context = routeContext(from: route) {
                metadata["projectId"] = .string(context.projectId)
                if let compositionId = context.compositionId {
                    metadata["compositionId"] = .string(compositionId)
                }
            }
        }

        return [
            EnvironmentCandidate(
                id: projectEnvironmentId(bundleId: app.bundleId, projectName: projectName),
                metadata: metadata
            )
        ]
    }

    static func focusedRoute(from configURL: URL) -> String? {
        guard let data = try? Data(contentsOf: configURL),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let windows = root["windows"] as? [[String: Any]] else {
            return nil
        }

        if let focused = windows.first(where: { ($0["focused"] as? Bool) == true }),
           let route = focused["route"] as? String,
           !route.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return route
        }

        if let first = windows.first,
           let route = first["route"] as? String,
           !route.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return route
        }

        if let lastClosed = root["lastClosedWindow"] as? [String: Any],
           let route = lastClosed["route"] as? String,
           !route.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return route
        }

        return nil
    }

    static func routeContext(from route: String) -> DescriptRouteContext? {
        guard let components = URLComponents(string: route) else { return nil }
        let segments = components.percentEncodedPath
            .split(separator: "/")
            .map(String.init)
            .filter { !$0.isEmpty }
        guard let projectId = segments.first else { return nil }
        let compositionId = segments.count > 1 ? segments[1] : nil
        return DescriptRouteContext(projectId: projectId, compositionId: compositionId)
    }

    static func projectEnvironmentId(bundleId: String, projectName: String) -> String {
        "mac:\(bundleId)/\(EnvironmentIDEncoding.encodePathComponent(projectName))"
    }
}

struct DescriptRouteContext: Equatable {
    let projectId: String
    let compositionId: String?
}
