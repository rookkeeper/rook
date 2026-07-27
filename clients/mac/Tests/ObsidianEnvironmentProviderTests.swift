import XCTest
@testable import Rook
import RookKit

@MainActor
final class ObsidianEnvironmentProviderTests: XCTestCase {
    func testVaultNameParsesFromTrailingSegment() {
        XCTAssertEqual(
            ObsidianEnvironmentProvider.vaultName(from: "Note name - Personal Vault - Obsidian"),
            "Personal Vault"
        )
    }

    func testVaultNameAllowsNotesWithDashes() {
        XCTAssertEqual(
            ObsidianEnvironmentProvider.vaultName(from: "Roadmap - Q4 - Team Wiki - Obsidian"),
            "Team Wiki"
        )
    }

    func testVaultNameFallsBackToPrefixWhenNoNoteSeparatorExists() {
        XCTAssertEqual(
            ObsidianEnvironmentProvider.vaultName(from: "Personal Vault - Obsidian"),
            "Personal Vault"
        )
    }

    func testVaultNameRejectsInvalidTitles() {
        XCTAssertNil(ObsidianEnvironmentProvider.vaultName(from: "Obsidian"))
        XCTAssertNil(ObsidianEnvironmentProvider.vaultName(from: " - Obsidian"))
    }

    func testCandidatesEncodeVaultAndCommunityPlugins() throws {
        let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        let vaultDir = tempDir.appendingPathComponent("Work Vault")
        try FileManager.default.createDirectory(at: vaultDir.appendingPathComponent(".obsidian"), withIntermediateDirectories: true)
        try "[\"chat-with-agent\",\"obsidian-todos-extension\"]".data(using: .utf8)?.write(to: vaultDir.appendingPathComponent(".obsidian/community-plugins.json"))
        let configURL = tempDir.appendingPathComponent("obsidian.json")
        let config = """
        {"vaults":{"one":{"open":true,"path":"\(vaultDir.path)"}}}
        """
        try config.data(using: .utf8)?.write(to: configURL)

        let app = ForegroundApp(bundleId: "md.obsidian", name: "Obsidian", pid: 99)
        let candidates = ObsidianEnvironmentProvider.candidates(for: app, title: "Daily Note - Work Vault - Obsidian", configURL: configURL)

        XCTAssertEqual(Set(candidates.map(\.id)), Set([
            "mac:md.obsidian/Work%20Vault",
            "mac:md.obsidian/_plugin/chat-with-agent",
            "mac:md.obsidian/_plugin/obsidian-todos-extension",
        ]))
        XCTAssertEqual(candidates.first?.metadata["sourceName"], .string("Obsidian · Work Vault"))
        XCTAssertEqual(candidates.first?.metadata["vaultName"], .string("Work Vault"))
        XCTAssertEqual(candidates.first?.metadata["windowTitle"], .string("Daily Note - Work Vault - Obsidian"))
    }

    func testProviderTracksCurrentEnvironmentIdOnActivateAndDeactivate() {
        let provider = ObsidianEnvironmentProvider(register: { _, _ in })
        let app = ForegroundApp(bundleId: "md.obsidian", name: "Obsidian", pid: 1)

        provider.activate(app: app, title: "Daily Note - Work Vault - Obsidian")
        XCTAssertEqual(provider.currentAppEnvironmentId, "mac:md.obsidian/Work%20Vault")

        provider.deactivate()
        XCTAssertNil(provider.currentAppEnvironmentId)
    }
}
