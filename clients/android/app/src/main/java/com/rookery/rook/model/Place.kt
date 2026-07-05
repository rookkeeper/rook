// Mirrors clients/iphone/Sources/Location/Place.swift (Place, PlaceSuggestion, slugify)
package com.rookery.rook.model

import kotlinx.serialization.Serializable
import java.util.Locale

/**
 * A user-defined place. `id` is the slug used to build the environment id `loc:<id>`
 * and to resolve `environment-repository/loc/<id>/`.
 */
@Serializable
data class Place(
    val id: String,
    val name: String,
    val latitude: Double,
    val longitude: Double,
    val radius: Double
) {
    companion object {
        // Mirrors Place.slugify — lowercase, non-alphanumerics to '-', collapse runs.
        fun slugify(name: String): String {
            val mapped = name.lowercase(Locale.US)
                .map { if (it.isLetter() || it.isDigit()) it.toString() else "-" }
                .joinToString("")
            return mapped.split("-").filter { it.isNotEmpty() }.joinToString("-")
        }
    }
}

/** A detected location the user frequents but hasn't named yet. */
@Serializable
data class PlaceSuggestion(
    val id: String,
    val latitude: Double,
    val longitude: Double,
    val visitCount: Int
)
