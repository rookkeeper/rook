import Foundation
import RookKit
import SwiftUI

struct RookView: View {
    @ObservedObject var model: RookMacModel
    @State private var measuredContentHeight: CGFloat = 420
    @State private var hostingWindow: NSWindow?
    @State private var hasAppliedInitialSizing = false

    private let homePanelWidth: CGFloat = 372
    private let detailPanelWidth: CGFloat = 460
    private let mainWindowAutosaveName = "RookMainWindow"

    var body: some View {
        displayedContent
            .padding(12)
            .frame(
                minWidth: panelWidth,
                idealWidth: panelWidth,
                maxWidth: .infinity,
                minHeight: panelHeight,
                idealHeight: panelHeight,
                maxHeight: .infinity,
                alignment: .topLeading
            )
            .background(PanelBackground())
        .background(WindowAccessor { window in
            if hostingWindow !== window {
                hostingWindow = window
                hasAppliedInitialSizing = false
                applyWindowSizing(window)
            }
        })
        .environment(\.colorScheme, .dark)
        .onAppear {
            model.refreshNow()
            model.updateSessionListPolling()
            applyWindowSizing(hostingWindow)
        }
        .onPreferenceChange(PanelContentHeightKey.self) { height in
            let rounded = ceil(height)
            guard abs(rounded - measuredContentHeight) > 1 else { return }
            measuredContentHeight = rounded
            applyWindowSizing(hostingWindow)
        }
        .onChange(of: model.panelMode) { _, _ in
            model.updateSessionListPolling()
            applyWindowSizing(hostingWindow)
        }
    }

    @ViewBuilder
    private var displayedContent: some View {
        if Self.usesIntrinsicHeight(for: model.panelMode) {
            baseContent
                .fixedSize(horizontal: false, vertical: true)
                .background(intrinsicHeightMeasurement)
        } else {
            baseContent
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    private var intrinsicHeightMeasurement: some View {
        GeometryReader { proxy in
            Color.clear
                .preference(key: PanelContentHeightKey.self, value: proxy.size.height + 24)
        }
    }

    static func usesIntrinsicHeight(for panelMode: PanelMode) -> Bool {
        switch panelMode {
        case .home, .chat, .environments:
            return false
        case .sessions, .environmentOffer:
            return true
        }
    }

    private var baseContent: some View {
        ZStack(alignment: .topLeading) {
            switch model.panelMode {
            case .home:
                HomeContent(model: model)
            case .sessions(let agentId):
                SessionsDetail(model: model, agentId: agentId)
            case .chat:
                ChatDetail(model: model, elasticThreadCard: true, measurementMode: false)
            case .environmentOffer:
                EnvironmentOfferDetail(model: model)
            case .environments:
                EnvironmentsDetail(model: model)
            }
        }
    }

    // Panel size is applied WITHOUT animation. Animating the hosting view's
    // content size (here, the 372↔460 width on mode switches) makes AppKit
    // resize the window mid–constraint-pass and trap inside
    // NSHostingView.updateWindowContentSizeExtremaIfNecessary — crashing the
    // app, including on launch when hosted in the companion NSPanel.
    private var panelWidth: CGFloat {
        model.panelMode == .home ? homePanelWidth : detailPanelWidth
    }

    private var panelHeight: CGFloat {
        Self.usesIntrinsicHeight(for: model.panelMode) ? max(420, measuredContentHeight) : 420
    }

    private func applyWindowSizing(_ window: NSWindow?) {
        guard let window else { return }

        let targetContentSize = NSSize(width: panelWidth, height: panelHeight)
        window.contentMinSize = targetContentSize
        window.contentMaxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)

        let currentContentRect = window.contentRect(forFrameRect: window.frame)
        let hasSavedFrame = UserDefaults.standard.string(forKey: "NSWindow Frame \(mainWindowAutosaveName)") != nil
        let desiredContentSize: NSSize
        if hasAppliedInitialSizing || hasSavedFrame {
            desiredContentSize = NSSize(
                width: max(currentContentRect.width, targetContentSize.width),
                height: max(currentContentRect.height, targetContentSize.height)
            )
        } else {
            desiredContentSize = targetContentSize
        }
        hasAppliedInitialSizing = true

        guard abs(desiredContentSize.width - currentContentRect.width) > 1 || abs(desiredContentSize.height - currentContentRect.height) > 1 else {
            return
        }

        let desiredFrame = window.frameRect(forContentRect: NSRect(origin: .zero, size: desiredContentSize))
        var nextFrame = window.frame
        nextFrame.origin.y += nextFrame.height - desiredFrame.height
        nextFrame.size = desiredFrame.size
        window.setFrame(nextFrame, display: true)
    }
}

private struct PanelContentHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 420

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

private struct WindowAccessor: NSViewRepresentable {
    var onResolve: (NSWindow?) -> Void

    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        DispatchQueue.main.async {
            onResolve(view.window)
        }
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        DispatchQueue.main.async {
            onResolve(nsView.window)
        }
    }
}

