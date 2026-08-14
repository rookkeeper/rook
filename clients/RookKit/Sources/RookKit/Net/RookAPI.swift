import Foundation

public struct RookAPIError: LocalizedError {
    public let message: String

    public init(message: String) {
        self.message = message
    }

    public var errorDescription: String? { message }
}

public enum RookHealthResult: Equatable {
    case ok
    case unauthorized
    case httpStatus(Int)
    case transportError(String)
}

/// REST control plane for the Rook server.
public struct RookAPI {
    private static let logger = RookLog.network

    public let baseURL: URL
    public let authToken: String?

    public init(baseURL: URL = URL(string: "http://127.0.0.1:7665")!, authToken: String? = nil) {
        self.baseURL = baseURL
        let trimmed = authToken?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.authToken = (trimmed?.isEmpty == false) ? trimmed : nil
    }

    public var webSocketURL: URL {
        webSocketURL(sessionId: nil)
    }

    public func webSocketURL(sessionId: String?) -> URL {
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        components.scheme = baseURL.scheme == "https" ? "wss" : "ws"
        components.path = "/api/ws"
        if let sessionId, !sessionId.isEmpty {
            components.queryItems = [URLQueryItem(name: "sessionId", value: sessionId)]
        }
        return components.url!
    }

    public func webSocketRequest(sessionId: String? = nil) -> URLRequest {
        var request = authorizedRequest(url: webSocketURL(sessionId: sessionId))
        request.timeoutInterval = 30
        return request
    }

