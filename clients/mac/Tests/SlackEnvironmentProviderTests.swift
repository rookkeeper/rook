import XCTest
@testable import Rook
import RookKit

@MainActor
final class SlackEnvironmentProviderTests: XCTestCase {
    func testTitleContextParsesWorkspaceAndChannel() {
        XCTAssertEqual(
            SlackEnvironmentProvider.titleContext(from: "announcements (Channel) - NashDev - 1 new item - Slack"),
            SlackTitleContext(workspaceName: "NashDev", channelName: "announcements")
        )
    }

    func testCandidatesIncludeWorkspaceAndChannel() {
        let app = ForegroundApp(bundleId: "com.tinyspeck.slackmacgap", name: "Slack", pid: 1)
        let candidates = SlackEnvironmentProvider.candidates(for: app, title: "announcements (Channel) - NashDev - 1 new item - Slack")

        XCTAssertEqual(candidates.map(\.id), [
            "mac:com.tinyspeck.slackmacgap/NashDev",
            "mac:com.tinyspeck.slackmacgap/NashDev/announcements",
        ])
        XCTAssertEqual(candidates.last?.metadata["workspaceName"], .string("NashDev"))
        XCTAssertEqual(candidates.last?.metadata["channelName"], .string("announcements"))
    }

    func testProviderTracksCurrentEnvironmentIdOnActivateAndDeactivate() {
        let provider = SlackEnvironmentProvider(register: { _, _ in })
        let app = ForegroundApp(bundleId: "com.tinyspeck.slackmacgap", name: "Slack", pid: 1)

        provider.activate(app: app, title: "announcements (Channel) - NashDev - 1 new item - Slack")
        XCTAssertEqual(provider.currentAppEnvironmentId, "mac:com.tinyspeck.slackmacgap/NashDev/announcements")

        provider.deactivate()
        XCTAssertNil(provider.currentAppEnvironmentId)
    }
}
