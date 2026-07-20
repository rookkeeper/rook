import CoreLocation
import XCTest
import RookKit
@testable import Rook

/// Unit tests for the pure CLVisit dwell/motion gate (`LocationProvider.arrivalContext`).
/// CLVisit itself can't fire in the simulator, so the decision logic is tested directly.
final class ArrivalGateTests: XCTestCase {
    private let coord = CLLocationCoordinate2D(latitude: 36, longitude: -86)
    private let now = Date(timeIntervalSince1970: 1_000_000)
    private let arrival = Date(timeIntervalSince1970: 999_700) // 300s before `now`

    private func gate(
        departure: Date = .distantFuture,
        arrivalDate: Date? = nil,
        accuracy: CLLocationAccuracy = 30,
        speed: CLLocationSpeed? = 0.2,
        automotive: Bool = false
    ) -> ArrivalContext? {
        LocationProvider.arrivalContext(
            departureDate: departure,
            coordinate: coord,
            arrivalDate: arrivalDate ?? arrival,
            horizontalAccuracy: accuracy,
            speed: speed,
            isAutomotive: automotive,
            now: now,
            stationarySpeedThreshold: 1.5
        )
    }

    func testSettledArrivalPasses() {
        let c = gate()
        XCTAssertNotNil(c)
        XCTAssertEqual(c?.isStationary, true)
        XCTAssertEqual(c?.speedMetersPerSecond, 0.2)
        XCTAssertEqual(c?.horizontalAccuracy, 30)
        XCTAssertEqual(c?.dwellSeconds ?? -1, 300, accuracy: 0.001)
    }

    func testDepartureRejected() {
        XCTAssertNil(gate(departure: Date(timeIntervalSince1970: 1_000_500)))
    }

    func testDrivingRejected() {
        XCTAssertNil(gate(automotive: true))
    }

    func testFastSpeedRejected() {
        XCTAssertNil(gate(speed: 20))
    }

    func testUnknownSpeedTreatedAsStationary() {
        let c = gate(speed: nil)
        XCTAssertNotNil(c)
        XCTAssertNil(c?.speedMetersPerSecond)
    }

    func testNegativeSpeedNormalizedToNil() {
        let c = gate(speed: -1)
        XCTAssertNotNil(c)
        XCTAssertNil(c?.speedMetersPerSecond)
    }

    func testNegativeAccuracyBecomesNil() {
        XCTAssertNil(gate(accuracy: -1)?.horizontalAccuracy)
    }

    func testNoDwellWhenArrivalDistantPast() {
        XCTAssertNil(gate(arrivalDate: .distantPast)?.dwellSeconds)
    }
}

// MARK: - RookModel tool cancellation tests

@MainActor
final class RookModelToolCancellationTests: XCTestCase {
    var model: RookModel!

    override func setUp() {
        model = RookModel()
    }

    override func tearDown() {
        model = nil
    }

    func testFinalizeActiveToolsMarksInputStreamingAsCancelled() {
        let toolState = ToolBlockState(
            toolCallId: "t1", title: "edit", kindLabel: "tool",
            status: .inputStreaming, arguments: "{\"path\":\"", output: ""
        )
        model.blocks = [ChatBlock(id: "1", kind: .tool(toolState))]
        model.finalizeActiveTools(as: .cancelled)
        guard case .tool(let final) = model.blocks[0].kind else { return XCTFail() }
        XCTAssertEqual(final.status, .cancelled)
    }

    func testFinalizeActiveToolsMarksPendingAsCancelled() {
        model.blocks = [ChatBlock(id: "1", kind: .tool(
            ToolBlockState(toolCallId: "t2", title: "w", kindLabel: "t", status: .pending, arguments: "", output: "")))]
        model.finalizeActiveTools(as: .cancelled)
        guard case .tool(let final) = model.blocks[0].kind else { return XCTFail() }
        XCTAssertEqual(final.status, .cancelled)
    }

    func testFinalizeActiveToolsSkipsCompletedTools() {
        model.blocks = [ChatBlock(id: "1", kind: .tool(
            ToolBlockState(toolCallId: "t3", title: "r", kindLabel: "t", status: .completed, arguments: "{}", output: "ok")))]
        model.finalizeActiveTools(as: .cancelled)
        guard case .tool(let final) = model.blocks[0].kind else { return XCTFail() }
        XCTAssertEqual(final.status, .completed)
    }

