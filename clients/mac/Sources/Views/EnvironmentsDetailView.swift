import Foundation
import RookKit
import SwiftUI

/// Sorted list of every environment the manager knows about, with join/leave
/// affordances. Entered environments come first, then active (most recent first),
/// then inactive.
struct EnvironmentsDetail: View {
    @ObservedObject var model: RookMacModel

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            DetailHeader(
                title: "Environments",
                systemImage: "globe",
                trailing: ""
            ) {
                model.closeEnvironments()
            }

            if model.environmentsLoading {
                HStack {
                    Spacer()
                    ProgressView()
                        .scaleEffect(0.8)
                    Spacer()
                }
                .padding(.vertical, 20)
            } else if !model.environmentsError.isEmpty {
                PanelCard {
                    Text(model.environmentsError)
                        .font(.callout)
                        .foregroundStyle(PanelPalette.danger)
                }
            } else if model.environmentListItems.isEmpty {
                PanelCard {
                    Text("No environments in memory.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, minHeight: 80, alignment: .center)
                }
            } else {
                environmentList
            }
        }
    }

    private var environmentList: some View {
        ScrollView {
            VStack(spacing: 6) {
                ForEach(model.environmentListItems) { item in
                    environmentRow(item)
                }
            }
            .padding(.horizontal, 2)
        }
    }

    private func environmentRow(_ item: EnvironmentListItem) -> some View {
        PanelCard {
            HStack(spacing: 9) {
                // Status icon
                Image(systemName: item.entered ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(item.entered ? PanelPalette.success : PanelPalette.textMuted)

                VStack(alignment: .leading, spacing: 2) {
                    Text(item.sourceName ?? item.environmentId)
                        .font(.subheadline)
                        .fontWeight(.semibold)
                    Text(item.environmentId)
                        .font(.caption.monospaced())
                        .foregroundStyle(PanelPalette.textMuted)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    HStack(spacing: 8) {
                        Text(item.status == "active" ? "Active" : "Recent")
                            .font(.caption2)
                            .foregroundStyle(item.status == "active" ? PanelPalette.success : PanelPalette.textMuted)
                        Text("•")
                            .font(.caption2)
                            .foregroundStyle(PanelPalette.textMuted)
                        Text("\(item.approvedBundleCount)/\(item.bundleCount) bundles")
                            .font(.caption2)
                            .foregroundStyle(PanelPalette.textMuted)
                    }
                }

                Spacer(minLength: 8)

                // Join / Leave button
                Button {
                    if item.entered {
                        model.leaveEnvironment(item.environmentId)
                    } else {
                        model.joinEnvironment(item.environmentId)
                    }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: item.entered ? "rectangle.portrait.and.arrow.right" : "arrow.right.to.line.compact")
                            .font(.system(size: 10, weight: .semibold))
                        Text(item.entered ? "Leave" : "Join")
                            .font(.caption)
                            .fontWeight(.semibold)
                    }
                    .foregroundStyle(item.entered ? PanelPalette.danger : PanelPalette.accent)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(
                        Capsule()
                            .fill((item.entered ? PanelPalette.danger : PanelPalette.accent).opacity(0.14))
                    )
                }
                .buttonStyle(.plain)
                .help(item.entered ? "Leave this environment" : "Join this environment")
                .pointingHandOnHover()
            }
        }
    }
}
