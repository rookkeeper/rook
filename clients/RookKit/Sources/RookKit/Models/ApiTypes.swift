import Foundation

public struct AgentDefinition: Codable, Equatable, Identifiable {
    public let id: String
    public let parentId: String?

    public init(id: String, parentId: String?) {
        self.id = id
        self.parentId = parentId
    }
}

/// Wraps the raw session record JSON so resume can send the record back to
/// ACP session summaries plus Rook `_meta` fields, including fields this app doesn't model.
public enum SessionSelectionStatus: String, Equatable {
    case active
    case ready
    case error
    case on
    case off

    public var label: String {
        switch self {
        case .active: return "Active"
        case .ready: return "Ready"
        case .error: return "Error"
        case .on: return "On"
        case .off: return "Off"
        }
    }
}

public struct AgentSessionSummary: Equatable, Identifiable {
    public let raw: JSONValue

    public init(raw: JSONValue) {
        self.raw = raw
    }

    public var id: String { raw["sessionId"]?.stringValue ?? "" }
    public var agent: String { raw["runtimeId"]?.stringValue ?? "" }
    public var supportsImagePrompts: Bool { raw["supportsImagePrompts"]?.boolValue ?? false }
    public var name: String { raw["title"]?.stringValue ?? "session" }
    public var running: Bool { raw["running"]?.boolValue ?? false }
    public var activityStatus: SessionSelectionStatus {
        SessionSelectionStatus(rawValue: raw["activityStatus"]?.stringValue ?? "") ?? .off
    }
    public var connectedClients: Int { Int(raw["connectedClients"]?.numberValue ?? 0) }
    public var updatedAtISO: String? { raw["updatedAt"]?.stringValue }
    public var startedAtISO: String? { raw["startedAt"]?.stringValue }

