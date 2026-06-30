import CoreLocation
import XCTest
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
