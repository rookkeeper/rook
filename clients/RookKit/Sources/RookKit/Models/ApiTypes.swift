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

public struct EnvironmentBundlePreview: Codable, Equatable, Identifiable {
    public let id: String
    public let bundleId: String
    public let environmentId: String
    public let repository: String
    public let valid: Bool
    public let skills: [EnvironmentArtifactPreview]
    public let mcpServers: [EnvironmentArtifactPreview]
    public let apps: [EnvironmentArtifactPreview]
    public let errors: [RepositoryReadError]

    public init(id: String, bundleId: String, environmentId: String, repository: String, valid: Bool, skills: [EnvironmentArtifactPreview], mcpServers: [EnvironmentArtifactPreview], apps: [EnvironmentArtifactPreview], errors: [RepositoryReadError]) {
        self.id = id
        self.bundleId = bundleId
        self.environmentId = environmentId
        self.repository = repository
        self.valid = valid
        self.skills = skills
        self.mcpServers = mcpServers
        self.apps = apps
        self.errors = errors
    }

    public var allArtifacts: [EnvironmentArtifactPreview] {
        skills + mcpServers + apps
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
    public let sourceName: String?
    public let canonicalSourceUrl: String?

    public init(environmentId: String, sourceName: String?, canonicalSourceUrl: String?) {
        self.environmentId = environmentId
        self.sourceName = sourceName
        self.canonicalSourceUrl = canonicalSourceUrl
    }
}
