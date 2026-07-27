import XCTest
@testable import Rook
import RookKit

@MainActor
final class DescriptEnvironmentProviderTests: XCTestCase {
    func testProjectNameParsesFromWindowTitle() {
        XCTAssertEqual(
            DescriptEnvironmentProvider.projectName(from: "AI Tinkerers 2026.05.22 - Descript"),
            "AI Tinkerers 2026.05.22"
        )
        XCTAssertEqual(
            DescriptEnvironmentProvider.projectName(from: "Day28_shorts - Descript - Audio playing"),
            nil
        )
    }

    func testCandidatesIncludeRouteMetadata() throws {
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
}
