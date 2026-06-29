import Foundation
import RookKit
import SwiftUI

/// Native counterpart of the web client's EnvironmentApprovalModal: shows the
/// offered environment, previews the bundle files that would be injected, and
/// posts one of the four 2×2 decisions.
struct EnvironmentOfferDetail: View {
    @ObservedObject var model: RookMacModel
    @State private var selectedBundleId: String?
    @State private var selectedFilePath: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            DetailHeader(
                title: "Environment Offer",
                systemImage: "puzzlepiece.extension",
                trailing: model.pendingOffer?.environmentId ?? ""
            ) {
                model.dismissOfferView()
            }

            if let offer = model.pendingOffer {
                sourceCard(offer)
                bundlesCard
                decisionsCard
            } else {
                PanelCard {
                    Text("No pending environment offer.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, minHeight: 80, alignment: .center)
                }
            }
        }
        .onAppear { ensureSelection() }
        .onChange(of: model.offerBundles) { _, _ in ensureSelection() }
    }

    private func sourceCard(_ offer: EnvironmentOffer) -> some View {
        PanelCard {
            HStack(alignment: .top, spacing: 10) {
                StatusGlyph(systemImage: "puzzlepiece.extension.fill", tint: PanelPalette.warning, size: 28)
                VStack(alignment: .leading, spacing: 3) {
                    Text(offer.sourceName ?? offer.environmentId)
                        .font(.subheadline)
                        .fontWeight(.semibold)
                    Text("wants to load environment bundles into this agent session")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let url = offer.canonicalSourceUrl, !url.isEmpty {
                        Text(url)
                            .font(.caption2)
                            .foregroundStyle(PanelPalette.secondaryText)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }
            }
        }
    }

    private var selectedBundle: EnvironmentBundlePreview? {
        model.offerBundles.first { $0.id == selectedBundleId } ?? model.offerBundles.first
    }

    private var bundlesCard: some View {
        PanelCard {
            HStack(spacing: 8) {
                Label("Bundles", systemImage: "shippingbox")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                Spacer()
                if model.offerLoading {
                    ProgressView().scaleEffect(0.5)
                }
            }

            if !model.offerError.isEmpty {
                PanelMessageView(systemImage: "exclamationmark.triangle.fill", tint: PanelPalette.warning, text: model.offerError)
            }

            if model.offerBundles.isEmpty && !model.offerLoading {
                Text("No bundle files to preview.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if model.offerBundles.count > 1 {
                HStack(spacing: 6) {
                    ForEach(model.offerBundles) { bundle in
                        bundleChip(bundle)
                    }
                }
            }

            if let bundle = selectedBundle {
                if !bundle.valid, let error = bundle.errors.first {
                    PanelMessageView(systemImage: "exclamationmark.triangle.fill", tint: PanelPalette.danger, text: error.message)
                }
                filesList(bundle)
                if let path = selectedFilePath ?? bundle.allFilePaths.first,
                   let content = bundle.content(for: path) {
                    fileContent(path: path, content: content)
                }
            }
        }
    }

    private func bundleChip(_ bundle: EnvironmentBundlePreview) -> some View {
        let isSelected = bundle.id == selectedBundle?.id
        return Button {
            selectedBundleId = bundle.id
            selectedFilePath = bundle.allFilePaths.first
        } label: {
            Text(bundle.bundleId)
                .font(.caption)
                .fontWeight(.medium)
                .lineLimit(1)
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(Capsule().fill(Color.white.opacity(isSelected ? 0.20 : 0.09)))
                .overlay(Capsule().strokeBorder(.white.opacity(isSelected ? 0.30 : 0.14)))
        }
        .buttonStyle(.plain)
        .help("Preview \(bundle.bundleId)")
        .pointingHandOnHover()
    }

    private func filesList(_ bundle: EnvironmentBundlePreview) -> some View {
        VStack(spacing: 0) {
            ForEach(bundle.allFilePaths, id: \.self) { path in
                let isSelected = path == (selectedFilePath ?? bundle.allFilePaths.first)
                Button {
                    selectedFilePath = path
                } label: {
                    HStack(spacing: 7) {
                        Image(systemName: "doc.text")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(isSelected ? PanelPalette.info : PanelPalette.secondaryText)
                        Text(path)
                            .font(.caption.monospaced())
                            .foregroundStyle(isSelected ? .primary : .secondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Spacer(minLength: 0)
                    }
                    .padding(.vertical, 5)
                    .padding(.horizontal, 6)
                    .contentShape(Rectangle())
                    .background(
                        RoundedRectangle(cornerRadius: 5, style: .continuous)
                            .fill(isSelected ? Color.white.opacity(0.10) : Color.clear)
                    )
                }
                .buttonStyle(.plain)
                .pointingHandOnHover()
            }
        }
    }

    private func fileContent(path: String, content: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 6) {
                Image(systemName: "text.quote")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(PanelPalette.info)
                Text(path)
                    .font(.caption2.monospaced())
                    .fontWeight(.semibold)
                    .foregroundStyle(PanelPalette.secondaryText)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }

            ScrollView(.vertical) {
                Text(content)
                    .font(.system(size: 10.5, design: .monospaced))
                    .lineSpacing(2)
                    .foregroundStyle(.white.opacity(0.85))
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                    .padding(.trailing, 2)
            }
            .scrollIndicators(.visible)
            .frame(minHeight: 90, maxHeight: 190, alignment: .topLeading)
        }
        .padding(9)
        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(PanelPalette.backgroundPrimary))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(PanelPalette.border))
    }

    private var hasInvalidBundle: Bool {
        model.offerBundles.contains(where: { !$0.valid })
    }

    private var decisionsCard: some View {
        PanelCard {
            HStack(spacing: 8) {
                CompactActionButton(title: "Allow this visit", systemImage: "checkmark", tint: PanelPalette.success, prominence: .filled, helpText: "Load bundles for this visit only") {
                    model.decideEnvironment("accept")
                }
                .disabled(hasInvalidBundle)
                CompactActionButton(title: "Always allow", systemImage: "checkmark.seal", tint: PanelPalette.info, prominence: .filled, helpText: "Load bundles now and on every future visit") {
                    model.decideEnvironment("approve")
                }
                .disabled(hasInvalidBundle)
            }
            HStack(spacing: 8) {
                CompactActionButton(title: "Not now", systemImage: "xmark", tint: PanelPalette.secondaryText, prominence: .subtle, helpText: "Skip for this visit") {
                    model.decideEnvironment("ignore")
                }
                CompactActionButton(title: "Never", systemImage: "nosign", tint: PanelPalette.danger, prominence: .subtle, helpText: "Reject this environment permanently") {
                    model.decideEnvironment("reject")
                }
                .disabled(hasInvalidBundle)
            }
        }
    }

    private func ensureSelection() {
        if selectedBundle == nil {
            selectedBundleId = model.offerBundles.first?.id
        }
        if selectedFilePath == nil {
            selectedFilePath = selectedBundle?.allFilePaths.first
        }
    }
}
