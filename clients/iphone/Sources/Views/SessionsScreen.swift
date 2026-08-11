import RookKit
import SwiftUI

/// Per-agent session list — the iOS counterpart of the Mac app's `SessionsDetail`.
/// Tapping an agent lands here: start a new (optionally named) chat, or resume
/// one of that agent's previous sessions. Entering a chat is what advances to
/// `ChatScreen` (RootView swaps on `currentSession`).
struct SessionsScreen: View {
    @ObservedObject var model: RookModel
    let agentId: String
    @State private var newSessionName = ""
    @FocusState private var nameFocused: Bool
    @State private var sessionToRename: AgentSessionSummary?
    @State private var renameDraft = ""
    @State private var sessionToDelete: AgentSessionSummary?

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    newChatCard
                    sessionsCard
                }
                .padding(16)
            }
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
    }

    private var header: some View {
        HStack(spacing: 10) {
            Button {
                model.closeAgentSessions()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(PanelPalette.textNormal)
                    .frame(width: 30, height: 30)
                    .background(Circle().fill(Color.white.opacity(0.08)))
            }
            Image(systemName: "sparkle")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(PanelPalette.info)
                .frame(width: 28, height: 28)
                .background(Circle().fill(PanelPalette.info.opacity(0.14)))
            VStack(alignment: .leading, spacing: 1) {
                Text(agentId)
                    .font(.headline)
                    .foregroundStyle(PanelPalette.textNormal)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(PanelPalette.textMuted)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    private var subtitle: String {
        if model.sessionsLoading && model.sessions.isEmpty {
            return "Loading sessions…"
        }
        if model.sessions.isEmpty {
            return "New conversation"
        }
        return "\(model.sessions.count) past session\(model.sessions.count == 1 ? "" : "s")"
    }

    private var newChatCard: some View {
        PanelCard {
            Label("New chat", systemImage: "plus.bubble")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(PanelPalette.textNormal)

            HStack(spacing: 8) {
                TextField("Name (optional)", text: $newSessionName)
                    .focused($nameFocused)
                    .submitLabel(.go)
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

                Button {
                    startNew()
                } label: {
                    Image(systemName: model.startingSession ? "hourglass" : "arrow.up")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 42, height: 42)
                        .background(Circle().fill(PanelPalette.accent))
                }
                .buttonStyle(.plain)
                .disabled(model.startingSession)
            }
        }
    }

    private var sessionsCard: some View {
        PanelCard {
            HStack(spacing: 8) {
                Label("Previous sessions", systemImage: "clock.arrow.circlepath")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(PanelPalette.textNormal)
                Spacer()
                if model.sessionsLoading {
                    ProgressView().scaleEffect(0.7)
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
                    .foregroundStyle(PanelPalette.textMuted)
                    .frame(maxWidth: .infinity, minHeight: 100, alignment: .center)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(model.sessions.enumerated()), id: \.element.id) { index, session in
                        HStack(spacing: 8) {
                            Button {
                                model.resumeSession(session)
                            } label: {
                                SessionRow(session: session, currentSessionId: model.currentSession?.id)
                            }
                            .buttonStyle(.plain)
                            .disabled(model.startingSession)

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
                            Divider().overlay(PanelPalette.border).opacity(0.5)
                        }
                    }
                }
            }
        }
    }

    private func startNew() {
        guard !model.startingSession else {
            return
        }
        nameFocused = false
        model.startNewSession(agentId: agentId, name: newSessionName)
    }
}

private struct SessionRow: View {
    let session: AgentSessionSummary
    let currentSessionId: String?

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: statusIcon)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(statusTint)
                .frame(width: 30, height: 30)
                .background(
                    Circle().fill(statusTint.opacity(0.14))
                )

            VStack(alignment: .leading, spacing: 2) {
                Text(session.name)
                    .font(.body.weight(.medium))
                    .foregroundStyle(PanelPalette.textNormal)
                    .lineLimit(1)
                    .truncationMode(.tail)
                if !session.createdAtLabel.isEmpty {
                    Text(session.createdAtLabel)
                        .font(.caption)
                        .foregroundStyle(PanelPalette.textMuted)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 4)

            Text(statusLabel)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.white.opacity(0.95))
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(
                    Capsule().fill(statusTint.opacity(0.25))
                )

            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(PanelPalette.textMuted)
        }
        .padding(.vertical, 9)
        .contentShape(Rectangle())
    }

    private var status: SessionSelectionStatus {
        session.selectionStatus(currentSessionId: currentSessionId)
    }

    private var statusTint: Color {
        switch status {
        case .active: return PanelPalette.warning
        case .on: return PanelPalette.success
        case .off: return PanelPalette.textMuted
        }
    }

    private var statusIcon: String {
        switch status {
        case .active: return "waveform.and.mic"
        case .on: return "bolt.fill"
        case .off: return "moon.zzz"
        }
    }

    private var statusLabel: String {
        status.label
    }
}

private struct SessionActionsMenu: View {
    var onRename: () -> Void
    var onDelete: () -> Void

    var body: some View {
        Menu {
            Button("Rename", action: onRename)
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
