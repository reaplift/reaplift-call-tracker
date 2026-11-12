package com.reaplift.calls.sync

/** One of the company's outcomes for the after-call form (M4), from `/device/v1/config`. */
data class Outcome(val id: String, val label: String)

/** An after-call form filled on the phone, waiting to be sent. */
data class PendingComment(
    val deviceCallId: String,
    val outcomeId: String?,
    val note: String?,
    val followUpAtMs: Long?,
)

sealed interface CommentResult {
    data object Sent : CommentResult
    /** The call itself has not reached the server yet; keep the comment and try again next sync. */
    data object NotSyncedYet : CommentResult
    /** The server will never take it (for example an outcome that was switched off); stop retrying. */
    data class Refused(val reason: String) : CommentResult
}

interface CommentStore {
    /** Filled forms not yet sent, for calls the server already has. */
    fun commentsToSend(limit: Int): List<PendingComment>
    fun markCommentSent(deviceCallId: String, at: Long)
}

interface CommentUploader {
    /** Throws DeviceRevokedException when the phone was unpaired, or another exception when the server is unreachable. */
    suspend fun sendComment(comment: PendingComment): CommentResult
}

/** Which calls the after-call form asks about (M4). */
object AfterCall {
    /** Every call, missed and rejected too: a missed call often needs "called back" (client, 11 November 2026). */
    val ASKED_TYPES = setOf("incoming", "outgoing", "missed", "rejected")

    /** Only recent calls get a notification; older ones (for example the first sync after pairing) wait in the list. */
    const val PROMPT_WINDOW_MS = 6 * 60 * 60 * 1000L

    fun asksAbout(type: String) = type in ASKED_TYPES

    fun shouldPrompt(call: OutgoingCall, pairedAtMs: Long, nowMs: Long): Boolean =
        asksAbout(call.type) && call.startedAtMs >= pairedAtMs && nowMs - call.startedAtMs <= PROMPT_WINDOW_MS
}

/** Sends filled forms. Pure: the store and the server are passed in, so it runs in plain JVM tests. */
class CommentSync(private val store: CommentStore) {
    suspend fun send(uploader: CommentUploader, now: () -> Long): SendResult {
        var sent = 0
        var refused = 0
        for (comment in store.commentsToSend(BATCH_SIZE)) {
            val result = try {
                uploader.sendComment(comment)
            } catch (e: DeviceRevokedException) {
                return SendResult.Revoked
            } catch (e: Exception) {
                return SendResult.Failed(e.message ?: "Could not reach the server")
            }
            when (result) {
                CommentResult.Sent -> { store.markCommentSent(comment.deviceCallId, now()); sent++ }
                CommentResult.NotSyncedYet -> Unit
                is CommentResult.Refused -> { store.markCommentSent(comment.deviceCallId, now()); refused++ }
            }
        }
        return SendResult.Done(sent, refused)
    }

    companion object {
        const val BATCH_SIZE = 100
    }
}
