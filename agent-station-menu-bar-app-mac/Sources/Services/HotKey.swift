import AppKit
import Foundation

/// Global push-to-talk hotkey (default ⌃⌥Space). Uses NSEvent monitors — the
/// global monitor needs the Accessibility grant the app already requests; the
/// local monitor covers the case where our own panel has focus.
@MainActor
final class HotKey {
    var onTrigger: (() -> Void)?

    private var globalMonitor: Any?
    private var localMonitor: Any?
    private let keyCode: UInt16
    private let modifiers: NSEvent.ModifierFlags

    /// keyCode 49 = space.
    init(keyCode: UInt16 = 49, modifiers: NSEvent.ModifierFlags = [.control, .option]) {
        self.keyCode = keyCode
        self.modifiers = modifiers
    }

    func start() {
        guard globalMonitor == nil else {
            return
        }
        globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
            self?.handle(event)
        }
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            if self?.matches(event) == true {
                self?.onTrigger?()
                return nil
            }
            return event
        }
    }

    func stop() {
        [globalMonitor, localMonitor].forEach { monitor in
            if let monitor {
                NSEvent.removeMonitor(monitor)
            }
        }
        globalMonitor = nil
        localMonitor = nil
    }

    private func handle(_ event: NSEvent) {
        if matches(event) {
            onTrigger?()
        }
    }

    private func matches(_ event: NSEvent) -> Bool {
        let relevant: NSEvent.ModifierFlags = [.command, .option, .control, .shift]
        return event.keyCode == keyCode && event.modifierFlags.intersection(relevant) == modifiers
    }
}
