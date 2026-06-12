import Foundation
import SwiftUI

struct ChatDetail: View {
    @ObservedObject var model: AgentStationModel
    @State private var draft = ""
    @State private var isHoveringSend = false

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

    /// Persistent status line, like the web client's `.cwa-status-line`:
    /// mint "Ready" when idle, pulsing warm yellow while the agent works.
    private var statusRow: some View {
        HStack(spacing: 8) {
            StatusLineDot(tint: statusTint, pulsing: model.isRunning || model.reconnecting)
            Text(statusText)
                .font(.caption)
                .foregroundStyle(statusTint)
                .lineLimit(1)
            Spacer(minLength: 0)
            if model.isRunning {
                Button {
                    model.stopAgent()
                } label: {
                    Label("Stop", systemImage: "stop.fill")
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(PanelPalette.danger))
                }
                .buttonStyle(.plain)
                .help("Stop the agent (⌘.)")
                .keyboardShortcut(".", modifiers: .command)
                .pointingHandOnHover()
            }
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
    }

    private var statusTint: Color {
        if model.reconnecting || !model.socketConnected {
            return PanelPalette.danger
        }
        return model.isRunning ? PanelPalette.warning : PanelPalette.success
    }

    private var statusText: String {
        if model.reconnecting {
            return "Reconnecting to session…"
        }
        if !model.socketConnected {
            return "Disconnected"
        }
        if model.isRunning {
            return model.statusLine.isEmpty ? "Agent is working…" : model.statusLine
        }
        return "Ready"
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
                        .fill(PanelPalette.backgroundPrimary.opacity(0.75))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .strokeBorder(PanelPalette.border)
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
                            .fill(isHoveringSend ? PanelPalette.accentHover : PanelPalette.accent)
                    )
            }
            .onHover { isHoveringSend = $0 }
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

/// Bubble corners match the web client: user 16/16/4/16, agent 16/16/16/4.
private func bubbleShape(tailAt corner: UnitPoint) -> UnevenRoundedRectangle {
    if corner == .bottomTrailing {
        return UnevenRoundedRectangle(
            topLeadingRadius: 16, bottomLeadingRadius: 16,
            bottomTrailingRadius: 4, topTrailingRadius: 16,
            style: .continuous
        )
    }
    return UnevenRoundedRectangle(
        topLeadingRadius: 16, bottomLeadingRadius: 4,
        bottomTrailingRadius: 16, topTrailingRadius: 16,
        style: .continuous
    )
}

private struct UserBlockView: View {
    var text: String

    var body: some View {
        HStack {
            Spacer(minLength: 48)
            Text(text)
                .font(.callout)
                .foregroundStyle(.white)
                .textSelection(.enabled)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(bubbleShape(tailAt: .bottomTrailing).fill(PanelPalette.accent))
        }
    }
}

private struct AssistantTextBlockView: View {
    var text: String
    var streaming: Bool

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(paragraphs.enumerated()), id: \.offset) { _, paragraph in
                    Text(inlineMarkdown(paragraph))
                        .font(.system(size: 12.5))
                        .lineSpacing(3)
                        .foregroundStyle(.white)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if streaming {
                    StreamingIndicator()
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(bubbleShape(tailAt: .bottomLeading).fill(PanelPalette.accent))
            Spacer(minLength: 48)
        }
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
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Button {
                    withAnimation(.easeInOut(duration: 0.14)) {
                        expanded.toggle()
                    }
                } label: {
                    HStack(spacing: 6) {
                        Text(streaming ? "THINKING…" : "THINKING")
                            .font(.system(size: 9.5, weight: .semibold))
                            .kerning(0.5)
                            .opacity(0.8)
                        Image(systemName: expanded ? "chevron.down" : "chevron.right")
                            .font(.system(size: 8, weight: .bold))
                            .opacity(0.7)
                    }
                    .foregroundStyle(.white)
                }
                .buttonStyle(.plain)
                .pointingHandOnHover()

                if expanded || streaming {
                    Text(text)
                        .font(.system(size: 11.5))
                        .italic()
                        .lineSpacing(2)
                        .foregroundStyle(.white)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(bubbleShape(tailAt: .bottomLeading).fill(PanelPalette.thinkingFill))
            .opacity(0.75)
            Spacer(minLength: 48)
        }
    }
}

