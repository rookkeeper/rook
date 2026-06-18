import AppKit
import Foundation
import RookKit
import SwiftUI

struct ChatDetail: View {
    @ObservedObject var model: AgentStationModel
    var elasticThreadCard = true
    var measurementMode = false
    @State private var draft = ""
    @State private var isHoveringSend = false
    @State private var settingsExpanded = false
    @State private var threadIsAtBottom = true

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            DetailHeader(
                title: chatTitle,
                systemImage: "bubble.left.and.bubble.right",
                trailing: headerTrailing
            ) {
                model.goHome()
            }

            if let pendingPermission = model.pendingPermission {
                permissionCard(pendingPermission)
            }

            threadCard

            if !model.queuedMessages.isEmpty {
                queuedCard
            }

            if settingsExpanded, hasSettings {
                settingsCard
            }

            statusRow
            composeRow
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
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
            if measurementMode {
                Color.clear
                    .frame(maxWidth: .infinity, minHeight: 260)
            } else if model.blocks.isEmpty {
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
                    GeometryReader { scrollGeo in
                        ScrollView(.vertical) {
                            LazyVStack(alignment: .leading, spacing: 10) {
                                ForEach(model.blocks) { block in
                                    ChatBlockView(block: block)
                                }
                                GeometryReader { markerGeo in
                                    Color.clear
                                        .preference(
                                            key: ThreadBottomMarkerMaxYKey.self,
                                            value: markerGeo.frame(in: .named("thread-scroll")).maxY
                                        )
                                }
                                .frame(height: 1)
                                .id("chat-bottom")
                            }
                            .padding(.trailing, 2)
                        }
                        .coordinateSpace(name: "thread-scroll")
                        .background(WindowScrollMonitor {
                            DispatchQueue.main.async {
                                if threadIsAtBottom {
                                    model.resumeAutoScroll()
                                } else {
                                    model.pauseAutoScroll()
                                }
                            }
                        })
                        .onPreferenceChange(ThreadBottomMarkerMaxYKey.self) { markerMaxY in
                            threadIsAtBottom = markerMaxY <= scrollGeo.size.height + 12
                        }
                        .scrollIndicators(.visible)
                        .frame(minHeight: 260, idealHeight: 340, maxHeight: elasticThreadCard ? .infinity : 340)
                        .onAppear {
                            proxy.scrollTo("chat-bottom", anchor: .bottom)
                        }
                        .onChange(of: model.scrollTick) { _, _ in
                            guard model.autoScrollEnabled else { return }
                            proxy.scrollTo("chat-bottom", anchor: .bottom)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var queuedCard: some View {
        PanelCard {
            Label("\(model.queuedMessages.count) queued", systemImage: "tray.full")
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(PanelPalette.secondaryText)

            ForEach(Array(model.queuedMessages.enumerated()), id: \.element.id) { index, message in
                if message.isEditing {
                    VStack(alignment: .leading, spacing: 8) {
                        TextField("Edit queued message", text: Binding(
                            get: { message.draftText },
                            set: { model.updateQueuedMessageDraft(message.id, text: $0) }
                        ), axis: .vertical)
                        .textFieldStyle(.plain)
                        .font(.caption)
                        .lineLimit(2...4)
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

                        HStack(spacing: 6) {
                            queueButton("Save", systemImage: "checkmark", tint: PanelPalette.success) {
                                model.saveQueuedMessageEdit(message.id)
                            }
                            queueButton("Cancel", systemImage: "xmark", tint: PanelPalette.secondaryText) {
                                model.cancelEditingQueuedMessage(message.id)
                            }
                        }
                    }
                } else {
                    HStack(alignment: .top, spacing: 8) {
                        Text(message.text)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                            .truncationMode(.tail)
                        Spacer(minLength: 4)
                        HStack(spacing: 6) {
                            queueButton("Edit", systemImage: "pencil", tint: PanelPalette.secondaryText) {
                                model.beginEditingQueuedMessage(message.id)
                            }
                            queueButton("Send now", systemImage: "paperplane.fill", tint: PanelPalette.accent) {
                                model.sendQueuedMessageNow(message.id)
                            }
                            queueButton("Delete", systemImage: "trash", tint: PanelPalette.danger) {
                                model.removeQueuedMessage(at: index)
                            }
                        }
                    }
                }
            }
        }
    }

    private var statusRow: some View {
        HStack(spacing: 8) {
            StatusLineDot(tint: statusTint, pulsing: model.isRunning || model.reconnecting)
            Text(statusText)
                .font(.caption)
                .foregroundStyle(statusTint)
                .lineLimit(1)
            Spacer(minLength: 0)
            HStack(spacing: 8) {
                if let usage = model.contextUsage, usage.size > 0 {
                    Text(usageSummary(usage))
                        .font(.caption)
                        .foregroundStyle(PanelPalette.secondaryText)
                        .lineLimit(1)
                }
                if hasSettings {
                    Button {
                        withAnimation(.easeInOut(duration: 0.14)) {
                            settingsExpanded.toggle()
                        }
                    } label: {
                        Image(systemName: settingsExpanded ? "gearshape.fill" : "gearshape")
                            .foregroundStyle(PanelPalette.secondaryText)
                    }
                    .buttonStyle(.plain)
                    .help("ACP settings")
                    .pointingHandOnHover()
                }
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
        if model.lastStopReason == "cancelled" {
            return "Stopped"
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

    private var settingsCard: some View {
        PanelCard {
            if let modes = model.currentModes, !modes.availableModes.isEmpty {
                Picker("Mode", selection: Binding(
                    get: { modes.currentModeId },
                    set: { model.setMode($0) }
                )) {
                    ForEach(modes.availableModes) { mode in
                        Text(mode.name).tag(mode.id)
                    }
                }
                .pickerStyle(.menu)
            }

            ForEach(model.configOptions) { option in
                Picker(option.name, selection: Binding(
                    get: { option.currentValue },
                    set: { model.setConfigOption(option.id, value: $0) }
                )) {
                    ForEach(option.options) { value in
                        Text(value.name).tag(value.value)
                    }
                }
                .pickerStyle(.menu)
            }
        }
    }

    private func permissionCard(_ pendingPermission: PendingPermissionRequest) -> some View {
        PanelCard {
            Text("Permission requested")
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(PanelPalette.secondaryText)
            Text(pendingPermission.toolCall.title)
                .font(.callout)
                .fontWeight(.semibold)
            Text(pendingPermission.toolCall.kind)
                .font(.caption)
                .foregroundStyle(.secondary)
            HStack(spacing: 6) {
                ForEach(pendingPermission.options) { option in
                    queueButton(option.name, systemImage: "checkmark.shield", tint: PanelPalette.accent) {
                        model.decidePermission(optionId: option.optionId)
                    }
                }
                queueButton("Cancel", systemImage: "xmark", tint: PanelPalette.secondaryText) {
                    model.decidePermission(optionId: nil)
                }
            }
        }
    }

    private var hasSettings: Bool {
        model.currentModes != nil || !model.configOptions.isEmpty
    }

    private func usageSummary(_ usage: ContextUsageState) -> String {
        let base = "ctx \(compactCount(usage.used))"
        if let cost = usage.cost {
            return base + " · " + String(format: "$%.3f", cost.amount)
        }
        return base
    }

    private func queueButton(_ title: String, systemImage: String, tint: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .font(.caption2)
                .fontWeight(.semibold)
                .foregroundStyle(tint == PanelPalette.secondaryText ? PanelPalette.textNormal : .white)
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(
                    Capsule().fill(tint == PanelPalette.secondaryText ? PanelPalette.backgroundPrimary.opacity(0.7) : tint)
                )
        }
        .buttonStyle(.plain)
        .pointingHandOnHover()
    }

    private func submit() {
        let text = draft
        draft = ""
        model.resumeAutoScroll()
        model.send(text)
    }
}

private struct ThreadBottomMarkerMaxYKey: PreferenceKey {
    static var defaultValue: CGFloat = .greatestFiniteMagnitude

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

private struct WindowScrollMonitor: NSViewRepresentable {
    var onUserScroll: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onUserScroll: onUserScroll)
    }

    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        DispatchQueue.main.async {
            context.coordinator.attach(to: view)
        }
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        context.coordinator.onUserScroll = onUserScroll
        DispatchQueue.main.async {
            context.coordinator.attach(to: nsView)
        }
    }

    final class Coordinator {
        var onUserScroll: () -> Void
        private weak var window: NSWindow?
        private var monitor: Any?

        init(onUserScroll: @escaping () -> Void) {
            self.onUserScroll = onUserScroll
        }

        func attach(to view: NSView) {
            guard let window = view.window else {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self, weak view] in
                    guard let self, let view else { return }
                    self.attach(to: view)
                }
                return
            }
            guard self.window !== window else { return }
            detach()
            self.window = window
            monitor = NSEvent.addLocalMonitorForEvents(matching: .scrollWheel) { [weak self, weak window] event in
                guard let self, let window, event.window === window else {
                    return event
                }
                self.onUserScroll()
                return event
            }
        }

        private func detach() {
            if let monitor {
                NSEvent.removeMonitor(monitor)
            }
            monitor = nil
            window = nil
        }

        deinit {
            detach()
        }
    }
}
