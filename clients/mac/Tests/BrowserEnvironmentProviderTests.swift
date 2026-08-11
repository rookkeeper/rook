import XCTest
@testable import Rook
import RookKit

@MainActor
final class BrowserEnvironmentProviderTests: XCTestCase {
    func testSupportsSafariAndFirefoxOnly() {
        let provider = BrowserEnvironmentProvider(register: { _, _ in })

        XCTAssertEqual(provider.supportedBundleIds, [
            "com.apple.Safari",
            "org.mozilla.firefox",
        ])
    }

    func testSiteEnvironmentIdUsesURLHost() {
        XCTAssertEqual(
            BrowserEnvironmentProvider.siteEnvironmentId(from: "https://Example.COM/path?q=1"),
            "web:example.com"
        )
        XCTAssertNil(BrowserEnvironmentProvider.siteEnvironmentId(from: "about:blank"))
        XCTAssertNil(BrowserEnvironmentProvider.siteEnvironmentId(from: nil))
    }

    func testCandidatesIncludeBrowserAndObservedURLMetadata() {
        let app = ForegroundApp(bundleId: "com.apple.Safari", name: "Safari", pid: 1)
        let candidates = BrowserEnvironmentProvider.candidates(
            for: app,
            title: "Example",
            url: "https://example.com/path"
        )

        XCTAssertEqual(candidates.map(\.id), ["web:example.com"])
        XCTAssertEqual(candidates[0].metadata["appName"], .string("Safari"))
        XCTAssertEqual(candidates[0].metadata["url"], .string("https://example.com/path"))
        XCTAssertEqual(candidates[0].metadata["displayName"], .string("example.com"))
    }

    func testProviderUsesBaseAppEnvironmentAndClearsStateOnDeactivate() {
        let provider = BrowserEnvironmentProvider(register: { _, _ in })
        let app = ForegroundApp(bundleId: "org.mozilla.firefox", name: "Firefox", pid: 1)

        provider.activate(app: app, title: "Example")
        XCTAssertEqual(provider.currentAppEnvironmentId, "mac:org.mozilla.firefox")

        provider.deactivate()
        XCTAssertNil(provider.currentAppEnvironmentId)
        XCTAssertNil(provider.currentSiteEnvironmentId)
    }
}
