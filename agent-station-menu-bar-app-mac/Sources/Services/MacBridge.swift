import Foundation
import Network

/// Tier 2 action bridge: a loopback HTTP server the agent's shell tool can
/// `curl` to perceive and drive the Mac. Routes:
///   GET  /context      -> { frontmostApp, bundleId, windowTitle, environmentId, ... }
///   POST /applescript  -> { script }            -> { ok, output }
///   POST /open-url     -> { url }               -> { ok }
///   GET  /health       -> { ok, service }
///
/// Bound to 127.0.0.1 only. Action handlers (AppleScript, open-url) are
/// injected by the model so AppKit work happens on the main thread; the
/// /context payload is a pre-encoded snapshot updated from the model.
final class MacBridge {
    // Injected by the model; run on the bridge queue, hop to main themselves.
    var runAppleScript: ((String) -> (ok: Bool, output: String))?
    var openURL: ((String) -> Bool)?
    var readWindowText: (() -> String?)?
    var readScreenText: (() -> String?)?
    var readAxElements: (() -> [[String: Any]]?)?
    var captureScreenshot: (() -> [String: Any]?)?
    var performInput: (([String: Any]) -> (ok: Bool, output: String))?

    private let queue = DispatchQueue(label: "com.rookery.mac-bridge")
    private var listener: NWListener?
    private let lock = NSLock()
    private var contextJSON = Data("{}".utf8)
    private var controlEnabled = false
    private(set) var port: UInt16 = 0
    private var token = ""

    /// Gates the mutating /input route. Off by default; the user flips it from
    /// the panel. Perception routes (/screenshot, /ax-elements) are not gated by
    /// this — only by their own OS permission.
    func setControlEnabled(_ enabled: Bool) {
        lock.lock()
        controlEnabled = enabled
        lock.unlock()
    }

    /// `token` gates every route except /health. It is shared with the agent
    /// out-of-band via a 0600 file (see AgentStationModel.writeBridgeHandshake),
    /// which a webpage cannot read — so DNS-rebinding/CSRF callers can't
    /// authenticate even though they can reach the TCP port.
    func start(port: UInt16, token: String) {
        guard listener == nil else {
            return
        }
        self.token = token
        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true
        params.requiredLocalEndpoint = NWEndpoint.hostPort(
            host: "127.0.0.1",
            port: NWEndpoint.Port(rawValue: port)!
        )
        do {
            let listener = try NWListener(using: params)
            listener.newConnectionHandler = { [weak self] connection in
                self?.handle(connection)
            }
            listener.stateUpdateHandler = { [weak self] state in
                if case .ready = state {
                    self?.port = port
                    providerLog("bridge listening on 127.0.0.1:\(port)")
                } else if case .failed(let error) = state {
                    providerLog("bridge failed: \(error.localizedDescription)")
                }
            }
            listener.start(queue: queue)
            self.listener = listener
        } catch {
            providerLog("bridge could not start on \(port): \(error.localizedDescription)")
        }
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    func updateContext(_ data: Data) {
        lock.lock()
        contextJSON = data
        lock.unlock()
    }

    // MARK: - Connection handling

    private func handle(_ connection: NWConnection) {
        connection.start(queue: queue)
        receive(connection, buffer: Data())
    }

    private func receive(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [weak self] data, _, isComplete, error in
            guard let self else {
                connection.cancel()
                return
            }
            var buffer = buffer
            if let data {
                buffer.append(data)
            }
            if let request = self.parse(buffer) {
                let response = self.route(request)
                connection.send(content: response, completion: .contentProcessed { _ in
                    connection.cancel()
                })
            } else if isComplete || error != nil {
                connection.cancel()
            } else {
                self.receive(connection, buffer: buffer)
            }
        }
    }

    private struct ParsedRequest {
        let method: String
        let path: String
        let headers: [String: String]   // keys lowercased
        let body: Data
    }

