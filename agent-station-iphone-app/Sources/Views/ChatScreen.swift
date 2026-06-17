import RookKit
import SwiftUI

struct ChatScreen: View {
    @ObservedObject var model: RookModel
    @State private var draft = ""
    @FocusState private var composerFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            header
            PlaceCaption(model: model)
            Divider().overlay(PanelPalette.border)
            thread
            statusRow
            queuedBar
            composer
        }
    }

    @ViewBuilder
    private var queuedBar: some View {
        if !model.queuedMessages.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(Array(model.queuedMessages.enumerated()), id: \.offset) { index, message in
                        HStack(spacing: 5) {
                            Image(systemName: "clock")
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(PanelPalette.textMuted)
                            Text(message)
                                .font(.caption)
                                .foregroundStyle(PanelPalette.textNormal)
                                .lineLimit(1)
                            Button {
                                model.removeQueuedMessage(at: index)
                            } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .font(.system(size: 12))
                                    .foregroundStyle(PanelPalette.textMuted)
                            }
                            .buttonStyle(.plain)
                        }
                        .padding(.leading, 9)
                        .padding(.trailing, 6)
                        .padding(.vertical, 5)
                        .background(
                            Capsule().fill(PanelPalette.backgroundPrimary.opacity(0.8))
                        )
                        .overlay(Capsule().strokeBorder(PanelPalette.border))
                    }
                }
                .padding(.horizontal, 12)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.bottom, 2)
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            Button {
                model.leaveChat()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(PanelPalette.textNormal)
                    .frame(width: 30, height: 30)
                    .background(Circle().fill(Color.white.opacity(0.08)))
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(model.currentSession?.agent ?? "Rook")
                    .font(.headline)
                    .foregroundStyle(PanelPalette.textNormal)
                if let name = model.currentSession?.name, name != "default" {
                    Text(name)
                        .font(.caption)
                        .foregroundStyle(PanelPalette.textMuted)
                }
            }
            Spacer(minLength: 0)
            if let usage = model.contextUsage, usage.size > 0 {
                Text("ctx \(compact(usage.used))/\(compact(usage.size))")
                    .font(.caption.monospaced())
                    .foregroundStyle(PanelPalette.textMuted)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    private var thread: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    if model.blocks.isEmpty {
                        VStack(spacing: 8) {
                            Image(systemName: "bird")
                                .font(.system(size: 28, weight: .semibold))
                                .foregroundStyle(PanelPalette.textMuted)
                            Text("Say something to your agent")
                                .font(.callout)
                                .foregroundStyle(PanelPalette.textMuted)
                        }
                        .frame(maxWidth: .infinity, minHeight: 240)
                    } else {
                        ForEach(model.blocks) { block in
                            ChatBlockView(block: block)
                        }
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            }
            .onChange(of: model.scrollTick) { _, _ in
                withAnimation(.easeOut(duration: 0.18)) {
                    proxy.scrollTo("bottom", anchor: .bottom)
                }
            }
        }
    }

    @ViewBuilder
    private var statusRow: some View {
        HStack(spacing: 8) {
            StatusLineDot(tint: statusTint, pulsing: model.isRunning || model.reconnecting)
            Text(statusText)
                .font(.caption)
                .foregroundStyle(statusTint)
                .lineLimit(1)
            Spacer(minLength: 0)
            if model.voiceSpeaking {
                Button {
                    model.stopSpeaking()
                } label: {
                    Label("Mute", systemImage: "speaker.slash.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(PanelPalette.accent))
                }
                .buttonStyle(.plain)
            }
            if model.isRunning {
                Button {
                    model.stopAgent()
                } label: {
                    Label("Stop", systemImage: "stop.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(PanelPalette.danger))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 4)
    }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: 8) {
            // Mic / tap-to-talk
            Button {
                model.toggleVoiceListening()
            } label: {
                Image(systemName: model.voiceListening ? "waveform" : "mic.fill")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(model.voiceListening ? .white : PanelPalette.accent)
                    .frame(width: 38, height: 38)
                    .background(Circle().fill(model.voiceListening ? PanelPalette.danger : PanelPalette.backgroundPrimary.opacity(0.8)))
                    .overlay(Circle().strokeBorder(model.voiceListening ? PanelPalette.danger : PanelPalette.border))
                    .symbolEffect(.variableColor, isActive: model.voiceListening)
            }

            TextField(composerPlaceholder, text: $draft, axis: .vertical)
                .lineLimit(1...5)
                .focused($composerFocused)
                .foregroundStyle(PanelPalette.textNormal)
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .background(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(PanelPalette.backgroundPrimary.opacity(0.8))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .strokeBorder(model.voiceListening ? PanelPalette.danger.opacity(0.6) : PanelPalette.border)
                )

            Button {
                submit()
            } label: {
                Image(systemName: model.isRunning ? "tray.and.arrow.down.fill" : "arrow.up")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 38, height: 38)
                    .background(Circle().fill(PanelPalette.accent))
            }
            .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .opacity(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.5 : 1)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private var composerPlaceholder: String {
        if model.voiceListening {
            return model.voicePartial.isEmpty ? "Listening…" : model.voicePartial
        }
        return "Message \(model.currentSession?.agent ?? "agent")…"
    }

    private var statusTint: Color {
        if model.reconnecting || !model.socketConnected {
            return PanelPalette.danger
        }
        return model.isRunning ? PanelPalette.warning : PanelPalette.success
    }

    private var statusText: String {
        if model.reconnecting { return "Reconnecting…" }
        if !model.socketConnected { return "Disconnected" }
        if model.isRunning { return model.statusLine.isEmpty ? "Working…" : model.statusLine }
        return "Ready"
    }

    private func submit() {
        let text = draft
        draft = ""
        model.sendTyped(text)
    }

    private func compact(_ value: Int) -> String {
        if value >= 1_000_000 { return String(format: "%.1fM", Double(value) / 1_000_000) }
        if value >= 1_000 { return String(format: "%.1fk", Double(value) / 1_000) }
        return "\(value)"
    }
}
