package com.reaplift.calls.sync

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import com.reaplift.calls.data.LocalDb
import com.reaplift.calls.data.Prefs
import com.reaplift.calls.data.TrackingState
import com.reaplift.calls.net.ApiClient
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** One sync run: check the company SIM, read new calls, send the outbox. Shared by the worker and the screens. */
object Tracking {
    private val lock = Mutex()

    val REQUIRED_PERMISSIONS = listOf(Manifest.permission.READ_CALL_LOG, Manifest.permission.READ_PHONE_STATE)

    fun hasPermissions(context: Context) =
        REQUIRED_PERMISSIONS.all { context.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }

    suspend fun syncNow(context: Context): SendResult? = lock.withLock {
        val prefs = Prefs(context)
        if (!prefs.isPaired || prefs.state == TrackingState.REVOKED) return null
        if (!hasPermissions(context)) {
            setState(context, prefs, TrackingState.PERMISSION_MISSING)
            return null
        }
        // Privacy rule: if the company SIM is not where it was, read nothing until the employee picks it again.
        val matcher = Sims(context).matcherFor(prefs.companySubId)
        if (matcher == null) {
            setState(context, prefs, TrackingState.SIM_MISSING)
            return null
        }
        setState(context, prefs, TrackingState.ON)

        val db = LocalDb(context)
        val sync = CallSync(AndroidCallLog(context), db, db)
        val since = prefs.pairedAt - prefs.initialSyncDays * 86_400_000L
        prefs.lastCallLogId = sync.collect(prefs.lastCallLogId, since, matcher)

        val result = sync.send(ApiClient(prefs.serverUrl!!, prefs.deviceToken), System::currentTimeMillis)
        when (result) {
            is SendResult.Done -> prefs.lastSyncAt = System.currentTimeMillis()
            SendResult.Revoked -> setState(context, prefs, TrackingState.REVOKED)
            is SendResult.Failed -> Unit
        }
        return result
    }

    private fun setState(context: Context, prefs: Prefs, state: TrackingState) {
        if (prefs.state == state) return
        prefs.state = state
        Notifications.stateChanged(context, state)
        if (state == TrackingState.REVOKED) TrackingService.stop(context)
    }
}