    /// Returns nil when the buffer doesn't yet hold a full request (keep reading).
    private func parse(_ buffer: Data) -> ParsedRequest? {
        let separator = Data("\r\n\r\n".utf8)
        guard let headerEnd = buffer.range(of: separator) else {
            return nil
        }
        let headerData = buffer.subdata(in: buffer.startIndex..<headerEnd.lowerBound)
        guard let headerString = String(data: headerData, encoding: .utf8) else {
            return nil
        }
        let lines = headerString.components(separatedBy: "\r\n")
        let parts = lines.first?.components(separatedBy: " ") ?? []
        guard parts.count >= 2 else {
            return nil
        }
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let colon = line.firstIndex(of: ":") else {
                continue
            }
            let key = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
            let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            headers[key] = value
        }
        let contentLength = Int(headers["content-length"] ?? "") ?? 0
        let bodyStart = headerEnd.upperBound
        let available = buffer.distance(from: bodyStart, to: buffer.endIndex)
        guard available >= contentLength else {
            return nil
        }
        let bodyEnd = buffer.index(bodyStart, offsetBy: contentLength)
        let body = buffer.subdata(in: bodyStart..<bodyEnd)
        return ParsedRequest(method: parts[0], path: parts[1], headers: headers, body: body)
    }

    private func route(_ request: ParsedRequest) -> Data {
        let path = request.path.components(separatedBy: "?").first ?? request.path

        // Liveness check — unauthenticated, leaks nothing sensitive.
        if request.method == "GET", path == "/health" {
            return response(body: jsonData(["ok": true, "service": "mac-bridge"]))
        }

        // DNS-rebinding guard: a rebound attacker domain leaves its own name in
        // the Host header, not 127.0.0.1:<port>.
        let allowedHosts: Set<String> = ["127.0.0.1:\(port)", "localhost:\(port)"]
        guard let host = request.headers["host"], allowedHosts.contains(host) else {
            return response(status: "403 Forbidden", body: jsonData(["error": "bad host"]))
        }
        // Browsers attach Origin to cross-origin requests; a legitimate local
        // client (curl from the agent's shell) does not.
        if request.headers["origin"] != nil {
            return response(status: "403 Forbidden", body: jsonData(["error": "origin not allowed"]))
        }
        // Bearer token gates everything else.
        guard Self.constantTimeEquals(request.headers["authorization"], "Bearer \(token)") else {
            return response(status: "401 Unauthorized", body: jsonData(["error": "unauthorized"]))
        }

        switch (request.method, path) {
        case ("GET", "/context"), ("GET", "/"):
            lock.lock()
            let data = contextJSON
            lock.unlock()
            return response(body: data)

        case ("GET", "/window-text"):
            let text = readWindowText?() ?? nil
            return response(body: jsonData(["ok": text != nil, "text": text ?? ""]))

        case ("GET", "/screen-text"):
            let text = readScreenText?() ?? nil
            return response(body: jsonData(["ok": text != nil, "text": text ?? ""]))

        case ("GET", "/ax-elements"):
            let elements = readAxElements?() ?? nil
            return response(body: jsonData(["ok": elements != nil, "elements": elements ?? []]))

        case ("GET", "/screenshot"):
            guard let capture = captureScreenshot?() ?? nil else {
                return response(status: "403 Forbidden", body: jsonData(["ok": false, "error": "screen recording not permitted"]))
            }
            return response(body: jsonData(capture))

        case ("POST", "/input"):
            lock.lock()
            let enabled = controlEnabled
            lock.unlock()
            guard enabled else {
                return response(status: "403 Forbidden", body: jsonData(["ok": false, "error": "computer control disabled — enable it in the menu bar app"]))
            }
            guard let object = try? JSONSerialization.jsonObject(with: request.body) as? [String: Any] else {
                return response(status: "400 Bad Request", body: jsonData(["ok": false, "error": "invalid JSON"]))
            }
            let result = performInput?(object) ?? (ok: false, output: "input handler not ready")
            return response(body: jsonData(["ok": result.ok, "output": result.output]))

        case ("POST", "/applescript"):
            guard let script = stringField("script", in: request.body) else {
                return response(status: "400 Bad Request", body: jsonData(["error": "missing 'script'"]))
            }
            let result = runAppleScript?(script) ?? (ok: false, output: "bridge action handler not ready")
            return response(body: jsonData(["ok": result.ok, "output": result.output]))

        case ("POST", "/open-url"):
            guard let url = stringField("url", in: request.body) else {
                return response(status: "400 Bad Request", body: jsonData(["error": "missing 'url'"]))
            }
            let ok = openURL?(url) ?? false
            return response(body: jsonData(["ok": ok]))

        default:
            return response(status: "404 Not Found", body: jsonData(["error": "unknown route"]))
        }
    }

    // MARK: - Helpers

    private func stringField(_ key: String, in body: Data) -> String? {
        let object = try? JSONSerialization.jsonObject(with: body) as? [String: Any]
        return object?[key] as? String
    }

    private static func constantTimeEquals(_ lhs: String?, _ rhs: String) -> Bool {
        guard let lhs else {
            return false
        }
        let a = Array(lhs.utf8)
        let b = Array(rhs.utf8)
        guard a.count == b.count else {
            return false
        }
        var diff: UInt8 = 0
        for i in 0..<a.count {
            diff |= a[i] ^ b[i]
        }
        return diff == 0
    }

    private func jsonData(_ object: [String: Any]) -> Data {
        (try? JSONSerialization.data(withJSONObject: object)) ?? Data("{}".utf8)
    }

    private func response(status: String = "200 OK", body: Data) -> Data {
        var head = "HTTP/1.1 \(status)\r\n"
        head += "Content-Type: application/json\r\n"
        head += "Content-Length: \(body.count)\r\n"
        head += "Connection: close\r\n\r\n"
        return Data(head.utf8) + body
    }
}
