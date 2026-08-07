import AppKit
import Foundation
import RookKit
import SwiftUI
import UniformTypeIdentifiers

struct ChatDetail: View {
    @ObservedObject var model: RookMacModel
    var elasticThreadCard = true
    var measurementMode = false
    @State private var draft = ""
    @State private var composeHeight: CGFloat = 38
    @State private var isHoveringSend = false
    @State private var settingsExpanded = false
    @State private var threadIsAtBottom = true
    @State private var composerContent: [ChatPromptContent] = []
    @State private var composeError = ""

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

            environmentsBar

            threadCard

            if !model.queuedMessages.isEmpty {
                queuedCard
            }

            if settingsExpanded, hasSettings {
                settingsCard
            }

            if !composeError.isEmpty {
                Text(composeError)
                    .font(.caption)
                    .foregroundStyle(PanelPalette.danger)
                    .padding(.horizontal, 6)
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

    private var environmentsBar: some View {
        let enteredCount = model.enteredEnvironmentIds.count
        let availableCount = model.environmentListItems.filter { $0.status == "active" }.count
        return Button {
            model.openEnvironments()
        } label: {
            HStack(spacing: 7) {
                Image(systemName: "globe")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(enteredCount > 0 ? PanelPalette.accent : PanelPalette.textMuted)
                Text("Environments")
                    .font(.caption)
                    .foregroundStyle(PanelPalette.textNormal)
                if enteredCount > 0 {
                    Text("\(enteredCount) joined")
                        .font(.caption2)
                        .foregroundStyle(PanelPalette.success)
                }
                Spacer(minLength: 4)
                Text("\(availableCount) available")
                    .font(.caption2)
                    .foregroundStyle(PanelPalette.textMuted)
                Image(systemName: "chevron.right")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(PanelPalette.backgroundSecondary.opacity(0.5))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .strokeBorder(PanelPalette.border)
            )
            .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
        .help("View and join environments")
        .pointingHandOnHover()
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
                    Image("RookMark")
                        .renderingMode(.original)
                        .resizable()
                        .scaledToFit()
                        .frame(width: 20, height: 20)
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
                            // Use VStack instead of LazyVStack; during streaming the
                            // LazyStack's visible-range calculation can miscompute when
                            // content mutations and scrollTo calls interleave, causing the
                            // entire thread to render blank until a manual scroll forces
                            // relayout (issue #55).
                            VStack(alignment: .leading, spacing: 10) {
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
                            if !message.images.isEmpty {
                                Label("\(message.images.count)", systemImage: "photo")
                                    .font(.caption2)
                                    .foregroundStyle(PanelPalette.secondaryText)
                            }
                            queueButton("Edit", systemImage: "pencil", tint: PanelPalette.secondaryText) {
                                model.beginEditingQueuedMessage(message.id)
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
            ChatComposeTextView(
                content: $composerContent,
                placeholder: composePlaceholder,
                measuredHeight: $composeHeight,
                onSubmit: submit,
                onContentChange: { content in
                    guard content.images.isEmpty || model.supportsImagePrompts else {
                        composeError = "The selected runtime does not support image prompts."
                        return
                    }
                    composerContent = content
                    composeError = ""
                },
                onError: { composeError = $0 }
            )
            .frame(minHeight: 38, maxHeight: 96)
            .frame(height: min(max(composeHeight, 38), 96))
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(PanelPalette.backgroundPrimary.opacity(0.75))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .strokeBorder(PanelPalette.border)
            )

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
            .disabled(composerContent.isEmptyPrompt)
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
        let content = composerContent
        guard !content.isEmptyPrompt else { return }
        composerContent = []
        composeError = ""
        model.resumeAutoScroll()
        model.send(content)
    }
}

private struct ChatComposeTextView: NSViewRepresentable {
    @Binding var content: [ChatPromptContent]
    var placeholder: String
    @Binding var measuredHeight: CGFloat
    var onSubmit: () -> Void
    var onContentChange: ([ChatPromptContent]) -> Void
    var onError: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(content: $content, placeholder: placeholder, measuredHeight: $measuredHeight, onSubmit: onSubmit, onContentChange: onContentChange, onError: onError)
    }

    func makeNSView(context: Context) -> NSScrollView {
        let textView = SubmitTextView()
        let scrollView = NSScrollView()
        scrollView.borderType = .noBorder
        scrollView.drawsBackground = false
        scrollView.hasVerticalScroller = false
        scrollView.hasHorizontalScroller = false
        scrollView.autohidesScrollers = true
        scrollView.documentView = textView

        textView.minSize = NSSize(width: 0, height: 0)
        textView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.autoresizingMask = [.width]
        textView.textContainer?.widthTracksTextView = true
        textView.textContainer?.containerSize = NSSize(width: 0, height: CGFloat.greatestFiniteMagnitude)
        textView.delegate = context.coordinator
        textView.onPasteImage = { [weak coordinator = context.coordinator, weak textView] in
            guard let textView else { return false }
            return coordinator?.handlePasteboard(NSPasteboard.general, in: textView) ?? false
        }
        textView.onDrop = { [weak coordinator = context.coordinator, weak textView] pasteboard in
            guard let textView else { return false }
            return coordinator?.handlePasteboard(pasteboard, in: textView) ?? false
        }
        textView.registerForDraggedTypes([
            .fileURL,
            .png,
            .tiff,
            NSPasteboard.PasteboardType(UTType.jpeg.identifier),
            NSPasteboard.PasteboardType(UTType.gif.identifier),
            NSPasteboard.PasteboardType(UTType.webP.identifier),
        ])
        textView.drawsBackground = false
        textView.isRichText = false
        textView.importsGraphics = false
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.font = .systemFont(ofSize: NSFont.systemFontSize)
        textView.textContainerInset = NSSize(width: 6, height: 8)
        textView.textContainer?.lineFragmentPadding = 0
        textView.textContainer?.widthTracksTextView = true
        textView.isHorizontallyResizable = false
        textView.isVerticallyResizable = true
        context.coordinator.apply(content: content, to: textView)
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        guard let textView = scrollView.documentView as? SubmitTextView else {
            return
        }
        context.coordinator.apply(content: content, to: textView)
        context.coordinator.placeholder = placeholder
        textView.needsDisplay = true
        context.coordinator.updateHeight(for: textView)
    }

    final class Coordinator: NSObject, NSTextViewDelegate {
        @Binding var content: [ChatPromptContent]
        @Binding var measuredHeight: CGFloat
        var placeholder: String
        var onSubmit: () -> Void
        var onContentChange: ([ChatPromptContent]) -> Void
        var onError: (String) -> Void
        private var renderedContent: [ChatPromptContent] = []
        private var applyingContent = false

        init(content: Binding<[ChatPromptContent]>, placeholder: String, measuredHeight: Binding<CGFloat>, onSubmit: @escaping () -> Void, onContentChange: @escaping ([ChatPromptContent]) -> Void, onError: @escaping (String) -> Void) {
            _content = content
            _measuredHeight = measuredHeight
            self.placeholder = placeholder
            self.onSubmit = onSubmit
            self.onContentChange = onContentChange
            self.onError = onError
        }

        func apply(content: [ChatPromptContent], to textView: NSTextView) {
            guard renderedContent != content else { return }
            applyingContent = true
            let selection = textView.selectedRange()
            textView.textStorage?.setAttributedString(makeAttributedString(content))
            let location = min(selection.location, textView.string.utf16.count)
            textView.setSelectedRange(NSRange(location: location, length: 0))
            applyingContent = false
            renderedContent = content
        }

        func handlePasteboard(_ pasteboard: NSPasteboard, in textView: NSTextView) -> Bool {
            do {
                guard let attachment = try MacImageAttachmentFactory.make(from: pasteboard) else { return false }
                guard !extractContent(from: textView).images.contains(where: { $0.base64Data == attachment.base64Data }) else { return true }
                let replacement = makeAttributedString([.image(attachment)])
                let selection = textView.selectedRange()
                textView.textStorage?.replaceCharacters(in: selection, with: replacement)
                textView.setSelectedRange(NSRange(location: selection.location + 1, length: 0))
                notifyContentChanged(for: textView)
                return true
            } catch {
                onError(error.localizedDescription)
                return true
            }
        }

        func textDidChange(_ notification: Notification) {
            guard !applyingContent, let textView = notification.object as? NSTextView else {
                return
            }
            notifyContentChanged(for: textView)
        }

        func textView(_ textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
            if commandSelector == #selector(NSResponder.insertNewline(_:)) {
                if NSApp.currentEvent?.modifierFlags.contains(.shift) == true {
                    textView.insertNewlineIgnoringFieldEditor(nil)
                    return true
                }
                onSubmit()
                return true
            }
            if commandSelector == #selector(NSResponder.insertLineBreak(_:)) {
                textView.insertNewlineIgnoringFieldEditor(nil)
                return true
            }
            return false
        }

        private func notifyContentChanged(for textView: NSTextView) {
            let next = extractContent(from: textView)
            renderedContent = next
            onContentChange(next)
            updateHeight(for: textView)
        }

        private func makeAttributedString(_ content: [ChatPromptContent]) -> NSAttributedString {
            let result = NSMutableAttributedString()
            let attributes: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: NSFont.systemFontSize)]
            for item in content {
                switch item {
                case .text(let text):
                    result.append(NSAttributedString(string: text, attributes: attributes))
                case .image(let image):
                    guard let data = image.data, let nsImage = NSImage(data: data) else { continue }
                    let attachment = NSTextAttachment()
                    attachment.image = nsImage
                    attachment.bounds = NSRect(x: 0, y: -4, width: 28, height: 28)
                    let start = result.length
                    result.append(NSAttributedString(attachment: attachment))
                    result.addAttribute(NSAttributedString.Key("RookChatImageAttachment"), value: image, range: NSRange(location: start, length: 1))
                }
            }
            return result
        }

        private func extractContent(from textView: NSTextView) -> [ChatPromptContent] {
            guard let storage = textView.textStorage else { return [] }
            let imageKey = NSAttributedString.Key("RookChatImageAttachment")
            var result: [ChatPromptContent] = []
            var location = 0
            while location < storage.length {
                var range = NSRange(location: location, length: 0)
                if let image = storage.attribute(imageKey, at: location, effectiveRange: &range) as? ChatImageAttachment {
                    result.append(.image(image))
                } else {
                    let text = storage.attributedSubstring(from: range).string
                    if !text.isEmpty && text != "\u{FFFC}" {
                        if case .text(let previous)? = result.last {
                            result[result.count - 1] = .text(previous + text)
                        } else {
                            result.append(.text(text))
                        }
                    }
                }
                location = NSMaxRange(range)
            }
            return result
        }

        func updateHeight(for textView: NSTextView) {
            guard let layoutManager = textView.layoutManager, let textContainer = textView.textContainer else {
                return
            }
            layoutManager.ensureLayout(for: textContainer)
            let used = layoutManager.usedRect(for: textContainer).height
            let height = ceil(used + textView.textContainerInset.height * 2)
            DispatchQueue.main.async {
                self.measuredHeight = max(38, height)
            }
        }
    }
}

