// Great-circle distance helper.
//
// ponytail: pure haversine instead of android.location.Location.distanceBetween so the
// PlaceStore merge logic and region point-in-circle checks are JVM-unit-testable (the
// framework static throws "not mocked" under plain JUnit). Accuracy at 120 m / place-radius
// scale is well within a metre — plenty for merge and geofence-equivalent membership.
package com.rookery.rook.location

import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

object Geo {
    private const val EARTH_RADIUS_M = 6_371_000.0

    fun metersBetween(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val dLat = Math.toRadians(lat2 - lat1)
        val dLon = Math.toRadians(lon2 - lon1)
        val a = sin(dLat / 2).pow(2) +
            cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLon / 2).pow(2)
        return 2 * EARTH_RADIUS_M * asin(min(1.0, sqrt(a)))
    }
}
