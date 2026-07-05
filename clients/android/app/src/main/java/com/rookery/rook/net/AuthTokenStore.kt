// Mirrors the iPhone app's Keychain-backed auth-token storage (RookModel's server token).
// EncryptedSharedPreferences is the Android-Keystore-backed analog of iOS Keychain — the
// one genuinely security-sensitive value gets hardware-backed encryption; everything else
// (base URL, places) stays in plain SharedPreferences.
package com.rookery.rook.net

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class AuthTokenStore(context: Context) {
    private val appContext = context.applicationContext

    // Lazy: MasterKey/Keystore init touches hardware crypto and shouldn't run on construction.
    private val prefs by lazy {
        val masterKey = MasterKey.Builder(appContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            appContext,
            "rook_secure",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    fun get(): String = prefs.getString(KEY, "").orEmpty()

    fun set(token: String) {
        prefs.edit().putString(KEY, token).apply()
    }

    private companion object {
        const val KEY = "authToken"
    }
}
