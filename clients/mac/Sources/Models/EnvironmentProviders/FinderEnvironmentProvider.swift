import Foundation
import RookKit

struct FinderObservation: Equatable {
    let currentDirectoryPath: String?
    let allDirectoryPaths: [String]
}

@MainActor
final class FinderEnvironmentProvider: SpecializedEnvironmentProvider {
    private static let pollInterval: TimeInterval = 5

    let supportedBundleIds = ["com.apple.finder"]
    var onStateChange: (() -> Void)?
    private(set) var currentAppEnvironmentId: String?
    var currentSiteEnvironmentId: String? { nil }

    private let registration: EnvironmentRegistrationController
    private let observe: () -> FinderObservation
    private var pollTimer: Timer?
    private var currentApp: ForegroundApp?
    private var currentTitle: String?

    init(register: @escaping ([EnvironmentCandidate], String) -> Void) {
        self.registration = EnvironmentRegistrationController(register: register)
        self.observe = Self.observeFinder
    }

    init(
        register: @escaping ([EnvironmentCandidate], String) -> Void,
        observe: @escaping () -> FinderObservation
    ) {
        self.registration = EnvironmentRegistrationController(register: register)
        self.observe = observe
    }

    func activate(app: ForegroundApp, title: String?) {
        currentApp = app
        currentTitle = title
        let observation = observe()
        currentAppEnvironmentId = Self.currentEnvironmentId(from: observation)
        startPolling()
        poll()
    }

    func update(app: ForegroundApp, title: String?) {
        currentApp = app
        currentTitle = title
        currentAppEnvironmentId = Self.currentEnvironmentId(from: observe())
    }

    func deactivate() {
        pollTimer?.invalidate()
        pollTimer = nil
        currentApp = nil
        currentTitle = nil
        currentAppEnvironmentId = nil
        registration.clear()
        onStateChange?()
    }

    func setServerOnline(_ online: Bool) {
        registration.setServerOnline(online)
    }

    private func startPolling() {
        pollTimer?.invalidate()
        pollTimer = Timer.scheduledTimer(withTimeInterval: Self.pollInterval, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.poll()
            }
        }
    }

    private func poll() {
        guard let currentApp else { return }
        let title = AXReader.focusedWindowTitle(pid: currentApp.pid) ?? currentTitle
        currentTitle = title
        let observation = observe()
        currentAppEnvironmentId = Self.currentEnvironmentId(from: observation)
        let candidates = Self.candidates(for: currentApp, title: title, observation: observation)
        registration.emitNow(candidates: candidates, reason: "finder")
        onStateChange?()
    }

    static func currentEnvironmentId(from observation: FinderObservation) -> String? {
        guard let path = observation.currentDirectoryPath else { return nil }
        return "dir:\(path)"
    }

    static func candidates(for app: ForegroundApp, title: String?, observation: FinderObservation) -> [EnvironmentCandidate] {
        observation.allDirectoryPaths.map { path in
            var metadata = CandidateMetadata.base(app: app, title: title)
            metadata["directoryPath"] = .string(path)
            metadata["displayName"] = .string("\(app.name) · \(displayName(for: path))")
            if path == observation.currentDirectoryPath {
                metadata["finderCurrent"] = .bool(true)
            }
            return EnvironmentCandidate(id: "dir:\(path)", metadata: metadata)
        }
        .sorted { lhs, rhs in
            EnvironmentIDEncoding.depth(lhs.id) < EnvironmentIDEncoding.depth(rhs.id)
        }
    }

    static func parseObservation(from output: String) -> FinderObservation {
        var currentDirectoryPath: String?
        var allDirectoryPaths: [String] = []

        for rawLine in output.components(separatedBy: .newlines) {
            let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !line.isEmpty else { continue }
            let parts = line.components(separatedBy: "\t")
            guard parts.count >= 2 else { continue }
            let kind = parts[0].trimmingCharacters(in: .whitespacesAndNewlines)
            let rawPath = parts.dropFirst().joined(separator: "\t")
            guard let normalizedPath = GenericEnvironmentProvider.normalizedAbsolutePath(from: rawPath) else {
                continue
            }
            if !allDirectoryPaths.contains(normalizedPath) {
                allDirectoryPaths.append(normalizedPath)
            }
            if kind == "current" {
                currentDirectoryPath = normalizedPath
            }
        }

        return FinderObservation(currentDirectoryPath: currentDirectoryPath, allDirectoryPaths: allDirectoryPaths)
    }

    static func displayName(for path: String) -> String {
        if path == "/" {
            return "/"
        }
        return URL(fileURLWithPath: path).lastPathComponent
    }

    static func observeFinder() -> FinderObservation {
        MacStallWatchdog.shared.beginOperation("FinderEnvironmentProvider.observeFinder")
        defer { MacStallWatchdog.shared.endOperation("FinderEnvironmentProvider.observeFinder") }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", finderObservationScript]
        MacStallWatchdog.shared.updateContext(["automationTarget": "Finder"])

        let stdout = Pipe()
        let stderr = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr

        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            providerLog("finder observe error: \(error.localizedDescription)")
            return FinderObservation(currentDirectoryPath: nil, allDirectoryPaths: [])
        }

        guard process.terminationStatus == 0 else {
            let errorData = stderr.fileHandleForReading.readDataToEndOfFile()
            let errorOutput = String(data: errorData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !errorOutput.isEmpty {
                providerLog("finder observe error: \(errorOutput)")
            }
            return FinderObservation(currentDirectoryPath: nil, allDirectoryPaths: [])
        }

        let outputData = stdout.fileHandleForReading.readDataToEndOfFile()
        let output = String(data: outputData, encoding: .utf8) ?? ""
        return parseObservation(from: output)
    }

    private static let finderObservationScript = #"""
tell application "Finder"
set outputLines to {}
try
	if (count of Finder windows) > 0 then
		repeat with w in Finder windows
			try
				set end of outputLines to "window" & tab & POSIX path of ((target of w) as alias)
			end try
		end repeat
		try
			set end of outputLines to "current" & tab & POSIX path of ((target of front window) as alias)
		end try
	else
		try
			set desktopPath to POSIX path of (desktop as alias)
			set end of outputLines to "window" & tab & desktopPath
			set end of outputLines to "current" & tab & desktopPath
		end try
	end if
end try
set AppleScript's text item delimiters to linefeed
return outputLines as text
end tell
"""#
}
