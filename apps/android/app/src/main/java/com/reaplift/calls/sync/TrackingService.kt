package com.reaplift.calls.sync

import android.annotation.SuppressLint
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.database.ContentObserver
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.CallLog
import android.telephony.PhoneStateListener
import android.telephony.TelephonyCallback
import android.telephony.TelephonyManager
import androidx.core.app.ServiceCompat
import com.reaplift.calls.data.LocalDb
import com.reaplift.calls.data.Prefs

/**
 * Keeps tracking alive (HLD section 8.4): a permanent notification, a watch on the call log so a call
 * syncs within seconds, and the company SIM's call state, to measure ringing time (section 8.3).
 */
class TrackingService : Service() {
    private var observer: ContentObserver? = null
    private var stopListening: (() -> Unit)? = null
    private var lastState = TelephonyManager.CALL_STATE_IDLE

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
        ServiceCompat.startForeground(this, Notifications.TRACKING_ID, Notifications.tracking(this), type)
        if (observer == null) watchCallLog()
        if (stopListening == null) listenToCallState()
        SyncWorker.syncSoon(this, delaySeconds = 0)
        return START_STICKY
    }

    private fun watchCallLog() {
        val o = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean) = SyncWorker.syncSoon(this@TrackingService)
        }
        try {
            contentResolver.registerContentObserver(CallLog.Calls.CONTENT_URI, true, o)
            observer = o
        } catch (e: SecurityException) {
            // Permission gone: Tracking reports it, and the periodic sync keeps checking.
        }
    }

    private fun onCallState(state: Int) {
        if (state == TelephonyManager.CALL_STATE_IDLE && lastState != TelephonyManager.CALL_STATE_IDLE) {
            LocalDb(this).record(System.currentTimeMillis())
        }
        lastState = state
    }

    @SuppressLint("MissingPermission")
    @Suppress("DEPRECATION")
    private fun listenToCallState() {
        val subId = Prefs(this).companySubId
        if (subId < 0 || !Tracking.hasPermissions(this)) return
        val telephony = getSystemService(TelephonyManager::class.java)?.createForSubscriptionId(subId) ?: return
        try {
            if (Build.VERSION.SDK_INT >= 31) {
                val callback = object : TelephonyCallback(), TelephonyCallback.CallStateListener {
                    override fun onCallStateChanged(state: Int) = onCallState(state)
                }
                telephony.registerTelephonyCallback(mainExecutor, callback)
                stopListening = { telephony.unregisterTelephonyCallback(callback) }
            } else {
                val listener = object : PhoneStateListener() {
                    override fun onCallStateChanged(state: Int, phoneNumber: String?) = onCallState(state)
                }
                telephony.listen(listener, PhoneStateListener.LISTEN_CALL_STATE)
                stopListening = { telephony.listen(listener, PhoneStateListener.LISTEN_NONE) }
            }
        } catch (e: SecurityException) {
            // Ringing time is left empty, never guessed.
        }
    }

    override fun onDestroy() {
        observer?.let { contentResolver.unregisterContentObserver(it) }
        stopListening?.invoke()
        super.onDestroy()
    }

    companion object {
        fun start(context: Context) {
            context.startForegroundService(Intent(context, TrackingService::class.java))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, TrackingService::class.java))
        }

        /** After choosing a new company SIM the call-state listener must follow it. */
        fun restart(context: Context) {
            stop(context)
            start(context)
        }
    }
}
