import RookKit
import SwiftUI

@main
struct RookApp: App {
    @StateObject private var model = RookModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView(model: model)
                .preferredColorScheme(.dark)
                .onOpenURL { url in
                    // Live Activity / Dynamic Island tap (rook://open) → chat.
                    if url.scheme == "rook" {
                        model.openChat()
                    }
                }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active {
                        model.handleBecameActive()
                    }
                }
        }
    }
}
