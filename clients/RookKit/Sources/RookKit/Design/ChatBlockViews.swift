import MarkdownUI
import SwiftUI

/// Renders one `ChatBlock` from the shared chat model. Reused by the macOS
/// menu-bar app and the iOS app; the screen-level chat view (composer, scroll,
/// model wiring) stays per-app.
public struct ChatBlockView: View {
    public var block: ChatBlock

    public init(block: ChatBlock) {
        self.block = block
    }

    public var body: some View {
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

/// Web `.cwa-status-line__dot` with the `cwa-pulse` keyframes. Public so the
/// per-app chat status line can reuse it.
public struct StatusLineDot: View {
    public var tint: Color
    public var pulsing: Bool
    @State private var animating = false

    public init(tint: Color, pulsing: Bool) {
        self.tint = tint
        self.pulsing = pulsing
    }

    public var body: some View {
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
            VStack(alignment: .leading, spacing: 6) {
                Markdown(text)
                    .markdownTheme(.gitHub)
                    .foregroundStyle(.white)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
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
