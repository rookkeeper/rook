// Mirrors clients/iphone/Sources/Location/Place.swift (PlaceStore).
//
// Persisted set of places (SharedPreferences-backed JSON, the analog of iOS's
// UserDefaults JSON blobs). Seeds the "geofences" the MovementService checks and collects
// arrival-detected suggestions. Divergences from Swift (intentional):
// - SharedPreferences is injected (not Context-constructed) so tests can supply a fake.
// - Skips iOS's simulator-only ROOK_SEED_PLACE/ROOK_SEED_VISIT env hooks (the equivalent
//   test seam is LocationController.simulateArrival).
// - Mutators are @Synchronized: unlike iOS's @MainActor PlaceStore, recordVisit is called
//   from the background MovementService while the UI reads on the main thread.
package com.rookery.rook.location

import android.content.SharedPreferences
import com.rookery.rook.model.Place
import com.rookery.rook.model.PlaceSuggestion
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import java.util.Locale

class PlaceStore(private val prefs: SharedPreferences) {
    private val json = Json { ignoreUnknownKeys = true }

    private val _places = MutableStateFlow<List<Place>>(emptyList())
    val places: StateFlow<List<Place>> = _places.asStateFlow()

    private val _suggestions = MutableStateFlow<List<PlaceSuggestion>>(emptyList())
    val suggestions: StateFlow<List<PlaceSuggestion>> = _suggestions.asStateFlow()

    init {
        load()
    }

    // MARK: - Suggestions

    /**
     * Record an arrival. If near an existing named place, ignore it; if near an existing
     * suggestion, bump the count; otherwise add a new suggestion.
     */
    @Synchronized
    fun recordVisit(latitude: Double, longitude: Double) {
        if (_places.value.any { Geo.metersBetween(it.latitude, it.longitude, latitude, longitude) < MERGE_RADIUS_M }) {
            return
        }
        val current = _suggestions.value
        val index = current.indexOfFirst {
            Geo.metersBetween(it.latitude, it.longitude, latitude, longitude) < MERGE_RADIUS_M
        }
        _suggestions.value = if (index >= 0) {
            current.mapIndexed { i, s -> if (i == index) s.copy(visitCount = s.visitCount + 1) else s }
        } else {
            val id = "sugg-%.4f-%.4f".format(Locale.US, latitude, longitude)
            current + PlaceSuggestion(id = id, latitude = latitude, longitude = longitude, visitCount = 1)
        }
        saveSuggestions()
    }

    @Synchronized
    fun promoteSuggestion(suggestion: PlaceSuggestion, name: String, radius: Double) {
        add(name = name, latitude = suggestion.latitude, longitude = suggestion.longitude, radius = radius)
        dismissSuggestion(suggestion)
    }

    @Synchronized
    fun dismissSuggestion(suggestion: PlaceSuggestion) {
        _suggestions.value = _suggestions.value.filterNot { it.id == suggestion.id }
        saveSuggestions()
    }

    // MARK: - Places

    @Synchronized
    fun add(name: String, latitude: Double, longitude: Double, radius: Double) {
        val trimmed = name.trim()
        if (trimmed.isEmpty()) return
        var slug = Place.slugify(trimmed)
        if (slug.isEmpty()) slug = "place-${_places.value.size + 1}"
        // Replace any existing place with the same slug.
        _places.value = _places.value.filterNot { it.id == slug } +
            Place(id = slug, name = trimmed, latitude = latitude, longitude = longitude, radius = radius)
        save()
    }

    @Synchronized
    fun remove(place: Place) {
        _places.value = _places.value.filterNot { it.id == place.id }
        save()
    }

    // MARK: - Persistence

    private fun load() {
        prefs.getString(PLACES_KEY, null)?.let { raw ->
            runCatching { json.decodeFromString(ListSerializer(Place.serializer()), raw) }
                .getOrNull()?.let { _places.value = it }
        }
        prefs.getString(SUGGESTIONS_KEY, null)?.let { raw ->
            runCatching { json.decodeFromString(ListSerializer(PlaceSuggestion.serializer()), raw) }
                .getOrNull()?.let { _suggestions.value = it }
        }
    }

    private fun save() {
        prefs.edit()
            .putString(PLACES_KEY, json.encodeToString(ListSerializer(Place.serializer()), _places.value))
            .apply()
    }

    private fun saveSuggestions() {
        prefs.edit()
            .putString(SUGGESTIONS_KEY, json.encodeToString(ListSerializer(PlaceSuggestion.serializer()), _suggestions.value))
            .apply()
    }

    private companion object {
        const val MERGE_RADIUS_M = 120.0
        const val PLACES_KEY = "RookPlaces"
        const val SUGGESTIONS_KEY = "RookPlaceSuggestions"
    }
}
