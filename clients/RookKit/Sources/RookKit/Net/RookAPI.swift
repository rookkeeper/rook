import Foundation

public struct RookAPIError: LocalizedError {
    public let message: String

    public init(message: String) {
        self.message = message
    }

    public var errorDescription: String? { message }
}

/// REST control plane for the Rook server.
public struct RookAPI {
    public let baseURL: URL

    public init(baseURL: URL = URL(string: "http://127.0.0.1:3000")!) {
        self.baseURL = baseURL
    }

    public var webSocketURL: URL {
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        components.scheme = baseURL.scheme == "https" ? "wss" : "ws"
        components.path = "/api/ws"
        return components.url!
    }

    public var webAppURL: URL { baseURL }

    public func health(timeout: TimeInterval = 1.5) async -> Bool {
        var request = URLRequest(url: baseURL.appending(path: "api/health"))
        request.timeoutInterval = timeout
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse, http.statusCode == 200,
              let body = try? JSONDecoder().decode(JSONValue.self, from: data) else {
            return false
        }
        return body["ok"]?.boolValue == true
    }

    public func agents() async throws -> [AgentDefinition] {
        struct AgentsResponse: Codable {
            let agents: [AgentDefinition]
        }
        let body: AgentsResponse = try await get(path: "api/agents", query: [:])
        return body.agents
    }

    public func sessions(agent: String) async throws -> [AgentSessionSummary] {
        let body = try await getJSON(path: "api/agent/sessions", query: ["agent": agent])
        guard case .array(let items)? = body["sessions"] else {
            return []
        }
        return items.map(AgentSessionSummary.init(raw:))
    }

    public func recentSession() async throws -> AgentSessionSummary? {
        let body = try await getJSON(path: "api/agent/session/recent", query: [:])
        guard let session = body["session"], session != .null else {
            return nil
        }
        return AgentSessionSummary(raw: session)
    }

    public func startSession(agent: String, sessionName: String?) async throws -> AgentSessionSummary {
        var payload: [String: JSONValue] = ["agent": .string(agent)]
        if let sessionName, !sessionName.isEmpty {
            payload["sessionName"] = .string(sessionName)
        }
        return try await start(payload: payload)
    }

    public func resumeSession(_ session: AgentSessionSummary) async throws -> AgentSessionSummary {
        let payload: [String: JSONValue] = [
            "agent": .string(session.agent),
            "session": session.raw,
        ]
        return try await start(payload: payload)
    }

    private func start(payload: [String: JSONValue]) async throws -> AgentSessionSummary {
        let body = try await postJSON(path: "api/agent/start", payload: .object(payload))
        guard let session = body["session"], session != .null else {
            throw RookAPIError(message: "Server returned no session")
        }
        return AgentSessionSummary(raw: session)
    }

    public func environmentPreview(environmentId: String) async throws -> EnvironmentPreview {
        try await get(
            path: "api/environments/preview",
            query: ["environmentId": environmentId]
        )
    }

    public func registerEnvironment(id: String, sourceName: String, metadata: [String: JSONValue]) async throws {
        _ = try await postJSON(
            path: "api/environments/register",
            payload: .object([
                "id": .string(id),
                "sourceName": .string(sourceName),
                "metadata": .object(metadata),
            ])
        )
    }

    public func unregisterEnvironment(id: String) async throws {
        _ = try await postJSON(
            path: "api/environments/unregister",
            payload: .object(["id": .string(id)])
        )
    }

    /// Read-only: ask which `loc:` environments are likely at the given location.
    /// Returns candidates without registering or entering anything.
    public func identifyEnvironments(_ request: IdentifyAvailableRequest) async throws -> [EnvironmentCandidate] {
        try await postLocation(path: "api/environments/identify", request)
    }

    /// Committing: identify, then register/auto-enter the dwell set into the
    /// SessionRoom/agent. Returns the same candidate list.
    public func registerLocation(_ request: IdentifyAvailableRequest) async throws -> [EnvironmentCandidate] {
        try await postLocation(path: "api/environments/register-location", request)
    }

    private func postLocation(path: String, _ request: IdentifyAvailableRequest) async throws -> [EnvironmentCandidate] {
        struct IdentifyResponse: Decodable {
            let candidates: [EnvironmentCandidate]
        }
        var urlRequest = URLRequest(url: requestURL(path: path, query: [:]))
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.httpBody = try JSONEncoder().encode(request)
        let (data, response) = try await URLSession.shared.data(for: urlRequest)
        try throwIfErrorResponse(data: data, response: response)
        return try JSONDecoder().decode(IdentifyResponse.self, from: data).candidates
    }

    public func decideEnvironment(environmentId: String, decision: String) async throws {
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
        throw RookAPIError(message: message)
    }
}
