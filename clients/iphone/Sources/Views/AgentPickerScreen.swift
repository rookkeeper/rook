import RookKit
import SwiftUI

struct AgentPickerScreen: View {
    @ObservedObject var model: RookModel
    @State private var showingSettings = false
    @State private var showingPlaces = false
    @State private var newSessionName = ""
    @State private var selectedRuntimeID = ""

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
        .onAppear {
            if selectedRuntimeID.isEmpty { selectedRuntimeID = model.agents.first?.id ?? "" }
        }
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
                VStack(spacing: 0) {
                    ForEach(Array(model.sessions.enumerated()), id: \.element.id) { index, session in
                        Button { model.resumeSession(session) } label: {
                            SessionRow(session: session)
                        }
                        .buttonStyle(.plain)
                        .disabled(model.startingSession)

                        if index < model.sessions.count - 1 {
                            Divider().overlay(PanelPalette.border).opacity(0.5)
                        }
                    }
                }
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
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(PanelPalette.info)
                .frame(width: 30, height: 30)
                .background(Circle().fill(PanelPalette.info.opacity(0.14)))

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
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(PanelPalette.textMuted)
        }
        .padding(.vertical, 9)
        .contentShape(Rectangle())
    }
}
