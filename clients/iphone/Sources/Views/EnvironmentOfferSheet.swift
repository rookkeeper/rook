import RookKit
import SwiftUI

/// Reuses the model's `pendingOffer` / `offerBundles` / `decideEnvironment`
/// flow — identical to the macOS approval, presented as an iOS sheet.
struct EnvironmentOfferSheet: View {
    @ObservedObject var model: RookModel
    @State private var selectedFile: String?

    var body: some View {
        NavigationStack {
            ZStack {
                PanelBackground().ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        sourceCard
                        if model.offerLoading {
                            ProgressView().frame(maxWidth: .infinity)
                        }
                        if !model.offerError.isEmpty {
                            PanelMessageView(systemImage: "exclamationmark.triangle.fill", tint: PanelPalette.warning, text: model.offerError)
                        }
                        ForEach(model.offerBundles) { bundle in
                            bundleCard(bundle)
                        }
                        decisionButtons
                    }
                    .padding(16)
                }
            }
            .navigationTitle("New environment")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Not now") { model.decideEnvironment("ignore") }
                        .foregroundStyle(PanelPalette.textMuted)
                }
            }
        }
        .tint(PanelPalette.accent)
    }

    private var sourceCard: some View {
        PanelCard {
            HStack(spacing: 10) {
                Image(systemName: "mappin.and.ellipse")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(PanelPalette.accentHover)
                    .frame(width: 30, height: 30)
                    .background(Circle().fill(PanelPalette.accent.opacity(0.18)))
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.pendingOffer?.sourceName ?? model.pendingOffer?.environmentId ?? "")
                        .font(.headline)
                        .foregroundStyle(PanelPalette.textNormal)
                    Text("wants to load environment bundles into this session")
                        .font(.caption)
                        .foregroundStyle(PanelPalette.textMuted)
                }
            }
        }
    }

    private func bundleCard(_ bundle: EnvironmentBundlePreview) -> some View {
        PanelCard {
            VStack(alignment: .leading, spacing: 8) {
                Text(bundle.bundleId)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(PanelPalette.textNormal)
                if !bundle.valid, let error = bundle.errors.first {
                    PanelMessageView(systemImage: "exclamationmark.triangle.fill", tint: PanelPalette.danger, text: error.message)
                }
                ForEach(bundle.allFilePaths, id: \.self) { path in
                    if let content = bundle.content(for: path) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(path)
                                .font(.caption2.monospaced())
                                .foregroundStyle(PanelPalette.textMuted)
                            Text(content)
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundStyle(PanelPalette.textMuted)
                                .lineLimit(8)
                        }
                    }
                }
            }
        }
    }

    private var decisionButtons: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                CompactActionButton(title: "Allow this visit", systemImage: "checkmark", tint: PanelPalette.success, prominence: .filled, helpText: "") {
                    model.decideEnvironment("accept")
                }
                .disabled(model.offerBundles.contains(where: { !$0.valid }))
                CompactActionButton(title: "Always allow", systemImage: "checkmark.seal", tint: PanelPalette.info, prominence: .filled, helpText: "") {
                    model.decideEnvironment("approve")
                }
                .disabled(model.offerBundles.contains(where: { !$0.valid }))
            }
            HStack(spacing: 8) {
                CompactActionButton(title: "Not now", systemImage: "xmark", tint: PanelPalette.secondaryText, prominence: .subtle, helpText: "") {
                    model.decideEnvironment("ignore")
                }
                CompactActionButton(title: "Never", systemImage: "nosign", tint: PanelPalette.danger, prominence: .subtle, helpText: "") {
                    model.decideEnvironment("reject")
                }
                .disabled(model.offerBundles.contains(where: { !$0.valid }))
            }
        }
    }
}
