// Mirrors the RoadContext in ~/Downloads/android-movement-classifier-handoff.md.
//
// v0: this type exists so MovementClassifier.emit's road-context branch is present, but no
// provider populates it yet (OSRM/PTILES is a documented follow-on) — callers pass null and
// the classifier degrades to speed + accel.
package com.rookery.rook.movement

data class RoadContext(
    val roadClass: String,      // OSM highway tag: "motorway", "footway", "residential", ...
    val distanceMeters: Double, // fix → nearest road
    val snappedLat: Double,
    val snappedLon: Double
)
