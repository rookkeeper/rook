import RookKit
import SwiftUI

struct SessionsHomeScreen: View {
    @ObservedObject var model: RookModel
    @State private var showingSettings = false
    @State private var showingPlaces = false
    @State private var newSessionName = ""
    @State private var selectedRuntimeID = ""
    @State private var sessionToRename: AgentSessionSummary?
    @State private var renameDraft = ""
    @State private var sessionToDelete: AgentSessionSummary?

    var body: some View {
        VStack(spacing: 0) {
            RookHeader(model: model, trailing: AnyView(
                HStack(spacing: 14) {
                    Button { showingPlaces = true } label: {
                        Image(systemName: "mappin.and.ellipse").foregroundStyle(PanelPalette.textMuted)
                    }
                    Button { showingSettings = true } label: {
                        Image(systemName: "gearshape").foregroundStyle(PanelPalette.textMuted)
                    }
                }
            ))

            PlaceCaption(model: model)

            if model.serverState == .offline || model.serverState == .unauthorized {
                offlineCard
            }

            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if model.currentSession != nil && !model.chatVisible { resumeRow }
                    newChatCard
                    sessionsCard
                    if !model.agentsError.isEmpty {
                        PanelMessageView(systemImage: "exclamationmark.triangle.fill", tint: PanelPalette.warning, text: model.agentsError)
                    }
                    if !model.sessionsError.isEmpty {
                        PanelMessageView(systemImage: "exclamationmark.triangle.fill", tint: PanelPalette.warning, text: model.sessionsError)
                    }
                }
                .padding(16)
            }
        }
        .sheet(isPresented: $showingSettings) { SettingsScreen(model: model) }
        .sheet(isPresented: $showingPlaces) { PlacesScreen(model: model) }
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
            .presentationDetents([.height(220)])
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
            if selectedRuntimeID.isEmpty { selectedRuntimeID = model.agents.first?.id ?? "" }
        }
        .onAppear { model.startSessionListPolling() }
        .onDisappear { model.stopSessionListPolling() }
        .onChange(of: model.agents) { _, newValue in
            if selectedRuntimeID.isEmpty || !newValue.contains(where: { $0.id == selectedRuntimeID }) {
                selectedRuntimeID = newValue.first?.id ?? ""
            }
        }
    }

    private var newChatCard: some View {
        PanelCard {
            Label("New chat", systemImage: "plus.bubble")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(PanelPalette.textNormal)

            VStack(alignment: .leading, spacing: 8) {
                if model.agents.isEmpty {
                    Text(model.serverState == .online ? "No configured runtimes" : "Waiting for the server…")
                        .font(.callout)
                        .foregroundStyle(PanelPalette.textMuted)
                } else {
                    Picker("Agent Runtime", selection: $selectedRuntimeID) {
                        ForEach(model.agentTree, id: \.agent.id) { entry in
                            Text(String(repeating: "  ", count: entry.depth) + entry.agent.id).tag(entry.agent.id)
                        }
                    }
                    .pickerStyle(.menu)
                }

                HStack(spacing: 8) {
                    TextField("Name (optional)", text: $newSessionName)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .foregroundStyle(PanelPalette.textNormal)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .background(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(PanelPalette.backgroundPrimary.opacity(0.8))
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .strokeBorder(PanelPalette.border)
                        )
                        .onSubmit { startNew() }

                    Button { startNew() } label: {
                        Image(systemName: model.startingSession ? "hourglass" : "arrow.up")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 42, height: 42)
                            .background(Circle().fill(PanelPalette.accent))
                    }
                    .buttonStyle(.plain)
                    .disabled(model.startingSession || selectedRuntimeID.isEmpty)
                }
            }
        }
    }

    private var sessionsCard: some View {
        PanelCard {
            HStack(spacing: 8) {
                Label("Sessions", systemImage: "clock.arrow.circlepath")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(PanelPalette.textNormal)
                Spacer()
                if model.sessionsLoading { ProgressView().scaleEffect(0.7) }
            }

            if model.sessions.isEmpty && !model.sessionsLoading {
                Text("No sessions yet — start a new chat above.")
                    .font(.callout)
                    .foregroundStyle(PanelPalette.textMuted)
                    .frame(maxWidth: .infinity, minHeight: 100, alignment: .center)
            } else {
                IPhoneSessionSections(
                    model: model,
                    onRename: { session in
                        renameDraft = session.name
                        sessionToRename = session
                    },
                    onDelete: { session in sessionToDelete = session }
                )
            }
        }
    }

    private var resumeRow: some View {
        Button { model.openChat() } label: {
            HStack(spacing: 11) {
                Image(systemName: "play.fill")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 32, height: 32)
                    .background(Circle().fill(PanelPalette.accent))
                VStack(alignment: .leading, spacing: 1) {
                    Text("Resume chat")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(PanelPalette.textNormal)
                    Text(resumeLine)
                        .font(.caption)
                        .foregroundStyle(PanelPalette.textMuted)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                Spacer(minLength: 4)
                if model.isRunning { StatusDot(tint: PanelPalette.warning) }
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(PanelPalette.textMuted)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 11)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(PanelPalette.accent.opacity(0.14)))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(PanelPalette.accent.opacity(0.4)))
        }
        .buttonStyle(.plain)
    }

    private var resumeLine: String {
        guard let session = model.currentSession else { return "" }
        let name = session.name == "default" ? "" : " · \(session.name)"
        return "\(session.agent)\(name)"
    }

    private func startNew() {
        guard !model.startingSession, !selectedRuntimeID.isEmpty else { return }
        model.startNewSession(agentId: selectedRuntimeID, name: newSessionName)
    }

    private var offlineCard: some View {
        PanelMessageView(
            systemImage: model.serverState == .unauthorized ? "lock.slash.fill" : "bolt.slash.fill",
            tint: PanelPalette.danger,
            text: model.serverState == .unauthorized
                ? "Server requires authorization at \(model.baseURLString). Check the bearer token in Settings."
                : offlineText
        )
        .padding(16)
    }

    private var offlineText: String {
        if model.serverDiagnostic.isEmpty {
            return "Server unreachable at \(model.baseURLString). Run `npm run dev` on the Mac; tap the gear to change the address."
        }
        return "Server unreachable at \(model.baseURLString). \(model.serverDiagnostic)"
    }
}