    public func healthResult(timeout: TimeInterval = 1.5) async -> RookHealthResult {
        var request = authorizedRequest(url: baseURL.appending(path: "api/health"))
        request.timeoutInterval = timeout
        let timed = RookPerformance.begin(
            "HealthCheck",
            operation: "http-health",
            description: "GET /api/health timeout=\(timeout)",
            logger: Self.logger,
            signposter: RookLog.networkSignposter
        )
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                timed.finish(details: "non-http-response")
                return .transportError("Non-HTTP response")
            }
            switch http.statusCode {
            case 200:
                if let body = try? JSONDecoder().decode(JSONValue.self, from: data), body["ok"]?.boolValue == true {
                    timed.finish(details: "status=200 bytes=\(data.count)")
                    return .ok
                }
                timed.finish(details: "status=200 malformed-body bytes=\(data.count)")
                return .transportError("Malformed health response")
            case 401:
                timed.finish(details: "status=401")
                return .unauthorized
            default:
                timed.finish(details: "status=\(http.statusCode)")
                return .httpStatus(http.statusCode)
            }
        } catch {
            timed.fail(error)
            return .transportError(error.localizedDescription)
        }
    }

    public func healthStatus(timeout: TimeInterval = 1.5) async -> Int? {
        switch await healthResult(timeout: timeout) {
        case .ok: return 200
        case .unauthorized: return 401
        case .httpStatus(let code): return code
        case .transportError: return nil
        }
    }

    public func health(timeout: TimeInterval = 1.5) async -> Bool {
        if case .ok = await healthResult(timeout: timeout) {
            return true
        }
        return false
    }

    public func agents() async throws -> [AgentDefinition] {
        struct RuntimeResponse: Codable {
            let runtimes: [AgentDefinition]
        }
        let body: RuntimeResponse = try await get(path: "api/agent_runtimes", query: [:])
        return body.runtimes
    }

    public func sessions() async throws -> [AgentSessionSummary] {
        struct SessionsResponse: Decodable {
            let sessions: [JSONValue]
        }
        let response: SessionsResponse = try await get(path: "api/sessions", query: [:])
        return response.sessions.map { AgentSessionSummary(raw: $0) }
    }

    public func sessionTranscript(sessionId: String) async throws -> [JSONValue] {
        struct TranscriptResponse: Decodable {
            let events: [JSONValue]
        }
        let response: TranscriptResponse = try await get(path: "api/sessions/\(sessionId)/transcript", query: [:])
        return response.events
    }

    public func renameSession(sessionId: String, title: String) async throws -> AgentSessionSummary {
        AgentSessionSummary(raw: try await patchJSON(
            path: "api/sessions/\(sessionId)",
            payload: .object(["title": .string(title)])
        ))
    }

    public func setSessionPinned(sessionId: String, pinned: Bool) async throws -> AgentSessionSummary {
        AgentSessionSummary(raw: try await patchJSON(
            path: "api/sessions/\(sessionId)",
            payload: .object(["pinned": .bool(pinned)])
        ))
    }

    public func reorderPinnedSessions(sessionIds: [String]) async throws -> [AgentSessionSummary] {
        let response = try await postJSON(
            path: "api/sessions/reorder-pinned",
            payload: .object(["sessionIds": .array(sessionIds.map(JSONValue.string))])
        )
        guard case .array(let values) = response["sessions"] else { return [] }
        return values.map(AgentSessionSummary.init(raw:))
    }

    public func touchSession(sessionId: String) async throws -> AgentSessionSummary {
        AgentSessionSummary(raw: try await postJSON(path: "api/sessions/\(sessionId)/touch", payload: .object([:])) )
    }

    public func unviewSession(sessionId: String) async throws -> AgentSessionSummary {
        AgentSessionSummary(raw: try await postJSON(path: "api/sessions/\(sessionId)/unview", payload: .object([:])) )
    }

    public func deleteSession(sessionId: String) async throws {
        _ = try await deleteJSON(path: "api/sessions/\(sessionId)")
    }

    public func environmentPreview(environmentId: String) async throws -> EnvironmentPreview {
        try await get(
            path: "api/environments/preview",
            query: ["environmentId": environmentId]
        )
    }

    public func registerEnvironment(_ candidate: CandidateEnvironmentRecord) async throws {
        _ = try await postJSON(
            path: "api/environments/register",
            payload: .object([
                "id": .string(candidate.id),
                "metadata": .object(candidate.metadata),
            ])
        )
    }

    /// Read-only: ask which `location:` environments are likely at the given location.
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
        var urlRequest = authorizedRequest(url: requestURL(path: path, query: [:]))
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.httpBody = try JSONEncoder().encode(request)
        let (data, response) = try await performData(for: urlRequest)
        try throwIfErrorResponse(data: data, response: response)
        return try JSONDecoder().decode(IdentifyResponse.self, from: data).candidates
    }

    public func decideEnvironment(environmentId: String, bundleHash: String, decision: String, sessionId: String) async throws {
        _ = try await postJSON(
            path: "api/environments/decision",
            payload: .object([
                "environmentId": .string(environmentId),
                "bundleHash": .string(bundleHash),
                "decision": .string(decision),
                "sessionId": .string(sessionId),
            ])
        )
    }

    public func enterEnvironment(sessionId: String, environmentId: String) async throws -> [String] {
        try await updateSessionEnvironments(sessionId: sessionId, enterEnvironmentIds: [environmentId], leaveEnvironmentIds: [])
    }

    public func exitEnvironment(sessionId: String, environmentId: String) async throws -> [String] {
        try await updateSessionEnvironments(sessionId: sessionId, enterEnvironmentIds: [], leaveEnvironmentIds: [environmentId])
    }

    public func updateSessionEnvironments(sessionId: String, enterEnvironmentIds: [String], leaveEnvironmentIds: [String]) async throws -> [String] {
        struct EnvironmentResponse: Decodable {
            let ok: Bool
            let entered: [String]
        }
        let response: EnvironmentResponse = try await post(
            path: "api/session/environments",
            payload: .object([
                "sessionId": .string(sessionId),
                "enterEnvironmentIds": .array(enterEnvironmentIds.map(JSONValue.string)),
                "leaveEnvironmentIds": .array(leaveEnvironmentIds.map(JSONValue.string)),
            ])
        )
        return response.entered
    }

    public func environmentList(sessionId: String) async throws -> [EnvironmentListItem] {
        try await get(path: "api/environments/list", query: ["sessionId": sessionId])
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
        let (data, response) = try await performData(for: authorizedRequest(url: requestURL(path: path, query: query)))
        try throwIfErrorResponse(data: data, response: response)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func post<T: Decodable>(path: String, payload: JSONValue) async throws -> T {
        try await sendJSON(path: path, method: "POST", payload: payload)
    }

    private func patch<T: Decodable>(path: String, payload: JSONValue) async throws -> T {
        try await sendJSON(path: path, method: "PATCH", payload: payload)
    }

    private func getJSON(path: String, query: [String: String]) async throws -> JSONValue {
        try await get(path: path, query: query)
    }

    private func postJSON(path: String, payload: JSONValue) async throws -> JSONValue {
        try await sendJSON(path: path, method: "POST", payload: payload)
    }

    private func patchJSON(path: String, payload: JSONValue) async throws -> JSONValue {
        try await sendJSON(path: path, method: "PATCH", payload: payload)
    }

    private func deleteJSON(path: String) async throws -> JSONValue {
        var request = authorizedRequest(url: requestURL(path: path, query: [:]))
        request.httpMethod = "DELETE"
        let (data, response) = try await URLSession.shared.data(for: request)
        try throwIfErrorResponse(data: data, response: response)
        return try JSONDecoder().decode(JSONValue.self, from: data)
    }

    private func sendJSON<T: Decodable>(path: String, method: String, payload: JSONValue) async throws -> T {
        var request = authorizedRequest(url: requestURL(path: path, query: [:]))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(payload)
        let (data, response) = try await performData(for: request)
        try throwIfErrorResponse(data: data, response: response)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func authorizedRequest(url: URL) -> URLRequest {
        var request = URLRequest(url: url)
        if let authToken {
            request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    private func performData(for request: URLRequest) async throws -> (Data, URLResponse) {
        let method = request.httpMethod ?? "GET"
        let path = request.url?.path(percentEncoded: false) ?? request.url?.path ?? "(unknown)"
        let timed = RookPerformance.begin(
            "HTTPRequest",
            operation: "http-request",
            description: "\(method) \(path)",
            logger: Self.logger,
            signposter: RookLog.networkSignposter
        )
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            if let http = response as? HTTPURLResponse {
                timed.finish(details: "status=\(http.statusCode) bytes=\(data.count)")
            } else {
                timed.finish(details: "non-http-response bytes=\(data.count)")
            }
            return (data, response)
        } catch {
            timed.fail(error, details: "\(method) \(path)")
            throw error
        }
    }

    private func throwIfErrorResponse(data: Data, response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse, http.statusCode >= 400 else {
            return
        }
        let body = try? JSONDecoder().decode(JSONValue.self, from: data)
        // Fastify 500s put the real message in "message", user-land errors in "error".
        let message = body?["error"]?.stringValue
            ?? body?["message"]?.stringValue
            ?? "Server error (\(http.statusCode))"
        throw RookAPIError(message: message)
    }
}
