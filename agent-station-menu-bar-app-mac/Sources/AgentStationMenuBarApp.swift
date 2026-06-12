import AppKit
import Foundation
import SwiftUI

/// Re-running `open` on the app (or launching it from Finder/Spotlight while
/// it's already running) reopens the panel window when window mode is on.
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if UserDefaults.standard.bool(forKey: "ShowPanelWindow") {
            Task { @MainActor in
                AgentStationModel.shared?.openPanelWindow()
            }
        }
        return true
    }
}

@main
struct AgentStationMenuBarApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var model = AgentStationModel()

    var body: some Scene {
        MenuBarExtra {
            AgentStationMenuView(model: model)
        } label: {
            Image(systemName: model.menuBarSystemImage)
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(model.menuBarTint)
                .accessibilityLabel("Agent Station")
                .help(model.menuBarHelp)
        }
        .menuBarExtraStyle(.window)
    }
}
