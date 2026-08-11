import XCTest
@testable import RookKit

final class RookLogTests: XCTestCase {
    func testPerformanceSeverityThresholds() {
        XCTAssertEqual(RookPerformance.severity(forElapsedMs: 12), .info)
        XCTAssertEqual(RookPerformance.severity(forElapsedMs: 100), .warning)
        XCTAssertEqual(RookPerformance.severity(forElapsedMs: 499.99), .warning)
        XCTAssertEqual(RookPerformance.severity(forElapsedMs: 500), .error)
    }
}
