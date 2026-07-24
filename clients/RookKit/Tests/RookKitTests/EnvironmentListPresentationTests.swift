import XCTest
@testable import RookKit

@MainActor
final class EnvironmentListPresentationTests: XCTestCase {
    func testShouldDisplaySourceNameHidesWebUrls() {
        let item = EnvironmentListItem(
            environmentId: "web:github.com/the-rooks-nest/rook",
            displayName: "the-rooks-nest / rook",
            sourceName: "https://github.com/the-rooks-nest/rook",
            status: "active",
            lastTouchedAt: "2026-07-23T00:00:00Z",
            entered: false,
            bundleCount: 1,
            approvedBundleCount: 1
        )

        XCTAssertFalse(EnvironmentListPresentation.shouldDisplaySourceName(for: item))
    }

    func testShouldDisplaySourceNameShowsNonWebSourceName() {
        let item = EnvironmentListItem(
            environmentId: "mac:md.obsidian/MyVault",
            displayName: "Obsidian · MyVault",
            sourceName: "Daily Note - Work Vault - Obsidian",
            status: "active",
            lastTouchedAt: "2026-07-23T00:00:00Z",
            entered: false,
            bundleCount: 1,
            approvedBundleCount: 1
        )

        XCTAssertTrue(EnvironmentListPresentation.shouldDisplaySourceName(for: item))
    }

    func testShouldDisplaySourceNameHidesDuplicateSourceName() {
        let item = EnvironmentListItem(
            environmentId: "mac:md.obsidian/MyVault",
            displayName: "Obsidian",
            sourceName: "Obsidian",
            status: "active",
            lastTouchedAt: "2026-07-23T00:00:00Z",
            entered: false,
            bundleCount: 1,
            approvedBundleCount: 1
        )

        XCTAssertFalse(EnvironmentListPresentation.shouldDisplaySourceName(for: item))
    }
}
