import ActivityKit
import RookKit
import SwiftUI
import WidgetKit

/// Rook's Live Activity — Lock Screen card + Dynamic Island presentations.
/// Shows the current place, whether skills are loaded, and the agent's status.
struct RookLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RookActivityAttributes.self) { context in
            // Lock Screen / banner presentation.
            LockScreenView(attributes: context.attributes, state: context.state)
                .activityBackgroundTint(PanelPalette.backgroundSecondary)
                .activitySystemActionForegroundColor(PanelPalette.accent)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 6) {
                        Image("RookMarkPurple")
                            .resizable()
                            .scaledToFit()
                            .frame(width: 14, height: 14)
                        Text(context.attributes.agentName)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.white)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    statusPill(context.state)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(spacing: 6) {
                        Image(systemName: "mappin.circle.fill")
                            .foregroundStyle(context.state.skillsActive ? PanelPalette.accentHover : .secondary)
                        Text(placeLine(context.state))
                            .font(.caption)
                            .foregroundStyle(.white.opacity(0.9))
                        Spacer()
                    }
                }
            } compactLeading: {
                Image("RookMarkPurple")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 14, height: 14)
            } compactTrailing: {
                Text(context.state.placeName ?? (context.state.running ? "•" : ""))
                    .font(.caption2)
                    .foregroundStyle(context.state.skillsActive ? PanelPalette.success : .secondary)
                    .lineLimit(1)
            } minimal: {
                Image("RookMarkPurple")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 14, height: 14)
            }
            .widgetURL(URL(string: "rook://open"))
        }
    }

    private func statusPill(_ state: RookActivityAttributes.ContentState) -> some View {
        Text(state.agentStatus)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(state.running ? PanelPalette.warning : PanelPalette.success)
    }

    private func placeLine(_ state: RookActivityAttributes.ContentState) -> String {
        guard let place = state.placeName else {
            return "No place"
        }
        return state.skillsActive ? "\(place) · skills active" : place
    }
}

private struct LockScreenView: View {
    let attributes: RookActivityAttributes
    let state: RookActivityAttributes.ContentState

    var body: some View {
        HStack(spacing: 12) {
            Image("RookMarkPurple")
                .resizable()
                .scaledToFit()
                .frame(width: 22, height: 22)
                .frame(width: 40, height: 40)
                .background(Circle().fill(PanelPalette.accent.opacity(0.18)))

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text("Rook")
                        .font(.headline)
                        .foregroundStyle(.white)
                    Text("· \(attributes.agentName)")
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.7))
                }
                HStack(spacing: 6) {
                    if let place = state.placeName {
                        Image(systemName: "mappin.circle.fill")
                            .font(.caption2)
                            .foregroundStyle(state.skillsActive ? PanelPalette.accentHover : .secondary)
                        Text(state.skillsActive ? "\(place) · skills active" : place)
                            .font(.caption)
                            .foregroundStyle(.white.opacity(0.85))
                    } else {
                        Text("Ready")
                            .font(.caption)
                            .foregroundStyle(.white.opacity(0.7))
                    }
                }
            }
            Spacer()
            Text(state.agentStatus)
                .font(.caption.weight(.semibold))
                .foregroundStyle(state.running ? PanelPalette.warning : PanelPalette.success)
        }
        .padding(14)
    }
}