    public var createdAt: Date? {
        guard let iso = startedAtISO else {
            return nil
        }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: iso) {
            return date
        }
        return ISO8601DateFormatter().date(from: iso)
    }

    public var createdAtLabel: String {
        formatDate(createdAt)
    }

    public var updatedAtLabel: String {
        formatDate(dateFromISO(updatedAtISO))
    }

    public func updating(title: String? = nil, updatedAtISO: String? = nil, running: Bool? = nil) -> AgentSessionSummary {
        var object: [String: JSONValue] = [
            "sessionId": .string(id),
            "title": .string(title ?? name),
            "running": .bool(running ?? self.running),
        ]
        if let runtimeId = raw["runtimeId"]?.stringValue { object["runtimeId"] = .string(runtimeId) }
        if let cwd = raw["cwd"]?.stringValue { object["cwd"] = .string(cwd) }
        if let startedAt = raw["startedAt"]?.stringValue { object["startedAt"] = .string(startedAt) }
        if let supportsImagePrompts = raw["supportsImagePrompts"]?.boolValue { object["supportsImagePrompts"] = .bool(supportsImagePrompts) }
        if let connectedClients = raw["connectedClients"]?.numberValue { object["connectedClients"] = .number(connectedClients) }
        if let activityStatus = raw["activityStatus"]?.stringValue { object["activityStatus"] = .string(activityStatus) }
        if let updatedAtISO { object["updatedAt"] = .string(updatedAtISO) }
        else if let updatedAt = raw["updatedAt"]?.stringValue { object["updatedAt"] = .string(updatedAt) }
        return AgentSessionSummary(raw: .object(object))
    }

    private func dateFromISO(_ value: String?) -> Date? {
        guard let iso = value else { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: iso) { return date }
        return ISO8601DateFormatter().date(from: iso)
    }

    private func formatDate(_ date: Date?) -> String {
        guard let date else { return "" }
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

public struct CandidateEnvironmentRecord: Encodable, Equatable {
    public let id: String
    public let metadata: [String: JSONValue]

    public init(id: String, metadata: [String: JSONValue]) {
        self.id = id
        self.metadata = metadata
    }
}

public struct EnvironmentArtifactPreview: Codable, Equatable, Identifiable {
    public let id: String
    public let files: [String: String]

    public init(id: String, files: [String: String]) {
        self.id = id
        self.files = files
    }

    public var sortedFilePaths: [String] {
        files.keys.sorted()
    }

    /// The artifact's main Markdown document: `<id>/SKILL.md`, then a bare
    /// `SKILL.md`, then the first `.md` file by path.
    public var primaryMarkdown: String? {
        if let content = files["\(id)/SKILL.md"] { return content }
        if let content = files["SKILL.md"] { return content }
        guard let path = sortedFilePaths.first(where: { $0.lowercased().hasSuffix(".md") }) else { return nil }
        return files[path]
    }
}

/// Phone -> server payload asking which `location:` environments are likely
/// available at the current location (issue #42, phase 1).
public struct IdentifyAvailableRequest: Encodable, Equatable {
    public var latitude: Double
    public var longitude: Double
    public var horizontalAccuracy: Double?
    public var source: String?
    public var dwellSeconds: Double?
    public var isStationary: Bool?
    public var speedMetersPerSecond: Double?
    public var observedAt: String?

    public init(
        latitude: Double,
        longitude: Double,
        horizontalAccuracy: Double? = nil,
        source: String? = nil,
        dwellSeconds: Double? = nil,
        isStationary: Bool? = nil,
        speedMetersPerSecond: Double? = nil,
        observedAt: String? = nil
    ) {
        self.latitude = latitude
        self.longitude = longitude
        self.horizontalAccuracy = horizontalAccuracy
        self.source = source
        self.dwellSeconds = dwellSeconds
        self.isStationary = isStationary
        self.speedMetersPerSecond = speedMetersPerSecond
        self.observedAt = observedAt
    }
}

/// A ranked candidate environment returned by `identify` / `register-location`.
public struct EnvironmentCandidate: Codable, Equatable, Identifiable {
    public let environmentId: String
    public let displayName: String
    public let operator_: String?
    public let storeNumber: String?
    public let address: String?
    public let latitude: Double?
    public let longitude: Double?
    public let website: String?
    public let distanceMeters: Double?
    public let confidence: Double
    public let matchReasons: [String]
    public let hasKnownEnvironment: Bool
    public let possibleSkills: [String]?

    public var id: String { environmentId }

    enum CodingKeys: String, CodingKey {
        case environmentId, displayName
        case operator_ = "operator"
        case storeNumber, address, latitude, longitude, website, distanceMeters, confidence, matchReasons, hasKnownEnvironment, possibleSkills
    }

    public init(
        environmentId: String,
        displayName: String,
        operator_: String?,
        storeNumber: String?,
        address: String?,
        latitude: Double?,
        longitude: Double?,
        website: String?,
        distanceMeters: Double?,
        confidence: Double,
        matchReasons: [String],
        hasKnownEnvironment: Bool,
        possibleSkills: [String]?
    ) {
        self.environmentId = environmentId
        self.displayName = displayName
        self.operator_ = operator_
        self.storeNumber = storeNumber
        self.address = address
        self.latitude = latitude
        self.longitude = longitude
        self.website = website
        self.distanceMeters = distanceMeters
        self.confidence = confidence
        self.matchReasons = matchReasons
        self.hasKnownEnvironment = hasKnownEnvironment
        self.possibleSkills = possibleSkills
    }
}

public struct RepositoryReadError: Codable, Equatable, Identifiable {
    public let code: String
    public let message: String
    public let repository: String
    public let environmentId: String
    public let bundleId: String?
    public let path: String?
    public let url: String?

    public init(code: String, message: String, repository: String, environmentId: String, bundleId: String?, path: String?, url: String? = nil) {
        self.code = code
        self.message = message
        self.repository = repository
        self.environmentId = environmentId
        self.bundleId = bundleId
        self.path = path
        self.url = url
    }

    public var id: String { [code, repository, environmentId, bundleId ?? "", path ?? "", url ?? ""].joined(separator: "|") }
}

public struct EnvironmentBundlePreview: Codable, Equatable, Identifiable {
    public let id: String
    public let bundleId: String
    public let environmentId: String
    public let repository: String
    public let valid: Bool
    public let bundleHash: String
    public let skills: [EnvironmentArtifactPreview]
    public let mcpServers: [EnvironmentArtifactPreview]
    public let apps: [EnvironmentArtifactPreview]
    public let facts: [EnvironmentArtifactPreview]
    public let llmsTxt: String?
    public let agentsMd: String?
    public let errors: [RepositoryReadError]

    public init(id: String, bundleId: String, environmentId: String, repository: String, valid: Bool, bundleHash: String, skills: [EnvironmentArtifactPreview], mcpServers: [EnvironmentArtifactPreview], apps: [EnvironmentArtifactPreview], errors: [RepositoryReadError], facts: [EnvironmentArtifactPreview] = [], llmsTxt: String? = nil, agentsMd: String? = nil) {
        self.id = id
        self.bundleId = bundleId
        self.environmentId = environmentId
        self.repository = repository
        self.valid = valid
        self.bundleHash = bundleHash
        self.skills = skills
        self.mcpServers = mcpServers
        self.apps = apps
        self.facts = facts
        self.llmsTxt = llmsTxt
        self.agentsMd = agentsMd
        self.errors = errors
    }

    /// The `SKILL.md` body of every skill in the bundle, in bundle order.
    /// Repositories key skill files as `<skill-id>/SKILL.md`; the bare `SKILL.md`
    /// and first-`.md` lookups are defensive fallbacks (no repository writes them today).
    public var skillMarkdown: [(id: String, content: String)] {
        skills.compactMap { skill in
            guard let content = skill.primaryMarkdown else { return nil }
            return (id: skill.id, content: content)
        }
    }

    public var allArtifacts: [EnvironmentArtifactPreview] {
        skills + mcpServers + apps + facts
    }

    public var allFilePaths: [String] {
        allArtifacts.flatMap(\.sortedFilePaths).sorted()
    }

    public func content(for path: String) -> String? {
        for artifact in allArtifacts {
            if let content = artifact.files[path] {
                return content
            }
        }
        return nil
    }
}

public struct EnvironmentPreview: Codable, Equatable {
    public let environmentId: String
    public let bundles: [EnvironmentBundlePreview]

    public init(environmentId: String, bundles: [EnvironmentBundlePreview]) {
        self.environmentId = environmentId
        self.bundles = bundles
    }
}

public struct EnvironmentOffer: Equatable {
    public let environmentId: String
    public let displayName: String?
    public let bundleId: String
    public let bundleHash: String
    public let skills: [String]
    public let mcpServers: [String]
    public let apps: [String]

    public init(environmentId: String, displayName: String?, bundleId: String, bundleHash: String, skills: [String], mcpServers: [String], apps: [String]) {
        self.environmentId = environmentId
        self.displayName = displayName
        self.bundleId = bundleId
        self.bundleHash = bundleHash
        self.skills = skills
        self.mcpServers = mcpServers
        self.apps = apps
    }
}

public struct EnvironmentListItem: Codable, Equatable, Identifiable {
    public let environmentId: String
    public let displayName: String
    public let status: String
    public let lastTouchedAt: String
    public let entered: Bool
    public let bundleCount: Int
    public let approvedBundleCount: Int

    public var id: String { environmentId }

    public init(environmentId: String, displayName: String, status: String, lastTouchedAt: String, entered: Bool, bundleCount: Int, approvedBundleCount: Int) {
        self.environmentId = environmentId
        self.displayName = displayName
        self.status = status
        self.lastTouchedAt = lastTouchedAt
        self.entered = entered
        self.bundleCount = bundleCount
        self.approvedBundleCount = approvedBundleCount
    }
}