private struct ToolBlockView: View {
    var state: ToolBlockState
    @State private var expanded = false
    @State private var isHoveringCard = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header strip — always visible, like .cwa-tool-block__call-header.
            Button {
                withAnimation(.easeInOut(duration: 0.14)) {
                    expanded.toggle()
                }
            } label: {
                HStack(spacing: 7) {
                    Text("TOOL")
                        .font(.system(size: 9, weight: .semibold))
                        .kerning(0.5)
                        .foregroundStyle(PanelPalette.textMuted)
                    Text(state.title)
                        .font(.system(size: 11.5, design: .monospaced))
                        .fontWeight(.semibold)
                        .foregroundStyle(PanelPalette.textNormal)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    if !state.status.isTerminal && state.status != .pending {
                        ProgressView()
                            .scaleEffect(0.4)
                            .frame(width: 10, height: 10)
                    }
                    Spacer(minLength: 4)
                    Text(state.status.label)
                        .font(.system(size: 9.5, weight: .semibold))
                        .foregroundStyle(statusTint)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .overlay(
                            Capsule()
                                .strokeBorder(Color.white.opacity(0.16))
                        )
                    Image(systemName: expanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(PanelPalette.textMuted)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(PanelPalette.hover)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Show tool details")
            .pointingHandOnHover()

            if expanded {
                VStack(alignment: .leading, spacing: 0) {
                    if !state.arguments.isEmpty {
                        monoSection(label: "ARGUMENTS", text: state.arguments, isError: false)
                    }
                    if !state.output.isEmpty {
                        monoSection(label: "RESULT", text: state.output, isError: state.status == .failed)
                    }
                    if state.arguments.isEmpty && state.output.isEmpty {
                        Text("No input or output captured.")
                            .font(.caption2)
                            .foregroundStyle(PanelPalette.textMuted)
                            .padding(8)
                    }
                }
                .background(PanelPalette.backgroundPrimary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(isHoveringCard ? PanelPalette.accent : PanelPalette.border)
        )
        .onHover { isHoveringCard = $0 }
    }

    private func monoSection(label: String, text: String, isError: Bool) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(label)
                .font(.system(size: 9, weight: .semibold))
                .kerning(0.5)
                .foregroundStyle(isError ? PanelPalette.danger : PanelPalette.textMuted)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(PanelPalette.hover)
            ScrollView(.vertical) {
                Text(text)
                    .font(.system(size: 10.5, design: .monospaced))
                    .foregroundStyle(isError ? PanelPalette.danger : PanelPalette.textNormal)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
            }
            .frame(maxHeight: 110)
        }
    }

    private var statusTint: Color {
        switch state.status {
        case .completed:
            return PanelPalette.success
        case .failed:
            return PanelPalette.danger
        case .cancelled:
            return PanelPalette.textMuted
        case .running, .inputStreaming, .ready:
            return PanelPalette.warning
        case .pending:
            return PanelPalette.textMuted
        }
    }
}

private struct ErrorBlockView: View {
    var source: String
    var message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(sourceLabel)
                .font(.system(size: 9.5, weight: .bold))
                .kerning(0.5)
                .foregroundStyle(PanelPalette.danger)
            Text(message)
                .font(.caption)
                .foregroundStyle(PanelPalette.textNormal)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(PanelPalette.danger.opacity(0.14))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(PanelPalette.danger.opacity(0.55))
        )
    }

    private var sourceLabel: String {
        switch source {
        case "run":
            return "RUN FAILED"
        case "connection":
            return "CONNECTION ERROR"
        case "protocol":
            return "PROTOCOL ERROR"
        default:
            return "ERROR"
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
            .fill(Color.white.opacity(0.9))
            .frame(width: 6, height: 6)
            .opacity(pulsing ? 0.25 : 1)
            .animation(.easeInOut(duration: 0.6).repeatForever(autoreverses: true), value: pulsing)
            .onAppear {
                pulsing = true
            }
    }
}

/// Web `.cwa-status-line__dot` with the `cwa-pulse` keyframes.
private struct StatusLineDot: View {
    var tint: Color
    var pulsing: Bool
    @State private var animating = false

    var body: some View {
        Circle()
            .fill(tint)
            .frame(width: 8, height: 8)
            .opacity(pulsing ? (animating ? 1 : 0.35) : 0.85)
            .scaleEffect(pulsing ? (animating ? 1.15 : 0.9) : 1)
            .animation(
                pulsing ? .easeInOut(duration: 0.6).repeatForever(autoreverses: true) : .default,
                value: animating
            )
            .onAppear {
                animating = true
            }
    }
}
