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

    func testObsidianCandidatesEncodeVaultAndCommunityPlugins() throws {
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

    func testSlackTitleContextParsesWorkspaceAndChannel() {
        XCTAssertEqual(
            SlackEnvironmentProvider.titleContext(from: "announcements (Channel) - NashDev - 1 new item - Slack"),
            SlackTitleContext(workspaceName: "NashDev", channelName: "announcements")
        )
    }

    func testSlackCandidatesIncludeWorkspaceAndChannel() {
        let app = ForegroundApp(bundleId: "com.tinyspeck.slackmacgap", name: "Slack", pid: 1)
        let candidates = SlackEnvironmentProvider.candidates(for: app, title: "announcements (Channel) - NashDev - 1 new item - Slack")

        XCTAssertEqual(candidates.map(\.id), [
            "mac:com.tinyspeck.slackmacgap/NashDev",
            "mac:com.tinyspeck.slackmacgap/NashDev/announcements",
        ])
        XCTAssertEqual(candidates.last?.metadata["workspaceName"], .string("NashDev"))
        XCTAssertEqual(candidates.last?.metadata["channelName"], .string("announcements"))
    }

    func testObsTitleContextParsesProfileAndSceneCollection() {
        XCTAssertEqual(
            OBSStudioEnvironmentProvider.titleContext(from: "OBS 32.2.0 - Profile: Untitled - Scenes: Untitled"),
            OBSTitleContext(profileName: "Untitled", sceneCollectionName: "Untitled")
        )
    }

    func testObsCandidatesIncludeSceneCollectionMetadata() {
        let app = ForegroundApp(bundleId: "com.obsproject.obs-studio", name: "OBS Studio", pid: 1)
        let candidates = OBSStudioEnvironmentProvider.candidates(for: app, title: "OBS 32.2.0 - Profile: Untitled - Scenes: Untitled")

        XCTAssertEqual(candidates.map(\.id), ["mac:com.obsproject.obs-studio/Untitled"])
        XCTAssertEqual(candidates.first?.metadata["sceneCollectionName"], .string("Untitled"))
        XCTAssertEqual(candidates.first?.metadata["profileName"], .string("Untitled"))
    }

    func testDescriptProjectNameParsesFromWindowTitle() {
        XCTAssertEqual(
            DescriptEnvironmentProvider.projectName(from: "AI Tinkerers 2026.05.22 - Descript"),
            "AI Tinkerers 2026.05.22"
        )
        XCTAssertEqual(
            DescriptEnvironmentProvider.projectName(from: "Day28_shorts - Descript - Audio playing"),
            nil
        )
    }

    func testDescriptCandidatesIncludeRouteMetadata() throws {
        let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        let configURL = tempDir.appendingPathComponent("config.json")
        let config = """
        {
          "windows": [
            {
              "route": "https://web.descript.com/4f069ec2-0e4d-4e39-826a-5fd281b464d2/edd50?editorVariant=default",
              "focused": true
            }
          ]
        }
        """
        try config.data(using: .utf8)?.write(to: configURL)

        let app = ForegroundApp(bundleId: "com.descript.beachcube", name: "Descript", pid: 1)
        let candidates = DescriptEnvironmentProvider.candidates(for: app, title: "AI Tinkerers 2026.05.22 - Descript", configURL: configURL)

        XCTAssertEqual(candidates.map(\.id), ["mac:com.descript.beachcube/AI%20Tinkerers%202026.05.22"])
        XCTAssertEqual(candidates.first?.metadata["projectName"], .string("AI Tinkerers 2026.05.22"))
        XCTAssertEqual(candidates.first?.metadata["projectId"], .string("4f069ec2-0e4d-4e39-826a-5fd281b464d2"))
        XCTAssertEqual(candidates.first?.metadata["compositionId"], .string("edd50"))
    }

    func testDiscordTitleContextParsesServerAndChannel() {
        XCTAssertEqual(
            DiscordEnvironmentProvider.titleContext(from: "#self-promotion | Build With AI - Discord"),
            .serverChannel(serverName: "Build With AI", channelName: "self-promotion")
        )
    }

    func testDiscordCandidatesIncludeServerAndChannel() {
        let app = ForegroundApp(bundleId: "com.hnc.Discord", name: "Discord", pid: 1)
        let candidates = DiscordEnvironmentProvider.candidates(for: app, title: "#self-promotion | Build With AI - Discord")

        XCTAssertEqual(candidates.map(\.id), [
            "mac:com.hnc.Discord/Build%20With%20AI",
            "mac:com.hnc.Discord/Build%20With%20AI/self-promotion",
        ])
        XCTAssertEqual(candidates.last?.metadata["serverName"], .string("Build With AI"))
        XCTAssertEqual(candidates.last?.metadata["channelName"], .string("self-promotion"))
        XCTAssertEqual(candidates.last?.metadata["sourceName"], .string("Discord · Build With AI · #self-promotion"))
    }

    func testDiscordTitleContextParsesDirectMessage() {
        XCTAssertEqual(
            DiscordEnvironmentProvider.titleContext(from: "@Michael Pedersen - Discord"),
            .directMessage(name: "@Michael Pedersen")
        )
    }

    func testDiscordCandidatesIncludeDirectMessage() {
        let app = ForegroundApp(bundleId: "com.hnc.Discord", name: "Discord", pid: 1)
        let candidates = DiscordEnvironmentProvider.candidates(for: app, title: "@Michael Pedersen - Discord")

        XCTAssertEqual(candidates.map(\.id), [
            "mac:com.hnc.Discord/_dm/%40Michael%20Pedersen",
        ])
        XCTAssertEqual(candidates.first?.metadata["dmName"], .string("@Michael Pedersen"))
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
    func testSlackProviderTracksCurrentEnvironmentIdOnActivateAndDeactivate() {
        let provider = SlackEnvironmentProvider(register: { _, _ in })
        let app = ForegroundApp(bundleId: "com.tinyspeck.slackmacgap", name: "Slack", pid: 1)

        provider.activate(app: app, title: "announcements (Channel) - NashDev - 1 new item - Slack")
        XCTAssertEqual(provider.currentAppEnvironmentId, "mac:com.tinyspeck.slackmacgap/NashDev/announcements")

        provider.deactivate()
        XCTAssertNil(provider.currentAppEnvironmentId)
    }
}