struct DetailHeader: View {
    var title: String
    var systemImage: String
    var trailing: String
    var onBack: () -> Void

    var body: some View {
        PanelCard {
            HStack(spacing: 9) {
                Button(action: onBack) {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(.primary)
                        .frame(width: 28, height: 28)
                        .background(
                            Circle()
                                .fill(Color.white.opacity(0.10))
                        )
                }
                .buttonStyle(.plain)
                .help("Back")
                .pointingHandOnHover()

                Label(title, systemImage: systemImage)
                    .font(.headline)
                    .fontWeight(.semibold)
                    .lineLimit(1)
                    .truncationMode(.tail)

                Spacer(minLength: 0)

                if !trailing.isEmpty {
                    Text(trailing)
                        .font(.caption)
                        .foregroundStyle(PanelPalette.secondaryText)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
        }
    }
}

// MARK: - Home

private struct HomeContent: View {
    @ObservedObject var model: RookMacModel
    @State private var newSessionName = ""
    @State private var selectedRuntimeID = ""
    @State private var sessionToRename: AgentSessionSummary?
    @State private var renameDraft = ""
    @State private var sessionToDelete: AgentSessionSummary?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            identityRow
            if model.foregroundAppName != nil {
                foregroundCaption
            }
            if model.pendingOffer != nil {
                pendingOfferCard
            }
            if model.currentSession != nil {
                resumeRow
            }
            if !model.accessibilityTrusted {
                accessibilityCard
            }
            if model.serverState == .online {
                agentsCard
            } else {
                serverOfflineCard
            }
            footerActions
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .sheet(item: $sessionToRename) { session in
            RenameSessionSheet(
                sessionName: session.name,
                draft: $renameDraft,
                onCancel: { sessionToRename = nil },
                onSave: {
                    model.renameSession(session, title: renameDraft)
                    sessionToRename = nil
                }
            )
        }
        .alert("Delete Session?", isPresented: Binding(get: { sessionToDelete != nil }, set: { if !$0 { sessionToDelete = nil } }), presenting: sessionToDelete) { session in
            Button("Delete", role: .destructive) {
                model.deleteSession(session)
                sessionToDelete = nil
            }
            Button("Cancel", role: .cancel) {
                sessionToDelete = nil
            }
        } message: { session in
            Text("Delete \(session.name) permanently?")
        }
        .onAppear {
            ensureSelectedRuntimeID()
        }
        .onChange(of: model.agents.map(\.id).joined(separator: "|")) { _ in
            ensureSelectedRuntimeID()
        }
        // Catch drops anywhere else in the home view. Session-row drop targets
        // take precedence; a pinned source released in the surrounding home
        // view is unpinned and touched to the top of Recent.
        .onDrop(of: [.text], delegate: SessionDropDelegate { id, _ in
            unpinDroppedSession(id)
        })
    }

    private func unpinDroppedSession(_ id: String) {
        guard let session = model.sessions.first(where: { $0.id == id }), session.pinned else { return }
        model.setSessionPinned(session, pinned: false, moveToRecent: true)
    }

    // MARK: - Identity (slim, one line)

    private var identityRow: some View {
        HStack(spacing: 10) {
            Image("RookMark")
                .renderingMode(.original)
                .resizable()
                .scaledToFit()
                .frame(width: 15, height: 15)
            Text("Rook")
                .font(.headline)
            Spacer(minLength: 0)
            HStack(spacing: 6) {
                Text(serverStateLabel)
                    .font(.caption)
                    .foregroundStyle(PanelPalette.textMuted)
                StatusDot(tint: model.serverStatusTint)
            }
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 2)
    }

    private var serverStateLabel: String {
        switch model.serverState {
        case .online: return model.isRunning ? "working" : "online"
        case .starting: return "starting…"
        case .offline: return "offline"
        case .unknown: return "checking…"
        }
    }

    private var foregroundCaption: some View {
        let hasEnvironment = model.foregroundEnvironmentId != nil
        return HStack(spacing: 6) {
            Image(systemName: "macwindow")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(hasEnvironment ? PanelPalette.accentHover : PanelPalette.textMuted)
            Text("In \(model.foregroundAppName ?? "app")")
                .font(.caption2)
                .fontWeight(.medium)
                .foregroundStyle(PanelPalette.textNormal)
                .lineLimit(1)
                .truncationMode(.tail)
            Circle()
                .fill(hasEnvironment ? PanelPalette.success : PanelPalette.textMuted.opacity(0.6))
                .frame(width: 5, height: 5)
            Text(hasEnvironment ? "environment active" : "tracking off")
                .font(.caption2)
                .foregroundStyle(hasEnvironment ? PanelPalette.success : PanelPalette.textMuted)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 4)
    }

    // MARK: - Resume (primary affordance)

    private var resumeRow: some View {
        Button {
            model.openChat()
        } label: {
            HStack(spacing: 11) {
                Image(systemName: "play.fill")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 30, height: 30)
                    .background(Circle().fill(PanelPalette.accent))
                VStack(alignment: .leading, spacing: 1) {
                    Text("Resume chat")
                        .font(.subheadline)
                        .fontWeight(.semibold)
                        .foregroundStyle(PanelPalette.textNormal)
                    Text(currentChatLine)
                        .font(.caption)
                        .foregroundStyle(PanelPalette.textMuted)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                Spacer(minLength: 4)
                if model.isRunning {
                    StatusDot(tint: PanelPalette.warning)
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(PanelPalette.accent.opacity(0.14))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(PanelPalette.accent.opacity(0.4))
            )
            .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
        .help("Resume the current chat")
        .pointingHandOnHover()
    }

    private var accessibilityCard: some View {
        PanelCard {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    Label("Enable Accessibility", systemImage: "figure.wave")
                        .font(.subheadline)
                        .fontWeight(.semibold)
                    Spacer()
                    StatusDot(tint: PanelPalette.warning)
                }

                Text("Rook needs Accessibility access to read browser URLs and app window titles for environments.")
                    .font(.caption)
                    .foregroundStyle(PanelPalette.textMuted)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: 8) {
                    Button("Open Settings") {
                        model.requestAccessibilityAccess()
                    }
                    .buttonStyle(.borderedProminent)

                    Button("I've enabled it") {
                        model.refreshAccessibilityStatus()
                    }
                    .buttonStyle(.bordered)
                }
            }
        }
    }

