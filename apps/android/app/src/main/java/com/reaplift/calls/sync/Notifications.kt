package com.reaplift.calls.sync

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.reaplift.calls.R
import com.reaplift.calls.data.TrackingState
import com.reaplift.calls.ui.MainActivity

object Notifications {
    const val TRACKING_CHANNEL = "tracking"
    private const val ALERTS_CHANNEL = "alerts"
    private const val AFTER_CALL_CHANNEL = "after_call"
    /** The extra MainActivity reads to open the after-call form for one call. */
    const val EXTRA_COMMENT_CALL = "comment_call_id"
    const val TRACKING_ID = 1
    private const val ALERT_ID = 2

    fun createChannels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(TRACKING_CHANNEL, "Call tracking is on", NotificationManager.IMPORTANCE_LOW),
        )
        manager.createNotificationChannel(
            NotificationChannel(ALERTS_CHANNEL, "Problems with call tracking", NotificationManager.IMPORTANCE_DEFAULT),
        )
        // High, so it shows on top of the screen right after the call: Android does not let apps open a screen by themselves.
        manager.createNotificationChannel(
            NotificationChannel(AFTER_CALL_CHANNEL, "After a work call", NotificationManager.IMPORTANCE_HIGH),
        )
    }

    private fun commentId(deviceCallId: String) = 1_000 + (deviceCallId.hashCode() and 0xFFFF)

    /** "How did the call go?" for one company-SIM call; tapping it opens the after-call form (M4). */
    fun askForComment(context: Context, call: OutgoingCall, who: String) {
        if (android.os.Build.VERSION.SDK_INT >= 33 &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        val id = commentId(call.deviceCallId)
        val open = PendingIntent.getActivity(
            context,
            id,
            Intent(context, MainActivity::class.java)
                .putExtra(EXTRA_COMMENT_CALL, call.deviceCallId)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val text = "${call.type.replaceFirstChar { it.uppercase() }} call with $who. Tap to add the outcome and a comment."
        NotificationManagerCompat.from(context).notify(
            id,
            NotificationCompat.Builder(context, AFTER_CALL_CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("How did the call go?")
                .setContentText(text)
                .setStyle(NotificationCompat.BigTextStyle().bigText(text))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setContentIntent(open)
                .setAutoCancel(true)
                .build(),
        )
    }

    fun cancelComment(context: Context, deviceCallId: String) =
        NotificationManagerCompat.from(context).cancel(commentId(deviceCallId))

    private fun openApp(context: Context) = PendingIntent.getActivity(
        context,
        0,
        Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
        PendingIntent.FLAG_IMMUTABLE,
    )

    fun tracking(context: Context): Notification =
        NotificationCompat.Builder(context, TRACKING_CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Call tracking is on")
            .setContentText("Work calls on your company SIM are synced")
            .setOngoing(true)
            .setContentIntent(openApp(context))
            .build()

    fun stateChanged(context: Context, state: TrackingState) {
        val text = when (state) {
            TrackingState.ON -> null
            TrackingState.SIM_MISSING -> "Your company SIM moved or was removed. Open the app and pick it again."
            TrackingState.PERMISSION_MISSING -> "Call log permission was turned off. Open the app to turn it back on."
            TrackingState.REVOKED -> "This phone was unpaired by your admin. Calls are no longer synced."
        }
        if (context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED &&
            android.os.Build.VERSION.SDK_INT >= 33
        ) return
        val manager = NotificationManagerCompat.from(context)
        if (text == null) {
            manager.cancel(ALERT_ID)
            return
        }
        manager.notify(
            ALERT_ID,
            NotificationCompat.Builder(context, ALERTS_CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("Call tracking paused")
                .setContentText(text)
                .setStyle(NotificationCompat.BigTextStyle().bigText(text))
                .setContentIntent(openApp(context))
                .setAutoCancel(true)
                .build(),
        )
    }
}
