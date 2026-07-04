// Mirrors ~/code/timeline/timeline-core/src/machine/capture/movement.rs (MovementType) and
// the spec in ~/Downloads/android-movement-classifier-handoff.md.
package com.rookery.rook.movement

enum class MovementType {
    Stationary,
    Walking,
    Running,
    Driving,
    Unknown // initial state only
}