    private var pendingOfferCard: some View {
        Button {
            model.reviewPendingOffer()
        } label: {
            PanelCard {
                HStack(spacing: 9) {
                    Image(systemName: "puzzlepiece.extension.fill")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(PanelPalette.warning)
                        .frame(width: 24, height: 24)
                        .background(
                            Circle()
                                .fill(PanelPalette.warning.opacity(0.18))
                        )
                    VStack(alignment: .leading, spacing: 2) {
                        Text(model.pendingOfferCount > 1 ? "Bundles available" : "Bundle available")
                            .font(.subheadline)
                            .fontWeight(.semibold)
                        HStack(spacing: 6) {
                            Text(model.pendingOffer?.bundleId ?? model.pendingOffer?.environmentId ?? "")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                            if model.pendingOfferCount > 1 {
                                Text("+\(model.pendingOfferCount - 1) more")
                                    .font(.caption2)
                                    .foregroundStyle(PanelPalette.warning)
                            }
                        }
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(.secondary)
                }
            }
            .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
        .help("Review environment offer")
        .pointingHandOnHover()
    }

    private var currentChatLine: String {
        guard let session = model.currentSession else {
            return ""
        }
        let name = session.name == "default" ? "" : " · \(session.name)"
        return "\(session.agent)\(name)"
    }

    private var agentsCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            newSessionCard
            sessionsCard
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func ensureSelectedRuntimeID() {
        guard !model.agents.isEmpty else {
            selectedRuntimeID = ""
            return
        }
        if selectedRuntimeID.isEmpty || !model.agents.contains(where: { $0.id == selectedRuntimeID }) {
            selectedRuntimeID = model.agents.first?.id ?? ""
        }
    }

    private var newSessionCard: some View {
        PanelCard {
            Text("NEW CHAT")
                .font(.system(size: 10, weight: .semibold))
                .kerning(0.6)
                .foregroundStyle(PanelPalette.textMuted)

            if model.agents.isEmpty {
                Text(model.serverState == .online ? "No configured runtimes" : "Waiting for the server…")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            } else {
                Picker("Agent Runtime", selection: $selectedRuntimeID) {
                    ForEach(model.agentTree, id: \.agent.id) { entry in
                        Text(String(repeating: "  ", count: entry.depth) + entry.agent.id).tag(entry.agent.id)
                    }
                }
            }

            HStack(spacing: 8) {
                TextField("Session name (optional)", text: $newSessionName)
                    .textFieldStyle(.plain)
                    .font(.callout)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(PanelPalette.backgroundPrimary.opacity(0.75)))
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(PanelPalette.border))
                    .onSubmit {
                        startNewSessionFromHome()
                    }

                Button {
                    startNewSessionFromHome()
                } label: {
                    Image(systemName: model.startingSession ? "hourglass" : "arrow.up")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 34, height: 34)
                        .background(Circle().fill(PanelPalette.accent))
                }
                .buttonStyle(.plain)
                .disabled(model.startingSession || selectedRuntimeID.isEmpty)
            }
        }
    }

    private func startNewSessionFromHome() {
        ensureSelectedRuntimeID()
        guard !selectedRuntimeID.isEmpty else { return }
        model.startNewSession(agentId: selectedRuntimeID, name: newSessionName)
    }

    private var sessionsCard: some View {
        PanelCard {
            HStack(spacing: 8) {
                Text("SESSIONS")
                    .font(.system(size: 10, weight: .semibold))
                    .kerning(0.6)
                    .foregroundStyle(PanelPalette.textMuted)
                Spacer()
                if model.sessionsLoading {
                    ProgressView()
                        .scaleEffect(0.5)
                }
            }

            if model.sessions.isEmpty && !model.sessionsLoading {
                Text("No sessions yet — start a new chat above.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 48, alignment: .center)
            } else {
                MacSessionSections(
                    model: model,
                    onRename: { session in
                        renameDraft = session.name
                        sessionToRename = session
                    },
                    onDelete: { session in sessionToDelete = session }
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }


    private var serverOfflineCard: some View {
        PanelCard {
            VStack(alignment: .leading, spacing: 8) {
                PanelMessageView(
                    systemImage: "bolt.slash.fill",
                    tint: PanelPalette.danger,
                    text: "Rook isn't reachable at \(model.api.baseURL.absoluteString). Start it here or run `npm run dev` in the rookery repo."
                )

                HStack(spacing: 8) {
                    CompactActionButton(
                        title: model.serverState == .starting ? "Starting…" : "Start Server",
                        systemImage: "power",
                        tint: PanelPalette.success,
                        prominence: .filled,
                        helpText: "Launch `npm run dev` for the rookery repo"
                    ) {
                        model.startServer()
                    }
                    .disabled(model.serverState == .starting)

                    CompactActionButton(
                        title: "Retry",
                        systemImage: "arrow.clockwise",
                        tint: PanelPalette.secondaryText,
                        prominence: .subtle,
                        helpText: "Check the server again"
                    ) {
                        model.refreshNow()
                    }
                }
            }
        }
    }

    private var footerActions: some View {
        HStack(spacing: 8) {
            FooterIconButton(title: "Open Server Log", systemImage: "doc.text.magnifyingglass") {
                model.openServerLog()
            }
            if model.managedServerRunning {
                FooterIconButton(title: "Stop Managed Server", systemImage: "stop.circle") {
                    model.stopServer()
                }
            }
            FooterIconButton(title: "Refresh", systemImage: "arrow.clockwise") {
                model.refreshNow()
            }
            Spacer(minLength: 0)
            FooterIconButton(title: "Quit", systemImage: "xmark.circle") {
                model.quitApp()
            }
        }
    }
}

private struct MacSessionSections: View {
    @ObservedObject var model: RookMacModel
    var onRename: (AgentSessionSummary) -> Void
    var onDelete: (AgentSessionSummary) -> Void
    @State private var draggedSessionID: String?
    @State private var dropTarget: SessionDropTarget?

    private let pinnedEndDropID = "__pinned_end__"

    private var pinned: [AgentSessionSummary] {
        model.sessions.filter(\.pinned).sorted {
            $0.pinnedOrder == $1.pinnedOrder ? $0.id < $1.id : $0.pinnedOrder < $1.pinnedOrder
        }
    }

    private var recent: [AgentSessionSummary] { model.sessions.filter { !$0.pinned } }

    var body: some View {
        GeometryReader { proxy in
            ScrollView(.vertical) {
            LazyVStack(alignment: .leading, spacing: 6) {
                if pinned.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        sectionHeader("Pinned", systemImage: "pin.fill")
                        Text("Pin a session to keep it here.")
                            .font(.caption)
                            .foregroundStyle(PanelPalette.textMuted)
                            .frame(maxWidth: .infinity, minHeight: 72)
                            .background(RoundedRectangle(cornerRadius: 8).fill(PanelPalette.backgroundPrimary.opacity(0.35)))
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                    .onDrop(of: [.text], delegate: SessionDropDelegate(onTargetChanged: { _, _ in clearDropTarget() }) { id, _ in
                        pin(id, moveToRecent: false)
                    })
                } else {
                    sectionHeader("Pinned", systemImage: "pin.fill")
                    sessionRows(pinned, allowsReordering: true)
                }
                sectionHeader("Recent", systemImage: "clock.arrow.circlepath")
                if recent.isEmpty {
                    Text("No recent sessions")
                        .font(.caption)
                        .foregroundStyle(PanelPalette.textMuted)
                        .padding(.vertical, 8)
                } else {
                    sessionRows(recent, allowsReordering: false)
                }
            }
        }
        .onDrop(of: [.text], delegate: SessionDropDelegate(onTargetChanged: { _, _ in clearDropTarget() }) { id, _ in
            unpinIfPinned(id)
        })
            .scrollIndicators(.hidden)
            .frame(height: max(100, proxy.size.height))
        }
        .frame(minHeight: 100)
    }

    private func sectionHeader(_ title: String, systemImage: String) -> some View {
        Label(title, systemImage: systemImage)
            .font(.caption.weight(.semibold))
            .foregroundStyle(PanelPalette.textMuted)
            .padding(.top, 4)
    }

    @ViewBuilder
    private func sessionRows(_ sessions: [AgentSessionSummary], allowsReordering: Bool) -> some View {
        ForEach(Array(sessions.enumerated()), id: \.element.id) { index, session in
            HStack(spacing: 8) {
                Button { model.resumeSession(session) } label: { SessionHomeRow(session: session) }
                    .buttonStyle(.plain)
                    .pointingHandOnHover()
                SessionActionsMenu(
                    onTogglePin: { model.setSessionPinned(session, pinned: !session.pinned, moveToRecent: session.pinned) },
                    onRename: { onRename(session) },
                    onDelete: { onDelete(session) }
                )
            }
            .onDrag {
                draggedSessionID = session.id
                return NSItemProvider(object: session.id as NSString)
            }
            .onDrop(of: [.text], delegate: allowsReordering
                ? SessionDropDelegate(targetID: session.id, onTargetChanged: updateDropTarget) { id, after in handlePinnedDrop(id, before: session.id, after: after) }
                : SessionDropDelegate(onTargetChanged: { _, _ in clearDropTarget() }) { id, _ in pin(id, moveToRecent: true) })
            .overlay(alignment: .top) {
                if allowsReordering && dropTarget?.sessionID == session.id && dropTarget?.after == false {
                    dropIndicator
                }
            }
            .overlay(alignment: .bottom) {
                if allowsReordering && dropTarget?.sessionID == session.id && dropTarget?.after == true {
                    dropIndicator
                }
            }
            if index < sessions.count - 1 { Divider().opacity(0.45) }
        }
        if allowsReordering {
            if dropTarget?.sessionID == pinnedEndDropID {
                dropIndicator
            }
            Color.clear.frame(height: 12)
                .overlay(alignment: .top) {
                    if dropTarget?.sessionID == pinnedEndDropID {
                        dropIndicator
                    }
                }
                .onDrop(of: [.text], delegate: SessionDropDelegate(targetID: pinnedEndDropID, onTargetChanged: updateDropTarget) { id, _ in handlePinnedDrop(id, before: nil, after: true) })
        } else {
            Color.clear.frame(height: 8)
                .onDrop(of: [.text], delegate: SessionDropDelegate(onTargetChanged: { _, _ in clearDropTarget() }) { id, _ in pin(id, moveToRecent: true) })
        }
    }

    private var dropIndicator: some View {
        Capsule()
            .fill(PanelPalette.accent)
            .frame(height: 3)
            .padding(.horizontal, 6)
            .transition(.opacity)
    }

    private func updateDropTarget(_ sessionID: String?, after: Bool) {
        guard draggedSessionID != nil else { return }
        guard let sessionID else {
            dropTarget = nil
            return
        }
        dropTarget = SessionDropTarget(sessionID: sessionID, after: after)
    }

    private func clearDropTarget() {
        dropTarget = nil
    }

    private func clearDragState() {
        draggedSessionID = nil
        dropTarget = nil
    }

    private func pin(_ id: String, moveToRecent: Bool) {
        model.setSessionPinned(model.sessions.first { $0.id == id } ?? AgentSessionSummary(raw: .object(["sessionId": .string(id)])), pinned: !moveToRecent, moveToRecent: moveToRecent)
        clearDragState()
    }

    private func unpinIfPinned(_ id: String) {
        guard let session = model.sessions.first(where: { $0.id == id }), session.pinned else { return }
        model.setSessionPinned(session, pinned: false, moveToRecent: true)
        clearDragState()
    }

    private func handlePinnedDrop(_ id: String, before targetID: String?, after: Bool) {
        if pinned.contains(where: { $0.id == id }) {
            reorder(id, before: targetID, after: after)
        } else if let source = model.sessions.first(where: { $0.id == id }) {
            let nextID: String?
            if let targetID, after, let targetIndex = pinned.firstIndex(where: { $0.id == targetID }) {
                nextID = pinned.dropFirst(targetIndex + 1).first?.id
            } else {
                nextID = targetID
            }
            model.pinSessionInPinned(source, before: nextID)
            clearDragState()
        }
    }

    private func reorder(_ id: String, before targetID: String?, after: Bool) {
        guard let source = pinned.first(where: { $0.id == id }) else { return }
        var reordered = pinned.filter { $0.id != id }
        if let targetID, let targetIndex = reordered.firstIndex(where: { $0.id == targetID }) {
            reordered.insert(source, at: targetIndex + (after ? 1 : 0))
        } else {
            reordered.append(source)
        }
        model.reorderPinnedSessions(reordered)
        clearDragState()
    }
}

private struct SessionDropTarget: Equatable {
    let sessionID: String
    let after: Bool
}

private struct SessionDropDelegate: DropDelegate {
    var targetID: String?
    var onTargetChanged: (String?, Bool) -> Void
    var action: (String, Bool) -> Void

    init(targetID: String? = nil, onTargetChanged: @escaping (String?, Bool) -> Void = { _, _ in }, action: @escaping (String, Bool) -> Void) {
        self.targetID = targetID
        self.onTargetChanged = onTargetChanged
        self.action = action
    }

    func dropEntered(info: DropInfo) {
        onTargetChanged(targetID, isAfter(info))
    }

    func dropUpdated(info: DropInfo) -> DropProposal? {
        onTargetChanged(targetID, isAfter(info))
        return DropProposal(operation: .move)
    }

    func dropExited(info: DropInfo) {
        onTargetChanged(nil, false)
    }

    func performDrop(info: DropInfo) -> Bool {
        let after = isAfter(info)
        onTargetChanged(nil, false)
        guard let provider = info.itemProviders(for: [.text]).first else { return false }
        provider.loadObject(ofClass: NSString.self) { object, _ in
            if let id = object as? NSString { DispatchQueue.main.async { action(String(id), after) } }
        }
        return true
    }

    private func isAfter(_ info: DropInfo) -> Bool {
        targetID != nil && info.location.y > 27
    }
}

private struct SessionHomeRow: View {
    var session: AgentSessionSummary

    var body: some View {
        HStack(spacing: 9) {
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(PanelPalette.info)
                .frame(width: 22, height: 22)
                .background(Circle().fill(PanelPalette.info.opacity(0.14)))

            VStack(alignment: .leading, spacing: 2) {
                Text(session.name)
                    .font(.callout)
                    .fontWeight(.medium)
                    .lineLimit(1)
                Text(session.agent)
                    .font(.caption)
                    .foregroundStyle(PanelPalette.secondaryText)
                    .lineLimit(1)
                if !session.updatedAtLabel.isEmpty {
                    Text("Updated \(session.updatedAtLabel)")
                        .font(.caption2)
                        .foregroundStyle(PanelPalette.secondaryText)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 4)

            Text(status.label)
                .font(.caption2)
                .fontWeight(.semibold)
                .foregroundColor(.white.opacity(0.96))
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(
                    Capsule()
                        .fill(statusTint.opacity(0.25))
                )

        }
        .padding(.vertical, 8)
        .padding(.horizontal, 6)
        .contentShape(Rectangle())
        .hoverRowBackground()
    }

    private var status: SessionSelectionStatus {
        session.activityStatus
    }

    private var statusTint: Color {
        switch status {
        case .active: return PanelPalette.warning
        case .ready: return PanelPalette.info
        case .error: return PanelPalette.danger
        case .on: return PanelPalette.success
        case .off: return PanelPalette.secondaryText
        }
    }
}

// MARK: - Sessions

private struct SessionsDetail: View {
    @ObservedObject var model: RookMacModel
    var agentId: String
    @State private var newSessionName = ""
    @State private var sessionToRename: AgentSessionSummary?
    @State private var renameDraft = ""
    @State private var sessionToDelete: AgentSessionSummary?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            DetailHeader(
                title: agentId,
                systemImage: "cpu",
                trailing: sessionsCountLabel
            ) {
                model.goHome()
            }

            newChatCard
            sessionsCard
        }
        .sheet(item: $sessionToRename) { session in
            RenameSessionSheet(
                sessionName: session.name,
                draft: $renameDraft,
                onCancel: { sessionToRename = nil },
                onSave: {
                    model.renameSession(session, title: renameDraft)
                    sessionToRename = nil
                }
            )
        }
        .alert("Delete Session?", isPresented: Binding(get: { sessionToDelete != nil }, set: { if !$0 { sessionToDelete = nil } }), presenting: sessionToDelete) { session in
            Button("Delete", role: .destructive) {
                model.deleteSession(session)
                sessionToDelete = nil
            }
            Button("Cancel", role: .cancel) {
                sessionToDelete = nil
            }
        } message: { session in
            Text("Delete \(session.name) permanently?")
        }
    }

    private var sessionsCountLabel: String {
        model.sessions.isEmpty ? "" : "\(model.sessions.count) sessions"
    }

    private var newChatCard: some View {
        PanelCard {
            Label("New Chat", systemImage: "plus.bubble")
                .font(.subheadline)
                .fontWeight(.semibold)

            HStack(spacing: 8) {
                TextField("Session name (optional)", text: $newSessionName)
                    .textFieldStyle(.plain)
                    .font(.callout)
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
                        startNew()
                    }

                Button {
                    startNew()
                } label: {
                    Image(systemName: model.startingSession ? "hourglass" : "arrow.up")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 34, height: 34)
                        .background(
                            Circle()
                                .fill(PanelPalette.accent)
                        )
                }
                .buttonStyle(.plain)
                .help("Start a new chat")
                .disabled(model.startingSession)
                .pointingHandOnHover()
            }
        }
    }

    private func startNew() {
        guard !model.startingSession else {
            return
        }
        model.startNewSession(agentId: agentId, name: newSessionName)
    }

    private var sessionsCard: some View {
        PanelCard {
            HStack(spacing: 8) {
                Label("Previous Sessions", systemImage: "clock.arrow.circlepath")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                Spacer()
                if model.sessionsLoading {
                    ProgressView()
                        .scaleEffect(0.5)
                }
            }

            if !model.sessionsError.isEmpty {
                PanelMessageView(
                    systemImage: "exclamationmark.triangle.fill",
                    tint: PanelPalette.warning,
                    text: model.sessionsError
                )
            }

            if model.sessions.isEmpty && !model.sessionsLoading {
                Text("No sessions yet — start a new chat above.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 120, alignment: .center)
            } else {
                ScrollView(.vertical) {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(model.sessions.enumerated()), id: \.element.id) { index, session in
                            HStack(spacing: 8) {
                                Button {
                                    model.resumeSession(session)
                                } label: {
                                    SessionRow(session: session, showsStatus: false)
                                }
                                .buttonStyle(.plain)
                                .help("Resume this session")
                                .disabled(model.startingSession)
                                .pointingHandOnHover()

                                SessionActionsMenu(
                                    onRename: {
                                        renameDraft = session.name
                                        sessionToRename = session
                                    },
                                    onDelete: {
                                        sessionToDelete = session
                                    }
                                )
                            }

                            if index < model.sessions.count - 1 {
                                Divider()
                                    .opacity(0.45)
                            }
                        }
                    }
                }
                .scrollIndicators(.visible)
                .frame(height: sessionListHeight)
                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            }
        }
    }

    private var sessionListHeight: CGFloat {
        let visibleRows = min(CGFloat(model.sessions.count), 7)
        let rowHeight: CGFloat = 54
        return max(visibleRows * rowHeight, rowHeight)
    }
}

