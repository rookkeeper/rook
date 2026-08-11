import AppKit
import ApplicationServices
import Foundation
import OSLog
import RookKit

/// Tier 1 perception: reading another app's focused-window title needs the
/// Accessibility (AX) permission. App *identity* (NSWorkspace) does not — only
/// reading inside another process does.
enum AXReader {
    private static let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.rookkeeper.Rook", category: "AXReader")
    private static let messagingTimeout: Float = 0.5
    private static let activeTabTraversalDeadlineNanoseconds: UInt64 = 2_000_000_000
    private static let slowCallThresholdMilliseconds = 100.0

    private struct DiagnosticsContext {
        let pid: pid_t
        let bundleId: String

        init(pid: pid_t) {
            self.pid = pid
            self.bundleId = NSRunningApplication(processIdentifier: pid)?.bundleIdentifier ?? "unknown"
        }
    }

    static func isTrusted(promptIfNeeded: Bool = false) -> Bool {
        MacStallWatchdog.shared.beginOperation("AXReader.isTrusted")
        defer { MacStallWatchdog.shared.endOperation("AXReader.isTrusted") }
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        let options = [key: promptIfNeeded] as CFDictionary
        let trusted = AXIsProcessTrustedWithOptions(options)
        MacStallWatchdog.shared.updateContext(["accessibilityTrusted": String(trusted)])
        return trusted
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

    /// Title of the focused (or main) window of the app owning `pid`, or nil if
    /// AX isn't trusted / the app exposes no titled window.
    static func focusedWindowTitle(pid: pid_t) -> String? {
        MacStallWatchdog.shared.beginOperation("AXReader.focusedWindowTitle")
        defer { MacStallWatchdog.shared.endOperation("AXReader.focusedWindowTitle") }
        MacStallWatchdog.shared.updateContext(["accessibilityTargetPid": String(pid)])
        return RookPerformance.measure(
            "AXFocusedWindowTitle",
            operation: "ax-focused-window-title",
            description: "pid=\(pid)",
            logger: RookLog.environment,
            signposter: RookLog.environmentSignposter,
            slowThresholdMs: 100,
            hangThresholdMs: 500,
            details: { (title: String?) in
                if let title {
                    return "titleChars=\(title.count)"
                }
                return "title=nil"
            }
        ) {
            guard let window = focusedWindow(pid: pid) else {
                return nil
            }
            let context = DiagnosticsContext(pid: pid)
            let (error, titleRef) = copyAttributeValue(
                window,
                attribute: kAXTitleAttribute as String,
                context: context,
                operation: "focused-window-title"
            )
            guard error == .success else {
                return nil
            }
            let title = titleRef as? String
            return (title?.isEmpty == false) ? title : nil
        }
    }

    /// Top-level window document-like values exposed via standard AX attributes
    /// such as AXDocument / AXFilename / AXURL.
    static func focusedWindowDocumentValues(pid: pid_t) -> [String] {
        MacStallWatchdog.shared.beginOperation("AXReader.focusedWindowDocumentValues")
        defer { MacStallWatchdog.shared.endOperation("AXReader.focusedWindowDocumentValues") }
        MacStallWatchdog.shared.updateContext(["accessibilityTargetPid": String(pid)])
        return RookPerformance.measure(
            "AXFocusedWindowDocuments",
            operation: "ax-focused-window-documents",
            description: "pid=\(pid)",
            logger: RookLog.environment,
            signposter: RookLog.environmentSignposter,
            slowThresholdMs: 100,
            hangThresholdMs: 500,
            details: { (values: [String]) in "values=\(values.count)" }
        ) {
            guard let window = focusedWindow(pid: pid) else {
                return []
            }
            let context = DiagnosticsContext(pid: pid)
            let attributes = ["AXDocument", "AXFilename", "AXURL"]
            var results: [String] = []
            for attribute in attributes {
                let (error, valueRef) = copyAttributeValue(
                    window,
                    attribute: attribute,
                    context: context,
                    operation: "focused-window-document.\(attribute)"
                )
                guard error == .success, let value = valueRef as? String else {
                    continue
                }
                let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty, !results.contains(trimmed) {
                    results.append(trimmed)
                }
            }
            return results
        }
    }

    private static func focusedWindow(pid: pid_t) -> AXUIElement? {
        guard !isInternalRookTarget(pid), isTrusted() else {
            return nil
        }
        let context = DiagnosticsContext(pid: pid)
        let appElement = AXUIElementCreateApplication(pid)
        var windowRef: AnyObject?
        let (focusedError, focusedWindowRef) = copyAttributeValue(
            appElement,
            attribute: kAXFocusedWindowAttribute as String,
            context: context,
            operation: "focused-window"
        )
        if focusedError == .success {
            windowRef = focusedWindowRef
        } else {
            let (mainError, mainWindowRef) = copyAttributeValue(
                appElement,
                attribute: kAXMainWindowAttribute as String,
                context: context,
                operation: "main-window"
            )
            guard mainError == .success else {
                return nil
            }
            windowRef = mainWindowRef
        }
        guard let windowRef else {
            return nil
        }
        return windowRef as! AXUIElement
    }

    /// The active tab's URL for a known browser owning `pid`, read from the
    /// focused window's AXWebArea (AXURL). Callers must restrict this to browser
    /// bundle IDs; walking an arbitrary app's AX tree can block for a long time.
    /// Returns nil when the browser does not expose a focused web area or URL.
    static func activeTabURL(pid: pid_t, maxNodes: Int = 600) -> String? {
        MacStallWatchdog.shared.beginOperation("AXReader.activeTabURL")
        defer { MacStallWatchdog.shared.endOperation("AXReader.activeTabURL") }
        MacStallWatchdog.shared.updateContext(["accessibilityTargetPid": String(pid)])
        return RookPerformance.measure(
            "AXActiveTabURL",
            operation: "ax-active-tab-url",
            description: "pid=\(pid) maxNodes=\(maxNodes)",
            logger: RookLog.environment,
            signposter: RookLog.environmentSignposter,
            slowThresholdMs: 150,
            hangThresholdMs: 600,
            details: { (url: String?) in url == nil ? "url=nil" : "url=resolved" }
        ) {
            guard let window = focusedWindow(pid: pid) else {
                return nil
            }
            let context = DiagnosticsContext(pid: pid)
            let deadline = DispatchTime.now().uptimeNanoseconds + activeTabTraversalDeadlineNanoseconds
            // Breadth-first: the web area sits near the top of the window subtree.
            var queue: [AXUIElement] = [window]
            var nodesVisited = 0
            while !queue.isEmpty,
                  nodesVisited < maxNodes,
                  DispatchTime.now().uptimeNanoseconds < deadline {
                let element = queue.removeFirst()
                nodesVisited += 1
                let (roleError, roleRef) = copyAttributeValue(
                    element,
                    attribute: kAXRoleAttribute as String,
                    context: context,
                    operation: "active-tab-url.role",
                    nodeCount: nodesVisited
                )
                if roleError == .success,
                   roleRef as? String == "AXWebArea" {
                    let (urlError, urlRef) = copyAttributeValue(
                        element,
                        attribute: "AXURL",
                        context: context,
                        operation: "active-tab-url.url",
                        nodeCount: nodesVisited
                    )
                    if urlError == .success {
                        if let url = urlRef as? NSURL {
                            return url.absoluteString
                        }
                        if let url = urlRef as? String {
                            return url
                        }
                    }
                }
                let (childrenError, childrenRef) = copyAttributeValue(
                    element,
                    attribute: kAXChildrenAttribute as String,
                    context: context,
                    operation: "active-tab-url.children",
                    nodeCount: nodesVisited
                )
                if childrenError == .success,
                   let children = childrenRef as? [AXUIElement] {
                    queue.append(contentsOf: children)
                }
            }
            if DispatchTime.now().uptimeNanoseconds >= deadline {
                logger.warning("AX traversal deadline reached operation=active-tab-url pid=\(context.pid, privacy: .public) bundleId=\(context.bundleId, privacy: .public) nodes=\(nodesVisited, privacy: .public)")
            }
            return nil
        }
    }

    /// Visible text of the focused window, extracted by walking the
    /// Accessibility tree (value/title/description of each element). Gives the
    /// agent on-screen *content* — editor text, chat messages, labels — for
    /// text-based apps, using only the Accessibility grant (no screenshots).
    /// Node- and char-budgeted so a deep tree can't hang the caller.
    static func focusedWindowText(pid: pid_t, maxChars: Int = 12_000, maxNodes: Int = 6_000) -> String? {
        MacStallWatchdog.shared.beginOperation("AXReader.focusedWindowText")
        defer { MacStallWatchdog.shared.endOperation("AXReader.focusedWindowText") }
        MacStallWatchdog.shared.updateContext(["accessibilityTargetPid": String(pid)])
        return RookPerformance.measure(
            "AXFocusedWindowText",
            operation: "ax-focused-window-text",
            description: "pid=\(pid) maxChars=\(maxChars) maxNodes=\(maxNodes)",
            logger: RookLog.environment,
            signposter: RookLog.environmentSignposter,
            slowThresholdMs: 200,
            hangThresholdMs: 750,
            details: { (text: String?) in "textChars=\(text?.count ?? 0)" }
        ) {
            guard !isInternalRookTarget(pid), isTrusted() else {
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
        MacStallWatchdog.shared.beginOperation("AXReader.actionableElements")
        defer { MacStallWatchdog.shared.endOperation("AXReader.actionableElements") }
        MacStallWatchdog.shared.updateContext(["accessibilityTargetPid": String(pid)])
        return RookPerformance.measure(
            "AXActionableElements",
            operation: "ax-actionable-elements",
            description: "pid=\(pid) maxElements=\(maxElements) maxNodes=\(maxNodes)",
            logger: RookLog.environment,
            signposter: RookLog.environmentSignposter,
            slowThresholdMs: 200,
            hangThresholdMs: 750,
            details: { (elements: [ActionableElement]?) in "elements=\(elements?.count ?? 0)" }
        ) {
            guard !isInternalRookTarget(pid), isTrusted() else {
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

    private static func isInternalRookTarget(_ pid: pid_t) -> Bool {
        guard let bundleId = NSRunningApplication(processIdentifier: pid)?.bundleIdentifier else {
            return false
        }
        return RookBundleIdentity.isInternalRookBundleId(bundleId)
    }

    private static func copyAttributeValue(
        _ element: AXUIElement,
        attribute: String,
        context: DiagnosticsContext,
        operation: String,
        nodeCount: Int = 0
    ) -> (AXError, AnyObject?) {
        AXUIElementSetMessagingTimeout(element, messagingTimeout)
        var value: AnyObject?
        let started = DispatchTime.now().uptimeNanoseconds
        let error = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
        let elapsedMilliseconds = Double(DispatchTime.now().uptimeNanoseconds - started) / 1_000_000
        if elapsedMilliseconds >= slowCallThresholdMilliseconds {
            logger.warning("slow AX call operation=\(operation, privacy: .public) pid=\(context.pid, privacy: .public) bundleId=\(context.bundleId, privacy: .public) elapsedMs=\(elapsedMilliseconds, privacy: .public) result=\(error.rawValue, privacy: .public) nodes=\(nodeCount, privacy: .public)")
        }
        return (error, value)
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
