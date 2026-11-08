package com.reaplift.calls.sync

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.reaplift.calls.data.Prefs
import com.reaplift.calls.data.TrackingState

/** Starts tracking again after a reboot or an app update. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val prefs = Prefs(context)
        if (!prefs.isPaired || prefs.state == TrackingState.REVOKED) return
        SyncWorker.schedulePeriodic(context)
        try {
            TrackingService.start(context)
        } catch (e: Exception) {
            // Some brands refuse a start from the background; the periodic sync still runs.
            SyncWorker.syncSoon(context)
        }
    }
}
