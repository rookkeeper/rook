import XCTest
@testable import RookKit

final class AgentTurnContentTrackerTests: XCTestCase {
    func testRetryProgressDoesNotCountAsAgentContent() {
        var tracker = AgentTurnContentTracker()

        tracker.recordAgentMessage("Retrying (attempt 1/3, waiting 2s)...")
        tracker.recordAgentMessage("Retrying (attempt 2/3, waiting 4s)...")
        tracker.recordAgentMessage("Retry finished, resuming.")

        XCTAssertFalse(tracker.hasActualContent)
        XCTAssertTrue(tracker.sawAutomaticRetry)
        XCTAssertEqual(tracker.completionErrorMessage, "Runtime retries exhausted before producing a response.")
    }

    func testActualAgentContentCompletesWithoutAnError() {
        var tracker = AgentTurnContentTracker()

        tracker.recordAgentMessage("Retrying...")
        tracker.recordAgentMessage("The answer is ready.")

        XCTAssertTrue(tracker.hasActualContent)
        XCTAssertNil(tracker.completionErrorMessage)
    }

    func testEmptyTurnUsesGenericNoResponseError() {
        let tracker = AgentTurnContentTracker()

        XCTAssertEqual(
            tracker.completionErrorMessage,
            "Agent produced no response — the model call likely failed upstream (check provider billing/auth)."
        )
    }
}
