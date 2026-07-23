import XCTest
@testable import Rook
import RookKit

@MainActor
final class EnvironmentListControllerTests: XCTestCase {
    func testResetClearsAllState() {
        let controller = makeController()
        controller.handleEntered("mac:md.obsidian")
        controller.handleEntered("web:example.com")
        controller.handleExited("web:example.com")

        controller.reset()

        XCTAssertEqual(controller.environmentListItems, [])
        XCTAssertEqual(controller.enteredEnvironmentIds, [])
        XCTAssertFalse(controller.environmentsLoading)
        XCTAssertEqual(controller.environmentsError, "")
    }

    func testHandleEnteredAddsEnvironmentId() {
        let controller = makeController()

        controller.handleEntered("mac:md.obsidian")
        controller.handleEntered("mac:md.obsidian")

        XCTAssertEqual(controller.enteredEnvironmentIds, ["mac:md.obsidian"])
    }

    func testHandleExitedRemovesEnvironmentId() {
        let controller = makeController()
        controller.handleEntered("mac:md.obsidian")
        controller.handleEntered("web:example.com")

        controller.handleExited("mac:md.obsidian")

        XCTAssertEqual(controller.enteredEnvironmentIds, ["web:example.com"])
    }

    private func makeController() -> EnvironmentListController {
        EnvironmentListController(api: RookAPI(baseURL: URL(string: "http://127.0.0.1:7665")!, authToken: ""))
    }
}
