import AppKit
import Foundation
import SwiftUI

/// Manages the main window and handles reopen events.
final class AppDelegate: NSObject, NSApplicationDelegate {
    var mainWindow: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let model = AgentStationModel.shared else { return }
        let contentView = AgentStationMenuView(model: model)
        let hostingController = NSHostingController(rootView: contentView)

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 460, height: 520),
            styleMask: [.titled, .closable, .resizable, .miniaturizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.contentViewController = hostingController
        window.title = "Agent Station"
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isReleasedWhenClosed = false
        window.setFrameAutosaveName("AgentStationMainWindow")
        window.center()
        window.makeKeyAndOrderFront(nil)

        mainWindow = window
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showMainWindow()
        return true
    }

    func showMainWindow() {
        mainWindow?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
}

@main
struct AgentStationMenuBarApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var model = AgentStationModel()

    var body: some Scene {
        MenuBarExtra {
            Button("Show Agent Station") {
                appDelegate.showMainWindow()
            }
            Divider()
            Button("Quit") {
                model.quitApp()
            }
            .keyboardShortcut("q")
        } label: {
            Image(systemName: model.menuBarSystemImage)
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(model.menuBarTint)
                .accessibilityLabel("Agent Station")
                .help(model.menuBarHelp)
        }
    }
}
