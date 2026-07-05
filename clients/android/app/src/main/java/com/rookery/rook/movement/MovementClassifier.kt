// Stateless per-fix movement emitter. Ports the emit() decision tree in
// ~/Downloads/android-movement-classifier-handoff.md (§3 Emitter), cross-checked against
// ~/code/timeline/timeline-core/src/machine/capture/movement.rs. Pure, framework-free.
//
// ponytail: the road-context branches are implemented but dormant in v0 (callers pass
// nearestRoad = null). The gridlock stationary-fraction override and the trailing 5-min
// motion-features (compute_motion_features / classify_motion_trailing) are omitted — both
// require road context and/or a GPS trailing window that v0 doesn't collect (v0 feeds the
// instantaneous Fused location.speed). Add them with the road provider.
package com.rookery.rook.movement

data class Vote(val type: MovementType, val confidence: Float)

object MovementClassifier {
    const val WALKING_CEILING_MPS = 2.2   // ~5 mph
    const val DRIVING_FLOOR_MPS = 8.9     // ~20 mph
    const val GPS_ACCURACY_GATE_M = 30.0  // fall back to accel-only above this

    /**
     * @param instSpeedMps instantaneous speed (m/s) from the fix, or null if unknown.
     * @param gpsAccuracyM horizontal accuracy (m) of the fix, or null if unknown.
     * @param nearestRoad nearest-road context, or null (always null in v0).
     */
    fun emit(
        instSpeedMps: Double?,
        gpsAccuracyM: Double?,
        nearestRoad: RoadContext?,
        accel: AccelStats
    ): Vote {
        // Poor GPS → trust the accelerometer only.
        if (gpsAccuracyM != null && gpsAccuracyM > GPS_ACCURACY_GATE_M) {
            return classifyAccelOnly(accel)
        }

        // Road-context priors (dormant in v0).
        if (nearestRoad != null && instSpeedMps != null) {
            val d = nearestRoad.distanceMeters
            val cls = nearestRoad.roadClass
            when {
                isHighway(cls) && d < 10.0 && instSpeedMps > 2.2 -> {
                    // Counter-signal: if we're a bit off the road AND the accel looks like
                    // walking cadence, the GPS snap was wrong — fall through to speed-only.
                    val walkingCadence = accel.dominantFrequency in 1.0f..3.0f && accel.stepCount > 4
                    if (!(d > 5.0 && walkingCadence)) return Vote(MovementType.Driving, 0.95f)
                }
                isFootpath(cls) && d < 5.0 && instSpeedMps > 1.1 -> return Vote(MovementType.Walking, 0.90f)
                isVehicular(cls) && d < 10.0 && instSpeedMps > 2.2 -> return Vote(MovementType.Driving, 0.85f)
                d > 50.0 && instSpeedMps in 0.5..2.2 -> return Vote(MovementType.Walking, 0.90f)
            }
        }

        // Speed-only.
        if (instSpeedMps != null) {
            if (instSpeedMps > DRIVING_FLOOR_MPS) return Vote(MovementType.Driving, 0.90f)
            if (instSpeedMps > WALKING_CEILING_MPS) return Vote(MovementType.Walking, 0.85f)
        }

        // Accel-only fallback.
        return classifyAccelOnly(accel)
    }

    // Handoff §3 classify_accel_only table — first match wins, top to bottom.
    fun classifyAccelOnly(s: AccelStats): Vote {
        val f = s.dominantFrequency
        val v = s.variance
        return when {
            f > 2.5f && v > 0.3f -> Vote(MovementType.Running, 0.50f)
            f > 1.0f && v > 0.01f -> Vote(MovementType.Walking, 0.60f)
            s.stepCount > 0 && v > 0.02f -> Vote(MovementType.Walking, 0.40f)
            f < 1.0f && v < 1.0f -> Vote(MovementType.Stationary, 0.70f)
            f < 1.0f && v >= 1.0f && v < 5.0f -> Vote(MovementType.Driving, 0.40f)
            else -> Vote(MovementType.Stationary, 0.85f)
        }
    }

    private fun isHighway(c: String): Boolean =
        c == "motorway" || c == "trunk" || c.endsWith("_link")

    private fun isFootpath(c: String): Boolean =
        c == "footway" || c == "path" || c == "pedestrian" || c == "steps"

    private fun isVehicular(c: String): Boolean =
        c == "residential" || c == "unclassified" || c == "service"
}
