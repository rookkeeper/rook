import Foundation
import OSLog

public enum RookLogCategory: String {
    case app
    case ui
    case session
    case network
    case environment
    case location
    case voice
    case bridge
    case server
    case performance
}

public enum RookLog {
    public static let subsystem = "com.rookery.Rook"
    public static let verboseEnabled = ProcessInfo.processInfo.environment["ROOK_VERBOSE_LOGGING"] == "1"

    public static let app = logger(.app)
    public static let ui = logger(.ui)
    public static let session = logger(.session)
    public static let network = logger(.network)
    public static let environment = logger(.environment)
    public static let location = logger(.location)
    public static let voice = logger(.voice)
    public static let bridge = logger(.bridge)
    public static let server = logger(.server)
    public static let performance = logger(.performance)

    public static let appSignposter = signposter(.app)
    public static let uiSignposter = signposter(.ui)
    public static let sessionSignposter = signposter(.session)
    public static let networkSignposter = signposter(.network)
    public static let environmentSignposter = signposter(.environment)
    public static let locationSignposter = signposter(.location)
    public static let voiceSignposter = signposter(.voice)
    public static let bridgeSignposter = signposter(.bridge)
    public static let serverSignposter = signposter(.server)
    public static let performanceSignposter = signposter(.performance)

    public static func logger(_ category: RookLogCategory) -> Logger {
        Logger(subsystem: subsystem, category: category.rawValue)
    }

    public static func signposter(_ category: RookLogCategory) -> OSSignposter {
        OSSignposter(logger: logger(category))
    }
}

public enum RookPerformanceSeverity: String {
    case info
    case warning
    case error
}

public final class RookTimedOperation {
    private let logger: Logger
    private let signposter: OSSignposter?
    private let signpostName: StaticString
    private let intervalState: OSSignpostIntervalState?
    private let operation: String
    private let description: String
    private let startedAtNs: UInt64
    private let slowThresholdMs: Double
    private let hangThresholdMs: Double
    private var finished = false

    fileprivate init(
        signpostName: StaticString,
        operation: String,
        description: String,
        logger: Logger,
        signposter: OSSignposter?,
        slowThresholdMs: Double,
        hangThresholdMs: Double
    ) {
        self.logger = logger
        self.signposter = signposter
        self.signpostName = signpostName
        self.operation = operation
        self.description = description
        self.startedAtNs = DispatchTime.now().uptimeNanoseconds
        self.slowThresholdMs = slowThresholdMs
        self.hangThresholdMs = hangThresholdMs
        if let signposter {
            self.intervalState = signposter.beginInterval(signpostName, "\(description, privacy: .public)")
        } else {
            self.intervalState = nil
        }
    }

    public func finish(details: String = "") {
        complete(error: nil, details: details)
    }

    public func fail(_ error: Error, details: String = "") {
        complete(error: error, details: details)
    }

    private func complete(error: Error?, details: String) {
        guard !finished else { return }
        finished = true

        let elapsedMs = Double(DispatchTime.now().uptimeNanoseconds - startedAtNs) / 1_000_000
        let severity = RookPerformance.severity(
            forElapsedMs: elapsedMs,
            slowThresholdMs: slowThresholdMs,
            hangThresholdMs: hangThresholdMs
        )
        let prefix = "operation=\(self.operation) elapsedMs=\(RookPerformance.format(elapsedMs))"
        let suffix = [description, details, error?.localizedDescription]
            .map { $0?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "" }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        let message = suffix.isEmpty ? prefix : "\(prefix) \(suffix)"

        if let signposter, let intervalState {
            if let error {
                signposter.endInterval(signpostName, intervalState, "\(message, privacy: .public) error=\(error.localizedDescription, privacy: .public)")
            } else {
                signposter.endInterval(signpostName, intervalState, "\(message, privacy: .public)")
            }
        }

        switch (severity, error) {
        case (_, let error?) where severity == .error:
            logger.error("\(message, privacy: .public)")
            logger.error("operation=\(self.operation, privacy: .public) failed error=\(error.localizedDescription, privacy: .public)")
        case (_, let error?) where severity == .warning:
            logger.warning("\(message, privacy: .public)")
            logger.warning("operation=\(self.operation, privacy: .public) failed error=\(error.localizedDescription, privacy: .public)")
        case (_, let error?):
            logger.error("\(message, privacy: .public)")
            logger.error("operation=\(self.operation, privacy: .public) failed error=\(error.localizedDescription, privacy: .public)")
        case (.error, nil):
            logger.error("\(message, privacy: .public)")
        case (.warning, nil):
            logger.warning("\(message, privacy: .public)")
        case (.info, nil):
            logger.debug("\(message, privacy: .public)")
        }
    }
}

public enum RookPerformance {
    public static let slowThresholdMs = 100.0
    public static let hangThresholdMs = 500.0

    public static func severity(
        forElapsedMs elapsedMs: Double,
        slowThresholdMs: Double = slowThresholdMs,
        hangThresholdMs: Double = hangThresholdMs
    ) -> RookPerformanceSeverity {
        if elapsedMs >= hangThresholdMs {
            return .error
        }
        if elapsedMs >= slowThresholdMs {
            return .warning
        }
        return .info
    }

    public static func begin(
        _ signpostName: StaticString,
        operation: String,
        description: String = "",
        logger: Logger = RookLog.performance,
        signposter: OSSignposter? = RookLog.performanceSignposter,
        slowThresholdMs: Double = slowThresholdMs,
        hangThresholdMs: Double = hangThresholdMs
    ) -> RookTimedOperation {
        RookTimedOperation(
            signpostName: signpostName,
            operation: operation,
            description: description,
            logger: logger,
            signposter: signposter,
            slowThresholdMs: slowThresholdMs,
            hangThresholdMs: hangThresholdMs
        )
    }

    @discardableResult
    public static func measure<T>(
        _ signpostName: StaticString,
        operation: String,
        description: String = "",
        logger: Logger = RookLog.performance,
        signposter: OSSignposter? = RookLog.performanceSignposter,
        slowThresholdMs: Double = slowThresholdMs,
        hangThresholdMs: Double = hangThresholdMs,
        details: (T) -> String = { _ in "" },
        _ body: () throws -> T
    ) rethrows -> T {
        let timed = begin(
            signpostName,
            operation: operation,
            description: description,
            logger: logger,
            signposter: signposter,
            slowThresholdMs: slowThresholdMs,
            hangThresholdMs: hangThresholdMs
        )
        do {
            let value = try body()
            timed.finish(details: details(value))
            return value
        } catch {
            timed.fail(error)
            throw error
        }
    }

    @discardableResult
    public static func measureAsync<T>(
        _ signpostName: StaticString,
        operation: String,
        description: String = "",
        logger: Logger = RookLog.performance,
        signposter: OSSignposter? = RookLog.performanceSignposter,
        slowThresholdMs: Double = slowThresholdMs,
        hangThresholdMs: Double = hangThresholdMs,
        details: (T) -> String = { _ in "" },
        _ body: () async throws -> T
    ) async rethrows -> T {
        let timed = begin(
            signpostName,
            operation: operation,
            description: description,
            logger: logger,
            signposter: signposter,
            slowThresholdMs: slowThresholdMs,
            hangThresholdMs: hangThresholdMs
        )
        do {
            let value = try await body()
            timed.finish(details: details(value))
            return value
        } catch {
            timed.fail(error)
            throw error
        }
    }

    fileprivate static func format(_ elapsedMs: Double) -> String {
        String(format: "%.2f", elapsedMs)
    }
}
