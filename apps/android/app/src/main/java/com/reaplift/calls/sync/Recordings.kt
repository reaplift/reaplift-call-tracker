package com.reaplift.calls.sync

import kotlin.math.abs
import kotlin.math.max

/**
 * Call recordings (M6, HLD 8.6). The phone's own dialer records; the app finds the file that belongs to a
 * company-SIM call and uploads it. Only files saved in the call's time window are looked at, only the matched
 * file is opened, and nothing is deleted from the phone. Pure: Android parts are passed in, so it runs in JVM tests.
 */

/** One audio file the phone's media index knows about (MediaStore), as read. */
data class AudioFile(
    val uri: String,
    val name: String,
    /** The folder, for example "Recordings/Call/" or "Record/Call/" (brand-specific). */
    val folder: String,
    val addedAtMs: Long,
    val durationMs: Long?,
    val sizeBytes: Long,
    val mimeType: String?,
)

interface AudioSource {
    /** Audio files added between the two times. */
    fun filesAddedBetween(fromMs: Long, toMs: Long): List<AudioFile>
}

interface RecordingLedger {
    /** Synced company-SIM calls since `sinceMs` that still need their recording looked for, oldest first. */
    fun callsNeedingRecording(sinceMs: Long, limit: Int): List<OutgoingCall>
    fun markRecording(deviceCallId: String, status: String, uri: String?, at: Long)
    /** Files already uploaded for other calls: never used twice. */
    fun usedRecordingUris(): Set<String>
}

sealed interface UploadResult {
    data object Done : UploadResult
    /** The server already has this call's recording. */
    data object AlreadyThere : UploadResult
    /** The call itself has not reached the server yet: try again next sync. */
    data object NotSyncedYet : UploadResult
    /** Recordings are not switched on on the server yet: stop for this sync, keep everything. */
    data object NotConfigured : UploadResult
}

interface RecordingUploader {
    /** Throws DeviceRevokedException when unpaired, or another exception when the network or storage failed. */
    suspend fun upload(call: OutgoingCall, file: AudioFile, score: Int): UploadResult
    /** No file matched the call: the panel flags it. */
    suspend fun reportMissing(call: OutgoingCall): UploadResult
}

object RecordingRules {
    /** D8: calls shorter than this are not expected to have a recording. */
    const val MIN_TALK_SECONDS = 5
    /** Dialers save the file when the call ends; give them this long before looking. */
    const val SETTLE_MS = 20_000L
    /** HLD 8.6: no match within 10 minutes of the call ending means the recording is missing. */
    const val GIVE_UP_MS = 10 * 60_000L
    /** A file saved a little before the call ended (some dialers stamp the start) still counts. */
    const val BEFORE_START_MS = 60_000L
    /** Scores at or above this are uploaded. */
    const val THRESHOLD = 60
    /** The first run after this update looks back this far, so a phone does not upload a week of audio at once. */
    const val FIRST_LOOKBACK_MS = 3 * 86_400_000L

    fun expectsRecording(call: OutgoingCall) =
        (call.type == "incoming" || call.type == "outgoing") && call.talkSeconds >= MIN_TALK_SECONDS

    fun callEndMs(call: OutgoingCall) = call.endedAtMs ?: (call.startedAtMs + call.talkSeconds * 1000L)
}

/**
 * How sure we are that `file` is `call`'s recording, 0 to 100. Time saved against the call's end, audio length
 * against talk time, and the number or contact name in the file name each add to it; a clearly wrong length
 * takes away.
 */
object RecordingMatcher {
    fun score(call: OutgoingCall, file: AudioFile): Int {
        var score = 0
        val end = RecordingRules.callEndMs(call)
        val fromEnd = abs(file.addedAtMs - end)
        score += when {
            fromEnd <= 90_000 -> 40
            fromEnd <= RecordingRules.GIVE_UP_MS -> 20
            else -> 0
        }
        file.durationMs?.takeIf { it > 0 && call.talkSeconds > 0 }?.let { ms ->
            val diff = abs(ms / 1000.0 - call.talkSeconds)
            score += when {
                diff <= max(3.0, call.talkSeconds * 0.10) -> 40
                diff <= max(10.0, call.talkSeconds * 0.25) -> 20
                else -> -30
            }
        }
        val nameDigits = file.name.filter(Char::isDigit)
        val last10 = call.number.filter(Char::isDigit).takeLast(10)
        val contact = call.contactName?.lowercase()?.split(Regex("\\s+"))?.firstOrNull { it.length >= 3 }
        when {
            last10.length == 10 && nameDigits.contains(last10) -> score += 30
            contact != null && file.name.lowercase().contains(contact) -> score += 20
        }
        val where = (file.folder + file.name).lowercase()
        if ("call" in where || "record" in where) score += 10
        return score.coerceIn(0, 100)
    }

    /** The best file for the call that no other call has used, if it is good enough. */
    fun best(call: OutgoingCall, files: List<AudioFile>, used: Set<String>): Pair<AudioFile, Int>? =
        files.filter { it.uri !in used }
            .map { it to score(call, it) }
            .filter { it.second >= RecordingRules.THRESHOLD }
            .maxByOrNull { it.second }
}

/** Finds and uploads recordings for synced calls; reports the ones with none. */
class RecordingSync(private val ledger: RecordingLedger, private val audio: AudioSource) {
    suspend fun run(uploader: RecordingUploader, sinceMs: Long, onMissing: (OutgoingCall) -> Unit = {}, now: () -> Long): SendResult {
        var uploaded = 0
        var missing = 0
        val used = ledger.usedRecordingUris().toMutableSet()
        for (call in ledger.callsNeedingRecording(sinceMs, BATCH_SIZE)) {
            if (!RecordingRules.expectsRecording(call)) {
                ledger.markRecording(call.deviceCallId, STATUS_NOT_EXPECTED, null, now())
                continue
            }
            val end = RecordingRules.callEndMs(call)
            if (now() - end < RecordingRules.SETTLE_MS) continue
            val files = audio.filesAddedBetween(call.startedAtMs - RecordingRules.BEFORE_START_MS, end + RecordingRules.GIVE_UP_MS)
            val match = RecordingMatcher.best(call, files, used)
            val result = try {
                when {
                    match != null -> uploader.upload(call, match.first, match.second)
                    now() - end >= RecordingRules.GIVE_UP_MS -> uploader.reportMissing(call)
                    else -> continue
                }
            } catch (e: DeviceRevokedException) {
                return SendResult.Revoked
            } catch (e: Exception) {
                return SendResult.Failed(e.message ?: "Could not upload the recording")
            }
            when (result) {
                UploadResult.Done, UploadResult.AlreadyThere -> {
                    if (match != null) {
                        ledger.markRecording(call.deviceCallId, STATUS_UPLOADED, match.first.uri, now())
                        used += match.first.uri
                        uploaded++
                    } else {
                        ledger.markRecording(call.deviceCallId, STATUS_MISSING, null, now())
                        onMissing(call)
                        missing++
                    }
                }
                UploadResult.NotSyncedYet -> Unit
                UploadResult.NotConfigured -> return SendResult.Done(uploaded, missing)
            }
        }
        return SendResult.Done(uploaded, missing)
    }

    companion object {
        const val BATCH_SIZE = 20
        const val STATUS_UPLOADED = "uploaded"
        const val STATUS_MISSING = "missing"
        const val STATUS_NOT_EXPECTED = "not_expected"
    }
}
