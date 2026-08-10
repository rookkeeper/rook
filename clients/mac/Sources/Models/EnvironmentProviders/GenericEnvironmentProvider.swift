import Foundation
import RookKit

private struct GenericEnvironmentObservation {
    let candidates: [EnvironmentCandidate]
    let normalizedIds: [String]
    let deepestDirEnvironmentId: String?
    let deepestWebEnvironmentId: String?
}

@MainActor
final class GenericEnvironmentProvider: SpecializedEnvironmentProvider {
    private static let pollInterval: TimeInterval = 5
    private static let logger = RookLog.environment
    private static let fileManager = FileManager.default
    private static let projectRootFileMarkers = [
        ".git",
        "Cargo.toml",
        "go.mod",
        "pyproject.toml",
        "Package.swift",
        "pom.xml",
        "build.gradle",
        "build.gradle.kts",
        "WORKSPACE",
        "WORKSPACE.bazel",
        "MODULE.bazel",
        "CMakeLists.txt",
    ]
    private static let projectRootDirectorySuffixes = [".xcodeproj", ".xcworkspace"]
    private static let projectRootFileSuffixes = [".sln"]
    private static let skillDirectoryMarkers = [
        ".agents/skills",
        ".claude/skills",
        ".codex/skills",
        ".cursor/skills",
        ".github/skills",
    ]
    private static let agentsMdMarker = "AGENTS.md"

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
        Self.logger.info("generic provider activate bundleId=\(app.bundleId, privacy: .public) title=\(title ?? "(null)", privacy: .public)")
        currentApp = app
        currentTitle = title
        previousNormalizedIds = nil
        startPolling()
        poll()
    }

    func update(app: ForegroundApp, title: String?) {
        Self.logger.info("generic provider update bundleId=\(app.bundleId, privacy: .public) title=\(title ?? "(null)", privacy: .public)")
        currentApp = app
        currentTitle = title
    }

    func deactivate() {
        Self.logger.info("generic provider deactivate bundleId=\(self.currentApp?.bundleId ?? "(none)", privacy: .public)")
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
        let timed = RookPerformance.begin(
            "GenericEnvironmentPoll",
            operation: "generic-environment-poll",
            description: "bundleId=\(app.bundleId)",
            logger: Self.logger,
            signposter: RookLog.environmentSignposter,
            slowThresholdMs: 150,
            hangThresholdMs: 600
        )
        let title = AXReader.focusedWindowTitle(pid: app.pid) ?? currentTitle
        currentTitle = title
        let observation = Self.observation(for: app, title: title)
        defer {
            previousNormalizedIds = observation.normalizedIds
            currentAppEnvironmentId = observation.deepestDirEnvironmentId
            currentSiteEnvironmentId = observation.deepestWebEnvironmentId
            onStateChange?()
        }
        guard let previousNormalizedIds, previousNormalizedIds == observation.normalizedIds else {
            Self.logger.info("generic provider observation changed bundleId=\(app.bundleId, privacy: .public) candidates=\(observation.candidates.count, privacy: .public)")
            timed.finish(details: "changed normalizedIds=\(observation.normalizedIds.count)")
            return
        }
        registration.emitNow(candidates: observation.candidates, reason: "generic")
        timed.finish(details: "stable normalizedIds=\(observation.normalizedIds.count) candidates=\(observation.candidates.count)")
    }

    private static func observation(for app: ForegroundApp, title: String?) -> GenericEnvironmentObservation {
        let documentValues = AXReader.focusedWindowDocumentValues(pid: app.pid)
        let webURL = AXReader.activeTabURL(pid: app.pid)
        var candidatesById: [String: EnvironmentCandidate] = [:]
        var deepestWebEnvironmentId: String?
        var deepestDirEnvironmentId: String?

        for rawValue in documentValues {
            if let normalizedPath = normalizedAbsolutePath(from: rawValue) {
                let dirCandidates = directoryCandidates(fromObservedPath: normalizedPath, app: app, title: title, rawValue: rawValue)
                deepestDirEnvironmentId = dirCandidates.last?.id ?? deepestDirEnvironmentId
                for candidate in dirCandidates {
                    candidatesById[candidate.id] = candidate
                }
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
            deepestDirEnvironmentId: deepestDirEnvironmentId,
            deepestWebEnvironmentId: deepestWebEnvironmentId
        )
    }

    private static func directoryCandidates(fromObservedPath observedPath: String, app: ForegroundApp, title: String?, rawValue: String) -> [EnvironmentCandidate] {
        let directories = candidateDirectories(forObservedPath: observedPath)
        return directories.compactMap { directoryPath in
            let detection = detectDirectorySignals(at: directoryPath)
            guard detection.isProjectLike || detection.isAgentic else { return nil }

            var metadata = CandidateMetadata.base(app: app, title: title)
            metadata["directoryPath"] = .string(directoryPath)
            metadata["axDocument"] = .string(rawValue)
            metadata["displayName"] = .string((directoryPath as NSString).lastPathComponent)
            metadata["observedPaths"] = .array([.string(observedPath)])
            if !detection.detectedSkillPaths.isEmpty {
                metadata["detectedSkillPaths"] = .array(detection.detectedSkillPaths.map { .string($0) })
            }
            if !detection.detectedAgentsMdPaths.isEmpty {
                metadata["detectedAgentsMdPaths"] = .array(detection.detectedAgentsMdPaths.map { .string($0) })
            }
            metadata["editableSkillPath"] = .string(detection.editableSkillPath)
            metadata["editableAgentMdPath"] = .string(detection.editableAgentMdPath)
            return EnvironmentCandidate(id: "dir:\(directoryPath)", metadata: metadata)
        }
    }

    private static func webCandidates(from rawURL: String, app: ForegroundApp, title: String?) -> [EnvironmentCandidate] {
        let ids = webEnvironmentIds(from: rawURL)
        guard !ids.isEmpty else { return [] }
        return ids.map { environmentId in
            var metadata = CandidateMetadata.base(app: app, title: title)
            metadata["url"] = .string(rawURL)
            metadata["displayName"] = .string(webDisplayName(for: environmentId))
            metadata["observedUrls"] = .array([.string(rawURL)])
            return EnvironmentCandidate(id: environmentId, metadata: metadata)
        }
    }

    private static func candidateDirectories(forObservedPath observedPath: String) -> [String] {
        let homeDir = URL(fileURLWithPath: NSHomeDirectory()).standardizedFileURL.path
        guard observedPath.hasPrefix(homeDir + "/") else { return [] }

        var isDirectory: ObjCBool = false
        let exists = fileManager.fileExists(atPath: observedPath, isDirectory: &isDirectory)
        var current = exists && isDirectory.boolValue ? observedPath : (observedPath as NSString).deletingLastPathComponent
        var result: [String] = []
        while current.hasPrefix(homeDir + "/") && current != homeDir {
            result.append(current)
            let parent = (current as NSString).deletingLastPathComponent
            if parent == current || parent.count < homeDir.count { break }
            current = parent
        }
        return result.reversed()
    }

    private static func detectDirectorySignals(at directoryPath: String) -> DirectorySignalDetection {
        let entries = (try? fileManager.contentsOfDirectory(atPath: directoryPath)) ?? []
        let entrySet = Set(entries)

        let hasProjectMarker = projectRootFileMarkers.contains(where: entrySet.contains)
            || projectRootDirectorySuffixes.contains(where: { suffix in entries.contains(where: { $0.hasSuffix(suffix) }) })
            || projectRootFileSuffixes.contains(where: { suffix in entries.contains(where: { $0.hasSuffix(suffix) }) })

        let detectedAgentsMdPaths = entrySet.contains(agentsMdMarker) ? [directoryPath + "/" + agentsMdMarker] : []
        let detectedSkillPaths = skillDirectoryMarkers
            .map { directoryPath + "/" + $0 }
            .filter { fileManager.fileExists(atPath: $0) }

        let editableSkillPath = detectedSkillPaths.first ?? (directoryPath + "/.agents/skills")
        let editableAgentMdPath = detectedAgentsMdPaths.first ?? (directoryPath + "/AGENTS.md")

        return DirectorySignalDetection(
            isProjectLike: hasProjectMarker,
            isAgentic: !detectedAgentsMdPaths.isEmpty || !detectedSkillPaths.isEmpty,
            detectedSkillPaths: detectedSkillPaths,
            detectedAgentsMdPaths: detectedAgentsMdPaths,
            editableSkillPath: editableSkillPath,
            editableAgentMdPath: editableAgentMdPath
        )
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
        return ["web:\(host)"]
    }

    private static func webDisplayName(for environmentId: String) -> String {
        let path = environmentId.replacingOccurrences(of: "web:", with: "")
        let parts = path.split(separator: "/").map(String.init)
        guard let first = parts.first else { return environmentId }
        if parts.count == 1 { return first }
        return ([first] + parts.dropFirst()).joined(separator: " / ")
    }

    static func warningForNonAbsoluteDirectoryCandidate(rawValue: String, app: ForegroundApp) {
        logger.warning("generic provider skipped non-absolute directory candidate bundleId=\(app.bundleId, privacy: .public) value=\(rawValue, privacy: .public)")
    }
}

private struct DirectorySignalDetection {
    let isProjectLike: Bool
    let isAgentic: Bool
    let detectedSkillPaths: [String]
    let detectedAgentsMdPaths: [String]
    let editableSkillPath: String
    let editableAgentMdPath: String
}
