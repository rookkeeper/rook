// Mirrors ~/code/timeline/timeline-core/src/machine/capture/movement.rs::calculate_accel_stats
// (+ step_detection.rs). AccelStats feeds MovementClassifier's accel-only fallback.
package com.rookery.rook.movement

import kotlin.math.sqrt

data class AccelStats(
    val variance: Float,
    val meanMagnitude: Float,
    val dominantFrequency: Float, // peak step cadence, Hz
    val stepCount: Int,
    val windowDuration: Float     // seconds
) {
    companion object {
        val EMPTY = AccelStats(0f, 0f, 0f, 0, 0f)

        /**
         * magnitude = sqrt(x²+y²+z²) per sample; mean + variance of magnitude; step
         * cadence from peak detection. Mirrors calculate_accel_stats.
         */
        fun calculate(x: FloatArray, y: FloatArray, z: FloatArray, sampleRateHz: Int): AccelStats {
            if (x.isEmpty() || sampleRateHz <= 0) return EMPTY
            val n = minOf(x.size, y.size, z.size)
            val magnitudes = FloatArray(n) { i -> sqrt(x[i] * x[i] + y[i] * y[i] + z[i] * z[i]) }

            val mean = magnitudes.sum() / n
            var varAccum = 0f
            for (m in magnitudes) {
                val d = m - mean
                varAccum += d * d
            }
            val variance = varAccum / n

            val (stepCount, dominantFrequency) = detectSteps(magnitudes, mean, variance, sampleRateHz)
            val windowDuration = n.toFloat() / sampleRateHz.toFloat()
            return AccelStats(variance, mean, dominantFrequency, stepCount, windowDuration)
        }

        // ponytail: simplified step detector — prominent local maxima above (mean + 0.5·std)
        // with a per-step refractory gap, instead of the FIR-lowpass + autocorrelation in
        // step_detection.rs. Cadence = peaks / windowSeconds. Good enough for the accel-only
        // fallback (GPS speed is the primary signal); upgrade to autocorrelation only if
        // accel-only misclassification is actually observed.
        private fun detectSteps(
            magnitudes: FloatArray,
            mean: Float,
            variance: Float,
            sampleRateHz: Int
        ): Pair<Int, Float> {
            val n = magnitudes.size
            if (n < 3) return 0 to 0f
            val threshold = mean + 0.5f * sqrt(variance)
            // Refractory: no two steps within ~0.25 s (max plausible cadence ~4 Hz).
            val minGap = maxOf(1, sampleRateHz / 4)
            var steps = 0
            var lastPeak = -minGap
            for (i in 1 until n - 1) {
                val m = magnitudes[i]
                val isPeak = m > magnitudes[i - 1] && m >= magnitudes[i + 1] && m > threshold
                if (isPeak && i - lastPeak >= minGap) {
                    steps++
                    lastPeak = i
                }
            }
            val seconds = n.toFloat() / sampleRateHz.toFloat()
            val frequency = if (seconds > 0f) steps / seconds else 0f
            return steps to frequency
        }
    }
}