private struct SessionRow: View {
    var session: AgentSessionSummary
    var showsStatus = true

    var body: some View {
        HStack(alignment: .center, spacing: 9) {
            Image(systemName: showsStatus ? statusIcon : "bubble.left.and.bubble.right")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(showsStatus ? statusTint : PanelPalette.info)
                .frame(width: 22, height: 22)
                .background(
                    Circle()
                        .fill(statusTint.opacity(0.14))
                )

            VStack(alignment: .leading, spacing: 2) {
                Text(session.name)
                    .font(.callout)
                    .fontWeight(.medium)
                    .lineLimit(1)
                    .truncationMode(.tail)

                Text(session.createdAtLabel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 4)

            if showsStatus {
                Text(statusLabel)
                    .font(.caption2)
                    .fontWeight(.semibold)
                    .foregroundColor(.white.opacity(0.96))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(
                        Capsule()
                            .fill(statusTint.opacity(0.25))
                    )
            }
        }
        .padding(.vertical, 7)
        .padding(.horizontal, 6)
        .contentShape(Rectangle())
        .hoverRowBackground()
    }

    private var status: SessionSelectionStatus {
        session.activityStatus
    }

    private var statusTint: Color {
        switch status {
        case .active: return PanelPalette.warning
        case .ready: return PanelPalette.info
        case .error: return PanelPalette.danger
        case .on: return PanelPalette.success
        case .off: return PanelPalette.secondaryText
        }
    }

    private var statusIcon: String {
        switch status {
        case .active: return "waveform.and.mic"
        case .ready: return "checkmark.circle.fill"
        case .error: return "exclamationmark.circle.fill"
        case .on: return "bolt.fill"
        case .off: return "moon.zzz"
        }
    }

    private var statusLabel: String {
        status.label
    }
}

private struct SessionActionsMenu: View {
    var onTogglePin: (() -> Void)? = nil
    var onRename: () -> Void
    var onDelete: () -> Void

    var body: some View {
        Menu {
            if let onTogglePin {
                Button("Pin/Unpin", action: onTogglePin)
            }
            Button("Rename", action: onRename)
            Divider()
            Button("Delete", role: .destructive, action: onDelete)
        } label: {
            Image(systemName: "ellipsis.circle")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(PanelPalette.secondaryText)
                .frame(width: 28, height: 28)
                .background(Circle().fill(Color.white.opacity(0.06)))
        }
        .menuIndicator(.hidden)
        .menuStyle(.borderlessButton)
        .fixedSize()
    }
}

private struct RenameSessionSheet: View {
    let sessionName: String
    @Binding var draft: String
    var onCancel: () -> Void
    var onSave: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Rename Session")
                .font(.headline)
            Text("Update the title for \(sessionName).")
                .font(.caption)
                .foregroundStyle(PanelPalette.secondaryText)
            TextField("Session title", text: $draft)
                .textFieldStyle(.roundedBorder)
                .onSubmit(onSave)
            HStack {
                Spacer()
                Button("Cancel", action: onCancel)
                Button("Save", action: onSave)
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 320)
    }
}
