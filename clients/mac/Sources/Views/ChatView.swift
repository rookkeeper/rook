import AppKit
import Foundation
import RookKit
import SwiftUI

struct ChatDetail: View {
    @ObservedObject var model: AgentStationModel
    @State private var draft = ""
    @State private var isHoveringSend = false
    @State private var settingsExpanded = false

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
                    .background(ScrollPositionObserver { atBottom in
                        if atBottom {
                            model.resumeAutoScroll()
                        } else {
                            model.pauseAutoScroll()
                        }
                    })
                    .scrollIndicators(.visible)
                    .frame(minHeight: 260, maxHeight: .infinity)
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

private struct ScrollPositionObserver: NSViewRepresentable {
    var onChange: (Bool) -> Void

    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        DispatchQueue.main.async {
            context.coordinator.attach(to: view, onChange: onChange)
        }
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        DispatchQueue.main.async {
            context.coordinator.attach(to: nsView, onChange: onChange)
            context.coordinator.report()
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    final class Coordinator: NSObject {
        private weak var scrollView: NSScrollView?
        private var observer: NSObjectProtocol?
        private var onChange: ((Bool) -> Void)?

        func attach(to view: NSView, onChange: @escaping (Bool) -> Void) {
            self.onChange = onChange
            if let scrollView = view.enclosingScrollView ?? findScrollView(from: view), self.scrollView !== scrollView {
                detach()
                self.scrollView = scrollView
                observer = NotificationCenter.default.addObserver(
                    forName: NSView.boundsDidChangeNotification,
                    object: scrollView.contentView,
                    queue: .main
                ) { [weak self] _ in
                    self?.report()
                }
                scrollView.contentView.postsBoundsChangedNotifications = true
            }
            report()
        }

        private func findScrollView(from view: NSView) -> NSScrollView? {
            var current: NSView? = view
            while let candidate = current {
                if let scrollView = candidate.enclosingScrollView {
                    return scrollView
                }
                current = candidate.superview
            }
            return nil
        }

        func report() {
            guard let scrollView, let documentView = scrollView.documentView else { return }
            let visibleRect = documentView.visibleRect
            let atBottom = visibleRect.maxY >= documentView.bounds.maxY - 12
            onChange?(atBottom)
        }

        private func detach() {
            if let observer {
                NotificationCenter.default.removeObserver(observer)
            }
            observer = nil
            scrollView = nil
        }

        deinit {
            detach()
        }
    }
}
