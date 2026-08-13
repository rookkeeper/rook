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
            .background(measurementContent)
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
        if model.panelMode == .chat || model.panelMode == .environments {
            baseContent
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        } else {
            baseContent
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    private var measurementContent: some View {
        measurementBaseContent
            .fixedSize(horizontal: false, vertical: true)
            .background(
                GeometryReader { proxy in
                    Color.clear
                        .preference(key: PanelContentHeightKey.self, value: proxy.size.height + 24)
                }
            )
            .hidden()
            .allowsHitTesting(false)
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

    private var measurementBaseContent: some View {
        ZStack(alignment: .topLeading) {
            switch model.panelMode {
            case .home:
                HomeContent(model: model)
            case .sessions(let agentId):
                SessionsDetail(model: model, agentId: agentId)
            case .chat:
                ChatDetail(model: model, elasticThreadCard: false, measurementMode: true)
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
        if model.panelMode == .chat || model.panelMode == .environments {
            return 420
        }
        return max(420, measuredContentHeight)
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
        .frame(maxHeight: .infinity, alignment: .top)
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
                ScrollView(.vertical) {
                    MacSessionSections(
                        model: model,
                        onRename: { session in
                            renameDraft = session.name
                            sessionToRename = session
                        },
                        onDelete: { session in sessionToDelete = session }
                    )
                }
                .scrollIndicators(.visible)
                .frame(maxHeight: .infinity, alignment: .top)
            }
        }
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
        .frame(maxHeight: .infinity, alignment: .top)
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
                    MacSessionSections(
                        model: model,
                        onRename: { session in
                            renameDraft = session.name
                            sessionToRename = session
                        },
                        onDelete: { session in sessionToDelete = session }
                    )
                }
                .scrollIndicators(.visible)
                .frame(maxHeight: .infinity, alignment: .top)
                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            }
        }
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

private struct MacSessionSections: View {
    @ObservedObject var model: RookMacModel
    var onRename: (AgentSessionSummary) -> Void
    var onDelete: (AgentSessionSummary) -> Void
    @State private var isDropTargeted = false

    private var pinned: [AgentSessionSummary] {
        model.sessions.filter(\.pinned).sorted {
            $0.pinnedOrder == $1.pinnedOrder ? $0.id < $1.id : $0.pinnedOrder < $1.pinnedOrder
        }
    }
    private var recent: [AgentSessionSummary] { model.sessions.filter { !$0.pinned } }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionHeader("Pinned", systemImage: "pin.fill")
            VStack(spacing: 0) {
                if pinned.isEmpty {
                    Text("Drag sessions here to pin.")
                        .font(.callout)
                        .foregroundStyle(PanelPalette.secondaryText)
                        .frame(maxWidth: .infinity, minHeight: 54)
                } else {
                    rows(pinned, supportsPositionDrop: true)
                }
            }
            .padding(.horizontal, 6)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(isDropTargeted ? PanelPalette.accent.opacity(0.16) : PanelPalette.backgroundPrimary.opacity(0.28))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .strokeBorder(isDropTargeted ? PanelPalette.accent : PanelPalette.border.opacity(0.7), style: StrokeStyle(lineWidth: 1, dash: [5]))
            )
            .dropDestination(for: String.self) { ids, _ in
                drop(ids, at: pinned.count)
            } isTargeted: { isDropTargeted = $0 }

            sectionHeader("Recent", systemImage: "clock.arrow.circlepath")
            if recent.isEmpty {
                Text("No recent sessions")
                    .font(.callout)
                    .foregroundStyle(PanelPalette.secondaryText)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 12)
            } else {
                rows(recent, supportsPositionDrop: false)
            }
        }
    }

    private func sectionHeader(_ title: String, systemImage: String) -> some View {
        Label(title, systemImage: systemImage)
            .font(.caption.weight(.semibold))
            .foregroundStyle(PanelPalette.secondaryText)
            .padding(.top, 5)
    }

    @ViewBuilder
    private func rows(_ sessions: [AgentSessionSummary], supportsPositionDrop: Bool) -> some View {
        ForEach(Array(sessions.enumerated()), id: \.element.id) { index, session in
            let row = HStack(spacing: 8) {
                Button { model.resumeSession(session) } label: {
                    SessionRow(session: session)
                }
                .buttonStyle(.plain)
                .help("Resume this session")
                .disabled(model.startingSession)
                .pointingHandOnHover()
                .draggable(session.id)

                SessionActionsMenu(
                    onRename: { onRename(session) },
                    isPinned: session.pinned,
                    onTogglePin: { model.setSessionPinned(session, pinned: !session.pinned) },
                    onDelete: { onDelete(session) }
                )
            }
            if supportsPositionDrop {
                row.dropDestination(for: String.self) { ids, _ in
                    drop(ids, at: index)
                }
            } else {
                row
            }
            if index < sessions.count - 1 { Divider().opacity(0.45) }
        }
    }

    private func drop(_ ids: [String], at index: Int) -> Bool {
        let movingIds = ids.filter { id in model.sessions.contains(where: { $0.id == id }) }
        guard !movingIds.isEmpty else { return false }
        let targetId = index < pinned.count ? pinned[index].id : nil
        var ordered = pinned.map(\.id).filter { !movingIds.contains($0) }
        let insertionIndex = targetId.flatMap { ordered.firstIndex(of: $0) } ?? ordered.count
        ordered.insert(contentsOf: movingIds, at: insertionIndex)
        model.reorderPinnedSessions(ordered)
        return true
    }
}

private struct SessionActionsMenu: View {
    var onRename: () -> Void
    var isPinned = false
    var onTogglePin: (() -> Void)? = nil
    var onDelete: () -> Void

    var body: some View {
        Menu {
            Button("Rename", action: onRename)
            if let onTogglePin {
                Button(isPinned ? "Unpin" : "Pin", action: onTogglePin)
            }
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
