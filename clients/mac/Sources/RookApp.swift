import AppKit
import Foundation
import SwiftUI

/// Manages the main window and handles reopen events.
final class AppDelegate: NSObject, NSApplicationDelegate {
    var mainWindow: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        if let icon = NSImage(named: "AppBrand") {
            NSApp.applicationIconImage = icon
        }
        guard let model = RookMacModel.shared else { return }
        let contentView = RookView(model: model)
        let hostingController = NSHostingController(rootView: contentView)

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 460, height: 520),
            styleMask: [.titled, .closable, .resizable, .miniaturizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.contentViewController = hostingController
        window.title = "Rook"
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isReleasedWhenClosed = false
        window.setFrameAutosaveName("RookMainWindow")
        if !window.setFrameUsingName("RookMainWindow") {
            window.center()
        }
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
struct RookApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var model = RookMacModel()

    var body: some Scene {
        MenuBarExtra {
            Button("Show Rook") {
                appDelegate.showMainWindow()
            }
            Divider()
            Button("Quit") {
                model.quitApp()
            }
            .keyboardShortcut("q")
        } label: {
            Image("MenuBarIcon")
                .renderingMode(.original)
                .resizable()
                .scaledToFit()
                .frame(width: 16, height: 16)
                .accessibilityLabel("Rook")
                .help(model.menuBarHelp)
        }
    }
}
