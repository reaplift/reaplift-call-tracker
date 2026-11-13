package com.reaplift.calls.data

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit

/** Why sync is not running, shown on the home screen and in the notification. */
enum class TrackingState { ON, SIM_MISSING, PERMISSION_MISSING, REVOKED }

/** Everything the app remembers about its setup. Kept in app-private storage; the token is also encrypted. */
class Prefs(context: Context) {
    private val prefs: SharedPreferences = context.getSharedPreferences("calls", Context.MODE_PRIVATE)

    var consentAt: Long
        get() = prefs.getLong("consent_at", 0)
        set(v) = prefs.edit { putLong("consent_at", v) }

    var batteryStepDone: Boolean
        get() = prefs.getBoolean("battery_step_done", false)
        set(v) = prefs.edit { putBoolean("battery_step_done", v) }

    /** The company SIM's subscription ID, chosen by the employee; -1 until chosen. */
    var companySubId: Int
        get() = prefs.getInt("company_sub_id", -1)
        set(v) = prefs.edit { putInt("company_sub_id", v) }

    var companySimSlot: Int
        get() = prefs.getInt("company_sim_slot", -1)
        set(v) = prefs.edit { putInt("company_sim_slot", v) }

    var companySimCarrier: String?
        get() = prefs.getString("company_sim_carrier", null)
        set(v) = prefs.edit { putString("company_sim_carrier", v) }

    var serverUrl: String?
        get() = prefs.getString("server_url", null)
        set(v) = prefs.edit { putString("server_url", v) }

    var deviceToken: String?
        get() = prefs.getString("device_token", null)?.let { TokenCipher.decrypt(it) }
        set(v) = prefs.edit { putString("device_token", v?.let { TokenCipher.encrypt(it) }) }

    var employeeName: String?
        get() = prefs.getString("employee_name", null)
        set(v) = prefs.edit { putString("employee_name", v) }

    /** The company the phone is paired to (P1); null for phones paired before servers sent it. */
    var companyName: String?
        get() = prefs.getString("company_name", null)
        set(v) = prefs.edit { putString("company_name", v) }

    var companyNumber: String?
        get() = prefs.getString("company_number", null)
        set(v) = prefs.edit { putString("company_number", v) }

    var pairedAt: Long
        get() = prefs.getLong("paired_at", 0)
        set(v) = prefs.edit { putLong("paired_at", v) }

    var initialSyncDays: Int
        get() = prefs.getInt("initial_sync_days", 7)
        set(v) = prefs.edit { putInt("initial_sync_days", v) }

    /** The highest call log row ID already looked at; rows after it are new. */
    var lastCallLogId: Long
        get() = prefs.getLong("last_call_log_id", 0)
        set(v) = prefs.edit { putLong("last_call_log_id", v) }

    var testCallDone: Boolean
        get() = prefs.getBoolean("test_call_done", false)
        set(v) = prefs.edit { putBoolean("test_call_done", v) }

    /** App 0.5.1: calls marked "recording missing" before the matching fix were looked at again, once. */
    var recheckedMissingRecordings: Boolean
        get() = prefs.getBoolean("rechecked_missing_recordings_051", false)
        set(v) = prefs.edit { putBoolean("rechecked_missing_recordings_051", v) }

    /** M6: recordings are looked for from this time on; set on the first run with recordings (3 days back). */
    var recordingsSince: Long
        get() = prefs.getLong("recordings_since", 0)
        set(v) = prefs.edit { putLong("recordings_since", v) }

    var lastSyncAt: Long
        get() = prefs.getLong("last_sync_at", 0)
        set(v) = prefs.edit { putLong("last_sync_at", v) }

    var state: TrackingState
        get() = TrackingState.valueOf(prefs.getString("state", TrackingState.ON.name)!!)
        set(v) = prefs.edit { putString("state", v.name) }

    val isPaired: Boolean get() = pairedAt > 0 && deviceToken != null

    /** After the server unpairs this phone: forget the pairing, keep consent and the chosen SIM. */
    fun clearPairing() {
        prefs.edit {
            remove("device_token"); remove("paired_at"); remove("employee_name"); remove("company_number"); remove("company_name")
            remove("last_call_log_id"); remove("test_call_done"); remove("last_sync_at"); remove("recordings_since")
            putString("state", TrackingState.ON.name)
        }
    }
}
