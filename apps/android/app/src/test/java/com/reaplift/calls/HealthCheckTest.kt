package com.reaplift.calls

import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class HealthCheckTest {
    @Test
    fun okWhenTheDatabaseAnswers() {
        assertEquals(
            HealthResult.Ok("abc"),
            parseHealth("""{"status":"ok","version":"abc","db":"ok"}"""),
        )
    }

    @Test
    fun databaseDownOn503Body() {
        assertEquals(
            HealthResult.DatabaseDown,
            parseHealth("""{"status":"error","version":"abc","db":"down"}"""),
        )
    }

    @Test
    fun anythingElseIsUnreachable() {
        assertTrue(parseHealth("<html>proxy error</html>") is HealthResult.Unreachable)
    }

    @Test
    fun callsHealthzOnTheGivenServer() = runTest {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"status":"ok","version":"v1","db":"ok"}"""))
            val result = HealthCheck().check(server.url("/").toString())
            assertEquals(HealthResult.Ok("v1"), result)
            assertEquals("/healthz", server.takeRequest().path)
        }
    }

    @Test
    fun unreachableWhenNothingListens() = runTest {
        val result = HealthCheck().check("http://127.0.0.1:1")
        assertTrue(result is HealthResult.Unreachable)
    }
}
