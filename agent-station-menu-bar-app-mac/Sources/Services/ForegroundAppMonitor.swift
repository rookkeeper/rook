import AppKit
import Foundation

/// Lightweight debug trace for the foreground-provider path; tail
/// /tmp/agent-station-menubar.log while testing.
func providerLog(_ message: String) {
    let line = "\(Date()) \(message)\n"
    let url = URL(fileURLWithPath: "/tmp/agent-station-menubar.log")
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
}

/// Watches which Mac app is frontmost via NSWorkspace activation
/// notifications (no Accessibility permission needed — app identity is free).
/// Debounced so ⌘-Tab flicker doesn't churn environment registrations.
@MainActor
final class ForegroundAppMonitor {
    var onForegroundChange: ((ForegroundApp) -> Void)?

    private(set) var current: ForegroundApp?
    private var observer: NSObjectProtocol?
    private var debounceTask: Task<Void, Never>?
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
            guard let bundleId = running?.bundleIdentifier,
                  let name = running?.localizedName else {
                return
            }
            Task { @MainActor in
                self?.handleActivation(ForegroundApp(bundleId: bundleId, name: name))
            }
        }
        if let frontmost = NSWorkspace.shared.frontmostApplication,
           let bundleId = frontmost.bundleIdentifier,
           let name = frontmost.localizedName {
            handleActivation(ForegroundApp(bundleId: bundleId, name: name))
        }
    }

    func stop() {
        if let observer {
            NSWorkspace.shared.notificationCenter.removeObserver(observer)
        }
        observer = nil
        debounceTask?.cancel()
    }

    private func handleActivation(_ app: ForegroundApp) {
        providerLog("activation: \(app.name) [\(app.bundleId)]")
        // Our own panel/window gaining focus must not end the current app's
        // foreground episode.
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
            self.current = app
            self.onForegroundChange?(app)
        }
    }
}
