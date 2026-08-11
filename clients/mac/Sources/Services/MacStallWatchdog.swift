import AppKit
import Foundation
import OSLog

struct StallWatchdogTracker {
    enum Event: Equatable {
        case stalled(ageNanoseconds: UInt64, operation: String)
        case recovered(stallDurationNanoseconds: UInt64)
    }

    private let thresholdNanoseconds: UInt64
    private(set) var lastHeartbeatNanoseconds: UInt64
    private(set) var lastOperation: String
    private var stallStartedNanoseconds: UInt64?
    private var activeOperations: [String] = []

    init(nowNanoseconds: UInt64, thresholdNanoseconds: UInt64, initialOperation: String = "startup") {
        self.lastHeartbeatNanoseconds = nowNanoseconds
        self.thresholdNanoseconds = thresholdNanoseconds
        self.lastOperation = initialOperation
    }

    mutating func heartbeat(nowNanoseconds: UInt64, operation: String) -> Event? {
        let recoveryDuration = stallStartedNanoseconds.map { nowNanoseconds >= $0 ? nowNanoseconds - $0 : 0 }
        lastHeartbeatNanoseconds = nowNanoseconds
        if activeOperations.isEmpty {
            lastOperation = operation
        }
        stallStartedNanoseconds = nil
        guard let recoveryDuration else {
            return nil
        }
        return .recovered(stallDurationNanoseconds: recoveryDuration)
    }

    mutating func beginOperation(_ operation: String) {
        activeOperations.append(operation)
        lastOperation = operation
    }

    mutating func endOperation(_ operation: String) {
        if let index = activeOperations.lastIndex(of: operation) {
            activeOperations.remove(at: index)
        }
        if activeOperations.isEmpty {
            lastOperation = operation
        }
    }

    mutating func check(nowNanoseconds: UInt64) -> Event? {
        guard stallStartedNanoseconds == nil else {
            return nil
        }
        let age = nowNanoseconds >= lastHeartbeatNanoseconds
            ? nowNanoseconds - lastHeartbeatNanoseconds
            : 0
        guard age >= thresholdNanoseconds else {
            return nil
        }
        stallStartedNanoseconds = nowNanoseconds
        return .stalled(ageNanoseconds: age, operation: activeOperations.last ?? lastOperation)
    }
}

/// Detects when the main run loop stops advancing while a background queue is
/// still alive. This is intentionally local-only and records no user content.
final class MacStallWatchdog {
    static let shared = MacStallWatchdog()

    private static let defaultThresholdNanoseconds: UInt64 = 3_000_000_000
    private static let checkIntervalNanoseconds: UInt64 = 1_000_000_000
    private static let logger = Logger(
        subsystem: Bundle.main.bundleIdentifier ?? "com.rookkeeper.Rook",
        category: "StallWatchdog"
    )

    let instanceID = String(UUID().uuidString.prefix(8)).lowercased()

    private let lock = NSLock()
    private let queue = DispatchQueue(label: "com.rookkeeper.Rook.stall-watchdog", qos: .utility)
    private var tracker: StallWatchdogTracker
    private var context: [String: String] = [:]
    private var heartbeatTimer: Timer?
    private var checkTimer: DispatchSourceTimer?
    private var notificationObservers: [NSObjectProtocol] = []
    private var isStarted = false

    init(thresholdNanoseconds: UInt64 = MacStallWatchdog.defaultThresholdNanoseconds) {
        tracker = StallWatchdogTracker(
            nowNanoseconds: DispatchTime.now().uptimeNanoseconds,
            thresholdNanoseconds: thresholdNanoseconds
        )
    }

    func start() {
        guard !isStarted else { return }
        isStarted = true
        updateContext(["appVisibility": "starting"])

        let heartbeatTimer = Timer(timeInterval: 0.5, repeats: true) { [weak self] _ in
            self?.heartbeat(operation: "main-run-loop")
        }
        RunLoop.main.add(heartbeatTimer, forMode: .common)
        self.heartbeatTimer = heartbeatTimer

        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(
            deadline: .now() + .nanoseconds(Int(Self.checkIntervalNanoseconds)),
            repeating: .nanoseconds(Int(Self.checkIntervalNanoseconds))
        )
        timer.setEventHandler { [weak self] in
            self?.checkForStall()
        }
        timer.resume()
        checkTimer = timer

        let center = NotificationCenter.default
        let notifications: [(Notification.Name, String)] = [
            (NSApplication.didBecomeActiveNotification, "active"),
            (NSApplication.didResignActiveNotification, "inactive"),
            (NSApplication.didHideNotification, "hidden"),
            (NSApplication.didUnhideNotification, "visible"),
        ]
        notificationObservers = notifications.map { name, visibility in
            center.addObserver(forName: name, object: nil, queue: nil) { [weak self] _ in
                self?.updateContext(["appVisibility": visibility])
            }
        }

        Self.logger.info("Stall watchdog started. instance=\(self.instanceID, privacy: .public)")
    }

    func stop() {
        heartbeatTimer?.invalidate()
        heartbeatTimer = nil
        checkTimer?.cancel()
        checkTimer = nil
        for observer in notificationObservers {
            NotificationCenter.default.removeObserver(observer)
        }
        notificationObservers.removeAll()
        isStarted = false
    }

    func heartbeat(operation: String = "main-run-loop") {
        let event: StallWatchdogTracker.Event?
        lock.lock()
        event = tracker.heartbeat(
            nowNanoseconds: DispatchTime.now().uptimeNanoseconds,
            operation: operation
        )
        let context = self.context
        lock.unlock()

        if case let .recovered(duration) = event {
            Self.logger.info(
                "Main-thread stall recovered. instance=\(self.instanceID, privacy: .public) durationMs=\(duration / 1_000_000, privacy: .public) context=\(Self.contextDescription(context), privacy: .public)"
            )
        }
    }

    func beginOperation(_ operation: String) {
        lock.lock()
        tracker.beginOperation(operation)
        lock.unlock()
    }

    func endOperation(_ operation: String) {
        lock.lock()
        tracker.endOperation(operation)
        lock.unlock()
    }

    func updateContext(_ values: [String: String]) {
        lock.lock()
        context.merge(values) { _, newValue in newValue }
        lock.unlock()
    }

    private func checkForStall() {
        let event: StallWatchdogTracker.Event?
        let context: [String: String]
        lock.lock()
        event = tracker.check(nowNanoseconds: DispatchTime.now().uptimeNanoseconds)
        context = self.context
        lock.unlock()

        guard case let .stalled(age, operation) = event else {
            return
        }
        Self.logger.error(
            "Main-thread stall detected. instance=\(self.instanceID, privacy: .public) ageMs=\(age / 1_000_000, privacy: .public) operation=\(operation, privacy: .public) context=\(Self.contextDescription(context), privacy: .public)"
        )
    }

    private static func contextDescription(_ context: [String: String]) -> String {
        context.keys.sorted().compactMap { key in
            guard let value = context[key] else { return nil }
            return "\(key)=\(value)"
        }.joined(separator: ",")
    }
}
