package com.reaplift.calls

import com.reaplift.calls.net.ApiClient
import com.reaplift.calls.sync.AfterCall
import com.reaplift.calls.sync.CommentResult
import com.reaplift.calls.sync.CommentStore
import com.reaplift.calls.sync.CommentSync
import com.reaplift.calls.sync.CommentUploader
import com.reaplift.calls.sync.DeviceRevokedException
import com.reaplift.calls.sync.OutgoingCall
import com.reaplift.calls.sync.PendingComment
import com.reaplift.calls.sync.SendResult
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

private class FakeComments(vararg comments: PendingComment) : CommentStore {
    val waiting = comments.toMutableList()
    val sent = mutableListOf<String>()
    override fun commentsToSend(limit: Int) = waiting.filter { it.deviceCallId !in sent }.take(limit)
    override fun markCommentSent(deviceCallId: String, at: Long) {
        sent += deviceCallId
    }
}

private class ScriptedServer(private val answers: Map<String, CommentResult>) : CommentUploader {
    val asked = mutableListOf<String>()
    override suspend fun sendComment(comment: PendingComment): CommentResult {
        asked += comment.deviceCallId
        return answers[comment.deviceCallId] ?: CommentResult.Sent
    }
}

private const val PAIRED = 1_762_930_000_000L
private fun call(id: String, type: String, startedAt: Long) = OutgoingCall(id, "9900011111", null, type, startedAt, 60, 5, null)

class CommentSyncTest {
    @Test
    fun asksAboutEveryRecentCallSincePairing() {
        val now = PAIRED + 3_600_000
        assertTrue(AfterCall.shouldPrompt(call("1", "outgoing", now - 60_000), PAIRED, now))
        assertTrue(AfterCall.shouldPrompt(call("2", "incoming", now - 60_000), PAIRED, now))
        assertTrue("a missed call often needs 'called back'", AfterCall.shouldPrompt(call("3", "missed", now - 60_000), PAIRED, now))
        assertTrue(AfterCall.shouldPrompt(call("4", "rejected", now - 60_000), PAIRED, now))
        assertFalse("calls from before pairing wait in the list", AfterCall.shouldPrompt(call("5", "outgoing", PAIRED - 60_000), PAIRED, now))
        val later = PAIRED + 10 * 3_600_000
        assertFalse("old calls do not pop up", AfterCall.shouldPrompt(call("6", "outgoing", PAIRED + 60_000), PAIRED, later))
    }

    @Test
    fun sendsEachFilledFormAndKeepsOnesTheServerCannotTakeYet() = runTest {
        val store = FakeComments(
            PendingComment("11", "o-1", "Wants a quote", PAIRED + 86_400_000),
            PendingComment("12", null, "Call back", null),
            PendingComment("13", "o-off", null, null),
        )
        val server = ScriptedServer(mapOf("12" to CommentResult.NotSyncedYet, "13" to CommentResult.Refused("switched off")))
        val result = CommentSync(store).send(server) { 1L }
        assertEquals(SendResult.Done(sent = 1, rejected = 1), result)
        assertEquals(listOf("11", "13"), store.sent)
        // The next sync tries 12 again, once its call has reached the server.
        val again = CommentSync(store).send(ScriptedServer(emptyMap())) { 2L }
        assertEquals(SendResult.Done(sent = 1, rejected = 0), again)
        assertEquals(listOf("11", "13", "12"), store.sent)
    }

    @Test
    fun stopsWhenThePhoneWasUnpairedOrTheServerIsDown() = runTest {
        val revoked = object : CommentUploader {
            override suspend fun sendComment(comment: PendingComment): CommentResult = throw DeviceRevokedException()
        }
        assertEquals(SendResult.Revoked, CommentSync(FakeComments(PendingComment("1", null, "x", null))).send(revoked) { 0L })
        val down = object : CommentUploader {
            override suspend fun sendComment(comment: PendingComment): CommentResult = throw java.io.IOException("offline")
        }
        val store = FakeComments(PendingComment("1", null, "x", null))
        assertTrue(CommentSync(store).send(down) { 0L } is SendResult.Failed)
        assertTrue("nothing is lost while offline", store.sent.isEmpty())
    }

    @Test
    fun sendsTheFormInTheServersShape() = runTest {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(204))
            val result = ApiClient(server.url("/").toString(), "tok")
                .sendComment(PendingComment("101", "o-1", "Wants a 2BHK quote", 1_763_037_000_000))
            assertEquals(CommentResult.Sent, result)
            val request = server.takeRequest()
            assertEquals("PATCH", request.method)
            assertEquals("/device/v1/calls/101/comment", request.path)
            assertEquals("""{"outcomeId":"o-1","note":"Wants a 2BHK quote","followUpAt":"2025-11-13T12:30:00Z"}""", request.body.readUtf8())
        }
    }

    @Test
    fun mapsTheServersAnswers() = runTest {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(404).setBody("""{"error":"CALL_NOT_SYNCED","message":"not yet"}"""))
            server.enqueue(MockResponse().setResponseCode(400).setBody("""{"error":"OUTCOME_UNKNOWN","message":"switched off"}"""))
            val api = ApiClient(server.url("/").toString(), "tok")
            assertEquals(CommentResult.NotSyncedYet, api.sendComment(PendingComment("1", null, "x", null)))
            assertEquals(CommentResult.Refused("switched off"), api.sendComment(PendingComment("2", "o", null, null)))
        }
    }

    @Test
    fun readsTheCompanysOutcomesFromConfig() = runTest {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"settings":{"initialSyncDays":7,"syncIntervalMinutes":15},"outcomes":[{"id":"a","label":"Interested"}]}"""))
            val config = ApiClient(server.url("/").toString(), "tok").config()
            assertEquals(listOf("Interested"), config.outcomes.map { it.label })
        }
    }
}