private final class SubmitTextView: NSTextView {
    var onPasteImage: (() -> Bool)?
    var onDrop: ((NSPasteboard) -> Bool)?

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if event.keyCode == 9, event.modifierFlags.contains(.command), onPasteImage?() == true {
            return true
        }
        return super.performKeyEquivalent(with: event)
    }

    override func keyDown(with event: NSEvent) {
        if event.keyCode == 9, event.modifierFlags.contains(.command), onPasteImage?() == true {
            return
        }
        super.keyDown(with: event)
    }

    override func paste(_ sender: Any?) {
        if onPasteImage?() == true { return }
        super.paste(sender)
    }

    override func pasteAsPlainText(_ sender: Any?) {
        if onPasteImage?() == true { return }
        super.pasteAsPlainText(sender)
    }

    override func pasteAsRichText(_ sender: Any?) {
        if onPasteImage?() == true { return }
        super.pasteAsRichText(sender)
    }

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        let types = sender.draggingPasteboard.types ?? []
        let rawImageTypes: Set<NSPasteboard.PasteboardType> = [
            .png,
            .tiff,
            NSPasteboard.PasteboardType(UTType.jpeg.identifier),
            NSPasteboard.PasteboardType(UTType.gif.identifier),
            NSPasteboard.PasteboardType(UTType.webP.identifier),
        ]
        guard sender.draggingPasteboard.canReadObject(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) || !rawImageTypes.isDisjoint(with: Set(types)) else {
            return []
        }
        return .copy
    }

    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation {
        let point = convert(sender.draggingLocation, from: nil)
        let index = characterIndex(for: point)
        setSelectedRange(NSRange(location: index, length: 0))
        return .copy
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        onDrop?(sender.draggingPasteboard) ?? false
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)

        guard string.isEmpty, let placeholder = (delegate as? ChatComposeTextView.Coordinator)?.placeholder, !placeholder.isEmpty else {
            return
        }

        let attributes: [NSAttributedString.Key: Any] = [
            .font: font ?? NSFont.systemFont(ofSize: NSFont.systemFontSize),
            .foregroundColor: NSColor.placeholderTextColor,
        ]
        let origin = NSPoint(x: textContainerInset.width, y: textContainerInset.height)
        placeholder.draw(at: origin, withAttributes: attributes)
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
