package com.reaplift.calls.sync

/** One row of Android's call log, as read. */
data class CallLogRow(
    val id: Long,
    val number: String?,
    val cachedName: String?,
    /** `CallLog.Calls.TYPE`. */
    val type: Int,
    val dateMs: Long,
    val durationSeconds: Long,
    /** `CallLog.Calls.PHONE_ACCOUNT_ID`: which SIM the call used. Its format differs by brand. */
    val phoneAccountId: String?,
)

/** A company-SIM call ready for the server (packages/shared `DeviceCall`). */
data class OutgoingCall(
    val deviceCallId: String,
    val number: String,
    val contactName: String?,
    val type: String,
    val startedAtMs: Long,
    val talkSeconds: Int,
    val ringSeconds: Int?,
    val endedAtMs: Long?,
)

interface CallLogSource {
    /** Rows with ID above `afterId` that started at or after `sinceMs`, in ID order. */
    fun rowsAfter(afterId: Long, sinceMs: Long): List<CallLogRow>
}

interface Outbox {
    fun add(call: OutgoingCall)
    fun pending(limit: Int): List<OutgoingCall>
    fun markSent(ids: Collection<String>, at: Long)
    fun drop(ids: Collection<String>)
    fun pendingCount(): Int
}

/** Call end times seen live by the tracking service. */
interface CallEnds {
    fun record(endedAtMs: Long)
    fun between(fromMs: Long, toMs: Long): List<Long>
}

/**
 * Decides which call log rows are company-SIM calls. This is the privacy rule (CLAUDE.md): anything it
 * does not accept never reaches the outbox.
 */
class CompanySimMatcher(
    /** Every phone-account ID that means the company SIM on this phone. */
    private val accountIds: Set<String>,
    /** Only when the phone has a single SIM: rows with no account ID are that SIM's. */
    private val acceptBlank: Boolean,
) {
    fun isCompany(phoneAccountId: String?): Boolean =
        if (phoneAccountId.isNullOrBlank()) acceptBlank else phoneAccountId in accountIds
}

object CallTypes {
    // CallLog.Calls constants, copied so this file runs in plain JVM tests.
    private const val INCOMING = 1
    private const val OUTGOING = 2
    private const val MISSED = 3
    private const val VOICEMAIL = 4
    private const val REJECTED = 5
    private const val BLOCKED = 6
    private const val ANSWERED_EXTERNALLY = 7

    /** The server's call type, or null for rows that are not calls the employee made or received. */
    fun map(type: Int): String? = when (type) {
        INCOMING -> "incoming"
        OUTGOING -> "outgoing"
        MISSED -> "missed"
        REJECTED, BLOCKED -> "rejected"
        VOICEMAIL, ANSWERED_EXTERNALLY -> null
        else -> null
    }
}

/**
 * Ringing time = (end − start) − talk time (HLD section 8.3), using the closest call end the tracking
 * service saw after the call's talk ended. Null when the service did not see the call end.
 */
fun ringSeconds(startMs: Long, talkSeconds: Long, ends: List<Long>): Int? {
    val talkEnd = startMs + talkSeconds * 1000
    // A little slack either side: the call log and the call-state event are not written at the same instant.
    val end = ends.filter { it >= talkEnd - 2_000 && it <= talkEnd + MAX_RING_MS }.minOrNull() ?: return null
    val ring = (end - startMs) / 1000 - talkSeconds
    return ring.coerceAtLeast(0).toInt()
}

/** Ringing longer than this is not a real ring; the end event belongs to another call. */
const val MAX_RING_MS = 5 * 60 * 1000L

sealed interface SendResult {
    data class Done(val sent: Int, val rejected: Int) : SendResult
    data object Revoked : SendResult
    data class Failed(val reason: String) : SendResult
}

interface CallUploader {
    /** Posts a batch; returns the IDs the server will never take, or throws on failure. */
    suspend fun upload(calls: List<OutgoingCall>): Set<String>
}

class DeviceRevokedException : Exception("This phone was unpaired")

/** Reads new company-SIM calls into the outbox, and sends the outbox. Pure: Android parts are passed in. */
class CallSync(
    private val source: CallLogSource,
    private val outbox: Outbox,
    private val callEnds: CallEnds,
) {
    /**
     * Moves new call log rows into the outbox. Returns the highest row ID looked at, including rows it
     * skipped (personal SIM), so they are never read again.
     */
    fun collect(afterId: Long, sinceMs: Long, matcher: CompanySimMatcher): Long {
        var last = afterId
        for (row in source.rowsAfter(afterId, sinceMs)) {
            last = maxOf(last, row.id)
            if (!matcher.isCompany(row.phoneAccountId)) continue
            val type = CallTypes.map(row.type) ?: continue
            val ends = callEnds.between(row.dateMs, row.dateMs + row.durationSeconds * 1000 + MAX_RING_MS)
            val ring = ringSeconds(row.dateMs, row.durationSeconds, ends)
            outbox.add(
                OutgoingCall(
                    deviceCallId = row.id.toString(),
                    number = row.number.orEmpty(),
                    contactName = row.cachedName?.takeIf { it.isNotBlank() },
                    type = type,
                    startedAtMs = row.dateMs,
                    talkSeconds = row.durationSeconds.toInt(),
                    ringSeconds = ring,
                    endedAtMs = ring?.let { row.dateMs + (row.durationSeconds + it) * 1000 },
                ),
            )
        }
        return last
    }

    /** Sends the outbox in batches of up to 200, oldest first. A call leaves it only once the server took it. */
    suspend fun send(uploader: CallUploader, now: () -> Long): SendResult {
        var sent = 0
        var rejected = 0
        while (true) {
            val batch = outbox.pending(BATCH_SIZE)
            if (batch.isEmpty()) return SendResult.Done(sent, rejected)
            val refused = try {
                uploader.upload(batch)
            } catch (e: DeviceRevokedException) {
                return SendResult.Revoked
            } catch (e: Exception) {
                return SendResult.Failed(e.message ?: "Could not reach the server")
            }
            outbox.drop(refused)
            outbox.markSent(batch.map { it.deviceCallId }.filter { it !in refused }, now())
            sent += batch.size - refused.size
            rejected += refused.size
        }
    }

    companion object {
        const val BATCH_SIZE = 200
    }
}
