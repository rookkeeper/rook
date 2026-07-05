// Runnable check for PlaceStore (SharedPreferences-backed) using an in-memory fake:
// add/remove/upsert-by-slug, recordVisit merge-vs-new, promoteSuggestion, slugify.
package com.rookery.rook.location

import android.content.SharedPreferences
import com.rookery.rook.model.Place
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaceStoreTest {

    private fun store() = PlaceStore(FakePrefs())

    @Test fun addAndRemove() {
        val s = store()
        s.add("Office", 10.0, 20.0, 150.0)
        assertEquals(1, s.places.value.size)
        assertEquals("office", s.places.value.first().id)
        s.remove(s.places.value.first())
        assertTrue(s.places.value.isEmpty())
    }

    @Test fun addReplacesSameSlug() {
        val s = store()
        s.add("Office", 10.0, 20.0, 150.0)
        s.add("Office", 11.0, 21.0, 200.0)
        assertEquals(1, s.places.value.size)
        assertEquals(200.0, s.places.value.first().radius, 0.0)
    }

    @Test fun recordVisitCreatesThenBumpsSuggestion() {
        val s = store()
        s.recordVisit(40.0, -70.0)
        assertEquals(1, s.suggestions.value.size)
        assertEquals(1, s.suggestions.value.first().visitCount)
        // Same spot (within 120 m merge radius) bumps the count instead of adding a new one.
        s.recordVisit(40.00001, -70.00001)
        assertEquals(1, s.suggestions.value.size)
        assertEquals(2, s.suggestions.value.first().visitCount)
    }

    @Test fun recordVisitNearNamedPlaceIsIgnored() {
        val s = store()
        s.add("Home", 40.0, -70.0, 150.0)
        s.recordVisit(40.00001, -70.00001) // within merge radius of Home
        assertTrue(s.suggestions.value.isEmpty())
    }

    @Test fun promoteSuggestionAddsPlaceAndDropsSuggestion() {
        val s = store()
        s.recordVisit(40.0, -70.0)
        s.promoteSuggestion(s.suggestions.value.first(), "Gym", 120.0)
        assertEquals(1, s.places.value.size)
        assertEquals("gym", s.places.value.first().id)
        assertTrue(s.suggestions.value.isEmpty())
    }

    @Test fun slugifyCollapsesNonAlphanumerics() {
        assertEquals("my-cool-place", Place.slugify("  My  Cool!! Place  "))
        assertEquals("cafe-42", Place.slugify("Cafe #42"))
    }

    @Test fun persistsAcrossInstances() {
        val prefs = FakePrefs()
        PlaceStore(prefs).add("Office", 1.0, 2.0, 100.0)
        // A fresh store over the same prefs reloads it.
        assertEquals("office", PlaceStore(prefs).places.value.first().id)
    }
}

// Minimal in-memory SharedPreferences — PlaceStore only touches getString/edit/putString/apply.
private class FakePrefs : SharedPreferences {
    private val map = HashMap<String, Any?>()

    override fun getString(key: String?, defValue: String?): String? = (map[key] as? String) ?: defValue
    override fun getAll(): MutableMap<String, *> = map
    @Suppress("UNCHECKED_CAST")
    override fun getStringSet(key: String?, defValues: MutableSet<String>?): MutableSet<String>? =
        (map[key] as? MutableSet<String>) ?: defValues
    override fun getInt(key: String?, defValue: Int): Int = (map[key] as? Int) ?: defValue
    override fun getLong(key: String?, defValue: Long): Long = (map[key] as? Long) ?: defValue
    override fun getFloat(key: String?, defValue: Float): Float = (map[key] as? Float) ?: defValue
    override fun getBoolean(key: String?, defValue: Boolean): Boolean = (map[key] as? Boolean) ?: defValue
    override fun contains(key: String?): Boolean = map.containsKey(key)
    override fun registerOnSharedPreferenceChangeListener(l: SharedPreferences.OnSharedPreferenceChangeListener?) {}
    override fun unregisterOnSharedPreferenceChangeListener(l: SharedPreferences.OnSharedPreferenceChangeListener?) {}

    override fun edit(): SharedPreferences.Editor = FakeEditor()

    private inner class FakeEditor : SharedPreferences.Editor {
        private val staged = HashMap<String, Any?>()
        private val removed = HashSet<String>()
        override fun putString(key: String?, value: String?): SharedPreferences.Editor { staged[key!!] = value; return this }
        override fun putStringSet(key: String?, values: MutableSet<String>?): SharedPreferences.Editor { staged[key!!] = values; return this }
        override fun putInt(key: String?, value: Int): SharedPreferences.Editor { staged[key!!] = value; return this }
        override fun putLong(key: String?, value: Long): SharedPreferences.Editor { staged[key!!] = value; return this }
        override fun putFloat(key: String?, value: Float): SharedPreferences.Editor { staged[key!!] = value; return this }
        override fun putBoolean(key: String?, value: Boolean): SharedPreferences.Editor { staged[key!!] = value; return this }
        override fun remove(key: String?): SharedPreferences.Editor { removed.add(key!!); return this }
        override fun clear(): SharedPreferences.Editor { map.clear(); return this }
        override fun commit(): Boolean { apply(); return true }
        override fun apply() {
            removed.forEach { map.remove(it) }
            map.putAll(staged)
        }
    }
}
