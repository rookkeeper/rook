// Abstracts the GPS stream + one-shot fix so arrival detection doesn't hard-require Google
// Play Services at runtime. Fused (better battery + the speed the classifier is calibrated
// to) is used when Play Services is present; otherwise falls back to the AOSP LocationManager
// so a de-Googled device still works. ARC (automotive) is separately optional — see
// MovementService (isAutomotive stays false without it, matching iOS-without-Core-Motion).
package com.rookery.rook.location

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Looper
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority

interface LocationSource {
    /** Begin continuous fixes at roughly [intervalMs]; [onFix] is called per fix. */
    fun start(intervalMs: Long, onFix: (Location) -> Unit)
    fun stop()
    /** One-shot best-effort current fix (null if unavailable). */
    fun requestCurrent(onResult: (Location?) -> Unit)

    companion object {
        fun playServicesAvailable(context: Context): Boolean =
            GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS

        fun create(context: Context): LocationSource =
            if (playServicesAvailable(context)) FusedLocationSource(context)
            else PlatformLocationSource(context)
    }
}

/** Play Services FusedLocationProviderClient — the preferred source. */
private class FusedLocationSource(context: Context) : LocationSource {
    private val client: FusedLocationProviderClient =
        LocationServices.getFusedLocationProviderClient(context)
    private var callback: LocationCallback? = null

    @SuppressLint("MissingPermission")
    override fun start(intervalMs: Long, onFix: (Location) -> Unit) {
        val request = LocationRequest.Builder(Priority.PRIORITY_BALANCED_POWER_ACCURACY, intervalMs).build()
        val cb = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                result.lastLocation?.let(onFix)
            }
        }
        callback = cb
        runCatching { client.requestLocationUpdates(request, cb, Looper.getMainLooper()) }
    }

    override fun stop() {
        callback?.let { runCatching { client.removeLocationUpdates(it) } }
        callback = null
    }

    @SuppressLint("MissingPermission")
    override fun requestCurrent(onResult: (Location?) -> Unit) {
        runCatching {
            client.lastLocation.addOnSuccessListener { onResult(it) }
            client.getCurrentLocation(Priority.PRIORITY_BALANCED_POWER_ACCURACY, null)
                .addOnSuccessListener { onResult(it) }
        }.onFailure { onResult(null) }
    }
}

/** AOSP LocationManager fallback — used when Google Play Services is absent. */
private class PlatformLocationSource(context: Context) : LocationSource {
    private val manager = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
    private var listener: LocationListener? = null

    @SuppressLint("MissingPermission")
    override fun start(intervalMs: Long, onFix: (Location) -> Unit) {
        val mgr = manager ?: return
        val l = LocationListener { onFix(it) }
        listener = l
        // GPS gives speed (Doppler) the classifier reads; NETWORK is a coarse fallback.
        for (provider in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
            if (mgr.isProviderEnabled(provider)) {
                runCatching { mgr.requestLocationUpdates(provider, intervalMs, 0f, l, Looper.getMainLooper()) }
            }
        }
    }

    override fun stop() {
        listener?.let { l -> runCatching { manager?.removeUpdates(l) } }
        listener = null
    }

    @SuppressLint("MissingPermission")
    override fun requestCurrent(onResult: (Location?) -> Unit) {
        val mgr = manager
        if (mgr == null) { onResult(null); return }
        val fix = runCatching { mgr.getLastKnownLocation(LocationManager.GPS_PROVIDER) }.getOrNull()
            ?: runCatching { mgr.getLastKnownLocation(LocationManager.NETWORK_PROVIDER) }.getOrNull()
        onResult(fix)
    }
}
