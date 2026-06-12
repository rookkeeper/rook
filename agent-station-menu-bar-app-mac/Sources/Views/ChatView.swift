import Foundation
import SwiftUI

struct ChatDetail: View {
    @ObservedObject var model: AgentStationModel
    @State private var draft = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            DetailHeader(
                title: chatTitle,
                systemImage: "bubble.left.and.bubble.right",
                trailing: headerTrailing
            ) {
                model.goHome()
            }

            threadCard

            if !model.queuedMessages.isEmpty {
                queuedCard
            }

            statusRow
            composeRow
        }
    }

    private var chatTitle: String {
        guard let session = model.currentSession else {
            return "Chat"
        }
        if session.name == "default" {
            return session.agent
        }
        return "\(session.agent) · \(session.name)"
    }

    private var headerTrailing: String {
        if let usage = model.contextUsage, usage.size > 0 {
            return "ctx \(compactCount(usage.used))/\(compactCount(usage.size))"
        }
        if model.reconnecting {
            return "reconnecting…"
        }
        return model.socketConnected ? "" : "disconnected"
    }

    private func compactCount(_ value: Int) -> String {
        if value >= 1_000_000 {
            return String(format: "%.1fM", Double(value) / 1_000_000)
        }
        if value >= 1_000 {
            return String(format: "%.1fk", Double(value) / 1_000)
        }
        return "\(value)"
    }

    private var threadCard: some View {
        PanelCard {
            if model.blocks.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "bird")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(PanelPalette.secondaryText)
                    Text("Say something to your agent")
                        .font(.callout)
                        .fontWeight(.medium)
                    Text("Messages stream here, including thinking and tool activity.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity, minHeight: 320, alignment: .center)
            } else {
                ScrollViewReader { proxy in
                    ScrollView(.vertical) {
                        LazyVStack(alignment: .leading, spacing: 10) {
                            ForEach(model.blocks) { block in
                                ChatBlockView(block: block)
                            }
                            Color.clear
                                .frame(height: 1)
                                .id("chat-bottom")
                        }
                        .padding(.trailing, 2)
                    }
                    .scrollIndicators(.visible)
                    .frame(height: 340)
                    .onAppear {
                        proxy.scrollTo("chat-bottom", anchor: .bottom)
                    }
                    .onChange(of: model.scrollTick) { _, _ in
                        proxy.scrollTo("chat-bottom", anchor: .bottom)
                    }
                }
            }
        }
    }

    private var queuedCard: some View {
        PanelCard {
            Label("\(model.queuedMessages.count) queued", systemImage: "tray.full")
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(PanelPalette.secondaryText)

            ForEach(Array(model.queuedMessages.enumerated()), id: \.offset) { index, message in
                HStack(spacing: 8) {
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Spacer(minLength: 4)
                    Button {
                        model.removeQueuedMessage(at: index)
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 11))
                            .foregroundStyle(PanelPalette.secondaryText)
                    }
                    .buttonStyle(.plain)
                    .help("Remove from queue")
                    .pointingHandOnHover()
                }
            }
        }
    }

    @ViewBuilder
    private var statusRow: some View {
        if model.isRunning || model.reconnecting {
            HStack(spacing: 8) {
                ProgressView()
                    .scaleEffect(0.5)
                Text(model.reconnecting ? "Reconnecting to session…" : displayStatus)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            .padding(.horizontal, 4)
        }
    }

    private var displayStatus: String {
        model.statusLine.isEmpty ? "Agent is working…" : model.statusLine
    }

    private var composeRow: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField(composePlaceholder, text: $draft, axis: .vertical)
                .textFieldStyle(.plain)
                .font(.callout)
                .lineLimit(1...4)
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(Color.black.opacity(0.24))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .strokeBorder(.white.opacity(0.20))
                )
                .onSubmit {
                    submit()
                }

            Button {
                submit()
            } label: {
                Image(systemName: model.isRunning ? "tray.and.arrow.down" : "arrow.up")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 34, height: 34)
                    .background(
                        Circle()
                            .fill(PanelPalette.info.gradient)
                    )
            }
            .buttonStyle(.plain)
            .help(model.isRunning ? "Queue message" : "Send message")
            .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .pointingHandOnHover()
        }
    }

    private var composePlaceholder: String {
        guard let session = model.currentSession else {
            return "Message your agent"
        }
        return model.isRunning ? "Queue a message for \(session.agent)…" : "Message \(session.agent)…"
    }

    private func submit() {
        let text = draft
        draft = ""
        model.send(text)
    }
}

