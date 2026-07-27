import XCTest
@testable import Rook
import RookKit

@MainActor
final class DiscordEnvironmentProviderTests: XCTestCase {
    func testTitleContextParsesServerAndChannel() {
        XCTAssertEqual(
            DiscordEnvironmentProvider.titleContext(from: "#self-promotion | Build With AI - Discord"),
            .serverChannel(serverName: "Build With AI", channelName: "self-promotion")
        )
    }

    func testCandidatesIncludeServerAndChannel() {
        let app = ForegroundApp(bundleId: "com.hnc.Discord", name: "Discord", pid: 1)
        let candidates = DiscordEnvironmentProvider.candidates(for: app, title: "#self-promotion | Build With AI - Discord")

        XCTAssertEqual(candidates.map(\.id), [
            "mac:com.hnc.Discord/Build%20With%20AI",
            "mac:com.hnc.Discord/Build%20With%20AI/self-promotion",
        ])
        XCTAssertEqual(candidates.last?.metadata["serverName"], .string("Build With AI"))
        XCTAssertEqual(candidates.last?.metadata["channelName"], .string("self-promotion"))
        XCTAssertEqual(candidates.last?.metadata["displayName"], .string("Discord · Build With AI · #self-promotion"))
    }

    func testTitleContextParsesDirectMessage() {
        XCTAssertEqual(
            DiscordEnvironmentProvider.titleContext(from: "@Michael Pedersen - Discord"),
            .directMessage(name: "@Michael Pedersen")
        )
    }

    func testCandidatesIncludeDirectMessage() {
        let app = ForegroundApp(bundleId: "com.hnc.Discord", name: "Discord", pid: 1)
        let candidates = DiscordEnvironmentProvider.candidates(for: app, title: "@Michael Pedersen - Discord")

        XCTAssertEqual(candidates.map(\.id), [
            "mac:com.hnc.Discord/_dm/%40Michael%20Pedersen",
        ])
        XCTAssertEqual(candidates.first?.metadata["dmName"], .string("@Michael Pedersen"))
    }
}
