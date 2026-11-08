package com.reaplift.calls.ui

import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings

/** Per-brand steps that stop the phone from closing the app in the background (HLD section 8.4). */
data class BrandGuide(val brand: String, val steps: List<String>, val settingsScreens: List<ComponentName>)

private val GENERAL = BrandGuide(
    "your phone",
    listOf(
        "Open Settings, then Apps, then ReapLift Calls.",
        "Open Battery and choose Unrestricted (or turn off battery optimisation).",
        "If there is an Autostart or Background activity switch, turn it on.",
    ),
    emptyList(),
)

// Written from each brand's usual menus; check against the test phones (open-questions.md, T3) and correct.
private val GUIDES = mapOf(
    "samsung" to BrandGuide(
        "Samsung",
        listOf(
            "Open Settings, then Apps, then ReapLift Calls, then Battery.",
            "Choose Unrestricted.",
            "Open Settings, then Battery, then Background usage limits, and make sure ReapLift Calls is not in Sleeping apps or Deep sleeping apps.",
        ),
        emptyList(),
    ),
    "oppo" to BrandGuide(
        "Oppo",
        listOf(
            "Open Settings, then Apps, then App management, then ReapLift Calls.",
            "Turn on Allow auto launch (or Auto startup).",
            "Open Battery usage and turn on Allow background activity.",
        ),
        listOf(
            ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"),
            ComponentName("com.oplus.safecenter", "com.oplus.safecenter.startupapp.StartupAppListActivity"),
        ),
    ),
    "vivo" to BrandGuide(
        "Vivo",
        listOf(
            "Open Settings, then Battery, then Background power consumption management, and choose Allow for ReapLift Calls.",
            "Open i Manager (or Settings, then Apps), then Autostart, and turn on ReapLift Calls.",
        ),
        listOf(
            ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"),
            ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager"),
        ),
    ),
)

fun guideForThisPhone(): BrandGuide {
    val brand = Build.MANUFACTURER.lowercase()
    return GUIDES[brand] ?: if (brand in setOf("realme", "oneplus")) GUIDES.getValue("oppo") else GENERAL
}

/** Opens the brand's autostart screen if the phone has one, otherwise the app's own settings page. */
fun openAutostartSettings(context: Context, guide: BrandGuide) {
    for (screen in guide.settingsScreens) {
        try {
            context.startActivity(Intent().setComponent(screen).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            return
        } catch (e: ActivityNotFoundException) {
            continue
        } catch (e: SecurityException) {
            continue
        }
    }
    context.startActivity(
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
}
