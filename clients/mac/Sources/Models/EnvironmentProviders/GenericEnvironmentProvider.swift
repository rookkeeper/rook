import Foundation
import OSLog
import RookKit

private struct GenericEnvironmentObservation {
    let candidates: [EnvironmentCandidate]
    let normalizedIds: [String]
    let deepestWebEnvironmentId: String?
}

@MainActor
final class GenericEnvironmentProvider: SpecializedEnvironmentProvider {
    private static let pollInterval: TimeInterval = 5
    private static let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.rookery.rook", category: "GenericEnvironmentProvider")

    let supportedBundleIds: [String] = []
    var onStateChange: (() -> Void)?
    private(set) var currentAppEnvironmentId: String?
    private(set) var currentSiteEnvironmentId: String?

    private let registration: EnvironmentRegistrationController
    private var pollTimer: Timer?
    private var currentApp: ForegroundApp?
    private var currentTitle: String?
    private var previousNormalizedIds: [String]?

    init(register: @escaping ([EnvironmentCandidate], String) -> Void) {
        self.registration = EnvironmentRegistrationController(register: register)
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
        guard let app = currentApp else { return }
        let title = AXReader.focusedWindowTitle(pid: app.pid) ?? currentTitle
        currentTitle = title
        let observation = Self.observation(for: app, title: title)
        defer {
            previousNormalizedIds = observation.normalizedIds
            currentSiteEnvironmentId = observation.deepestWebEnvironmentId
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
        var deepestWebEnvironmentId: String?

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
            deepestWebEnvironmentId = webCandidates.last?.id ?? deepestWebEnvironmentId
            for candidate in webCandidates {
                candidatesById[candidate.id] = candidate
            }
        }

        if let webURL {
            let webCandidates = webCandidates(from: webURL, app: app, title: title)
            deepestWebEnvironmentId = webCandidates.last?.id ?? deepestWebEnvironmentId
            for candidate in webCandidates {
                candidatesById[candidate.id] = candidate
            }
        }

        let candidates = candidatesById.values.sorted { lhs, rhs in
            EnvironmentIDEncoding.depth(lhs.id) < EnvironmentIDEncoding.depth(rhs.id)
        }
        return GenericEnvironmentObservation(
            candidates: candidates,
            normalizedIds: candidates.map(\.id),
            deepestWebEnvironmentId: deepestWebEnvironmentId
        )
    }

    private static func directoryCandidate(path: String, app: ForegroundApp, title: String?, rawValue: String) -> EnvironmentCandidate {
        var metadata = CandidateMetadata.base(app: app, title: title)
        metadata["directoryPath"] = .string(path)
        metadata["axDocument"] = .string(rawValue)
        metadata["sourceName"] = .string(path)
        return EnvironmentCandidate(id: "dir:\(path)", metadata: metadata)
    }

    private static func webCandidates(from rawURL: String, app: ForegroundApp, title: String?) -> [EnvironmentCandidate] {
        let ids = webEnvironmentIds(from: rawURL)
        guard !ids.isEmpty else { return [] }
        var metadata = CandidateMetadata.base(app: app, title: title)
        metadata["url"] = .string(rawURL)
        metadata["sourceName"] = .string(rawURL)
        metadata["canonicalSourceUrl"] = .string(rawURL)
        return ids.map { EnvironmentCandidate(id: $0, metadata: metadata) }
    }

    static func normalizedAbsolutePath(from rawValue: String) -> String? {
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
