import Foundation

struct AgentDefinition: Codable, Equatable, Identifiable {
    let id: String
    let parentId: String?
}

/// Wraps the raw session record JSON so resume can send the record back to
/// `POST /api/agent/start` verbatim, including fields this app doesn't model.
struct AgentSessionSummary: Equatable, Identifiable {
    let raw: JSONValue

    var id: String { raw["id"]?.stringValue ?? "" }
    var agent: String { raw["agent"]?.stringValue ?? "" }
    var name: String { raw["name"]?.stringValue ?? "default" }
    var running: Bool { raw["running"]?.boolValue ?? false }
    var connectedClients: Int { Int(raw["connectedClients"]?.numberValue ?? 0) }

    var createdAt: Date? {
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

    var createdAtLabel: String {
        guard let date = createdAt else {
            return ""
        }
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

struct SkillPreview: Codable, Equatable, Identifiable {
    let id: String
    let name: String
    let files: [String: String]

    var sortedFilePaths: [String] {
        files.keys.sorted()
    }
}

struct EnvironmentOffer: Equatable {
    let environmentId: String
    let sourceName: String?
    let canonicalSourceUrl: String?
}
