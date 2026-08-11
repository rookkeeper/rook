import XCTest
@testable import Rook

final class RookBundleIdentityTests: XCTestCase {
    func testRecognizesProductionAndDevelopmentBundleIds() {
        XCTAssertTrue(RookBundleIdentity.isInternalRookBundleId("com.rookery.Rook", currentBundleId: "com.example.Test"))
        XCTAssertTrue(RookBundleIdentity.isInternalRookBundleId("com.rookery.Rook.Dev.browser.environment.providers", currentBundleId: "com.example.Test"))
    }

    func testRecognizesTheCurrentBundleIdEvenIfItIsCustom() {
        XCTAssertTrue(RookBundleIdentity.isInternalRookBundleId("com.example.Test", currentBundleId: "com.example.Test"))
    }

    func testRejectsExternalBundleIds() {
        XCTAssertFalse(RookBundleIdentity.isInternalRookBundleId("com.google.Chrome", currentBundleId: "com.example.Test"))
        XCTAssertFalse(RookBundleIdentity.isInternalRookBundleId("com.rookery.RookOther", currentBundleId: "com.example.Test"))
    }
}
