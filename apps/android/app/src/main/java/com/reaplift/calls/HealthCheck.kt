package com.reaplift.calls

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

/** The server's `/healthz` answer (packages/shared `HealthResponse`). */
@Serializable
data class HealthResponse(val status: String, val version: String, val db: String)

sealed interface HealthResult {
    data class Ok(val version: String) : HealthResult
    data object DatabaseDown : HealthResult
    data class Unreachable(val reason: String) : HealthResult
}

private val json = Json { ignoreUnknownKeys = true }

/** Turns a `/healthz` body into what the screen shows. Pure, so it is unit tested. */
fun parseHealth(body: String): HealthResult =
    try {
        val health = json.decodeFromString<HealthResponse>(body)
        if (health.db == "ok") HealthResult.Ok(health.version) else HealthResult.DatabaseDown
    } catch (e: Exception) {
        HealthResult.Unreachable("Unexpected answer")
    }

class HealthCheck(
    private val client: OkHttpClient =
        OkHttpClient.Builder().callTimeout(10, TimeUnit.SECONDS).build(),
) {
    suspend fun check(serverUrl: String): HealthResult =
        withContext(Dispatchers.IO) {
            try {
                val request = Request.Builder().url(serverUrl.trimEnd('/') + "/healthz").build()
                client.newCall(request).execute().use { response ->
                    // 503 still carries the body that says the database is down.
                    parseHealth(response.body?.string().orEmpty())
                }
            } catch (e: Exception) {
                HealthResult.Unreachable(e.message ?: "Server unreachable")
            }
        }
}
