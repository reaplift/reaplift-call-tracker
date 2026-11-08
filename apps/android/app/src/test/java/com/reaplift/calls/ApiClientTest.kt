package com.reaplift.calls

import com.reaplift.calls.net.ApiClient
import com.reaplift.calls.net.ApiException
import com.reaplift.calls.sync.DeviceRevokedException
import com.reaplift.calls.sync.OutgoingCall
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class ApiClientTest {
    private val call = OutgoingCall("101", "+919900011111", "Sharma Traders", "outgoing", 1_762_936_320_000, 185, 12, 1_762_936_517_000)

    @Test
    fun postsCallsInTheServersShapeWithTheToken() = runTest {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"accepted":1,"duplicates":0,"rejected":[]}"""))
            val result = ApiClient(server.url("/").toString(), "tok").postCalls(listOf(call))
            assertEquals(1, result.accepted)
            val request = server.takeRequest()
            assertEquals("/device/v1/calls", request.path)
            assertEquals("Bearer tok", request.getHeader("Authorization"))
            val body = request.body.readUtf8()
            assertTrue(body, body.contains(""""deviceCallId":"101""""))
            assertTrue(body, body.contains(""""startedAt":"2025-11-12T08:32:00Z""""))
            assertTrue(body, body.contains(""""ringSeconds":12"""))
        }
    }

    @Test
    fun aRevokedPhoneIsReportedAsSuch() = runTest {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"DEVICE_REVOKED","message":"This phone was unpaired"}"""))
            try {
                ApiClient(server.url("/").toString(), "tok").upload(listOf(call))
                fail("expected DeviceRevokedException")
            } catch (e: DeviceRevokedException) {
                // expected
            }
        }
    }

    @Test
    fun aWrongCodeCarriesTheServersMessage() = runTest {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(400).setBody("""{"error":"PAIRING_CODE_INVALID","message":"This code is wrong or has expired"}"""))
            try {
                ApiClient(server.url("/").toString()).postCalls(listOf(call))
                fail("expected ApiException")
            } catch (e: ApiException) {
                assertEquals("PAIRING_CODE_INVALID", e.code)
                assertEquals("This code is wrong or has expired", e.message)
            }
        }
    }
}
