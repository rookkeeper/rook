// Stateful vote debouncer. Net-new (no Rust source) — implemented from the CHRE-style spec
// in ~/Downloads/android-movement-classifier-handoff.md (§4), whose defaults are the
// reverse-engineered Google CHRE Activity-Recognition parameters.
//
// Turns the noisy per-fix Vote stream into a stable MovementType: a majority window, a
// per-direction latency (fast into Driving, slow otherwise), a minimum run of agreeing
// votes, and a "vehicle sticky" guard that resists a premature flip to Stationary right
// after driving (a red light shouldn't read as "arrived").
package com.rookery.rook.movement

class VoteDebouncer(
    private val majorityWindow: Int = 5,
    private val rapidLatencyMs: Long = 15_000,   // enter Driving
    private val defaultLatencyMs: Long = 60_000, // all other transitions
    private val vehicleStickyMs: Long = 150_000, // suppress →Stationary after a Driving vote
    private val minContinuous: Int = 3
) {
    private val window = ArrayDeque<MovementType>()
    private var current: MovementType = MovementType.Unknown
    private var pendingType: MovementType? = null
    private var pendingCount = 0
    private var pendingSinceMs = 0L
    private var lastDrivingVoteMs: Long? = null

    /** Feed one vote; returns the debounced stable type. `nowMs` is a monotonic clock. */
    fun tick(vote: Vote, nowMs: Long): MovementType {
        window.addLast(vote.type)
        while (window.size > majorityWindow) window.removeFirst()
        if (vote.type == MovementType.Driving) lastDrivingVoteMs = nowMs

        val majority = majorityVote() ?: return current

        if (majority == current) {
            // Settled on the current state — drop any half-formed transition.
            pendingType = null
            pendingCount = 0
            return current
        }

        // Accumulate the pending transition (whether or not sticky suppresses it).
        if (pendingType == majority) {
            pendingCount++
        } else {
            pendingType = majority
            pendingCount = 1
            pendingSinceMs = nowMs
        }

        // Vehicle sticky: fresh off Driving, ignore a flip to Stationary for a while.
        val last = lastDrivingVoteMs
        val stickyOverride = current == MovementType.Driving &&
            majority == MovementType.Stationary &&
            last != null && (nowMs - last) < vehicleStickyMs
        if (stickyOverride) return current

        val latency = if (majority == MovementType.Driving) rapidLatencyMs else defaultLatencyMs
        if (pendingCount >= minContinuous && (nowMs - pendingSinceMs) >= latency) {
            current = majority
            pendingType = null
            pendingCount = 0
        }
        return current
    }

    fun currentType(): MovementType = current

    // Counts per type; a type wins at floor(len/2)+1. No winner → null (no change).
    private fun majorityVote(): MovementType? {
        if (window.isEmpty()) return null
        val threshold = window.size / 2 + 1
        return window.groupingBy { it }.eachCount()
            .entries.firstOrNull { it.value >= threshold }?.key
    }
}
