import RookKit
import SwiftUI

/// Sorted list of environments known to the manager, with join/leave
/// buttons per row. Entered environments come first, then active (most
/// recent), then inactive.
struct EnvironmentsScreen: View {
    @ObservedObject var model: RookModel

    var body: some View {
        ZStack {
            PanelBackground().ignoresSafeArea()
            if model.environmentsLoading && model.environmentListItems.isEmpty {
                VStack {
                    Spacer()
                    ProgressView()
                    Spacer()
                }
            } else if !model.environmentsError.isEmpty && model.environmentListItems.isEmpty {
                VStack(spacing: 12) {
                    Spacer()
                    Image(systemName: "exclamationmark.triangle")
                        .font(.title2)
                        .foregroundStyle(PanelPalette.danger)
                    Text(model.environmentsError)
                        .font(.callout)
                        .foregroundStyle(PanelPalette.danger)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)
                    Spacer()
                }
            } else if model.environmentListItems.isEmpty {
                VStack(spacing: 12) {
                    Spacer()
                    Image(systemName: "globe")
                        .font(.title)
                        .foregroundStyle(PanelPalette.textMuted)
                    Text("No environments in memory.")
                        .font(.callout)
                        .foregroundStyle(PanelPalette.textMuted)
                    Spacer()
                }
            } else {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(model.environmentListItems) { item in
                            environmentRow(item)
                        }
                    }
                    .padding(16)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .tint(PanelPalette.accent)
        .onAppear { model.startEnvironmentListAutoRefresh() }
        .onDisappear { model.stopEnvironmentListAutoRefresh() }
    }

    private func environmentRow(_ item: EnvironmentListItem) -> some View {
        PanelCard {
            HStack(spacing: 10) {
                Image(systemName: item.entered ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(item.entered ? PanelPalette.success : PanelPalette.textMuted)

                VStack(alignment: .leading, spacing: 3) {
                    Text(item.displayName)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(PanelPalette.textNormal)
                    Text(item.environmentId)
                        .font(.caption2.monospaced())
                        .foregroundStyle(PanelPalette.textMuted)
                        .lineLimit(1)
                    if let sourceName = item.sourceName,
                       sourceName != item.displayName,
                       sourceName != item.environmentId {
                        Text(sourceName)
                            .font(.caption2)
                            .foregroundStyle(PanelPalette.textMuted)
                            .lineLimit(1)
                    }
                    HStack(spacing: 6) {
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
                            .font(.caption.weight(.semibold))
                    }
                    .foregroundStyle(item.entered ? PanelPalette.danger : PanelPalette.accent)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(
                        Capsule()
                            .fill((item.entered ? PanelPalette.danger : PanelPalette.accent).opacity(0.14))
                    )
                }
            }
        }
    }
}
