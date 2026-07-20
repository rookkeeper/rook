import XCTest
@testable import RookKit

final class ToolBlockStatusTests: XCTestCase {
    func testPendingLabel() {
        XCTAssertEqual(ToolBlockStatus.pending.label, "Pending")
    }

    func testInputStreamingLabel() {
        XCTAssertEqual(ToolBlockStatus.inputStreaming.label, "Preparing")
    }

    func testReadyLabel() {
        XCTAssertEqual(ToolBlockStatus.ready.label, "Ready")
    }

    func testRunningLabel() {
        XCTAssertEqual(ToolBlockStatus.running.label, "Running")
    }

    func testCompletedLabel() {
        XCTAssertEqual(ToolBlockStatus.completed.label, "Done")
    }

    func testFailedLabel() {
        XCTAssertEqual(ToolBlockStatus.failed.label, "Failed")
    }

    func testCancelledLabel() {
        XCTAssertEqual(ToolBlockStatus.cancelled.label, "Cancelled")
    }

    func testPendingIsNotTerminal() {
        XCTAssertFalse(ToolBlockStatus.pending.isTerminal)
    }

    func testInputStreamingIsNotTerminal() {
        XCTAssertFalse(ToolBlockStatus.inputStreaming.isTerminal)
    }

    func testReadyIsNotTerminal() {
        XCTAssertFalse(ToolBlockStatus.ready.isTerminal)
    }

    func testRunningIsNotTerminal() {
        XCTAssertFalse(ToolBlockStatus.running.isTerminal)
    }

    func testCompletedIsTerminal() {
        XCTAssertTrue(ToolBlockStatus.completed.isTerminal)
    }

    func testFailedIsTerminal() {
        XCTAssertTrue(ToolBlockStatus.failed.isTerminal)
    }

    func testCancelledIsTerminal() {
        XCTAssertTrue(ToolBlockStatus.cancelled.isTerminal)
    }
}

final class ToolBlockStateTests: XCTestCase {
    func testEquality() {
        let a = ToolBlockState(toolCallId: "1", title: "edit", kindLabel: "tool", status: .running, arguments: "{}", output: "")
        let b = ToolBlockState(toolCallId: "1", title: "edit", kindLabel: "tool", status: .running, arguments: "{}", output: "")
        XCTAssertEqual(a, b)
    }

    func testEqualityDifferentStatus() {
        let a = ToolBlockState(toolCallId: "1", title: "edit", kindLabel: "tool", status: .running, arguments: "{}", output: "")
        let b = ToolBlockState(toolCallId: "1", title: "edit", kindLabel: "tool", status: .completed, arguments: "{}", output: "")
        XCTAssertNotEqual(a, b)
    }

    func testEqualityDifferentArguments() {
        let a = ToolBlockState(toolCallId: "1", title: "edit", kindLabel: "tool", status: .running, arguments: "{}", output: "")
        let b = ToolBlockState(toolCallId: "1", title: "edit", kindLabel: "tool", status: .running, arguments: #"{"path":"/tmp"}"#, output: "")
        XCTAssertNotEqual(a, b)
    }

    func testEqualityDifferentOutput() {
        let a = ToolBlockState(toolCallId: "1", title: "edit", kindLabel: "tool", status: .completed, arguments: "{}", output: "")
        let b = ToolBlockState(toolCallId: "1", title: "edit", kindLabel: "tool", status: .completed, arguments: "{}", output: "done")
        XCTAssertNotEqual(a, b)
    }

    func testEqualityMutatedStatus() {
        var state = ToolBlockState(toolCallId: "1", title: "edit", kindLabel: "tool", status: .pending, arguments: "", output: "")
        state.status = .inputStreaming
        XCTAssertEqual(state.status, .inputStreaming)
        XCTAssertFalse(state.status.isTerminal)
        state.status = .cancelled
        XCTAssertTrue(state.status.isTerminal)
    }
}
