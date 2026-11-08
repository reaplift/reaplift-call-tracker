package com.reaplift.calls.sync

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.telecom.TelecomManager
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager

data class SimInfo(val subId: Int, val slot: Int, val carrier: String, val number: String?)

/** The phone's SIMs, and which call log rows belong to the company one. */
class Sims(private val context: Context) {
    private fun granted(permission: String) =
        context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

    @SuppressLint("MissingPermission")
    fun active(): List<SimInfo> {
        if (!granted(Manifest.permission.READ_PHONE_STATE)) return emptyList()
        val manager = context.getSystemService(SubscriptionManager::class.java) ?: return emptyList()
        return manager.activeSubscriptionInfoList.orEmpty()
            .map { info ->
                SimInfo(
                    subId = info.subscriptionId,
                    slot = info.simSlotIndex,
                    carrier = info.carrierName?.toString().orEmpty().ifBlank { info.displayName?.toString().orEmpty() },
                    number = phoneNumber(manager, info.subscriptionId, info.number),
                )
            }
            .sortedBy { it.slot }
    }

    /** Android often does not know a SIM's own number; this is only a hint for the SIM picker. */
    @SuppressLint("MissingPermission")
    @Suppress("DEPRECATION")
    private fun phoneNumber(manager: SubscriptionManager, subId: Int, legacy: String?): String? =
        try {
            val n = if (Build.VERSION.SDK_INT >= 33 && granted(Manifest.permission.READ_PHONE_NUMBERS)) {
                manager.getPhoneNumber(subId)
            } else {
                legacy
            }
            n?.filter { it.isDigit() }?.takeIf { it.length >= 10 }
        } catch (e: SecurityException) {
            null
        }

    /**
     * Every phone-account ID the call log may use for this SIM. Brands differ: some write the subscription
     * ID, some an ID of their own; Android 11+ can map each calling account to its SIM, which covers both.
     * Null when the SIM is not in the phone any more.
     */
    @SuppressLint("MissingPermission")
    @Suppress("DEPRECATION")
    fun matcherFor(subId: Int): CompanySimMatcher? {
        val sims = active()
        val sim = sims.firstOrNull { it.subId == subId } ?: return null
        val ids = mutableSetOf(sim.subId.toString())
        val subscriptions = context.getSystemService(SubscriptionManager::class.java)
        subscriptions?.getActiveSubscriptionInfo(subId)?.iccId?.takeIf { it.isNotBlank() }?.let { ids += it }
        val telecom = context.getSystemService(TelecomManager::class.java)
        val telephony = context.getSystemService(TelephonyManager::class.java)
        val handles = try {
            telecom?.callCapablePhoneAccounts.orEmpty()
        } catch (e: SecurityException) {
            emptyList()
        }
        if (Build.VERSION.SDK_INT >= 30 && telephony != null) {
            handles.filter { telephony.getSubscriptionId(it) == subId }.forEach { ids += it.id }
        } else if (sims.size == 1) {
            handles.forEach { ids += it.id }
        }
        return CompanySimMatcher(ids, acceptBlank = sims.size == 1)
    }

    fun defaultDialer(): String? = context.getSystemService(TelecomManager::class.java)?.defaultDialerPackage
}
