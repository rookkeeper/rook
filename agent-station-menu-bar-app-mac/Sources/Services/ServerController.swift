import Foundation

/// Launches and supervises a dev Agent Station server (`npm run dev`) for the
/// rookery repo when one isn't already running.
@MainActor
final class ServerController {
    var onTermination: (() -> Void)?

    private(set) var isManagedServerRunning = false
    private var process: Process?

    /// The rookery repo root. This source file lives at
    /// `<repo>/agent-station-menu-bar-app-mac/Sources/Services/ServerController.swift`,
    /// so walk four directories up; a `RookeryRepoRoot` default overrides it.
    static var repoRoot: URL {
        if let override = UserDefaults.standard.string(forKey: "RookeryRepoRoot"), !override.isEmpty {
            return URL(fileURLWithPath: override)
        }
        return URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }

    static var logFileURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appending(path: "Library/Logs/AgentStationMenuBar/server.log")
    }

    func start() {
        guard process == nil else {
            return
        }
        let logURL = Self.logFileURL
        try? FileManager.default.createDirectory(
            at: logURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        FileManager.default.createFile(atPath: logURL.path, contents: nil)
        let logHandle = try? FileHandle(forWritingTo: logURL)

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = ["-lc", "exec npm run dev"]
        process.currentDirectoryURL = Self.repoRoot
        if let logHandle {
            process.standardOutput = logHandle
            process.standardError = logHandle
        }
        process.terminationHandler = { [weak self] _ in
            Task { @MainActor in
                guard let self else {
                    return
                }
                self.process = nil
                self.isManagedServerRunning = false
                self.onTermination?()
            }
        }
        do {
            try process.run()
            self.process = process
            isManagedServerRunning = true
        } catch {
            try? logHandle?.write(contentsOf: Data("Failed to launch server: \(error)\n".utf8))
            isManagedServerRunning = false
        }
    }

    func stop() {
        process?.terminate()
        process = nil
        isManagedServerRunning = false
    }
}
