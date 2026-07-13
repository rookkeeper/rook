import Foundation
import Observation

public struct AcpSessionSummary: Identifiable, Equatable {
    public let sessionId: String
    public let title: String
    public let runtimeId: String
    public let startedAt: String?
    public let updatedAt: String

    public var id: String { sessionId }
}

@MainActor
@Observable
public final class AcpPlaygroundModel {
    public private(set) var sessions: [AcpSessionSummary] = []
    public private(set) var selectedSessionID: String?
    public private(set) var transcript = ""
    public private(set) var status = "Connecting…"
    public private(set) var runtimeIDs: [String] = []
    public var titleDraft = "session"
    public var selectedRuntimeID = ""
    public var draft = ""

    private let socket = AcpPlaygroundSocket()
    private var defaultRuntimeID: String?

    public init() {
        socket.onUpdate = { [weak self] params in
            self?.receiveUpdate(params)
        }
    }

    public func start() async {
        do {
            let initialize = try await socket.connect()
            let meta = initialize["_meta"] as? [String: Any]
            defaultRuntimeID = meta?["defaultRuntimeId"] as? String
            runtimeIDs = (meta?["runtimeIds"] as? [String]) ?? []
            selectedRuntimeID = defaultRuntimeID ?? runtimeIDs.first ?? ""
            status = defaultRuntimeID == nil ? "Connected — no configured runtime" : "Connected"
            try await refreshSessions()
        } catch {
            status = error.localizedDescription
        }
    }

    public func refreshSessions() async throws {
        let result = try await socket.request(method: "session/list", params: [:])
        let rawSessions = result["sessions"] as? [[String: Any]] ?? []
        sessions = rawSessions.compactMap { raw in
            guard let sessionId = raw["sessionId"] as? String,
                  let updatedAt = raw["updatedAt"] as? String else { return nil }
            let title = (raw["title"] as? String) ?? "session"
            let meta = raw["_meta"] as? [String: Any]
            let runtimeId = (meta?["runtimeId"] as? String) ?? sessionId.split(separator: ":").first.map(String.init) ?? ""
            let startedAt = meta?["startedAt"] as? String
            return AcpSessionSummary(sessionId: sessionId, title: title, runtimeId: runtimeId, startedAt: startedAt, updatedAt: updatedAt)
        }
    }

    public func newSession() async {
        do {
            let result = try await socket.request(method: "session/new", params: [
                "cwd": FileManager.default.currentDirectoryPath,
                "mcpServers": [],
                "_meta": [
                    "runtimeId": selectedRuntimeID.isEmpty ? (defaultRuntimeID ?? "") : selectedRuntimeID,
                    "title": titleDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "session" : titleDraft.trimmingCharacters(in: .whitespacesAndNewlines),
                ],
            ])
            guard let sessionId = result["sessionId"] as? String else { throw ClientError.missingSessionID }
            selectedSessionID = sessionId
            transcript = ""
            try await refreshSessions()
        } catch {
            status = error.localizedDescription
        }
    }

    public func openSession(_ sessionId: String) async {
        do {
            selectedSessionID = sessionId
            transcript = ""
            _ = try await socket.request(method: "session/load", params: [
                "sessionId": sessionId,
                "cwd": FileManager.default.currentDirectoryPath,
                "mcpServers": [],
            ])
        } catch {
            status = error.localizedDescription
        }
    }

    public func send() async {
        guard let sessionId = selectedSessionID else { return }
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        draft = ""
        transcript += "You: \(text)\n\n"
        do {
            _ = try await socket.request(method: "session/prompt", params: [
                "sessionId": sessionId,
                "prompt": [["type": "text", "text": text]],
            ])
            transcript += "\n\n"
            try await refreshSessions()
        } catch {
            status = error.localizedDescription
        }
    }

    public func goHome() {
        selectedSessionID = nil
        transcript = ""
        Task { try? await refreshSessions() }
    }

    private func receiveUpdate(_ params: [String: Any]) {
        guard params["sessionId"] as? String == selectedSessionID,
              let update = params["update"] as? [String: Any],
              let kind = update["sessionUpdate"] as? String else { return }
        if kind == "agent_message_chunk" || kind == "agent_thought_chunk" {
            let content = update["content"] as? [String: Any]
            if let text = content?["text"] as? String {
                transcript += text
            }
        }
    }

    private enum ClientError: LocalizedError {
        case missingSessionID
        var errorDescription: String? { "Server did not return a session id." }
    }
}
