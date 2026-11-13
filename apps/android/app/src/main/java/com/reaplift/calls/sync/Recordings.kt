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

/**
 * Why no recording was matched (app 0.5.1, after no recording matched on the first beta phones): how many audio
 * files the media index had in the call's window, and the closest one's score, folder, length and how far its save
 * time was from the call's end. Never a file name, which can carry a client's name or number.
 */
data class MissingReason(
    val filesInWindow: Int,
    val bestScore: Int?,
    val bestFolder: String?,
    val bestAudioSeconds: Int?,
    val bestOffsetSeconds: Int?,
)

interface RecordingUploader {
    /** Throws DeviceRevokedException when unpaired, or another exception when the network or storage failed. */
    suspend fun upload(call: OutgoingCall, file: AudioFile, score: Int): UploadResult
    /**
     * No file matched these calls (up to 50, one request): the panel flags them, and the reasons help tune the
     * matching per brand. Returns the calls the server doesn't have yet; they are reported again later.
     */
    suspend fun reportMissing(calls: List<Pair<OutgoingCall, MissingReason>>): Set<String>
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

    /** The closest file, good enough or not, to explain a missing recording. */
    fun explain(call: OutgoingCall, files: List<AudioFile>, used: Set<String>): MissingReason {
        val candidates = files.filter { it.uri !in used }
        val best = candidates.maxByOrNull { score(call, it) }
        return MissingReason(
            filesInWindow = candidates.size,
            bestScore = best?.let { score(call, it) },
            bestFolder = best?.folder?.let(::withoutNumbers)?.take(200),
            bestAudioSeconds = best?.durationMs?.let { (it / 1000).toInt() },
            bestOffsetSeconds = best?.let { ((it.addedAtMs - RecordingRules.callEndMs(call)) / 1000).toInt() },
        )
    }

    /** A folder named after a client (some recorder apps do this) must not leave the phone: long digit runs go. */
    fun withoutNumbers(folder: String) = folder.replace(Regex("\\d{5,}"), "#")

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
        // Missing ones go to the server together at the end: one request, not one per call.
        val toReport = mutableListOf<Pair<OutgoingCall, MissingReason>>()
        var uploadsPaused = false
        for (call in ledger.callsNeedingRecording(sinceMs, BATCH_SIZE)) {
            if (!RecordingRules.expectsRecording(call)) {
                ledger.markRecording(call.deviceCallId, STATUS_NOT_EXPECTED, null, now())
                continue
            }
            val end = RecordingRules.callEndMs(call)
            if (now() - end < RecordingRules.SETTLE_MS) continue
            val files = audio.filesAddedBetween(call.startedAtMs - RecordingRules.BEFORE_START_MS, end + RecordingRules.GIVE_UP_MS)
            val match = RecordingMatcher.best(call, files, used)
            if (match == null) {
                if (now() - end >= RecordingRules.GIVE_UP_MS) toReport += call to RecordingMatcher.explain(call, files, used)
                continue
            }
            if (uploadsPaused) continue
            val result = try {
                uploader.upload(call, match.first, match.second)
            } catch (e: DeviceRevokedException) {
                return SendResult.Revoked
            } catch (e: Exception) {
                return SendResult.Failed(e.message ?: "Could not upload the recording")
            }
            when (result) {
                UploadResult.Done, UploadResult.AlreadyThere -> {
                    ledger.markRecording(call.deviceCallId, STATUS_UPLOADED, match.first.uri, now())
                    used += match.first.uri
                    uploaded++
                }
                UploadResult.NotSyncedYet -> Unit
                // Storage isn't switched on yet: keep the files for later, but still report the missing ones.
                UploadResult.NotConfigured -> uploadsPaused = true
            }
        }
        if (toReport.isNotEmpty()) {
            val notSynced = try {
                uploader.reportMissing(toReport)
            } catch (e: DeviceRevokedException) {
                return SendResult.Revoked
            } catch (e: Exception) {
                return SendResult.Failed(e.message ?: "Could not report missing recordings")
            }
            for ((call, _) in toReport) {
                if (call.deviceCallId in notSynced) continue
                ledger.markRecording(call.deviceCallId, STATUS_MISSING, null, now())
                onMissing(call)
                missing++
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
