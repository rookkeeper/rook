import AppKit
import SwiftUI

enum PanelPalette {
    static let success = Color(red: 0.24, green: 0.92, blue: 0.38)
    static let warning = Color(red: 1.0, green: 0.62, blue: 0.16)
    static let danger = Color(red: 1.0, green: 0.35, blue: 0.36)
    static let info = Color(red: 0.28, green: 0.62, blue: 1.0)
    static let secondaryText = Color.white.opacity(0.70)
}

struct PanelBackground: View {
    var body: some View {
        ZStack {
            Color.black.opacity(0.72)
            Rectangle()
                .fill(.ultraThinMaterial)
            Color.black.opacity(0.30)
        }
    }
}

struct PanelCard<Content: View>: View {
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            content
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Color.white.opacity(0.10))
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(.thinMaterial)
                )
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(.white.opacity(0.18))
        )
    }
}

struct StatusGlyph: View {
    var systemImage: String
    var tint: Color
    var size: CGFloat = 38

    var body: some View {
        Image(systemName: systemImage)
            .font(.system(size: size * 0.52, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(
                Circle()
                    .fill(tint.gradient)
            )
    }
}

struct StatusDot: View {
    var tint: Color

    var body: some View {
        Circle()
            .fill(tint)
            .frame(width: 7, height: 7)
    }
}

enum CompactButtonProminence {
    case filled
    case subtle
}

struct CompactActionButton: View {
    @Environment(\.isEnabled) private var isEnabled
    @State private var isHovering = false

    var title: String
    var systemImage: String
    var tint: Color
    var prominence: CompactButtonProminence
    var helpText: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: systemImage)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(prominence == .filled ? .white : tint)
                    .frame(width: 24, height: 24)
                    .background(
                        Circle()
                            .fill(prominence == .filled ? tint.gradient : tint.opacity(0.16).gradient)
                    )

                Text(title)
                    .font(.callout)
                    .fontWeight(.semibold)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, minHeight: 42)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(buttonFill)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .strokeBorder(buttonStroke)
            )
            .opacity(isEnabled ? 1 : 0.45)
        }
        .buttonStyle(.plain)
        .help(helpText)
        .onHover { isHovering = $0 }
        .pointingHandOnHover()
    }

    private var buttonFill: Color {
        if prominence == .filled {
            return tint.opacity(isHovering && isEnabled ? 0.24 : 0.14)
        }
        return Color.black.opacity(isHovering && isEnabled ? 0.18 : 0.08)
    }

    private var buttonStroke: Color {
        if prominence == .filled {
            return tint.opacity(isHovering && isEnabled ? 0.44 : 0.28)
        }
        return .white.opacity(isHovering && isEnabled ? 0.24 : 0.12)
    }
}

struct FooterIconButton: View {
    @Environment(\.isEnabled) private var isEnabled
    @State private var isHovering = false

    var title: String
    var systemImage: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.primary)
                .frame(width: 34, height: 30)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(Color.black.opacity(isHovering && isEnabled ? 0.20 : 0.10))
                        .background(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .fill(.thinMaterial)
                        )
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .strokeBorder(.white.opacity(isHovering && isEnabled ? 0.30 : 0.16))
                )
                .opacity(isEnabled ? 1 : 0.45)
        }
        .buttonStyle(.plain)
        .help(title)
        .onHover { isHovering = $0 }
        .pointingHandOnHover()
    }
}

struct PanelMessageView: View {
    var systemImage: String
    var tint: Color
    var text: String

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: systemImage)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 18)
            Text(text)
                .font(.caption)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
                .lineLimit(5)
        }
    }
}

struct HoverRowBackground: ViewModifier {
    @State private var isHovering = false

    func body(content: Content) -> some View {
        content
            .background(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(isHovering ? Color.white.opacity(0.08) : Color.clear)
            )
            .onHover { isHovering = $0 }
    }
}

extension View {
    func hoverRowBackground() -> some View {
        modifier(HoverRowBackground())
    }
}

struct PointingHandOnHover: ViewModifier {
    @State private var isHovering = false

    func body(content: Content) -> some View {
        content
            .onHover { hovering in
                if hovering && !isHovering {
                    NSCursor.pointingHand.push()
                } else if !hovering && isHovering {
                    NSCursor.pop()
                }
                isHovering = hovering
            }
            .onDisappear {
                if isHovering {
                    NSCursor.pop()
                    isHovering = false
                }
            }
    }
}

extension View {
    func pointingHandOnHover() -> some View {
        modifier(PointingHandOnHover())
    }
}

/// Inline-markdown text helper for streamed agent output. Block-level
/// markdown is rendered as styled plain text per paragraph, which keeps
/// streaming cheap and never drops content.
func inlineMarkdown(_ text: String) -> AttributedString {
    var options = AttributedString.MarkdownParsingOptions()
    options.interpretedSyntax = .inlineOnlyPreservingWhitespace
    return (try? AttributedString(markdown: text, options: options)) ?? AttributedString(text)
}