private struct SessionRow: View {
    let session: AgentSessionSummary

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: statusIcon)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(statusTint)
                .frame(width: 30, height: 30)
                .background(Circle().fill(statusTint.opacity(0.14)))

            VStack(alignment: .leading, spacing: 2) {
                Text(session.name)
                    .font(.body.weight(.medium))
                    .foregroundStyle(PanelPalette.textNormal)
                    .lineLimit(1)
                Text(session.agent)
                    .font(.caption)
                    .foregroundStyle(PanelPalette.textMuted)
                    .lineLimit(1)
                if !session.updatedAtLabel.isEmpty {
                    Text("Updated \(session.updatedAtLabel)")
                        .font(.caption2)
                        .foregroundStyle(PanelPalette.textMuted)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 4)

            Text(status.label)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.white.opacity(0.95))
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(Capsule().fill(statusTint.opacity(0.25)))

            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(PanelPalette.textMuted)
        }
        .padding(.vertical, 9)
        .contentShape(Rectangle())
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
        case .off: return PanelPalette.textMuted
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
}

private struct IPhoneSessionSections: View {
    @ObservedObject var model: RookModel
    var onRename: (AgentSessionSummary) -> Void
    var onDelete: (AgentSessionSummary) -> Void

    private var pinned: [AgentSessionSummary] {
        model.sessions.filter(\.pinned).sorted {
            $0.pinnedOrder == $1.pinnedOrder ? $0.id < $1.id : $0.pinnedOrder < $1.pinnedOrder
        }
    }
    private var recent: [AgentSessionSummary] { model.sessions.filter { !$0.pinned } }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionHeader("Pinned", systemImage: "pin.fill")
            if pinned.isEmpty {
                Text("Pin a session to keep it here.")
                    .font(.callout)
                    .foregroundStyle(PanelPalette.textMuted)
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .background(RoundedRectangle(cornerRadius: 8).fill(PanelPalette.backgroundPrimary.opacity(0.35)))
            } else {
                rows(pinned)
            }
            sectionHeader("Recent", systemImage: "clock.arrow.circlepath")
            if recent.isEmpty {
                Text("No recent sessions")
                    .font(.callout)
                    .foregroundStyle(PanelPalette.textMuted)
                    .padding(.vertical, 10)
            } else {
                rows(recent)
            }
        }
    }

    private func sectionHeader(_ title: String, systemImage: String) -> some View {
        Label(title, systemImage: systemImage)
            .font(.caption.weight(.semibold))
            .foregroundStyle(PanelPalette.textMuted)
            .padding(.top, 4)
    }

    @ViewBuilder
    private func rows(_ sessions: [AgentSessionSummary]) -> some View {
        ForEach(Array(sessions.enumerated()), id: \.element.id) { index, session in
            HStack(spacing: 8) {
                Button { model.resumeSession(session) } label: { SessionRow(session: session) }
                    .buttonStyle(.plain)
                    .disabled(model.startingSession)
                SessionActionsMenu(
                    onRename: { onRename(session) },
                    isPinned: session.pinned,
                    onTogglePin: { model.setSessionPinned(session, pinned: !session.pinned) },
                    onDelete: { onDelete(session) }
                )
            }
            if index < sessions.count - 1 {
                Divider().overlay(PanelPalette.border).opacity(0.5)
            }
        }
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
            Button("Delete", role: .destructive, action: onDelete)
        } label: {
            Image(systemName: "ellipsis.circle")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(PanelPalette.textMuted)
                .frame(width: 30, height: 30)
        }
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
                .foregroundStyle(PanelPalette.textMuted)
            TextField("Session title", text: $draft)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)
            HStack {
                Button("Cancel", action: onCancel)
                Spacer()
                Button("Save", action: onSave)
                    .buttonStyle(.borderedProminent)
            }
        }
        .padding(20)
    }
}
