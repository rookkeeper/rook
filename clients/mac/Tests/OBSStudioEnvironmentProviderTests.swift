import XCTest
@testable import Rook
import RookKit

@MainActor
final class OBSStudioEnvironmentProviderTests: XCTestCase {
    func testTitleContextParsesProfileAndSceneCollection() {
        XCTAssertEqual(
            OBSStudioEnvironmentProvider.titleContext(from: "OBS 32.2.0 - Profile: Untitled - Scenes: Untitled"),
            OBSTitleContext(profileName: "Untitled", sceneCollectionName: "Untitled")
        )
    }

    func testCandidatesIncludeSceneCollectionMetadata() {
        let app = ForegroundApp(bundleId: "com.obsproject.obs-studio", name: "OBS Studio", pid: 1)
        let candidates = OBSStudioEnvironmentProvider.candidates(for: app, title: "OBS 32.2.0 - Profile: Untitled - Scenes: Untitled")

        XCTAssertEqual(candidates.map(\.id), ["mac:com.obsproject.obs-studio/Untitled"])
        XCTAssertEqual(candidates.first?.metadata["sceneCollectionName"], .string("Untitled"))
        XCTAssertEqual(candidates.first?.metadata["profileName"], .string("Untitled"))
    }
}
