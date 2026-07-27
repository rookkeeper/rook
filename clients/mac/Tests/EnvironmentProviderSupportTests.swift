import XCTest
@testable import Rook

@MainActor
final class EnvironmentProviderSupportTests: XCTestCase {
    func testGenericWebEnvironmentIdsBuildHierarchy() {
        XCTAssertEqual(
            GenericEnvironmentProvider.webEnvironmentIds(from: "https://example.com/a/b%20c?x=1"),
            ["web:example.com", "web:example.com/a", "web:example.com/a/b%20c"]
        )
    }

    func testGenericWebEnvironmentIdsLowercaseHostAndSkipEmptySegments() {
        XCTAssertEqual(
            GenericEnvironmentProvider.webEnvironmentIds(from: "https://Example.COM//A//B/"),
            ["web:example.com", "web:example.com/A", "web:example.com/A/B"]
        )
    }

    func testGenericWebEnvironmentIdsRejectUnsupportedURLs() {
        XCTAssertEqual(GenericEnvironmentProvider.webEnvironmentIds(from: "file:///tmp/test.html"), [])
        XCTAssertEqual(GenericEnvironmentProvider.webEnvironmentIds(from: "notaurl"), [])
    }

    func testEnvironmentIdEncodingEscapesPathComponentAndComputesDepth() {
        XCTAssertEqual(EnvironmentIDEncoding.encodePathComponent("My Vault/Notes & Plans"), "My%20Vault%2FNotes%20%26%20Plans")
        XCTAssertEqual(EnvironmentIDEncoding.depth("mac:md.obsidian/My%20Vault"), 2)
        XCTAssertEqual(EnvironmentIDEncoding.depth("web:example.com/a/b"), 3)
    }
}
