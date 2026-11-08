package com.reaplift.calls

import com.reaplift.calls.sync.CallEnds
import com.reaplift.calls.sync.CallLogRow
import com.reaplift.calls.sync.CallLogSource
import com.reaplift.calls.sync.CallSync
import com.reaplift.calls.sync.CallTypes
import com.reaplift.calls.sync.CallUploader
import com.reaplift.calls.sync.CompanySimMatcher
import com.reaplift.calls.sync.DeviceRevokedException
import com.reaplift.calls.sync.Outbox
import com.reaplift.calls.sync.OutgoingCall
import com.reaplift.calls.sync.SendResult
import com.reaplift.calls.sync.ringSeconds
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private class FakeLog(val rows: List<CallLogRow>) : CallLogSource {
    override fun rowsAfter(afterId: Long, sinceMs: Long) = rows.filter { it.id > afterId && it.dateMs >= sinceMs }.sortedBy { it.id }
}

private class FakeOutbox : Outbox {
    val calls = linkedMapOf<String, OutgoingCall>()
    val sent = mutableSetOf<String>()
    override fun add(call: OutgoingCall) {
        calls.putIfAbsent(call.deviceCallId, call)
    }
    override fun pending(limit: Int) = calls.values.filter { it.deviceCallId !in sent }.take(limit)
    override fun markSent(ids: Collection<String>, at: Long) {
        sent += ids
    }
    override fun drop(ids: Collection<String>) {
        ids.forEach { calls.remove(it) }
    }
    override fun pendingCount() = pending(Int.MAX_VALUE).size
}

private class FakeEnds(val ends: List<Long> = emptyList()) : CallEnds {
    override fun record(endedAtMs: Long) = Unit
    override fun between(fromMs: Long, toMs: Long) = ends.filter { it in fromMs..toMs }
}

private const val T = 1_762_930_000_000L // a Wednesday afternoon
private const val COMPANY = "2"
private const val PERSONAL = "1"

// M1's worked example, as Android's call log holds it: both SIMs, mixed together.
private val LOG = listOf(
    CallLogRow(101, "+919900011111", "Sharma Traders", 2, T, 185, COMPANY),
    CallLogRow(102, "8800022222", null, 2, T + 480_000, 0, COMPANY),
    CallLogRow(103, "9900011111", null, 3, T + 1_380_000, 0, COMPANY),
    CallLogRow(104, "7000033333", "Mom", 2, T + 2_280_000, 360, PERSONAL),
    CallLogRow(105, "9900011111", null, 1, T + 3_480_000, 70, COMPANY),
    CallLogRow(106, "123", null, 4, T + 3_600_000, 30, COMPANY), // voicemail: not a call
)

class CallSyncTest {
    private val dualSim = CompanySimMatcher(setOf(COMPANY, "8991000000000000002"), acceptBlank = false)

    @Test
    fun personalSimCallsNeverReachTheOutbox() {
        val outbox = FakeOutbox()
        val last = CallSync(FakeLog(LOG), outbox, FakeEnds()).collect(0, 0, dualSim)
        assertEquals(listOf("101", "102", "103", "105"), outbox.calls.keys.toList())
        assertTrue(outbox.calls.values.none { it.number == "7000033333" || it.contactName == "Mom" })
        // The personal row was looked at, so it is never read again.
        assertEquals(106L, last)
    }

    @Test
    fun aRowWithNoSimIsSkippedOnADualSimPhone() {
        val outbox = FakeOutbox()
        val rows = listOf(CallLogRow(1, "9800000001", null, 2, T, 10, null), CallLogRow(2, "9800000002", null, 2, T, 10, ""))
        CallSync(FakeLog(rows), outbox, FakeEnds()).collect(0, 0, dualSim)
        assertTrue(outbox.calls.isEmpty())
        // On a single-SIM phone the same rows are the company SIM's.
        CallSync(FakeLog(rows), outbox, FakeEnds()).collect(0, 0, CompanySimMatcher(setOf(COMPANY), acceptBlank = true))
        assertEquals(2, outbox.calls.size)
    }

    @Test
    fun readsOnlyRowsAfterTheLastOneSeen() {
        val outbox = FakeOutbox()
        CallSync(FakeLog(LOG), outbox, FakeEnds()).collect(103, 0, dualSim)
        assertEquals(listOf("105"), outbox.calls.keys.toList())
    }

    @Test
    fun mapsCallLogTypes() {
        assertEquals("incoming", CallTypes.map(1))
        assertEquals("outgoing", CallTypes.map(2))
        assertEquals("missed", CallTypes.map(3))
        assertEquals("rejected", CallTypes.map(5))
        assertEquals("rejected", CallTypes.map(6))
        assertNull(CallTypes.map(4))
        assertNull(CallTypes.map(7))
    }

    @Test
    fun ringingTimeIsTheGapBeforeTheTalk() {
        // Dialled at T, talked 185 s, the call ended 197 s after T: it rang 12 s.
        assertEquals(12, ringSeconds(T, 185, listOf(T + 197_000)))
        // A missed call that rang 20 s.
        assertEquals(20, ringSeconds(T, 0, listOf(T + 20_000)))
        // Without an end event, ringing time is left empty, never guessed.
        assertNull(ringSeconds(T, 185, emptyList()))
        // An end long after the call belongs to another call.
        assertNull(ringSeconds(T, 0, listOf(T + 10 * 60_000)))
    }

    @Test
    fun collectFillsRingingTimeFromTheServiceEndTimes() {
        val outbox = FakeOutbox()
        CallSync(FakeLog(LOG), outbox, FakeEnds(listOf(T + 197_000))).collect(0, 0, dualSim)
        assertEquals(12, outbox.calls["101"]!!.ringSeconds)
        assertEquals(T + 197_000, outbox.calls["101"]!!.endedAtMs)
    }

    @Test
    fun sendKeepsCallsUntilTheServerTakesThem() = runTest {
        val outbox = FakeOutbox()
        val sync = CallSync(FakeLog(LOG), outbox, FakeEnds())
        sync.collect(0, 0, dualSim)

        val failing = object : CallUploader {
            override suspend fun upload(calls: List<OutgoingCall>): Set<String> = throw java.io.IOException("offline")
        }
        assertTrue(sync.send(failing) { 0 } is SendResult.Failed)
        assertEquals(4, outbox.pendingCount())

        val refusingOne = object : CallUploader {
            override suspend fun upload(calls: List<OutgoingCall>) = setOf("102")
        }
        assertEquals(SendResult.Done(sent = 3, rejected = 1), sync.send(refusingOne) { 0 })
        assertEquals(0, outbox.pendingCount())
        assertEquals(setOf("101", "103", "105"), outbox.sent)
    }

    @Test
    fun aRevokedPhoneStops() = runTest {
        val outbox = FakeOutbox()
        val sync = CallSync(FakeLog(LOG), outbox, FakeEnds())
        sync.collect(0, 0, dualSim)
        val revoked = object : CallUploader {
            override suspend fun upload(calls: List<OutgoingCall>): Set<String> = throw DeviceRevokedException()
        }
        assertEquals(SendResult.Revoked, sync.send(revoked) { 0 })
        assertEquals(4, outbox.pendingCount())
    }
}
