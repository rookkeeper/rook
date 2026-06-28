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
/// `POST /api/agent/start` verbatim, including fields this app doesn't model.
public struct AgentSessionSummary: Equatable, Identifiable {
    public let raw: JSONValue

    public init(raw: JSONValue) {
        self.raw = raw
    }

    public var id: String { raw["id"]?.stringValue ?? "" }
    public var agent: String { raw["agent"]?.stringValue ?? "" }
    public var name: String { raw["name"]?.stringValue ?? "default" }
    public var running: Bool { raw["running"]?.boolValue ?? false }
    public var connectedClients: Int { Int(raw["connectedClients"]?.numberValue ?? 0) }

    public var createdAt: Date? {
        guard let iso = raw["createdAt"]?.stringValue else {
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
        guard let date = createdAt else {
            return ""
        }
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

public struct SkillPreview: Codable, Equatable, Identifiable {
    public let id: String
    public let name: String
    public let files: [String: String]

    public init(id: String, name: String, files: [String: String]) {
        self.id = id
        self.name = name
        self.files = files
    }

    public var sortedFilePaths: [String] {
        files.keys.sorted()
    }
}

/// Phone -> server payload asking which `loc:` environments are likely
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

/// A ranked candidate environment returned by `identify-available`.
public struct EnvironmentCandidate: Codable, Equatable, Identifiable {
    public let environmentId: String
    public let displayName: String
    public let operator_: String?
    public let storeNumber: String?
    public let bestGuessStoreNumber: String?
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
        case storeNumber, bestGuessStoreNumber, address, latitude, longitude, website, distanceMeters, confidence, matchReasons, hasKnownEnvironment, possibleSkills
    }

    public init(
        environmentId: String,
        displayName: String,
        operator_: String?,
        storeNumber: String?,
        bestGuessStoreNumber: String?,
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
        self.bestGuessStoreNumber = bestGuessStoreNumber
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

public struct EnvironmentOffer: Equatable {
    public let environmentId: String
    public let sourceName: String?
    public let canonicalSourceUrl: String?

    public init(environmentId: String, sourceName: String?, canonicalSourceUrl: String?) {
        self.environmentId = environmentId
        self.sourceName = sourceName
        self.canonicalSourceUrl = canonicalSourceUrl
    }
}
