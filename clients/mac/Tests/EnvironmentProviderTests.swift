import XCTest
@testable import Rook
import RookKit

private typealias MacEnvironmentCandidate = Rook.EnvironmentCandidate

private struct StubSpecializedProvider: SpecializedEnvironmentProvider {
    let active: Bool
    let produced: [MacEnvironmentCandidate]

    func isActive(for app: ForegroundApp) -> Bool { active }
    func candidates(for app: ForegroundApp, title: String?) -> [MacEnvironmentCandidate] { produced }
}

final class EnvironmentProviderTests: XCTestCase {
    func testObsidianProviderIsActiveOnlyForObsidian() {
        let provider = ObsidianEnvironmentProvider()
        XCTAssertTrue(provider.isActive(for: ForegroundApp(bundleId: "md.obsidian", name: "Obsidian", pid: 1)))
        XCTAssertFalse(provider.isActive(for: ForegroundApp(bundleId: "com.apple.Safari", name: "Safari", pid: 1)))
    }

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
        let provider = ObsidianEnvironmentProvider()
        let app = ForegroundApp(bundleId: "md.obsidian", name: "Obsidian", pid: 99)

        let candidates = provider.candidates(for: app, title: "Daily Note - Work Vault - Obsidian")

        XCTAssertEqual(candidates.map(\.id), ["mac:md.obsidian/Work%20Vault"])
        XCTAssertEqual(candidates.first?.sourceName, "Obsidian · Work Vault")
        XCTAssertEqual(candidates.first?.metadata["vaultName"], .string("Work Vault"))
        XCTAssertEqual(candidates.first?.metadata["windowTitle"], .string("Daily Note - Work Vault - Obsidian"))
    }

    func testObsidianCandidatesRequireRecognizableTitle() {
        let provider = ObsidianEnvironmentProvider()
        let app = ForegroundApp(bundleId: "md.obsidian", name: "Obsidian", pid: 99)

        XCTAssertEqual(provider.candidates(for: app, title: nil), [])
        XCTAssertEqual(provider.candidates(for: app, title: "Obsidian"), [])
    }

    func testBrowserProviderIsActiveForSupportedBundleIds() {
        let provider = BrowserEnvironmentProvider()
        XCTAssertTrue(provider.isActive(for: ForegroundApp(bundleId: "com.apple.Safari", name: "Safari", pid: 1)))
        XCTAssertTrue(provider.isActive(for: ForegroundApp(bundleId: "com.google.Chrome", name: "Chrome", pid: 1)))
        XCTAssertFalse(provider.isActive(for: ForegroundApp(bundleId: "md.obsidian", name: "Obsidian", pid: 1)))
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
    func testAppEnvironmentProviderDerivesMacAndObsidianCandidatesSortedByDepth() {
        let api = RookAPI(baseURL: URL(string: "http://127.0.0.1:7665")!, authToken: "")
        let provider = AppEnvironmentProvider(
            api: api,
            environmentFocusDelay: 60,
            specializedProviders: [ObsidianEnvironmentProvider()]
        )
        let app = ForegroundApp(bundleId: "md.obsidian", name: "Obsidian", pid: 123)

        let candidates = provider.deriveForegroundEnvironmentCandidates(
            app: app,
            title: "Daily Note - Work Vault - Obsidian"
        )

        XCTAssertEqual(candidates.map(\.id), [
            "mac:md.obsidian",
            "mac:md.obsidian/Work%20Vault",
        ])
        XCTAssertEqual(candidates.last?.sourceName, "Obsidian · Work Vault")
        XCTAssertEqual(candidates.last?.metadata["vaultName"], .string("Work Vault"))
    }

    @MainActor
    func testAppEnvironmentProviderDeduplicatesOverlappingSpecializedCandidates() {
        let api = RookAPI(baseURL: URL(string: "http://127.0.0.1:7665")!, authToken: "")
        let provider = AppEnvironmentProvider(
            api: api,
            environmentFocusDelay: 60,
            specializedProviders: [
                StubSpecializedProvider(active: true, produced: [
                    MacEnvironmentCandidate(id: "mac:md.obsidian", sourceName: "duplicate", metadata: [:]),
                    MacEnvironmentCandidate(id: "mac:md.obsidian/Work%20Vault", sourceName: "vault", metadata: [:]),
                    MacEnvironmentCandidate(id: "mac:md.obsidian/Work%20Vault/Deep", sourceName: "deep", metadata: [:]),
                ])
            ]
        )
        let app = ForegroundApp(bundleId: "md.obsidian", name: "Obsidian", pid: 123)

        let candidates = provider.deriveForegroundEnvironmentCandidates(app: app, title: "Anything")

        XCTAssertEqual(candidates.map(\.id), [
            "mac:md.obsidian",
            "mac:md.obsidian/Work%20Vault",
            "mac:md.obsidian/Work%20Vault/Deep",
        ])
        XCTAssertEqual(Set(candidates.map(\.id)).count, candidates.count)
    }
}
