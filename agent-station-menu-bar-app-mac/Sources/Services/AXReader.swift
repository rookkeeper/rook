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

    /// Chromium/Electron render web content in a separate process whose
    /// accessibility tree is off by default, so reads only see the browser
    /// chrome (tabs/toolbar). Setting the Chromium-specific `AXManualAccessibility`
    /// attribute makes it build the web-content tree on demand. Harmless on
    /// non-Chromium apps (they reject the unknown attribute). The tree builds
    /// asynchronously, so the first read after enabling may still be sparse.
    private static func enableWebContentAccessibility(_ appElement: AXUIElement) {
        AXUIElementSetAttributeValue(appElement, "AXManualAccessibility" as CFString, kCFBooleanTrue)
    }

    /// Warm up an app's accessibility tree (call when it comes to the
    /// foreground) so content is ready by the time the agent reads it.
    static func primeAccessibility(pid: pid_t) {
        guard isTrusted() else {
            return
        }
        enableWebContentAccessibility(AXUIElementCreateApplication(pid))
    }

    /// Title of the focused (or main) window of the app owning `pid`, or nil if
    /// AX isn't trusted / the app exposes no titled window.
    static func focusedWindowTitle(pid: pid_t) -> String? {
        guard isTrusted() else {
            return nil
        }
        let appElement = AXUIElementCreateApplication(pid)
        enableWebContentAccessibility(appElement)
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

    /// The active tab's URL for a Chromium/WebKit browser owning `pid`, read from
    /// the focused window's AXWebArea (AXURL). Relies on the web-content tree, so
    /// the browser should have been primed (it comes forward → primeAccessibility).
    /// Returns nil for non-browsers or before the URL is exposed.
    static func activeTabURL(pid: pid_t, maxNodes: Int = 600) -> String? {
        guard isTrusted() else {
            return nil
        }
        let appElement = AXUIElementCreateApplication(pid)
        enableWebContentAccessibility(appElement)
        var windowRef: AnyObject?
        if AXUIElementCopyAttributeValue(appElement, kAXFocusedWindowAttribute as CFString, &windowRef) != .success {
            if AXUIElementCopyAttributeValue(appElement, kAXMainWindowAttribute as CFString, &windowRef) != .success {
                return nil
            }
        }
        guard let windowRef else {
            return nil
        }
        // Breadth-first: the web area sits near the top of the window subtree.
        var queue: [AXUIElement] = [windowRef as! AXUIElement]
        var budget = maxNodes
        while !queue.isEmpty, budget > 0 {
            let element = queue.removeFirst()
            budget -= 1
            if stringAttribute(element, kAXRoleAttribute as String) == "AXWebArea",
               let url = urlAttribute(element, "AXURL") {
                return url
            }
            var childrenRef: AnyObject?
            if AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &childrenRef) == .success,
               let children = childrenRef as? [AXUIElement] {
                queue.append(contentsOf: children)
            }
        }
        return nil
    }

    private static func urlAttribute(_ element: AXUIElement, _ attribute: String) -> String? {
        var value: AnyObject?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success, let value else {
            return nil
        }
        if let url = value as? NSURL {
            return url.absoluteString
        }
        return value as? String
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
        enableWebContentAccessibility(appElement)
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

    struct ActionableElement {
        let role: String
        let label: String
        let x: Int
        let y: Int
        let width: Int
        let height: Int
    }

    /// Actionable UI elements of the focused window with their on-screen frames,
    /// for the AX-driven control path: a text-only model (e.g. DeepSeek V4 Pro)
    /// reads this list and picks one to click — no screenshot/vision needed.
    /// Coordinates are global top-left screen space, matching CGEvent input.
    static func actionableElements(pid: pid_t, maxElements: Int = 250, maxNodes: Int = 8_000) -> [ActionableElement]? {
        guard isTrusted() else {
            return nil
        }
        let appElement = AXUIElementCreateApplication(pid)
        enableWebContentAccessibility(appElement)
        var windowRef: AnyObject?
        if AXUIElementCopyAttributeValue(appElement, kAXFocusedWindowAttribute as CFString, &windowRef) != .success {
            if AXUIElementCopyAttributeValue(appElement, kAXMainWindowAttribute as CFString, &windowRef) != .success {
                return nil
            }
        }
        guard let windowRef else {
            return nil
        }
        var elements: [ActionableElement] = []
        var nodeBudget = maxNodes
        collectActionable(windowRef as! AXUIElement, into: &elements, max: maxElements, nodeBudget: &nodeBudget)
        return elements
    }

    private static let actionableRoles: Set<String> = [
        "AXButton", "AXLink", "AXTextField", "AXTextArea", "AXCheckBox",
        "AXRadioButton", "AXMenuItem", "AXMenuButton", "AXPopUpButton",
        "AXTabButton", "AXTab", "AXComboBox", "AXSlider", "AXDisclosureTriangle",
    ]

    private static func supportsPress(_ element: AXUIElement) -> Bool {
        var actions: CFArray?
        guard AXUIElementCopyActionNames(element, &actions) == .success,
              let names = actions as? [String] else {
            return false
        }
        return names.contains(kAXPressAction as String)
    }

    private static func frame(of element: AXUIElement) -> CGRect? {
        var positionRef: AnyObject?
        var sizeRef: AnyObject?
        guard AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &positionRef) == .success,
              AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeRef) == .success else {
            return nil
        }
        var point = CGPoint.zero
        var size = CGSize.zero
        AXValueGetValue(positionRef as! AXValue, .cgPoint, &point)
        AXValueGetValue(sizeRef as! AXValue, .cgSize, &size)
        guard size.width > 1, size.height > 1 else {
            return nil
        }
        return CGRect(origin: point, size: size)
    }

    private static func collectActionable(
        _ element: AXUIElement,
        into elements: inout [ActionableElement],
        max: Int,
        nodeBudget: inout Int
    ) {
        guard nodeBudget > 0, elements.count < max else {
            return
        }
        nodeBudget -= 1

        let role = stringAttribute(element, kAXRoleAttribute as String) ?? ""
        if (actionableRoles.contains(role) || supportsPress(element)), let rect = frame(of: element) {
            let label = stringAttribute(element, kAXTitleAttribute as String)
                ?? stringAttribute(element, kAXDescriptionAttribute as String)
                ?? stringAttribute(element, kAXValueAttribute as String)
                ?? ""
            elements.append(ActionableElement(
                role: role,
                label: String(label.trimmingCharacters(in: .whitespacesAndNewlines).prefix(120)),
                x: Int(rect.origin.x),
                y: Int(rect.origin.y),
                width: Int(rect.size.width),
                height: Int(rect.size.height)
            ))
        }

        var childrenRef: AnyObject?
        guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &childrenRef) == .success,
              let children = childrenRef as? [AXUIElement] else {
            return
        }
        for child in children {
            collectActionable(child, into: &elements, max: max, nodeBudget: &nodeBudget)
        }
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
