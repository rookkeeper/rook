import CoreLocation
import Foundation

/// CoreLocation environment provider — the iOS analog of the macOS
/// `ForegroundAppMonitor`. Monitors geofenced places (CLCircularRegion region
/// monitoring, which relaunches the app on entry when Always-authorized) and
/// emits `onRegionChange` with the entered place (or `nil` on leaving all
/// regions). The model turns that into `loc:<slug>` register/unregister.
@MainActor
final class LocationProvider: NSObject, ObservableObject, CLLocationManagerDelegate {
    var onRegionChange: ((Place?) -> Void)?
    var onVisitArrival: ((CLLocationCoordinate2D) -> Void)?

    @Published private(set) var authorizationStatus: CLAuthorizationStatus
    @Published private(set) var currentLocation: CLLocation?
    private(set) var current: Place?

    private let manager = CLLocationManager()
    private var monitoredPlaces: [String: Place] = [:]

    override init() {
        authorizationStatus = manager.authorizationStatus
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    var isAuthorized: Bool {
        authorizationStatus == .authorizedAlways || authorizationStatus == .authorizedWhenInUse
    }

    var hasAlways: Bool {
        authorizationStatus == .authorizedAlways
    }

    func requestAuthorization() {
        // Two-step: When-In-Use first (iOS shows the Always upgrade prompt later).
        if authorizationStatus == .notDetermined {
            manager.requestWhenInUseAuthorization()
        } else if authorizationStatus == .authorizedWhenInUse {
            manager.requestAlwaysAuthorization()
        }
    }

    func requestCurrentLocation() {
        manager.requestLocation()
    }

    /// CLVisit-based "where you spend time" detection (Phase E). Fires
    /// `onVisitArrival` when you settle at a place — used to suggest naming it.
    func startMonitoringVisits() {
        manager.startMonitoringVisits()
    }

    /// (Re)build the monitored geofences from the user's places.
    func updateMonitoredPlaces(_ places: [Place]) {
        for region in manager.monitoredRegions {
            manager.stopMonitoring(for: region)
        }
        monitoredPlaces.removeAll()
        for place in places {
            let region = CLCircularRegion(
                center: CLLocationCoordinate2D(latitude: place.latitude, longitude: place.longitude),
                radius: place.radius,
                identifier: place.id
            )
            region.notifyOnEntry = true
            region.notifyOnExit = true
            monitoredPlaces[place.id] = place
            manager.startMonitoring(for: region)
            // Ask immediately whether we're already inside (e.g. app just launched here).
            manager.requestState(for: region)
        }
        // If the place we were "in" is gone, leave it.
        if let current, monitoredPlaces[current.id] == nil {
            self.current = nil
            onRegionChange?(nil)
        }
    }

    // MARK: - CLLocationManagerDelegate

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            let wasAuthorized = self.isAuthorized
            self.authorizationStatus = status
            if status == .authorizedAlways {
                manager.allowsBackgroundLocationUpdates = true
                manager.startMonitoringVisits()
            }
            if status == .authorizedAlways || status == .authorizedWhenInUse {
                // Grab an initial fix so the "save a place" UI has coordinates
                // and the first Save works without a second tap.
                manager.requestLocation()
                // Newly granted When-In-Use → escalate toward Always, since
                // background geofencing (the headline feature) requires it. iOS
                // shows the upgrade prompt once; PlacesScreen also offers a
                // manual upgrade if the user declines here.
                if !wasAuthorized && status == .authorizedWhenInUse {
                    manager.requestAlwaysAuthorization()
                }
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        Task { @MainActor in
            guard let place = monitoredPlaces[region.identifier] else {
                return
            }
            current = place
            onRegionChange?(place)
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
        Task { @MainActor in
            if current?.id == region.identifier {
                current = nil
                onRegionChange?(nil)
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didDetermineState state: CLRegionState, for region: CLRegion) {
        Task { @MainActor in
            guard let place = monitoredPlaces[region.identifier] else {
                return
            }
            if state == .inside, current?.id != place.id {
                current = place
                onRegionChange?(place)
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let last = locations.last else {
            return
        }
        Task { @MainActor in
            currentLocation = last
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didVisit visit: CLVisit) {
        // departureDate == distantFuture ⇒ an arrival (you're still here).
        guard visit.departureDate == Date.distantFuture else {
            return
        }
        let coordinate = visit.coordinate
        Task { @MainActor in
            onVisitArrival?(coordinate)
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Best-effort; region monitoring continues.
    }
}
