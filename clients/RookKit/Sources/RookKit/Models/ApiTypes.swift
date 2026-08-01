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
    case on
    case off

    public var label: String {
        switch self {
        case .active: return "Active"
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

    public var id: String { raw["id"]?.stringValue ?? raw["sessionId"]?.stringValue ?? "" }
    public var agent: String { raw["agent"]?.stringValue ?? raw["_meta"]?["runtimeId"]?.stringValue ?? "" }
    public var name: String { raw["name"]?.stringValue ?? raw["title"]?.stringValue ?? "default" }
    public var running: Bool { raw["running"]?.boolValue ?? false }
    public var connectedClients: Int { Int(raw["connectedClients"]?.numberValue ?? 0) }
    public var updatedAtISO: String? { raw["updatedAt"]?.stringValue }
    public var startedAtISO: String? { raw["createdAt"]?.stringValue ?? raw["_meta"]?["startedAt"]?.stringValue }

    public func selectionStatus(currentSessionId: String?) -> SessionSelectionStatus {
        if running, currentSessionId == id {
            return .active
        }
        return running ? .on : .off
    }

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

    public init(code: String, message: String, repository: String, environmentId: String, bundleId: String?, path: String?) {
        self.code = code
        self.message = message
        self.repository = repository
        self.environmentId = environmentId
        self.bundleId = bundleId
        self.path = path
    }

    public var id: String { [code, repository, environmentId, bundleId ?? "", path ?? ""].joined(separator: "|") }
}

public struct EnvironmentRevisionPreview: Codable, Equatable {
    public let contentHash: String
    public let publisherVersion: String?
    public let fetchedAt: String?
    public let sourceLocator: String?
    public let provenance: [String: JSONValue]

    public init(contentHash: String, publisherVersion: String? = nil, fetchedAt: String? = nil, sourceLocator: String? = nil, provenance: [String: JSONValue] = [:]) {
        self.contentHash = contentHash
        self.publisherVersion = publisherVersion
        self.fetchedAt = fetchedAt
        self.sourceLocator = sourceLocator
        self.provenance = provenance
    }
}

public struct EnvironmentBundlePreview: Codable, Equatable, Identifiable {
    public let id: String
    public let bundleId: String
    public let environmentId: String
    public let repository: String
    public let valid: Bool
    public let bundleHash: String
    public let revision: EnvironmentRevisionPreview?
    public let skills: [EnvironmentArtifactPreview]
    public let mcpServers: [EnvironmentArtifactPreview]
    public let apps: [EnvironmentArtifactPreview]
    public let facts: [EnvironmentArtifactPreview]
    public let llmsTxt: String?
    public let errors: [RepositoryReadError]

    public init(id: String, bundleId: String, environmentId: String, repository: String, valid: Bool, bundleHash: String, skills: [EnvironmentArtifactPreview], mcpServers: [EnvironmentArtifactPreview], apps: [EnvironmentArtifactPreview], errors: [RepositoryReadError], revision: EnvironmentRevisionPreview? = nil, facts: [EnvironmentArtifactPreview] = [], llmsTxt: String? = nil) {
        self.id = id
        self.bundleId = bundleId
        self.environmentId = environmentId
        self.repository = repository
        self.valid = valid
        self.bundleHash = bundleHash
        self.revision = revision
        self.skills = skills
        self.mcpServers = mcpServers
        self.apps = apps
        self.facts = facts
        self.llmsTxt = llmsTxt
        self.errors = errors
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
