import Foundation
import RookKit
import SwiftUI

/// Shows the offered bundle's actual content — `AGENTS.md`, `llms.txt`, each
/// skill's `SKILL.md`, MCP/app config files, and any repository read errors —
/// so the user reviews what will be loaded into the agent before deciding.
/// Approving remote instructions by capability name alone is a prompt-injection
/// surface, so this card sits between the summary and the decision buttons.
///
/// The offer panel is rendered twice (once hidden for height measurement), so
/// section expansion lives on the model rather than in view `@State`; both
/// copies then agree on the panel height.
///
/// The panel sizes itself to its content (`fixedSize(vertical:)`), so this card
/// bounds its own height: the sections stack scrolls as a whole once it passes
/// `contentMaxHeight`, and each expanded section scrolls internally past
/// `sectionMaxHeight`. Otherwise a bundle with content plus issues could push
/// the decision buttons below the bottom of a laptop screen.
struct BundleContentPreviewCard: View {
    @ObservedObject var model: RookMacModel
    let offer: EnvironmentOffer

    private static let issuesSectionId = "issues"
    /// Per-section cap. Sized so one expanded section plus the Issues section
    /// both fit inside `contentMaxHeight` before the outer scroll kicks in.
    private static let sectionMaxHeight: CGFloat = 180
    /// Cap on the whole sections stack (headers included).
    private static let contentMaxHeight: CGFloat = 360

    var body: some View {
        PanelCard {
            VStack(alignment: .leading, spacing: 8) {
                header
                if let bundle = model.offerPreviewBundle {
                    bundleContent(bundle)
                } else if model.offerLoading {
                    loadingRow
                } else if !model.offerPreviewError.isEmpty {
                    failureRow
                } else {
                    Text("Content unavailable for this bundle.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    // MARK: - Header and states

    private var header: some View {
        VStack(alignment: .leading, spacing: 3) {
            Label("Bundle content", systemImage: "doc.text.magnifyingglass")
                .font(.subheadline)
                .fontWeight(.semibold)
            Text(sourceLine)
                .font(.caption2.monospaced())
                .foregroundStyle(PanelPalette.secondaryText)
                .lineLimit(1)
                .truncationMode(.middle)
            Text("Review before approving — this content will be loaded into your agent.")
                .font(.caption)
                .foregroundStyle(PanelPalette.warning)
        }
    }

    private var sourceLine: String {
        if let repository = model.offerPreviewBundle?.repository {
            return "Source: \(repository) · \(offer.environmentId)"
        }
        return "Source: \(offer.environmentId)"
    }

    private var loadingRow: some View {
        HStack(spacing: 8) {
            ProgressView()
                .controlSize(.small)
            Text("Loading bundle content…")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var failureRow: some View {
        HStack(alignment: .top, spacing: 8) {
            Text("Could not load bundle content: \(model.offerPreviewError)")
                .font(.caption)
                .foregroundStyle(PanelPalette.danger)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button("Retry") {
                model.reloadOfferPreview()
            }
            .controlSize(.small)
        }
    }

    // MARK: - Sections

    private struct ContentSection: Identifiable {
        let id: String
        let title: String
        let systemImage: String
        let content: String
    }

    @ViewBuilder
    private func bundleContent(_ bundle: EnvironmentBundlePreview) -> some View {
        let sections = contentSections(bundle)
        if sections.isEmpty && bundle.errors.isEmpty {
            Text("This bundle has no reviewable text content.")
                .font(.caption)
                .foregroundStyle(.secondary)
        } else {
            // `frame(maxHeight:)` on a ScrollView hugs short content and caps
            // tall content, so a small bundle leaves no empty space in the card.
            ScrollView(.vertical) {
                sectionsStack(sections, errors: bundle.errors)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: Self.contentMaxHeight)
        }
    }

    private func sectionsStack(_ sections: [ContentSection], errors: [RepositoryReadError]) -> some View {
        let firstNonEmptyId = sections.first?.id
        return VStack(alignment: .leading, spacing: 6) {
            ForEach(sections) { section in
                DisclosureGroup(isExpanded: expansionBinding(section.id, defaultExpanded: section.id == firstNonEmptyId)) {
                    contentBody(section.content)
                } label: {
                    Label(section.title, systemImage: section.systemImage)
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundStyle(PanelPalette.secondaryText)
                }
            }
            if !errors.isEmpty {
                DisclosureGroup(isExpanded: expansionBinding(Self.issuesSectionId, defaultExpanded: true)) {
                    issuesBody(errors)
                } label: {
                    Label("Issues (\(errors.count))", systemImage: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundStyle(PanelPalette.warning)
                }
            }
        }
    }

    private func contentSections(_ bundle: EnvironmentBundlePreview) -> [ContentSection] {
        var sections: [ContentSection] = []
        if let agentsMd = bundle.agentsMd, !agentsMd.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            sections.append(ContentSection(id: "agents-md", title: "AGENTS.md", systemImage: "doc.text", content: agentsMd))
        }
        if let llmsTxt = bundle.llmsTxt, !llmsTxt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            sections.append(ContentSection(id: "llms-txt", title: "llms.txt", systemImage: "doc.plaintext", content: llmsTxt))
        }
        for skill in bundle.skillMarkdown {
            sections.append(ContentSection(id: "skill:\(skill.id)", title: "Skill: \(skill.id)", systemImage: "wand.and.stars", content: skill.content))
        }
        for server in bundle.mcpServers where !server.files.isEmpty {
            sections.append(ContentSection(id: "mcp:\(server.id)", title: "MCP: \(server.id)", systemImage: "server.rack", content: joinedFiles(server)))
        }
        for app in bundle.apps where !app.files.isEmpty {
            sections.append(ContentSection(id: "app:\(app.id)", title: "App: \(app.id)", systemImage: "app.connected.to.app.below.fill", content: joinedFiles(app)))
        }
        return sections
    }

    private func joinedFiles(_ artifact: EnvironmentArtifactPreview) -> String {
        artifact.sortedFilePaths
            .map { path in "--- \(path) ---\n\(artifact.files[path] ?? "")" }
            .joined(separator: "\n\n")
    }

    private func expansionBinding(_ id: String, defaultExpanded: Bool) -> Binding<Bool> {
        Binding(
            get: { model.offerSectionExpansion[id] ?? defaultExpanded },
            set: { model.setOfferSection(id, expanded: $0) }
        )
    }

    private func contentBody(_ content: String) -> some View {
        ScrollView(.vertical) {
            Text(content)
                .font(.caption.monospaced())
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(8)
        }
        .frame(maxHeight: Self.sectionMaxHeight)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(PanelPalette.backgroundPrimary.opacity(0.75))
        )
    }

    private func issuesBody(_ errors: [RepositoryReadError]) -> some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(errors) { error in
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(error.code): \(error.message)")
                            .font(.caption)
                            .foregroundStyle(PanelPalette.warning)
                        if let location = error.url ?? error.path {
                            Text(location)
                                .font(.caption2.monospaced())
                                .foregroundStyle(PanelPalette.secondaryText)
                                .lineLimit(2)
                                .truncationMode(.middle)
                        }
                    }
                    .textSelection(.enabled)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(8)
        }
        .frame(maxHeight: Self.sectionMaxHeight)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(PanelPalette.warning.opacity(0.10))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(PanelPalette.warning.opacity(0.35))
        )
    }
}
