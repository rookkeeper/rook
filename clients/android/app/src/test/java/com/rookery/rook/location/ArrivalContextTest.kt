// Runnable check for LocationController.arrivalContext — the pure arrival gate ported from
// LocationProvider.arrivalContext (speed/automotive reject + field derivation).
package com.rookery.rook.location

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertNotNull
import org.junit.Test

class ArrivalContextTest {

    private fun ctx(
        arrivalTimeMs: Long? = 0L,
        accuracy: Double = 10.0,
        speed: Double? = 0.0,
        automotive: Boolean = false,
        now: Long = 60_000L
    ) = LocationController.arrivalContext(
        latitude = 1.0, longitude = 2.0,
        arrivalTimeMs = arrivalTimeMs, horizontalAccuracy = accuracy,
        speed = speed, isAutomotive = automotive, nowMs = now
    )

    @Test fun automotiveIsRejected() {
        assertNull(ctx(automotive = true))
    }

    @Test fun fastSpeedIsRejected() {
        assertNull(ctx(speed = 3.0)) // above 1.5 m/s threshold
    }

    @Test fun unknownSpeedIsTreatedAsSettled() {
        val c = ctx(speed = null)
        assertNotNull(c)
        assertNull(c!!.speedMetersPerSecond) // unknown → null field
    }

    @Test fun negativeAccuracyBecomesNull() {
        assertNull(ctx(accuracy = -1.0)!!.horizontalAccuracy)
    }

    @Test fun unknownArrivalTimeGivesNullDwell() {
        assertNull(ctx(arrivalTimeMs = null)!!.dwellSeconds)
    }

    @Test fun settledArrivalComputesDwell() {
        val c = ctx(arrivalTimeMs = 0L, now = 60_000L)
        assertNotNull(c)
        assertEquals(60.0, c!!.dwellSeconds!!, 0.001)
        assertEquals(true, c.isStationary)
    }
}
