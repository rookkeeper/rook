import RookKit
import SwiftUI

struct RootView: View {
    @ObservedObject var model: RookModel
    // Test hook: ROOK_SHOW_PLACES opens the Places screen on launch.
    @State private var showPlaces = ProcessInfo.processInfo.environment["ROOK_SHOW_PLACES"] != nil

    var body: some View {
        ZStack {
            PanelBackground()
                .ignoresSafeArea()

            if model.currentSession != nil && model.chatVisible {
                ChatScreen(model: model)
            } else if let agentId = model.selectedAgentId {
                SessionsScreen(model: model, agentId: agentId)
            } else {
                AgentPickerScreen(model: model)
            }
        }
        .tint(PanelPalette.accent)
        .sheet(isPresented: Binding(
            get: { model.pendingOffer != nil },
            // Swiping the sheet away is "Not now": send an ignore decision so the
            // server doesn't keep a dangling unresolved offer, and the offer can
            // still be re-raised later. (A bare clearOffer() would lose it silently.)
            set: { if !$0 { model.decideEnvironment("ignore") } }
        )) {
            EnvironmentOfferSheet(model: model)
        }
        .sheet(isPresented: $showPlaces) {
            PlacesScreen(model: model)
        }
    }
}

// MARK: - Identity bar (shared header)

struct RookHeader: View {
    @ObservedObject var model: RookModel
    var trailing: AnyView?

    var body: some View {
        HStack(spacing: 10) {
            Image("RookMark")
                .renderingMode(.original)
                .resizable()
                .scaledToFit()
                .frame(width: 17, height: 17)
            Text("Rook")
                .font(.title3.weight(.semibold))
                .foregroundStyle(PanelPalette.textNormal)
            Spacer(minLength: 0)
            if let trailing {
                trailing
            } else {
                HStack(spacing: 6) {
                    Text(model.serverStatusLabel)
                        .font(.caption)
                        .foregroundStyle(PanelPalette.textMuted)
                    StatusDot(tint: model.serverStatusTint)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }
}

/// Live "where you are" caption: the current place + whether skills are loaded.
struct PlaceCaption: View {
    @ObservedObject var model: RookModel

    var body: some View {
        if let place = model.currentPlaceName {
            let hasSkills = model.placeEnvironmentId != nil
            HStack(spacing: 6) {
                Image(systemName: "mappin.circle.fill")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(hasSkills ? PanelPalette.accentHover : PanelPalette.textMuted)
                Text("At \(place)")
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(PanelPalette.textNormal)
                Circle()
                    .fill(hasSkills ? PanelPalette.success : PanelPalette.textMuted.opacity(0.6))
                    .frame(width: 5, height: 5)
                Text(hasSkills ? "skills active" : "no skills")
                    .font(.caption2)
                    .foregroundStyle(hasSkills ? PanelPalette.success : PanelPalette.textMuted)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 4)
        }
    }
}
