import Foundation
import RookKit
import SwiftUI

/// Native counterpart of the web client's EnvironmentApprovalModal: shows the
/// offered environment, previews the skill files that would be injected, and
/// posts one of the four 2×2 decisions.
struct EnvironmentOfferDetail: View {
    @ObservedObject var model: RookMacModel
    @State private var selectedSkillId: String?
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
                skillsCard
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
        .onAppear {
            ensureSelection()
        }
        .onChange(of: model.offerSkills) { _, _ in
            ensureSelection()
        }
    }

    private func sourceCard(_ offer: EnvironmentOffer) -> some View {
        PanelCard {
            HStack(alignment: .top, spacing: 10) {
                StatusGlyph(systemImage: "puzzlepiece.extension.fill", tint: PanelPalette.warning, size: 28)
                VStack(alignment: .leading, spacing: 3) {
                    Text(offer.sourceName ?? offer.environmentId)
                        .font(.subheadline)
                        .fontWeight(.semibold)
                    Text("wants to load skills into this agent session")
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

    private var selectedSkill: SkillPreview? {
        model.offerSkills.first { $0.id == selectedSkillId } ?? model.offerSkills.first
    }

    private var skillsCard: some View {
        PanelCard {
            HStack(spacing: 8) {
                Label("Skills", systemImage: "text.book.closed")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                Spacer()
                if model.offerLoading {
                    ProgressView()
                        .scaleEffect(0.5)
                }
            }

            if !model.offerError.isEmpty {
                PanelMessageView(
                    systemImage: "exclamationmark.triangle.fill",
                    tint: PanelPalette.warning,
                    text: model.offerError
                )
            }

            if model.offerSkills.isEmpty && !model.offerLoading {
                Text("No skill files to preview.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if model.offerSkills.count > 1 {
                HStack(spacing: 6) {
                    ForEach(model.offerSkills) { skill in
                        skillChip(skill)
                    }
                }
            }

            if let skill = selectedSkill {
                filesList(skill)
                if let path = selectedFilePath ?? skill.sortedFilePaths.first,
                   let content = skill.files[path] {
                    fileContent(path: path, content: content)
                }
            }
        }
    }

    private func skillChip(_ skill: SkillPreview) -> some View {
        let isSelected = skill.id == selectedSkill?.id
        return Button {
            selectedSkillId = skill.id
            selectedFilePath = skill.sortedFilePaths.first
        } label: {
            Text(skill.name)
                .font(.caption)
                .fontWeight(.medium)
                .lineLimit(1)
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(
                    Capsule()
                        .fill(Color.white.opacity(isSelected ? 0.20 : 0.09))
                )
                .overlay(
                    Capsule()
                        .strokeBorder(.white.opacity(isSelected ? 0.30 : 0.14))
                )
        }
        .buttonStyle(.plain)
        .help("Preview \(skill.name)")
        .pointingHandOnHover()
    }

    private func filesList(_ skill: SkillPreview) -> some View {
        VStack(spacing: 0) {
            ForEach(skill.sortedFilePaths, id: \.self) { path in
                let isSelected = path == (selectedFilePath ?? skill.sortedFilePaths.first)
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
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(PanelPalette.backgroundPrimary)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(PanelPalette.border)
        )
    }

    private var decisionsCard: some View {
        PanelCard {
            HStack(spacing: 8) {
                CompactActionButton(
                    title: "Allow this visit",
                    systemImage: "checkmark",
                    tint: PanelPalette.success,
                    prominence: .filled,
                    helpText: "Load skills for this visit only"
                ) {
                    model.decideEnvironment("accept")
                }
                CompactActionButton(
                    title: "Always allow",
                    systemImage: "checkmark.seal",
                    tint: PanelPalette.info,
                    prominence: .filled,
                    helpText: "Load skills now and on every future visit"
                ) {
                    model.decideEnvironment("approve")
                }
            }
            HStack(spacing: 8) {
                CompactActionButton(
                    title: "Not now",
                    systemImage: "xmark",
                    tint: PanelPalette.secondaryText,
                    prominence: .subtle,
                    helpText: "Skip for this visit"
                ) {
                    model.decideEnvironment("ignore")
                }
                CompactActionButton(
                    title: "Never",
                    systemImage: "nosign",
                    tint: PanelPalette.danger,
                    prominence: .subtle,
                    helpText: "Reject this environment permanently"
                ) {
                    model.decideEnvironment("reject")
                }
            }
        }
    }

    private func ensureSelection() {
        if selectedSkill == nil {
            selectedSkillId = model.offerSkills.first?.id
        }
        if selectedFilePath == nil {
            selectedFilePath = selectedSkill?.sortedFilePaths.first
        }
    }
}
