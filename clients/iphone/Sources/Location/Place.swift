import CoreLocation
import Foundation

/// A user-defined geofenced place. `id` is the slug used to build the
/// environment id `loc:<id>` and to resolve `environment-repository/loc/<id>/`.
struct Place: Codable, Equatable, Identifiable {
    var id: String
    var name: String
    var latitude: Double
    var longitude: Double
    var radius: Double

    static func slugify(_ name: String) -> String {
        let lowered = name.lowercased()
        let mapped = lowered.map { $0.isLetter || $0.isNumber ? String($0) : "-" }.joined()
        return mapped.split(separator: "-").joined(separator: "-")
    }
}

/// A CLVisit-detected location the user frequents but hasn't named yet.
struct PlaceSuggestion: Codable, Equatable, Identifiable {
    var id: String
    var latitude: Double
    var longitude: Double
    var visitCount: Int
}

/// Persisted set of places (UserDefaults-backed JSON). Seeds the geofences the
/// LocationProvider monitors and collects CLVisit auto-detect suggestions (Phase E).
@MainActor
final class PlaceStore: ObservableObject {
    @Published private(set) var places: [Place] = []
    @Published private(set) var suggestions: [PlaceSuggestion] = []

    private let defaultsKey = "RookPlaces"
    private let suggestionsKey = "RookPlaceSuggestions"
    private let mergeRadiusMeters = 120.0

    init() {
        load()
        seedFromEnvironmentIfNeeded()
    }

    // MARK: - Suggestions (CLVisit)

    /// Record an arrival. If it's near an existing place or suggestion, bump the
    /// count; otherwise add a new suggestion. Ignores arrivals near named places.
    func recordVisit(latitude: Double, longitude: Double) {
        if places.contains(where: { metersBetween($0.latitude, $0.longitude, latitude, longitude) < mergeRadiusMeters }) {
            return
        }
        if let index = suggestions.firstIndex(where: { metersBetween($0.latitude, $0.longitude, latitude, longitude) < mergeRadiusMeters }) {
            suggestions[index].visitCount += 1
        } else {
            let id = String(format: "sugg-%.4f-%.4f", latitude, longitude)
            suggestions.append(PlaceSuggestion(id: id, latitude: latitude, longitude: longitude, visitCount: 1))
        }
        saveSuggestions()
    }

    func promoteSuggestion(_ suggestion: PlaceSuggestion, name: String, radius: Double) {
        add(name: name, latitude: suggestion.latitude, longitude: suggestion.longitude, radius: radius)
        dismissSuggestion(suggestion)
    }

    func dismissSuggestion(_ suggestion: PlaceSuggestion) {
        suggestions.removeAll { $0.id == suggestion.id }
        saveSuggestions()
    }

    private func metersBetween(_ lat1: Double, _ lon1: Double, _ lat2: Double, _ lon2: Double) -> Double {
        let a = CLLocation(latitude: lat1, longitude: lon1)
        let b = CLLocation(latitude: lat2, longitude: lon2)
        return a.distance(from: b)
    }

    /// Test hook: `ROOK_SEED_PLACE="Name,lat,lon,radius"` seeds a place on
    /// launch (used for simulator verification via SIMCTL_CHILD_ROOK_SEED_PLACE).
    private func seedFromEnvironmentIfNeeded() {
        guard let raw = ProcessInfo.processInfo.environment["ROOK_SEED_PLACE"] else {
            return
        }
        let parts = raw.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        guard parts.count == 4,
              let lat = Double(parts[1]), let lon = Double(parts[2]), let r = Double(parts[3]) else {
            return
        }
        add(name: parts[0], latitude: lat, longitude: lon, radius: r)

        // ROOK_SEED_VISIT="lat,lon,count" seeds a CLVisit suggestion for testing.
        if let visit = ProcessInfo.processInfo.environment["ROOK_SEED_VISIT"] {
            let vp = visit.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
            if vp.count == 3, let vlat = Double(vp[0]), let vlon = Double(vp[1]), let count = Int(vp[2]) {
                let id = String(format: "sugg-%.4f-%.4f", vlat, vlon)
                suggestions = [PlaceSuggestion(id: id, latitude: vlat, longitude: vlon, visitCount: count)]
            }
        }
    }

    func add(name: String, latitude: Double, longitude: Double, radius: Double) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return
        }
        var slug = Place.slugify(trimmed)
        if slug.isEmpty {
            slug = "place-\(places.count + 1)"
        }
        // Replace any existing place with the same slug.
        places.removeAll { $0.id == slug }
        places.append(Place(id: slug, name: trimmed, latitude: latitude, longitude: longitude, radius: radius))
        save()
    }

    func remove(_ place: Place) {
        places.removeAll { $0.id == place.id }
        save()
    }

    private func load() {
        if let data = UserDefaults.standard.data(forKey: defaultsKey),
           let decoded = try? JSONDecoder().decode([Place].self, from: data) {
            places = decoded
        }
        if let data = UserDefaults.standard.data(forKey: suggestionsKey),
           let decoded = try? JSONDecoder().decode([PlaceSuggestion].self, from: data) {
            suggestions = decoded
        }
    }

    private func save() {
        if let data = try? JSONEncoder().encode(places) {
            UserDefaults.standard.set(data, forKey: defaultsKey)
        }
    }

    private func saveSuggestions() {
        if let data = try? JSONEncoder().encode(suggestions) {
            UserDefaults.standard.set(data, forKey: suggestionsKey)
        }
    }
}
