import SwiftUI

/// A floating window that tails `/tmp/rook.log` live.
struct LogViewerView: View {
    @State private var lines: [String] = []
    @State private var timer: Timer?
    @State private var lastSize: UInt64 = 0
    private let logURL = URL(fileURLWithPath: "/tmp/rook.log")

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Label("Rook Log", systemImage: "doc.text.magnifyingglass")
                    .font(.headline)
                    .foregroundStyle(.primary)
                Spacer()
                Text("\(lines.count) lines")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                Button {
                    lines = []
                    lastSize = 0
                    readLog()
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 11, weight: .semibold))
                }
                .buttonStyle(.plain)
                .help("Clear and re-read")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(.ultraThinMaterial)

            Divider()

            // Log content
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
        .frame(minWidth: 560, minHeight: 320)
        .onAppear {
            readLog()
            timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in
                readLog()
            }
        }
        .onDisappear {
            timer?.invalidate()
            timer = nil
        }
    }

    private func readLog() {
        guard let handle = try? FileHandle(forReadingFrom: logURL) else {
            if lines.isEmpty {
                lines = ["(log file not found at \(logURL.path))"]
            }
            return
        }
        defer { try? handle.close() }

        let currentSize = (try? handle.seekToEnd()) ?? 0
        if currentSize == lastSize { return }

        if currentSize < lastSize {
            // File was truncated — re-read from scratch.
            lines = []
        }

        // Only read the new tail; keep the most recent ~3000 lines.
        let bytesToRead = min(currentSize - lastSize, 256 * 1024)
        guard bytesToRead > 0 else { return }
        try? handle.seek(toOffset: max(currentSize - bytesToRead, 0))

        let data = handle.readData(ofLength: Int(bytesToRead))
        guard let text = String(data: data, encoding: .utf8) else { return }

        let newLines = text.components(separatedBy: "\n").filter { !$0.isEmpty }
        lines.append(contentsOf: newLines)
        // Trim head so we don't grow unbounded.
        if lines.count > 3000 {
            lines.removeFirst(lines.count - 3000)
        }
        lastSize = currentSize
    }

    private func lineColor(for line: String) -> Color {
        if line.contains("[ERROR]") || line.contains("error") {
            return .red.opacity(0.9)
        }
        if line.contains("[RAW-CONTEXT]") {
            return Color.cyan.opacity(0.85)
        }
        if line.contains("[WARN]") || line.contains("failed") {
            return .yellow.opacity(0.85)
        }
        return .white.opacity(0.75)
    }
}
