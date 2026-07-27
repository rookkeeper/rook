import XCTest
@testable import Rook
import RookKit

@MainActor
final class FinderEnvironmentProviderTests: XCTestCase {
    func testObservationParsesCurrentAndOpenDirectories() {
        let observation = FinderEnvironmentProvider.parseObservation(from: """
        window\t/Users/johnberryman/projects
        current\t/Users/johnberryman/projects/github/rookkeeper
        window\t/Users/johnberryman/projects/github/rookkeeper
        """)

        XCTAssertEqual(observation.currentDirectoryPath, "/Users/johnberryman/projects/github/rookkeeper")
        XCTAssertEqual(observation.allDirectoryPaths, [
            "/Users/johnberryman/projects",
            "/Users/johnberryman/projects/github/rookkeeper",
        ])
    }

    func testCandidatesEmitDirectoryEnvironments() {
        let app = ForegroundApp(bundleId: "com.apple.finder", name: "Finder", pid: 1)
        let observation = FinderObservation(
            currentDirectoryPath: "/Users/johnberryman/projects/github/rookkeeper",
            allDirectoryPaths: [
                "/Users/johnberryman/projects",
                "/Users/johnberryman/projects/github/rookkeeper",
            ]
        )

        let candidates = FinderEnvironmentProvider.candidates(for: app, title: "rookkeeper", observation: observation)

        XCTAssertEqual(candidates.map(\.id), [
            "dir:/Users/johnberryman/projects",
            "dir:/Users/johnberryman/projects/github/rookkeeper",
        ])
        XCTAssertEqual(candidates.last?.metadata["finderCurrent"], .bool(true))
        XCTAssertEqual(candidates.last?.metadata["displayName"], .string("Finder · rookkeeper"))
    }

    func testProviderTracksCurrentDirectoryEnvironmentId() {
        let provider = FinderEnvironmentProvider(
            register: { _, _ in },
            observe: {
                FinderObservation(
                    currentDirectoryPath: "/Users/johnberryman/projects/github/rookkeeper",
                    allDirectoryPaths: ["/Users/johnberryman/projects/github/rookkeeper"]
                )
            }
        )
        let app = ForegroundApp(bundleId: "com.apple.finder", name: "Finder", pid: 1)

        provider.activate(app: app, title: "rookkeeper")
        XCTAssertEqual(provider.currentAppEnvironmentId, "dir:/Users/johnberryman/projects/github/rookkeeper")

        provider.deactivate()
        XCTAssertNil(provider.currentAppEnvironmentId)
    }
}
