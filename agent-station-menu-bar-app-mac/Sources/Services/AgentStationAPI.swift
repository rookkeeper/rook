import Foundation

struct AgentStationAPIError: LocalizedError {
    let message: String

    var errorDescription: String? { message }
}

/// REST control plane for the Agent Station server at 127.0.0.1:3000.
struct AgentStationAPI {
    let baseURL: URL

    init(baseURL: URL = URL(string: "http://127.0.0.1:3000")!) {
        self.baseURL = baseURL
    }

    var webSocketURL: URL {
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        components.scheme = "ws"
        components.path = "/api/ws"
        return components.url!
    }

    var webAppURL: URL { baseURL }

    func health(timeout: TimeInterval = 1.5) async -> Bool {
        var request = URLRequest(url: baseURL.appending(path: "api/health"))
        request.timeoutInterval = timeout
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse, http.statusCode == 200,
              let body = try? JSONDecoder().decode(JSONValue.self, from: data) else {
            return false
        }
        return body["ok"]?.boolValue == true
    }

    func agents() async throws -> [AgentDefinition] {
        struct AgentsResponse: Codable {
            let agents: [AgentDefinition]
        }
        let body: AgentsResponse = try await get(path: "api/agents", query: [:])
        return body.agents
    }

    func sessions(agent: String) async throws -> [AgentSessionSummary] {
        let body = try await getJSON(path: "api/agent/sessions", query: ["agent": agent])
        guard case .array(let items)? = body["sessions"] else {
            return []
        }
        return items.map(AgentSessionSummary.init(raw:))
    }

    func recentSession() async throws -> AgentSessionSummary? {
        let body = try await getJSON(path: "api/agent/session/recent", query: [:])
        guard let session = body["session"], session != .null else {
            return nil
        }
        return AgentSessionSummary(raw: session)
    }

    func startSession(agent: String, sessionName: String?) async throws -> AgentSessionSummary {
        var payload: [String: JSONValue] = ["agent": .string(agent)]
        if let sessionName, !sessionName.isEmpty {
            payload["sessionName"] = .string(sessionName)
        }
        return try await start(payload: payload)
    }

    func resumeSession(_ session: AgentSessionSummary) async throws -> AgentSessionSummary {
        let payload: [String: JSONValue] = [
            "agent": .string(session.agent),
            "session": session.raw,
        ]
        return try await start(payload: payload)
    }

    private func start(payload: [String: JSONValue]) async throws -> AgentSessionSummary {
        let body = try await postJSON(path: "api/agent/start", payload: .object(payload))
        guard let session = body["session"], session != .null else {
            throw AgentStationAPIError(message: "Server returned no session")
        }
        return AgentSessionSummary(raw: session)
    }

    func skillPreviews(environmentId: String) async throws -> [SkillPreview] {
        struct PreviewResponse: Codable {
            let skills: [SkillPreview]
        }
        let body: PreviewResponse = try await get(
            path: "api/environments/preview",
            query: ["environmentId": environmentId]
        )
        return body.skills
    }

    func registerEnvironment(id: String, sourceName: String, metadata: [String: JSONValue]) async throws {
        _ = try await postJSON(
            path: "api/environments/register",
            payload: .object([
                "id": .string(id),
                "sourceName": .string(sourceName),
                "metadata": .object(metadata),
            ])
        )
    }

    func markEnvironmentUnavailable(id: String) async throws {
        _ = try await postJSON(
            path: "api/environments/unavailable",
            payload: .object(["id": .string(id)])
        )
    }

    func decideEnvironment(environmentId: String, decision: String) async throws {
        _ = try await postJSON(
            path: "api/environments/decision",
            payload: .object([
                "environmentId": .string(environmentId),
                "decision": .string(decision),
            ])
        )
    }

    // MARK: - Transport helpers

    private func requestURL(path: String, query: [String: String]) -> URL {
        var components = URLComponents(
            url: baseURL.appending(path: path),
            resolvingAgainstBaseURL: false
        )!
        if !query.isEmpty {
            components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        return components.url!
    }

    private func get<T: Decodable>(path: String, query: [String: String]) async throws -> T {
        let (data, response) = try await URLSession.shared.data(from: requestURL(path: path, query: query))
        try throwIfErrorResponse(data: data, response: response)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func getJSON(path: String, query: [String: String]) async throws -> JSONValue {
        try await get(path: path, query: query)
    }

    private func postJSON(path: String, payload: JSONValue) async throws -> JSONValue {
        var request = URLRequest(url: requestURL(path: path, query: [:]))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(payload)
        let (data, response) = try await URLSession.shared.data(for: request)
        try throwIfErrorResponse(data: data, response: response)
        return try JSONDecoder().decode(JSONValue.self, from: data)
    }

    private func throwIfErrorResponse(data: Data, response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse, http.statusCode >= 400 else {
            return
        }
        let body = try? JSONDecoder().decode(JSONValue.self, from: data)
        let message = body?["error"]?.stringValue ?? "Server error (\(http.statusCode))"
        throw AgentStationAPIError(message: message)
    }
}
