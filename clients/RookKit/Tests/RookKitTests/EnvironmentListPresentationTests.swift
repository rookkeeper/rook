import XCTest
@testable import RookKit

@MainActor
final class EnvironmentListPresentationTests: XCTestCase {
    func testApplyReplacesItems() {
        var current: [EnvironmentListItem] = []
        let refreshed = [
            EnvironmentListItem(
                environmentId: "web:github.com/the-rooks-nest/rook",
                displayName: "rook",
                status: "active",
                lastTouchedAt: "2026-07-23T00:00:00Z",
                entered: false,
                bundleCount: 1,
                approvedBundleCount: 1
            )
        ]

        EnvironmentListPresentation.apply(refreshed, to: &current)
        XCTAssertEqual(current, refreshed)
    }
}