// MARK: - Blocks

struct ChatBlockView: View {
    var block: ChatBlock

    var body: some View {
        switch block.kind {
        case .user(let text):
            UserBlockView(text: text)
        case .assistantText(let text, let streaming):
            AssistantTextBlockView(text: text, streaming: streaming)
        case .thinking(let text, let streaming):
            ThinkingBlockView(text: text, streaming: streaming)
        case .tool(let state):
            ToolBlockView(state: state)
        case .error(let source, let message):
            ErrorBlockView(source: source, message: message)
        case .system(let text):
            SystemBlockView(text: text)
        case .plan(let entries):
            PlanBlockView(entries: entries)
        }
    }
}

private struct UserBlockView: View {
    var text: String

    var body: some View {
        HStack {
            Spacer(minLength: 40)
            Text(text)
                .font(.callout)
                .foregroundStyle(.white.opacity(0.96))
                .textSelection(.enabled)
                .padding(.horizontal, 11)
                .padding(.vertical, 8)
                .background(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(PanelPalette.info.opacity(0.30))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(PanelPalette.info.opacity(0.35))
                )
        }
    }
}

private struct AssistantTextBlockView: View {
    var text: String
    var streaming: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(Array(paragraphs.enumerated()), id: \.offset) { _, paragraph in
                Text(inlineMarkdown(paragraph))
                    .font(.system(size: 12.5))
                    .lineSpacing(3)
                    .foregroundStyle(.white.opacity(0.92))
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if streaming {
                StreamingIndicator()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var paragraphs: [String] {
        text.components(separatedBy: "\n\n").filter {
            !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }
}

private struct ThinkingBlockView: View {
    var text: String
    var streaming: Bool
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Button {
                withAnimation(.easeInOut(duration: 0.14)) {
                    expanded.toggle()
                }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "brain")
                        .font(.system(size: 10, weight: .semibold))
                    Text(streaming ? "Thinking…" : "Thought")
                        .font(.caption2)
                        .fontWeight(.semibold)
                    Image(systemName: expanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 8, weight: .bold))
                }
                .foregroundStyle(PanelPalette.secondaryText)
            }
            .buttonStyle(.plain)
            .pointingHandOnHover()

            if expanded || streaming {
                Text(text)
                    .font(.caption)
                    .italic()
                    .lineSpacing(2)
                    .foregroundStyle(.white.opacity(0.55))
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 7)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Color.black.opacity(0.18))
        )
    }
}

