import SwiftUI
import RookKit

/// A floating window that shows the unified Apple-client log stream.
struct LogViewerView: View {
    @State private var lines: [String] = []
    @State private var streamProcess: Process?
    @State private var loading = false

    private let predicate = "subsystem == \"\(RookLog.subsystem)\""
    private let serverLogPath = ServerController.logFileURL.path

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Label("Rook Unified Log", systemImage: "doc.text.magnifyingglass")
                        .font(.headline)
                        .foregroundStyle(.primary)
                    Text("Subsystem: \(RookLog.subsystem) • Managed server log: \(serverLogPath)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
                Spacer()
                if loading {
                    ProgressView()
                        .controlSize(.small)
                }
                Text("\(lines.count) lines")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                Button {
                    reloadLogs()
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 11, weight: .semibold))
                }
                .buttonStyle(.plain)
                .help("Reload recent logs and restart live stream")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(.ultraThinMaterial)

            Divider()

            ScrollViewReader { proxy in
                ScrollView(.vertical) {
                    LazyVStack(alignment: .leading, spacing: 1) {
                        ForEach(lines.indices, id: \.self) { index in
                            Text(lines[index])
                                .font(.system(size: 10.5, design: .monospaced))
                                .foregroundStyle(lineColor(for: lines[index]))
                                .textSelection(.enabled)
                                .lineLimit(1)
                                .truncationMode(.tail)
                                .id(index)
                        }
                    }
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .defaultScrollAnchor(.bottom)
                .onChange(of: lines.count) { _, _ in
                    withAnimation {
                        proxy.scrollTo(lines.count - 1, anchor: .bottom)
                    }
                }
            }
            .background(Color.black.opacity(0.92))
        }
        .frame(minWidth: 760, minHeight: 420)
        .onAppear {
            reloadLogs()
        }
        .onDisappear {
            stopStreaming()
        }
    }

    private func reloadLogs() {
        loading = true
        stopStreaming()
        Task {
            let recent = await Task.detached(priority: .userInitiated) {
                Self.loadRecentLines(predicate: predicate, serverLogPath: serverLogPath)
            }.value
            await MainActor.run {
                lines = recent
                loading = false
                startStreaming()
            }
        }
    }

    private func startStreaming() {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/log")
        process.arguments = ["stream", "--style", "compact", "--level", "debug", "--predicate", predicate]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        pipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else {
                return
            }
            let newLines = text.components(separatedBy: .newlines).filter { !$0.isEmpty }
            guard !newLines.isEmpty else { return }
            Task { @MainActor in
                appendLines(newLines)
            }
        }
        process.terminationHandler = { _ in
            pipe.fileHandleForReading.readabilityHandler = nil
        }
        do {
            try process.run()
            streamProcess = process
        } catch {
            appendLines(["(failed to start log stream: \(error.localizedDescription))"])
        }
    }

    private func stopStreaming() {
        streamProcess?.terminate()
        streamProcess = nil
    }

    private nonisolated static func loadRecentLines(predicate: String, serverLogPath: String) -> [String] {
        let unified = runProcess(executable: "/usr/bin/log", arguments: ["show", "--last", "10m", "--style", "compact", "--predicate", predicate])
            .components(separatedBy: .newlines)
            .filter { !$0.isEmpty }
        let server = loadServerLogTail(path: serverLogPath)
        var result: [String] = []
        if !server.isEmpty {
            result.append("━━ managed server log tail (\(serverLogPath)) ━━")
            result.append(contentsOf: server)
            result.append("━━ unified log tail (subsystem \(RookLog.subsystem)) ━━")
        }
        result.append(contentsOf: unified)
        if result.isEmpty {
            result = ["(no recent logs found for subsystem \(RookLog.subsystem))"]
        }
        return Array(result.suffix(3000))
    }

    private nonisolated static func loadServerLogTail(path: String, maxLines: Int = 200) -> [String] {
        guard let contents = try? String(contentsOfFile: path, encoding: .utf8) else {
            return []
        }
        return Array(contents.components(separatedBy: .newlines).filter { !$0.isEmpty }.suffix(maxLines))
    }

    private nonisolated static func runProcess(executable: String, arguments: [String]) -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            return "(failed to run \(executable): \(error.localizedDescription))"
        }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        return String(data: data, encoding: .utf8) ?? ""
    }

    @MainActor
    private func appendLines(_ newLines: [String]) {
        lines.append(contentsOf: newLines)
        if lines.count > 3000 {
            lines.removeFirst(lines.count - 3000)
        }
    }

    private func lineColor(for line: String) -> Color {
        let lowercased = line.lowercased()
        if lowercased.contains("error") || lowercased.contains("fault") {
            return .red.opacity(0.9)
        }
        if lowercased.contains("warning") || lowercased.contains("failed") {
            return .yellow.opacity(0.85)
        }
        if lowercased.contains("managed server log tail") || lowercased.contains("unified log tail") {
            return .cyan.opacity(0.85)
        }
        return .white.opacity(0.75)
    }
}
