// Runnable check for the VoteDebouncer state machine (net-new from the handoff §4 spec):
// majority window, per-direction latency, min-continuous, and vehicle sticky.
package com.rookery.rook.movement

import org.junit.Assert.assertEquals
import org.junit.Test

class VoteDebouncerTest {

    private fun driving() = Vote(MovementType.Driving, 0.9f)
    private fun stationary() = Vote(MovementType.Stationary, 0.9f)

    @Test fun transitionsToDrivingAfterLatencyAndMinContinuous() {
        val d = VoteDebouncer()
        // Rapid latency for Driving is 15 s; min-continuous 3. Feed Driving votes at 7 s cadence.
        assertEquals(MovementType.Unknown, d.tick(driving(), 0))
        assertEquals(MovementType.Unknown, d.tick(driving(), 7_000))
        assertEquals(MovementType.Unknown, d.tick(driving(), 14_000)) // count 3 but elapsed < 15 s
        assertEquals(MovementType.Driving, d.tick(driving(), 21_000)) // elapsed 21 s ≥ 15 s
    }

    @Test fun doesNotTransitionBeforeMinContinuous() {
        val d = VoteDebouncer()
        d.tick(driving(), 0)
        // Only two Driving votes then plenty of time — min-continuous (3) not met.
        assertEquals(MovementType.Unknown, d.tick(driving(), 100_000))
    }

    @Test fun vehicleStickyKeepsDrivingThroughStationaryMajority() {
        val d = VoteDebouncer()
        // Drive first.
        d.tick(driving(), 0); d.tick(driving(), 7_000); d.tick(driving(), 14_000)
        assertEquals(MovementType.Driving, d.tick(driving(), 21_000))
        // Now Stationary becomes the majority, but we're within 150 s of the last Driving vote.
        d.tick(stationary(), 28_000)
        d.tick(stationary(), 35_000)
        // window = [D,D,S,S,S]→ majority Stationary, but sticky overrides.
        assertEquals(MovementType.Driving, d.tick(stationary(), 42_000))
    }

    @Test fun transitionsOutOfDrivingAfterStickyExpires() {
        val d = VoteDebouncer()
        d.tick(driving(), 0); d.tick(driving(), 7_000); d.tick(driving(), 14_000)
        d.tick(driving(), 21_000) // Driving
        // Feed Stationary well past the 150 s sticky window; the default (non-Driving)
        // latency is 60 s, so advance long enough to clear it.
        var last = MovementType.Driving
        var t = 200_000L
        repeat(15) { last = d.tick(stationary(), t); t += 10_000 }
        assertEquals(MovementType.Stationary, last)
    }
}
