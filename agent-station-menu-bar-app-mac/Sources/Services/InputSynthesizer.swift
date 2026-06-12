import AppKit
import CoreGraphics
import Foundation

/// Tier 4 hands: synthesize mouse/keyboard input via CGEvent. Posting events
/// needs the Accessibility grant (which the app already requests). Coordinates
/// are global top-left screen space, matching AXReader element frames.
enum InputSynthesizer {
    /// Clamp a point into the union of all screen frames so a mis-grounded
    /// coordinate can't fling the cursor somewhere unrecoverable.
    private static func clamp(_ point: CGPoint) -> CGPoint {
        let bounds = NSScreen.screens.reduce(CGRect.null) { $0.union($1.frame) }
        guard !bounds.isNull else {
            return point
        }
        // NSScreen frames are bottom-left origin; CGEvent is top-left. Width is
        // the same; clamp X directly and clamp Y to total height.
        let maxX = bounds.maxX
        let totalHeight = bounds.height
        return CGPoint(
            x: min(max(point.x, bounds.minX), maxX),
            y: min(max(point.y, 0), totalHeight)
        )
    }

    static func move(to point: CGPoint) {
        let p = clamp(point)
        CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left)?
            .post(tap: .cghidEventTap)
    }

    static func click(at point: CGPoint, double: Bool = false) {
        let p = clamp(point)
        func tap(_ clickState: Int64) {
            let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: p, mouseButton: .left)
            let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: p, mouseButton: .left)
            down?.setIntegerValueField(.mouseEventClickState, value: clickState)
            up?.setIntegerValueField(.mouseEventClickState, value: clickState)
            down?.post(tap: .cghidEventTap)
            up?.post(tap: .cghidEventTap)
        }
        tap(1)
        if double {
            tap(2)
        }
    }

    static func type(_ text: String) {
        for scalar in text.unicodeScalars {
            var unit = UniChar(scalar.value > 0xFFFF ? 0x20 : scalar.value)
            for keyDown in [true, false] {
                guard let event = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: keyDown) else {
                    continue
                }
                event.keyboardSetUnicodeString(stringLength: 1, unicodeString: &unit)
                event.post(tap: .cghidEventTap)
            }
        }
    }

    private static let keyCodes: [String: CGKeyCode] = [
        "return": 36, "enter": 36, "tab": 48, "space": 49, "delete": 51,
        "escape": 53, "esc": 53, "left": 123, "right": 124, "down": 125, "up": 126,
        "home": 115, "end": 119, "pageup": 116, "pagedown": 121, "forwarddelete": 117,
    ]

    private static func flags(for modifiers: [String]) -> CGEventFlags {
        var flags: CGEventFlags = []
        for modifier in modifiers.map({ $0.lowercased() }) {
            switch modifier {
            case "cmd", "command": flags.insert(.maskCommand)
            case "shift": flags.insert(.maskShift)
            case "option", "alt": flags.insert(.maskAlternate)
            case "control", "ctrl": flags.insert(.maskControl)
            default: break
            }
        }
        return flags
    }

    /// Press a named key (e.g. "return", "escape") with optional modifiers.
    static func key(_ name: String, modifiers: [String] = []) -> Bool {
        guard let code = keyCodes[name.lowercased()] else {
            return false
        }
        let eventFlags = flags(for: modifiers)
        for keyDown in [true, false] {
            guard let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: keyDown) else {
                return false
            }
            event.flags = eventFlags
            event.post(tap: .cghidEventTap)
        }
        return true
    }
}
