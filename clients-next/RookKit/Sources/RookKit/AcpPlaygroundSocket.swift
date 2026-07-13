import Foundation

@MainActor
final class AcpPlaygroundSocket {
    private var task: URLSessionWebSocketTask?
    private var connectTask: Task<[String: Any], Error>?
    private var nextRequestID = 0
    private var pending: [String: CheckedContinuation<[String: Any], Error>] = [:]
    var onUpdate: (([String: Any]) -> Void)?

    func connect() async throws -> [String: Any] {
        if let connectTask {
            return try await connectTask.value
        }
        if task != nil {
            return [:]
        }
        let task = Task<[String: Any], Error> { @MainActor in
            let initialized = try await openAndInitialize()
            self.connectTask = nil
            return initialized
        }
        connectTask = task
        return try await task.value
    }

    func disconnect() {
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        connectTask = nil
        let waiting = pending
        pending = [:]
        waiting.values.forEach { $0.resume(throwing: SocketError.disconnected) }
    }

    func request(method: String, params: [String: Any]) async throws -> [String: Any] {
        if task == nil {
            _ = try await connect()
        }
        guard let task else { throw SocketError.disconnected }
        nextRequestID += 1
        let id = "request-\(nextRequestID)"
        let frame: [String: Any] = ["jsonrpc": "2.0", "id": id, "method": method, "params": params]
        let data = try JSONSerialization.data(withJSONObject: frame)
        let text = String(decoding: data, as: UTF8.self)
        return try await withCheckedThrowingContinuation { continuation in
            pending[id] = continuation
            task.send(.string(text)) { [weak self] error in
                guard let error else { return }
                Task { @MainActor in
                    self?.pending.removeValue(forKey: id)?.resume(throwing: error)
                }
            }
        }
    }

    private func receiveLoop(_ task: URLSessionWebSocketTask) {
        Task { [weak self] in
            while self?.task === task {
                do {
                    let incoming = try await task.receive()
                    guard let self else { return }
                    let text: String
                    switch incoming {
                    case .string(let value): text = value
                    case .data(let value): text = String(decoding: value, as: UTF8.self)
                    @unknown default: continue
                    }
                    self.handle(text)
                } catch {
                    self?.handleDisconnect(error)
                    return
                }
            }
        }
    }

    private func openAndInitialize() async throws -> [String: Any] {
        disconnect()
        var urlRequest = URLRequest(url: websocketURL())
        if let token = ProcessInfo.processInfo.environment["ROOK_AUTH_TOKEN"], !token.isEmpty {
            urlRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let task = URLSession.shared.webSocketTask(with: urlRequest)
        self.task = task
        task.resume()
        receiveLoop(task)
        return try await request(method: "initialize", params: [
            "protocolVersion": 1,
            "clientCapabilities": [:],
            "clientInfo": ["name": "rook-next", "title": "Rook next", "version": "0.1.0"],
        ])
    }

    private func handleDisconnect(_ error: Error) {
        guard task != nil else { return }
        task = nil
        connectTask = nil
        let waiting = pending
        pending = [:]
        waiting.values.forEach { $0.resume(throwing: error) }
    }

    private func handle(_ text: String) {
        guard let data = text.data(using: .utf8),
              let frame = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        if frame["method"] as? String == "session/update",
           let params = frame["params"] as? [String: Any] {
            onUpdate?(params)
            return
        }
        guard let id = frame["id"] else { return }
        let key = String(describing: id)
        guard let continuation = pending.removeValue(forKey: key) else { return }
        if let result = frame["result"] as? [String: Any] {
            continuation.resume(returning: result)
        } else if let error = frame["error"] as? [String: Any] {
            continuation.resume(throwing: SocketError.server(error["message"] as? String ?? "Request failed"))
        } else {
            continuation.resume(returning: [:])
        }
    }

    private func websocketURL() -> URL {
        let base = ProcessInfo.processInfo.environment["ROOK_SERVER_BASE_URL"] ?? "http://127.0.0.1:7665"
        var components = URLComponents(string: base)!
        components.scheme = components.scheme == "https" ? "wss" : "ws"
        components.path = "/api/ws"
        return components.url!
    }

    enum SocketError: LocalizedError {
        case disconnected
        case server(String)

        var errorDescription: String? {
            switch self {
            case .disconnected: "Not connected to Rook server-next."
            case .server(let message): message
            }
        }
    }
}
