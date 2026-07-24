import XCTest
@testable import Rook
import RookKit

@MainActor
final class EnvironmentProviderTests: XCTestCase {
    func testObsidianVaultNameParsesFromTrailingSegment() {
        XCTAssertEqual(
            ObsidianEnvironmentProvider.vaultName(from: "Note name - Personal Vault - Obsidian"),
            "Personal Vault"
        )
    }

    func testObsidianVaultNameAllowsNotesWithDashes() {
        XCTAssertEqual(
            ObsidianEnvironmentProvider.vaultName(from: "Roadmap - Q4 - Team Wiki - Obsidian"),
            "Team Wiki"
        )
    }

    func testObsidianVaultNameFallsBackToPrefixWhenNoNoteSeparatorExists() {
        XCTAssertEqual(
            ObsidianEnvironmentProvider.vaultName(from: "Personal Vault - Obsidian"),
            "Personal Vault"
        )
    }

    func testObsidianVaultNameRejectsInvalidTitles() {
        XCTAssertNil(ObsidianEnvironmentProvider.vaultName(from: "Obsidian"))
        XCTAssertNil(ObsidianEnvironmentProvider.vaultName(from: " - Obsidian"))
    }

    func testObsidianCandidatesEncodeVaultAndIncludeMetadata() {
        let app = ForegroundApp(bundleId: "md.obsidian", name: "Obsidian", pid: 99)

        let candidates = ObsidianEnvironmentProvider.candidates(for: app, title: "Daily Note - Work Vault - Obsidian")

        XCTAssertEqual(candidates.map(\.id), ["mac:md.obsidian/Work%20Vault"])
        XCTAssertEqual(candidates.first?.metadata["sourceName"], .string("Obsidian · Work Vault"))
        XCTAssertEqual(candidates.first?.metadata["vaultName"], .string("Work Vault"))
        XCTAssertEqual(candidates.first?.metadata["windowTitle"], .string("Daily Note - Work Vault - Obsidian"))
    }

    func testObsidianCandidatesRequireRecognizableTitle() {
        let app = ForegroundApp(bundleId: "md.obsidian", name: "Obsidian", pid: 99)

        XCTAssertEqual(ObsidianEnvironmentProvider.candidates(for: app, title: nil), [])
        XCTAssertEqual(ObsidianEnvironmentProvider.candidates(for: app, title: "Obsidian"), [])
    }

    func testBrowserWebEnvironmentIdsBuildHierarchy() {
        XCTAssertEqual(
            BrowserEnvironmentProvider.webEnvironmentIds(from: "https://example.com/a/b%20c?x=1"),
            ["web:example.com", "web:example.com/a", "web:example.com/a/b%20c"]
        )
    }

    func testBrowserWebEnvironmentIdsLowercaseHostAndSkipEmptySegments() {
        XCTAssertEqual(
            BrowserEnvironmentProvider.webEnvironmentIds(from: "https://Example.COM//A//B/"),
            ["web:example.com", "web:example.com/A", "web:example.com/A/B"]
        )
    }

    func testBrowserWebEnvironmentIdsRejectUnsupportedURLs() {
        XCTAssertEqual(BrowserEnvironmentProvider.webEnvironmentIds(from: "file:///tmp/test.html"), [])
        XCTAssertEqual(BrowserEnvironmentProvider.webEnvironmentIds(from: "notaurl"), [])
    }

    func testEnvironmentIdEncodingEscapesPathComponentAndComputesDepth() {
        XCTAssertEqual(EnvironmentIDEncoding.encodePathComponent("My Vault/Notes & Plans"), "My%20Vault%2FNotes%20%26%20Plans")
        XCTAssertEqual(EnvironmentIDEncoding.depth("mac:md.obsidian/My%20Vault"), 2)
        XCTAssertEqual(EnvironmentIDEncoding.depth("web:example.com/a/b"), 3)
    }

    @MainActor
    func testObsidianProviderTracksCurrentEnvironmentIdOnActivateAndDeactivate() {
        let provider = ObsidianEnvironmentProvider(register: { _, _ in })
        let app = ForegroundApp(bundleId: "md.obsidian", name: "Obsidian", pid: 1)

        provider.activate(app: app, title: "Daily Note - Work Vault - Obsidian")
        XCTAssertEqual(provider.currentAppEnvironmentId, "mac:md.obsidian/Work%20Vault")

        provider.deactivate()
        XCTAssertNil(provider.currentAppEnvironmentId)
    }

    @MainActor
    func testBrowserProviderTracksCurrentSiteEnvironmentIdOnActivateAndDeactivate() {
        let provider = BrowserEnvironmentProvider(register: { _, _ in })

        XCTAssertNil(provider.currentSiteEnvironmentId)
        provider.deactivate()
        XCTAssertNil(provider.currentSiteEnvironmentId)
    }
}
