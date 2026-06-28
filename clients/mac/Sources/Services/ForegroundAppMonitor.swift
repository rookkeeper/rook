import AppKit
import Foundation

/// Lightweight debug trace for the foreground-provider path; tail
/// /tmp/rook.log while testing.
func providerLog(_ message: String) {
    let line = "\(Date()) \(message)\n"
    let url = URL(fileURLWithPath: "/tmp/rook.log")
    if let handle = try? FileHandle(forWritingTo: url) {
        handle.seekToEndOfFile()
        handle.write(Data(line.utf8))
        try? handle.close()
    } else {
        try? Data(line.utf8).write(to: url)
    }
}

struct ForegroundApp: Equatable {
    let bundleId: String
    let name: String
    let pid: pid_t

    // Identity is the bundle id — window-title changes within the same app are
    // context refreshes, not new foreground episodes.
    static func == (lhs: ForegroundApp, rhs: ForegroundApp) -> Bool {
        lhs.bundleId == rhs.bundleId
    }
}

/// Watches which Mac app is frontmost (NSWorkspace activation — needs no
/// permission) and, when Accessibility is granted, the focused window title
/// (Tier 1 perception). Emits two signals:
///   - onForegroundChange: app identity changed (drives register/unregister)
///   - onContextRefresh:   app+title snapshot (drives the bridge /context),
///                         also firing on in-app title changes (e.g. switching
///                         Slack channels without switching apps)
@MainActor
final class ForegroundAppMonitor {
    var onForegroundChange: ((ForegroundApp) -> Void)?
    var onContextRefresh: ((ForegroundApp, String?) -> Void)?

    private(set) var current: ForegroundApp?
    private(set) var currentTitle: String?

    private var observer: NSObjectProtocol?
    private var debounceTask: Task<Void, Never>?
    private var pollTimer: Timer?
    private let debounceNanoseconds: UInt64 = 700_000_000

    func start() {
        guard observer == nil else {
            return
        }
        observer = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            let running = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
            guard let running, let app = Self.makeApp(running) else {
                return
            }
            Task { @MainActor in
                self?.handleActivation(app)
            }
        }
        if let frontmost = NSWorkspace.shared.frontmostApplication,
           let app = Self.makeApp(frontmost) {
            handleActivation(app)
        }
        // Poll catches missed activations and in-app title changes (channel
        // switches) that emit no activation notification.
        pollTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.poll()
            }
        }
    }

    func stop() {
        if let observer {
            NSWorkspace.shared.notificationCenter.removeObserver(observer)
        }
        observer = nil
        debounceTask?.cancel()
        pollTimer?.invalidate()
        pollTimer = nil
    }

    /// Re-read the title now (e.g. right after the user grants Accessibility).
    func refreshTitleNow() {
        guard let current else {
            return
        }
        emitContext(for: current)
    }

    private nonisolated static func makeApp(_ running: NSRunningApplication) -> ForegroundApp? {
        guard let bundleId = running.bundleIdentifier, let name = running.localizedName else {
            return nil
        }
        return ForegroundApp(bundleId: bundleId, name: name, pid: running.processIdentifier)
    }

    private func handleActivation(_ app: ForegroundApp) {
        providerLog("activation: \(app.name) [\(app.bundleId)]")
        // Our own panel/window gaining focus must not end the current episode.
        if app.bundleId == Bundle.main.bundleIdentifier {
            return
        }
        guard app != current else {
            return
        }
        debounceTask?.cancel()
        debounceTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: self?.debounceNanoseconds ?? 0)
            guard !Task.isCancelled, let self else {
                return
            }
            self.commit(app)
        }
    }

    private func commit(_ app: ForegroundApp) {
        current = app
        onForegroundChange?(app)
        emitContext(for: app)
    }

    private func emitContext(for app: ForegroundApp) {
        let title = AXReader.focusedWindowTitle(pid: app.pid)
        currentTitle = title
        onContextRefresh?(app, title)
    }

    private func poll() {
        guard let frontmost = NSWorkspace.shared.frontmostApplication,
              let app = Self.makeApp(frontmost),
              app.bundleId != Bundle.main.bundleIdentifier else {
            return
        }
        if app != current {
            // Safety net for a missed activation notification — commit directly
            // (we've already waited a poll interval, so no extra debounce).
            debounceTask?.cancel()
            commit(app)
            return
        }
        let title = AXReader.focusedWindowTitle(pid: app.pid)
        if title != currentTitle {
            currentTitle = title
            onContextRefresh?(app, title)
        }
    }
}