private struct ToolBlockView: View {
    var state: ToolBlockState
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                withAnimation(.easeInOut(duration: 0.14)) {
                    expanded.toggle()
                }
            } label: {
                HStack(spacing: 8) {
                    statusIcon
                    Text(state.title)
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundStyle(.white.opacity(0.88))
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Spacer(minLength: 4)
                    Text(state.status.label)
                        .font(.caption2)
                        .fontWeight(.semibold)
                        .foregroundColor(.white.opacity(0.96))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(
                            Capsule()
                                .fill(statusTint.opacity(0.28))
                        )
                    Image(systemName: expanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(.secondary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Show tool details")
            .pointingHandOnHover()

            if !state.status.isTerminal && state.status != .pending {
                ProgressView()
                    .scaleEffect(0.45)
                    .frame(height: 8)
            }

            if expanded {
                if !state.arguments.isEmpty {
                    monoSection(label: "Input", text: state.arguments)
                }
                if !state.output.isEmpty {
                    monoSection(label: "Output", text: state.output)
                }
                if state.arguments.isEmpty && state.output.isEmpty {
                    Text("No input or output captured.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Color.black.opacity(0.22))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(statusTint.opacity(0.30))
        )
    }

    private func monoSection(label: String, text: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label)
                .font(.caption2)
                .fontWeight(.semibold)
                .foregroundStyle(PanelPalette.secondaryText)
            ScrollView(.vertical) {
                Text(text)
                    .font(.system(size: 10.5, design: .monospaced))
                    .foregroundStyle(.white.opacity(0.78))
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .topLeading)
            }
            .frame(maxHeight: 120)
            .padding(6)
            .background(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(Color.black.opacity(0.30))
            )
        }
    }

    private var statusIcon: some View {
        Image(systemName: iconName)
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(statusTint)
            .frame(width: 20, height: 20)
            .background(
                Circle()
                    .fill(statusTint.opacity(0.16))
            )
    }

    private var iconName: String {
        switch state.status {
        case .pending, .inputStreaming:
            return "ellipsis"
        case .ready:
            return "checkmark.circle"
        case .running:
            return "gearshape.2"
        case .completed:
            return "checkmark"
        case .failed:
            return "xmark"
        case .cancelled:
            return "slash.circle"
        }
    }

    private var statusTint: Color {
        switch state.status {
        case .completed:
            return PanelPalette.success
        case .failed:
            return PanelPalette.danger
        case .cancelled:
            return PanelPalette.secondaryText
        default:
            return PanelPalette.info
        }
    }
}

private struct ErrorBlockView: View {
    var source: String
    var message: String

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(PanelPalette.warning)
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text(sourceLabel)
                    .font(.caption2)
                    .fontWeight(.semibold)
                    .foregroundStyle(PanelPalette.warning)
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(PanelPalette.warning.opacity(0.10))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(PanelPalette.warning.opacity(0.25))
        )
    }

    private var sourceLabel: String {
        switch source {
        case "run":
            return "Run failed"
        case "connection":
            return "Connection error"
        case "protocol":
            return "Protocol error"
        default:
            return "Error"
        }
    }
}

private struct SystemBlockView: View {
    var text: String

    var body: some View {
        Text(text)
            .font(.caption2)
            .foregroundStyle(PanelPalette.secondaryText)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.vertical, 2)
    }
}

private struct PlanBlockView: View {
    var entries: [PlanEntry]

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 6) {
                Image(systemName: "list.bullet.rectangle")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(PanelPalette.info)
                Text("Plan")
                    .font(.caption2)
                    .fontWeight(.semibold)
                    .foregroundStyle(PanelPalette.secondaryText)
            }

            ForEach(entries) { entry in
                HStack(alignment: .top, spacing: 7) {
                    Image(systemName: planIcon(entry.status))
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(planTint(entry.status))
                        .padding(.top, 1)
                    Text(entry.content)
                        .font(.caption)
                        .foregroundStyle(entry.status == "completed" ? .secondary : .primary)
                        .strikethrough(entry.status == "completed", color: .secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Color.black.opacity(0.18))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(PanelPalette.info.opacity(0.20))
        )
    }

    private func planIcon(_ status: String) -> String {
        switch status {
        case "completed":
            return "checkmark.circle.fill"
        case "in_progress":
            return "arrow.triangle.2.circlepath"
        default:
            return "circle"
        }
    }

    private func planTint(_ status: String) -> Color {
        switch status {
        case "completed":
            return PanelPalette.success
        case "in_progress":
            return PanelPalette.info
        default:
            return PanelPalette.secondaryText
        }
    }
}

private struct StreamingIndicator: View {
    @State private var pulsing = false

    var body: some View {
        Circle()
            .fill(PanelPalette.info)
            .frame(width: 6, height: 6)
            .opacity(pulsing ? 0.25 : 1)
            .animation(.easeInOut(duration: 0.6).repeatForever(autoreverses: true), value: pulsing)
            .onAppear {
                pulsing = true
            }
    }
}
