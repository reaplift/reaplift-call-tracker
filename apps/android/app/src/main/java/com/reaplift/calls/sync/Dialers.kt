package com.reaplift.calls.sync

import android.content.Context
import android.content.Intent
import android.provider.Settings

/**
 * The phone's default calling app does the recording. Some keep recordings private, so no other app can upload
 * them (found 13 November 2026: Google Phone on an OPPO, Truecaller on a VERTU). Same list as the server's
 * DIALERS_HIDING_RECORDINGS.
 */
object Dialers {
    val HIDING_RECORDINGS = mapOf(
        "com.google.android.dialer" to "Google Phone",
        "com.truecaller" to "Truecaller",
    )

    fun current(context: Context): String? = Sims(context).defaultDialer()

    /** The calling app's name when it keeps recordings private, else null. */
    fun hidingRecordings(packageName: String?): String? = packageName?.let { HIDING_RECORDINGS[it] }

    /** Android's "Default apps" screen, where the employee picks the phone app. */
    fun defaultAppsIntent(): Intent = Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
}
