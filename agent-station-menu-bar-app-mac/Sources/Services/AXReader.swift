import ApplicationServices
import Foundation

/// Tier 1 perception: reading another app's focused-window title needs the
/// Accessibility (AX) permission. App *identity* (NSWorkspace) does not — only
/// reading inside another process does.
enum AXReader {
    static func isTrusted(promptIfNeeded: Bool = false) -> Bool {
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        let options = [key: promptIfNeeded] as CFDictionary
        return AXIsProcessTrustedWithOptions(options)
    }

    /// Title of the focused (or main) window of the app owning `pid`, or nil if
    /// AX isn't trusted / the app exposes no titled window.
    static func focusedWindowTitle(pid: pid_t) -> String? {
        guard isTrusted() else {
            return nil
        }
        let appElement = AXUIElementCreateApplication(pid)
        var windowRef: AnyObject?
        if AXUIElementCopyAttributeValue(appElement, kAXFocusedWindowAttribute as CFString, &windowRef) != .success {
            if AXUIElementCopyAttributeValue(appElement, kAXMainWindowAttribute as CFString, &windowRef) != .success {
                return nil
            }
        }
        guard let windowRef else {
            return nil
        }
        let window = windowRef as! AXUIElement
        var titleRef: AnyObject?
        guard AXUIElementCopyAttributeValue(window, kAXTitleAttribute as CFString, &titleRef) == .success else {
            return nil
        }
        let title = titleRef as? String
        return (title?.isEmpty == false) ? title : nil
    }

    /// Visible text of the focused window, extracted by walking the
    /// Accessibility tree (value/title/description of each element). Gives the
    /// agent on-screen *content* — editor text, chat messages, labels — for
    /// text-based apps, using only the Accessibility grant (no screenshots).
    /// Node- and char-budgeted so a deep tree can't hang the caller.
    static func focusedWindowText(pid: pid_t, maxChars: Int = 12_000, maxNodes: Int = 6_000) -> String? {
        guard isTrusted() else {
            return nil
        }
        let appElement = AXUIElementCreateApplication(pid)
        var windowRef: AnyObject?
        if AXUIElementCopyAttributeValue(appElement, kAXFocusedWindowAttribute as CFString, &windowRef) != .success {
            if AXUIElementCopyAttributeValue(appElement, kAXMainWindowAttribute as CFString, &windowRef) != .success {
                return nil
            }
        }
        guard let windowRef else {
            return nil
        }
        var pieces: [String] = []
        var nodeBudget = maxNodes
        var charCount = 0
        collectText(windowRef as! AXUIElement, into: &pieces, nodeBudget: &nodeBudget, charCount: &charCount, maxChars: maxChars)
        let text = pieces.joined(separator: "\n")
        return text.isEmpty ? nil : text
    }

    private static func stringAttribute(_ element: AXUIElement, _ attribute: String) -> String? {
        var value: AnyObject?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else {
            return nil
        }
        return value as? String
    }

    private static func collectText(
        _ element: AXUIElement,
        into pieces: inout [String],
        nodeBudget: inout Int,
        charCount: inout Int,
        maxChars: Int
    ) {
        guard nodeBudget > 0, charCount < maxChars else {
            return
        }
        nodeBudget -= 1

        for attribute in [kAXValueAttribute, kAXTitleAttribute, kAXDescriptionAttribute] {
            guard let raw = stringAttribute(element, attribute as String) else {
                continue
            }
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            // Skip empties and consecutive duplicates (a label often repeats as
            // both title and value of nested elements).
            if trimmed.isEmpty || pieces.last == trimmed {
                continue
            }
            pieces.append(trimmed)
            charCount += trimmed.count
        }

        var childrenRef: AnyObject?
        guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &childrenRef) == .success,
              let children = childrenRef as? [AXUIElement] else {
            return
        }
        for child in children {
            collectText(child, into: &pieces, nodeBudget: &nodeBudget, charCount: &charCount, maxChars: maxChars)
        }
    }
}
