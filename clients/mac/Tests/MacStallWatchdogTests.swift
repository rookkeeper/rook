import XCTest
@testable import Rook

final class MacStallWatchdogTests: XCTestCase {
    func testDoesNotReportBeforeThreshold() {
        var tracker = StallWatchdogTracker(
            nowNanoseconds: 100,
            thresholdNanoseconds: 50,
            initialOperation: "startup"
        )

        XCTAssertNil(tracker.check(nowNanoseconds: 149))
    }

    func testReportsOneStallWithLastOperation() {
        var tracker = StallWatchdogTracker(
            nowNanoseconds: 100,
            thresholdNanoseconds: 50
        )
        tracker.beginOperation("AXReader.focusedWindowTitle")

        XCTAssertEqual(
            tracker.check(nowNanoseconds: 150),
            .stalled(ageNanoseconds: 50, operation: "AXReader.focusedWindowTitle")
        )
        XCTAssertNil(tracker.check(nowNanoseconds: 250))
    }

    func testHeartbeatReportsRecoveryAndResetsEpisode() {
        var tracker = StallWatchdogTracker(
            nowNanoseconds: 100,
            thresholdNanoseconds: 50
        )

        XCTAssertEqual(
            tracker.check(nowNanoseconds: 150),
            .stalled(ageNanoseconds: 50, operation: "startup")
        )
        XCTAssertEqual(
            tracker.heartbeat(nowNanoseconds: 180, operation: "main-run-loop"),
            .recovered(stallDurationNanoseconds: 30)
        )
        XCTAssertNil(tracker.check(nowNanoseconds: 200))
    }

    func testHeartbeatKeepsAnActiveOperationAsTheDiagnosticContext() {
        var tracker = StallWatchdogTracker(
            nowNanoseconds: 100,
            thresholdNanoseconds: 50
        )
        tracker.beginOperation("AXReader.activeTabURL")

        tracker.heartbeat(nowNanoseconds: 120, operation: "main-run-loop")

        XCTAssertEqual(
            tracker.check(nowNanoseconds: 170),
            .stalled(ageNanoseconds: 50, operation: "AXReader.activeTabURL")
        )
    }
}
