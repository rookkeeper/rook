import Foundation
import Observation

@Observable
public final class HelloWorldModel {
    public private(set) var message = "Hello"
    public private(set) var isLoading = false

    public init() {}

    public func showWorldAndFetchHealth() async {
        message = "World"
        isLoading = true
        defer { isLoading = false }

        do {
            let (payload, response) = try await URLSession.shared.data(from: healthURL())
            guard let http = response as? HTTPURLResponse else {
                message = "World — no HTTP response"
                return
            }
            let body = String(data: payload, encoding: .utf8) ?? ""
            message = "World — \(http.statusCode) \(body)"
        } catch {
            message = "World — error: \(error.localizedDescription)"
        }
    }

    private func healthURL() -> URL {
        let base = ProcessInfo.processInfo.environment["ROOK_SERVER_BASE_URL"] ?? "http://127.0.0.1:7665"
        let trimmed = base.hasSuffix("/") ? String(base.dropLast()) : base
        return URL(string: "\(trimmed)/api/health")!
    }
}
