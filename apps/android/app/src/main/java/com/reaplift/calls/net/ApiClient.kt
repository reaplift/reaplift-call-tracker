package com.reaplift.calls.net

import com.reaplift.calls.sync.CallUploader
import com.reaplift.calls.sync.DeviceRevokedException
import com.reaplift.calls.sync.OutgoingCall
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.time.Instant
import java.util.concurrent.TimeUnit

@Serializable
data class PairRequest(
    val code: String,
    val brand: String,
    val model: String,
    val androidVersion: String,
    val sdkInt: Int,
    val appVersion: String,
    val defaultDialer: String?,
    val simSlot: Int,
    val simCarrier: String?,
    val phoneAccountId: String?,
    val consentVersion: String,
)

@Serializable
data class PairedEmployee(val name: String, val companyNumber: String)

@Serializable
data class DeviceSettings(val initialSyncDays: Int, val syncIntervalMinutes: Int)

@Serializable
data class PairResponse(val deviceToken: String, val employee: PairedEmployee, val settings: DeviceSettings)

@Serializable
data class CallJson(
    val deviceCallId: String,
    val number: String,
    val contactName: String?,
    val type: String,
    val startedAt: String,
    val talkSeconds: Int,
    val ringSeconds: Int?,
    val endedAt: String?,
)

@Serializable
data class CallBatch(val calls: List<CallJson>)

@Serializable
data class Rejected(val deviceCallId: String, val reason: String)

@Serializable
data class CallBatchResult(val accepted: Int, val duplicates: Int, val rejected: List<Rejected>)

@Serializable
data class ApiErrorBody(val error: String, val message: String)

class ApiException(val status: Int, val code: String, message: String) : Exception(message)

val json = Json { ignoreUnknownKeys = true; explicitNulls = true }

fun OutgoingCall.toJson() = CallJson(
    deviceCallId = deviceCallId,
    number = number,
    contactName = contactName,
    type = type,
    startedAt = Instant.ofEpochMilli(startedAtMs).toString(),
    talkSeconds = talkSeconds,
    ringSeconds = ringSeconds,
    endedAt = endedAtMs?.let { Instant.ofEpochMilli(it).toString() },
)

/** The server's phone API (`/device/v1`, data-model-and-api.md). */
class ApiClient(
    private val serverUrl: String,
    private val token: String? = null,
    private val client: OkHttpClient = OkHttpClient.Builder().callTimeout(30, TimeUnit.SECONDS).build(),
) : CallUploader {
    private val base = serverUrl.trimEnd('/')
    private val jsonType = "application/json".toMediaType()

    private suspend fun <T> call(method: String, path: String, body: String?, parse: (String) -> T): T =
        withContext(Dispatchers.IO) {
            val builder = Request.Builder().url(base + path)
            token?.let { builder.header("Authorization", "Bearer $it") }
            builder.method(method, body?.toRequestBody(jsonType))
            client.newCall(builder.build()).execute().use { response ->
                val text = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    val error = runCatching { json.decodeFromString<ApiErrorBody>(text) }.getOrNull()
                    if (error?.error == "DEVICE_REVOKED") throw DeviceRevokedException()
                    throw ApiException(response.code, error?.error ?: "HTTP_${response.code}", error?.message ?: "Server error ${response.code}")
                }
                parse(text)
            }
        }

    suspend fun pair(request: PairRequest): PairResponse =
        call("POST", "/device/v1/pair", json.encodeToString(request)) { json.decodeFromString(it) }

    suspend fun postCalls(calls: List<OutgoingCall>): CallBatchResult =
        call("POST", "/device/v1/calls", json.encodeToString(CallBatch(calls.map { it.toJson() }))) { json.decodeFromString(it) }

    override suspend fun upload(calls: List<OutgoingCall>): Set<String> =
        postCalls(calls).rejected.map { it.deviceCallId }.toSet()
}
