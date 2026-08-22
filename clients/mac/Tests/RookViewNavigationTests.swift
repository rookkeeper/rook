import XCTest
@testable import Rook

final class RookViewNavigationTests: XCTestCase {
    func testHomeAndChatUseTheAvailableWindowViewport() {
        XCTAssertFalse(RookView.usesIntrinsicHeight(for: .home))
        XCTAssertFalse(RookView.usesIntrinsicHeight(for: .chat))
        XCTAssertFalse(RookView.usesIntrinsicHeight(for: .environments))
    }

    func testDetailPanelsMeasureTheirVisibleContent() {
        XCTAssertTrue(RookView.usesIntrinsicHeight(for: .sessions(agentId: "MockAcpAgent")))
        XCTAssertTrue(RookView.usesIntrinsicHeight(for: .environmentOffer))
    }
}