    func testFinalizeActiveToolsMarksMultipleTools() {
        model.blocks = [
            ChatBlock(id: "1", kind: .tool(ToolBlockState(toolCallId: "a", title: "e1", kindLabel: "t", status: .running, arguments: "{}", output: ""))),
            ChatBlock(id: "2", kind: .tool(ToolBlockState(toolCallId: "b", title: "e2", kindLabel: "t", status: .inputStreaming, arguments: "{", output: ""))),
            ChatBlock(id: "3", kind: .tool(ToolBlockState(toolCallId: "c", title: "e3", kindLabel: "t", status: .completed, arguments: "{}", output: "")))
        ]
        model.finalizeActiveTools(as: .cancelled)
        if case .tool(let t) = model.blocks[0].kind { XCTAssertEqual(t.status, .cancelled) } else { XCTFail() }
        if case .tool(let t) = model.blocks[1].kind { XCTAssertEqual(t.status, .cancelled) } else { XCTFail() }
        if case .tool(let t) = model.blocks[2].kind { XCTAssertEqual(t.status, .completed) } else { XCTFail() }
    }

    func testFinalizeActiveToolsSkipsNonToolBlocks() {
        model.blocks = [
            ChatBlock(id: "1", kind: .user(text: "hello")),
            ChatBlock(id: "2", kind: .tool(ToolBlockState(toolCallId: "t1", title: "e", kindLabel: "t", status: .inputStreaming, arguments: "{}", output: "")))
        ]
        model.finalizeActiveTools(as: .cancelled)
        guard case .user = model.blocks[0].kind else { return XCTFail() }
        guard case .tool(let t) = model.blocks[1].kind else { return XCTFail() }
        XCTAssertEqual(t.status, .cancelled)
    }

    // MARK: - Full event simulation: tool started, streaming input, then cancelled

    func testToolInputDeltaAccumulatesAndGetsCancelled() {
        model.handleSocketEvent(.toolCallStarted(
            toolCallId: "t1", title: "edit", kind: "tool", status: "pending", rawInput: nil
        ))
        model.handleSocketEvent(.toolInputDelta(toolCallId: "t1", toolName: nil, delta: #"{"path"#))
        model.handleSocketEvent(.toolInputDelta(toolCallId: "t1", toolName: nil, delta: #"":""#))

        guard case .tool(let s) = model.blocks[0].kind else { return XCTFail() }
        XCTAssertEqual(s.status, .inputStreaming)
        XCTAssertTrue(s.arguments.contains("path"), "arguments should contain path string after deltas")

        // Simulate cancellation
        model.finalizeActiveTools(as: .cancelled)
        guard case .tool(let cancelled) = model.blocks[0].kind else { return XCTFail() }
        XCTAssertEqual(cancelled.status, .cancelled)
    }

    func testToolCallStartedCreatesPendingBlock() {
        model.handleSocketEvent(.toolCallStarted(
            toolCallId: "t1", title: "edit", kind: "tool", status: "pending", rawInput: nil
        ))
        XCTAssertEqual(model.blocks.count, 1)
        guard case .tool(let s) = model.blocks[0].kind else { return XCTFail() }
        XCTAssertEqual(s.toolCallId, "t1")
    }

    func testToolCallUpdateCompleted() {
        model.handleSocketEvent(.toolCallStarted(
            toolCallId: "t1", title: "edit", kind: "tool", status: "pending", rawInput: nil
        ))
        model.handleSocketEvent(.toolCallUpdate(toolCallId: "t1", status: "completed", toolName: nil, output: "result"))
        guard case .tool(let s) = model.blocks[0].kind else { return XCTFail() }
        XCTAssertEqual(s.status, .completed)
        XCTAssertEqual(s.output, "result")
    }

    func testToolCallUpdateFailed() {
        model.handleSocketEvent(.toolCallStarted(
            toolCallId: "t1", title: "edit", kind: "tool", status: "pending", rawInput: nil
        ))
        model.handleSocketEvent(.toolCallUpdate(toolCallId: "t1", status: "failed", toolName: nil, output: "error"))
        guard case .tool(let s) = model.blocks[0].kind else { return XCTFail() }
        XCTAssertEqual(s.status, .failed)
    }
}
