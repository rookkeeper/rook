import XCTest
@testable import Rook

final class RookBundleIdentityTests: XCTestCase {
    func testRecognizesProductionAndDevelopmentBundleIds() {
        XCTAssertTrue(RookBundleIdentity.isInternalRookBundleId("com.rookkeeper.Rook", currentBundleId: "com.example.Test"))
        XCTAssertTrue(RookBundleIdentity.isInternalRookBundleId("com.rookkeeper.Rook.Dev.browser.environment.providers", currentBundleId: "com.example.Test"))
    }

    func testRecognizesTheCurrentBundleIdEvenIfItIsCustom() {
        XCTAssertTrue(RookBundleIdentity.isInternalRookBundleId("com.example.Test", currentBundleId: "com.example.Test"))
    }

    func testRejectsExternalBundleIds() {
        XCTAssertFalse(RookBundleIdentity.isInternalRookBundleId("com.google.Chrome", currentBundleId: "com.example.Test"))
        XCTAssertFalse(RookBundleIdentity.isInternalRookBundleId("com.rookkeeper.RookOther", currentBundleId: "com.example.Test"))
    }
}
