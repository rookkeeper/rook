import Foundation
import RookKit
import SwiftUI

/// Transitional capabilities screen during the refactor. Voice and computer
/// control were removed from the active client; this screen now focuses on the
/// current environment context and documents the removal.
struct CapabilitiesDetail: View {
    @ObservedObject var model: RookMacModel

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            DetailHeader(
                title: "Capabilities",
                systemImage: "slider.horizontal.3",
                trailing: ""
            ) {
                model.goHome()
            }

            archivedFeaturesCard
            if model.foregroundEnvironmentId != nil {
                foregroundEnvironmentCard
            }
        }
    }

    private var archivedFeaturesCard: some View {
        PanelCard {
            HStack(spacing: 8) {
                Label("Archived features", systemImage: "archivebox.fill")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                Spacer()
                StatusDot(tint: PanelPalette.warning)
            }

            Text("Voice, hotkey control, the local context bridge, and computer-control UI were removed during the refactor. Restoration notes should live in follow-up issues if and when these features return.")
                .font(.caption)
                .foregroundStyle(PanelPalette.textMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var foregroundEnvironmentCard: some View {
        PanelCard {
            HStack(spacing: 9) {
                Image(systemName: "macwindow.on.rectangle")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(PanelPalette.accentHover)
                    .frame(width: 24, height: 24)
                    .background(Circle().fill(PanelPalette.accent.opacity(0.18)))
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(model.foregroundAppName ?? "App") environment")
                        .font(.subheadline)
                        .fontWeight(.semibold)
                    Text(model.foregroundEnvironmentId ?? "")
                        .font(.caption.monospaced())
                        .foregroundStyle(PanelPalette.textMuted)
                        .lineLimit(1)
                }
                Spacer()
                StatusDot(tint: PanelPalette.success)
            }

            if let site = model.foregroundSiteEnvironmentId, !site.isEmpty {
                Text(site)
                    .font(.caption.monospaced())
                    .foregroundStyle(PanelPalette.textMuted)
                    .lineLimit(1)
            }

            if let title = model.foregroundWindowTitle, !title.isEmpty {
                HStack(spacing: 6) {
                    Image(systemName: "text.window")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(PanelPalette.textMuted)
                    Text(title)
                        .font(.caption)
                        .foregroundStyle(PanelPalette.textNormal)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
        }
    }
}
