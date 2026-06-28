import Foundation

/// Launches and supervises a dev Rook server (`npm run dev`) for the
/// rookery repo when one isn't already running.
@MainActor
final class ServerController {
    var onTermination: (() -> Void)?

    private(set) var isManagedServerRunning = false
    private var process: Process?

    /// The rookery repo root, located by searching upward from this source file
    /// for a directory containing repo-root markers. Robust to moving this file
    /// within the tree (no hard-coded depth). A `RookeryRepoRoot` default overrides
    /// the search.
    static var repoRoot: URL {
        if let override = UserDefaults.standard.string(forKey: "RookeryRepoRoot"), !override.isEmpty {
            return URL(fileURLWithPath: override)
        }
        let fm = FileManager.default
        // Markers that live only at the repo root.
        let markers = ["environment-repository", ".git", "AGENTS.md"]
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        while true {
            if markers.contains(where: { fm.fileExists(atPath: dir.appending(path: $0).path) }) {
                return dir
            }
            let parent = dir.deletingLastPathComponent()
            if parent.path == dir.path { break }   // reached "/"
            dir = parent
        }
        // Don't silently return a wrong path — that's what hid the original bug.
        assertionFailure("Could not locate rookery repo root from \(#filePath); set RookeryRepoRoot.")
        return URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    }

    static var logFileURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appending(path: "Library/Logs/Rook/server.log")
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
