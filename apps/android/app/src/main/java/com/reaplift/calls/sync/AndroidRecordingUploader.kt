package com.reaplift.calls.sync

import android.content.ContentResolver
import android.net.Uri
import com.reaplift.calls.net.ApiClient
import com.reaplift.calls.net.ApiException
import com.reaplift.calls.net.RecordingUploadRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okio.BufferedSink
import okio.source
import java.util.concurrent.TimeUnit

/**
 * Uploads a matched recording straight to storage (R2) with the server's short-lived link, then tells the server it
 * is done. The file is streamed from the media index, never copied, and stays on the phone.
 */
class AndroidRecordingUploader(
    private val api: ApiClient,
    private val resolver: ContentResolver,
    // Recordings can take minutes on a slow network: no overall time limit, only a stall limit.
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .build(),
) : RecordingUploader {

    override suspend fun upload(call: OutgoingCall, file: AudioFile, score: Int): UploadResult {
        val mime = file.mimeType?.takeIf { it.startsWith("audio/") } ?: "audio/mp4"
        val link = try {
            api.recordingUploadUrl(
                RecordingUploadRequest(
                    deviceCallId = call.deviceCallId,
                    sizeBytes = file.sizeBytes,
                    mimeType = mime,
                    audioSeconds = file.durationMs?.let { (it / 1000).toInt() },
                    matchScore = score,
                ),
            )
        } catch (e: ApiException) {
            return mapped(e) ?: throw e
        }
        withContext(Dispatchers.IO) {
            val body = object : RequestBody() {
                override fun contentType(): MediaType = mime.toMediaType()
                override fun contentLength(): Long = file.sizeBytes
                override fun writeTo(sink: BufferedSink) {
                    resolver.openInputStream(Uri.parse(file.uri))?.use { sink.writeAll(it.source()) }
                        ?: throw java.io.IOException("The recording is no longer on the phone")
                }
            }
            val request = Request.Builder().url(link.uploadUrl).put(body)
            link.headers.forEach { (name, value) -> if (!name.equals("content-type", ignoreCase = true)) request.header(name, value) }
            client.newCall(request.build()).execute().use { response ->
                if (!response.isSuccessful) throw java.io.IOException("Storage refused the upload (${response.code})")
            }
        }
        return try {
            api.recordingComplete(call.deviceCallId)
            UploadResult.Done
        } catch (e: ApiException) {
            mapped(e) ?: throw e
        }
    }

    override suspend fun reportMissing(call: OutgoingCall, reason: MissingReason): UploadResult =
        try {
            api.recordingMissing(call.deviceCallId, reason)
            UploadResult.Done
        } catch (e: ApiException) {
            mapped(e) ?: throw e
        }

    private fun mapped(e: ApiException): UploadResult? = when (e.code) {
        "RECORDING_EXISTS" -> UploadResult.AlreadyThere
        "CALL_NOT_SYNCED" -> UploadResult.NotSyncedYet
        "RECORDINGS_NOT_CONFIGURED" -> UploadResult.NotConfigured
        else -> null
    }
}
