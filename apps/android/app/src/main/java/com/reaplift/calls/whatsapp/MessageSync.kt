package com.reaplift.calls.whatsapp

import com.reaplift.calls.sync.DeviceRevokedException
import com.reaplift.calls.sync.SendResult

interface SendStore {
    /** Sends not yet uploaded whose call (if any) the server already has, oldest first. */
    fun sendsToUpload(limit: Int): List<PendingSend>
    fun markSendsUploaded(ids: Collection<String>, at: Long)
}

interface SendUploader {
    /** Uploads up to 50; returns the IDs the server will never keep. Throws on failure. */
    suspend fun uploadSends(sends: List<PendingSend>): Set<String>
}

/** Sends the WhatsApp log (M10) in batches of 50. Pure, so it runs in JVM tests. */
class MessageSync(private val store: SendStore) {
    suspend fun send(uploader: SendUploader, now: () -> Long): SendResult {
        var sent = 0
        var refused = 0
        while (true) {
            val batch = store.sendsToUpload(BATCH_SIZE)
            if (batch.isEmpty()) return SendResult.Done(sent, refused)
            val rejected = try {
                uploader.uploadSends(batch)
            } catch (e: DeviceRevokedException) {
                return SendResult.Revoked
            } catch (e: Exception) {
                return SendResult.Failed(e.message ?: "Could not send the WhatsApp log")
            }
            // Rejected ones (for example a never-record number) are marked too, so they aren't retried forever.
            store.markSendsUploaded(batch.map { it.deviceSendId }, now())
            refused += rejected.size
            sent += batch.size - rejected.size
            if (batch.size < BATCH_SIZE) return SendResult.Done(sent, refused)
        }
    }

    companion object {
        const val BATCH_SIZE = 50
    }
}
