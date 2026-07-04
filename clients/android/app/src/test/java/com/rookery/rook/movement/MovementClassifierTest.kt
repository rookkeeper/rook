// Runnable check for the ported emit() decision tree + classifyAccelOnly table
// (~/Downloads/android-movement-classifier-handoff.md §3 / timeline movement.rs). Pure
// functions, no Android — plain JUnit.
package com.rookery.rook.movement

import org.junit.Assert.assertEquals
import org.junit.Test

class MovementClassifierTest {

    private val still = AccelStats.EMPTY

    @Test fun fastSpeedIsDriving() {
        assertEquals(MovementType.Driving, MovementClassifier.emit(12.0, 5.0, null, still).type)
    }

    @Test fun moderateSpeedIsWalking() {
        assertEquals(MovementType.Walking, MovementClassifier.emit(3.0, 5.0, null, still).type)
    }

    @Test fun poorAccuracyFallsBackToAccelOnly() {
        // Speed says Driving, but accuracy > 30 m forces accel-only; empty accel → Stationary.
        assertEquals(MovementType.Stationary, MovementClassifier.emit(20.0, 50.0, null, still).type)
    }

    @Test fun accelOnlyRunning() {
        assertEquals(MovementType.Running, MovementClassifier.classifyAccelOnly(stats(freq = 3.0f, variance = 0.5f)).type)
    }

    @Test fun accelOnlyWalkingByFrequency() {
        assertEquals(MovementType.Walking, MovementClassifier.classifyAccelOnly(stats(freq = 1.5f, variance = 0.1f)).type)
    }

    @Test fun accelOnlyWalkingByStepCount() {
        // freq < 1 so the frequency branch misses; step-count branch catches it.
        assertEquals(
            MovementType.Walking,
            MovementClassifier.classifyAccelOnly(stats(freq = 0.5f, variance = 0.03f, steps = 3)).type
        )
    }

    @Test fun accelOnlyStationaryLowVariance() {
        assertEquals(MovementType.Stationary, MovementClassifier.classifyAccelOnly(stats(freq = 0.5f, variance = 0.5f)).type)
    }

    @Test fun accelOnlyDrivingMidVariance() {
        assertEquals(MovementType.Driving, MovementClassifier.classifyAccelOnly(stats(freq = 0.5f, variance = 2.0f)).type)
    }

    @Test fun accelOnlyStationaryHighVariance() {
        // freq < 1, variance >= 5 → the else branch (Stationary 0.85).
        assertEquals(MovementType.Stationary, MovementClassifier.classifyAccelOnly(stats(freq = 0.5f, variance = 6.0f)).type)
    }

    @Test fun nullSpeedWithNoAccelIsStationary() {
        assertEquals(MovementType.Stationary, MovementClassifier.emit(null, null, null, still).type)
    }

    @Test fun calculateAccelStatsFlatSignalHasLowVariance() {
        val n = 100
        val x = FloatArray(n) { 0f }; val y = FloatArray(n) { 0f }; val z = FloatArray(n) { 9.8f }
        val stats = AccelStats.calculate(x, y, z, 50)
        assertEquals(9.8f, stats.meanMagnitude, 0.01f)
        assertEquals(0f, stats.variance, 0.001f)
    }

    private fun stats(freq: Float, variance: Float, steps: Int = 0) =
        AccelStats(variance = variance, meanMagnitude = 1f, dominantFrequency = freq, stepCount = steps, windowDuration = 2f)
}
