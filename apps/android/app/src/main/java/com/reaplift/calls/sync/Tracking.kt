package com.reaplift.calls.sync

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import com.reaplift.calls.data.LocalDb
import com.reaplift.calls.data.Prefs
import com.reaplift.calls.data.TrackingState
import com.reaplift.calls.net.ApiClient
import com.reaplift.calls.ui.formatNumber
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
        prefs.lastCallLogId = sync.collect(prefs.lastCallLogId, since, matcher, NeverRecordList(prefs.neverRecordHashes))

        // After-call form (M4): ask about each new call once, straight away, even offline. When the pop-up can show
        // over other apps it handles calls that just ended, so they get no notification as well.
        val now = System.currentTimeMillis()
        val popup = PopupPermission.granted(context)
        for (call in db.takeCallsToPrompt(prefs.pairedAt, now)) {
            if (popup && now - call.startedAtMs < POPUP_HANDLES_MS) continue
            Notifications.askForComment(context, call, call.contactName ?: formatNumber(call.number))
        }

        val api = ApiClient(prefs.serverUrl!!, prefs.deviceToken)
        var result = sync.send(api, System::currentTimeMillis)
        // Comments go after the calls they belong to.
        if (result is SendResult.Done) {
            val comments = CommentSync(db).send(api, System::currentTimeMillis)
            if (comments !is SendResult.Done) result = comments
        }
        // Recordings (M6) after the calls and comments: they are the slowest to send.
        if (result is SendResult.Done && MediaStoreAudio.hasPermission(context)) {
            if (prefs.recordingsSince == 0L) prefs.recordingsSince = System.currentTimeMillis() - RecordingRules.FIRST_LOOKBACK_MS
            // 0.5.1: look again, once, at the last 3 days' "missing" calls, so the server learns why and a recording
            // found now is uploaded.
            if (!prefs.recheckedMissingRecordings) {
                db.resetMissingRecordings(System.currentTimeMillis() - RecordingRules.FIRST_LOOKBACK_MS)
                prefs.recheckedMissingRecordings = true
            }
            val recordings = RecordingSync(db, MediaStoreAudio(context)).run(
                AndroidRecordingUploader(api, context.contentResolver),
                sinceMs = maxOf(prefs.recordingsSince, prefs.pairedAt - prefs.initialSyncDays * 86_400_000L),
                now = System::currentTimeMillis,
                // Only a call that just ended is worth telling the employee about; older ones (such as the 0.5.1
                // re-check) are reported to the server silently.
                onMissing = { call ->
                    if (System.currentTimeMillis() - RecordingRules.callEndMs(call) < 60 * 60_000L)
                        Notifications.recordingMissing(context, call, call.contactName ?: formatNumber(call.number))
                },
            )
            if (recordings !is SendResult.Done) result = recordings
        }
        // Settings change rarely: fetch them at most every 30 minutes, not on every sync, to keep requests low on
        // shared hosting. A never-record number added in between is still refused by the server.
        if (result is SendResult.Done && System.currentTimeMillis() - prefs.lastConfigAt > CONFIG_EVERY_MS) {
            runCatching { api.config() }.onSuccess { config ->
                db.replaceOutcomes(config.outcomes.map { Outcome(it.id, it.label) })
                db.replaceNoteTemplates(config.noteTemplates)
                prefs.neverRecordHashes = config.neverRecord.toSet()
                db.removeNeverRecord(NeverRecordList(prefs.neverRecordHashes))
                prefs.lastConfigAt = System.currentTimeMillis()
            }
        }
        when (result) {
            is SendResult.Done -> prefs.lastSyncAt = System.currentTimeMillis()
            SendResult.Revoked -> setState(context, prefs, TrackingState.REVOKED)
            is SendResult.Failed -> Unit
        }
        return result
    }

    /** Reads new company-SIM calls from the call log into the outbox, without sending: the pop-up needs the call now. */
    suspend fun collectNow(context: Context) = lock.withLock {
        val prefs = Prefs(context)
        if (!prefs.isPaired || prefs.state == TrackingState.REVOKED || !hasPermissions(context)) return@withLock
        val matcher = Sims(context).matcherFor(prefs.companySubId) ?: return@withLock
        val db = LocalDb(context)
        val since = prefs.pairedAt - prefs.initialSyncDays * 86_400_000L
        prefs.lastCallLogId = CallSync(AndroidCallLog(context), db, db).collect(prefs.lastCallLogId, since, matcher)
    }

    /** Calls this recent are the pop-up's; older ones (it was closed, or the phone was off) get the notification. */
    private const val POPUP_HANDLES_MS = 5 * 60_000L
    private const val CONFIG_EVERY_MS = 30 * 60_000L

    private fun setState(context: Context, prefs: Prefs, state: TrackingState) {
        if (prefs.state == state) return
        prefs.state = state
        Notifications.stateChanged(context, state)
        if (state == TrackingState.REVOKED) TrackingService.stop(context)
    }
}
