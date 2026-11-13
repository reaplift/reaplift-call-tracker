package com.reaplift.calls

import com.reaplift.calls.sync.SendResult
import com.reaplift.calls.whatsapp.MessageSync
import com.reaplift.calls.whatsapp.PendingSend
import com.reaplift.calls.whatsapp.SendStore
import com.reaplift.calls.whatsapp.SendUploader
import com.reaplift.calls.whatsapp.Templates
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// M10: the same blank rules as packages/shared/src/templates.ts (apps/server/test/templates.test.ts checks those).
class WhatsAppTest {
    private val followUp = "Hi {{name}}, this is {{employee_name}} from {{company_name}}. I'll call you on {{follow_up_date}} about {{site_name}}."

    @Test
    fun listsEachBlankOnceInOrder() {
        assertEquals(listOf("name", "employee_name", "company_name", "follow_up_date", "site_name"), Templates.blanks("$followUp Thanks {{name}}!"))
        assertEquals(listOf("name"), Templates.blanks("Spaces {{ name }} are fine"))
        assertEquals(emptyList<String>(), Templates.blanks("No blanks."))
    }

    @Test
    fun namesBlanksForTheScreen() {
        assertEquals("Client's name", Templates.label("name"))
        assertEquals("Site name", Templates.label("site_name"))
    }

    @Test
    fun fillsKnownBlanksAndKeepsGapsVisible() {
        val values = mapOf("name" to "Asha", "employee_name" to "Meena Iyer", "company_name" to "Country Roads", "follow_up_date" to "13 Nov", "site_name" to " ")
        assertEquals("Hi Asha, this is Meena Iyer from Country Roads. I'll call you on 13 Nov about {{site_name}}.", Templates.fill(followUp, values))
        assertEquals(listOf("site_name"), Templates.missing(followUp, values))
        assertEquals("नमस्ते आशा 🙏", Templates.fill("नमस्ते {{name}} 🙏", mapOf("name" to "आशा")))
    }

    private fun send(id: String) = PendingSend(id, "t1", "919900011111", "1", "Hi", "whatsapp", 1_000L)

    private class Store(vararg sends: PendingSend) : SendStore {
        val waiting = sends.toMutableList()
        val uploaded = mutableListOf<String>()
        override fun sendsToUpload(limit: Int) = waiting.filter { it.deviceSendId !in uploaded }.take(limit)
        override fun markSendsUploaded(ids: Collection<String>, at: Long) { uploaded += ids }
    }

    @Test
    fun uploadsTheLogFiftyAtATimeAndDropsRejectedOnes() = runTest {
        val store = Store(*(1..60).map { send("s$it") }.toTypedArray())
        val batches = mutableListOf<Int>()
        val uploader = object : SendUploader {
            override suspend fun uploadSends(sends: List<PendingSend>): Set<String> {
                batches += sends.size
                return if (sends.any { it.deviceSendId == "s7" }) setOf("s7") else emptySet()
            }
        }
        assertEquals(SendResult.Done(59, 1), MessageSync(store).send(uploader) { 2_000L })
        assertEquals(listOf(50, 10), batches)
        assertEquals(60, store.uploaded.size)
    }

    @Test
    fun keepsTheLogWhenOffline() = runTest {
        val store = Store(send("s1"))
        val down = object : SendUploader {
            override suspend fun uploadSends(sends: List<PendingSend>): Set<String> = throw java.io.IOException("offline")
        }
        assertTrue(MessageSync(store).send(down) { 2_000L } is SendResult.Failed)
        assertTrue(store.uploaded.isEmpty())
    }
}
