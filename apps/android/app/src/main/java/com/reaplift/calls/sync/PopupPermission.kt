package com.reaplift.calls.sync

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings

/**
 * "Display over other apps" (client, 12 November 2026): lets the after-call pop-up open by itself when a company-SIM
 * call ends, over whatever is on screen. Without it the app falls back to the "How did the call go?" notification.
 */
object PopupPermission {
    fun granted(context: Context) = Settings.canDrawOverlays(context)

    fun settingsIntent(context: Context) =
        Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
}
