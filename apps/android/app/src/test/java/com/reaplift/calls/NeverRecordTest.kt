package com.reaplift.calls

import com.reaplift.calls.sync.CallLogRow
import com.reaplift.calls.sync.CallLogSource
import com.reaplift.calls.sync.CallEnds
import com.reaplift.calls.sync.CallSync
import com.reaplift.calls.sync.CompanySimMatcher
import com.reaplift.calls.sync.NeverRecordList
import com.reaplift.calls.sync.Outbox
import com.reaplift.calls.sync.OutgoingCall
import com.reaplift.calls.sync.PhoneNumbers
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// M12: the super admin's never-record numbers are dropped on the phone, like personal-SIM calls.
class NeverRecordTest {
    private val director = NeverRecordList(setOf(NeverRecordList.sha256("919811100000")))

    @Test
    fun theHashMatchesTheServersWhateverFormTheCallLogUses() {
        // The server's numberHash("919811100000"), as `printf 919811100000 | shasum -a 256` prints it.
        assertEquals("8632f52de7ed2c503bffb4d9371cbae0d6f8d3d905fabd786afcfd6869738660", NeverRecordList.sha256("919811100000"))
        for (form in listOf("+91 98111 00000", "09811100000", "9811100000", "919811100000")) assertTrue(form, director.contains(form))
        assertFalse(director.contains("9900011111"))
        assertFalse(director.contains(null))
        assertFalse(NeverRecordList.EMPTY.contains("9811100000"))
    }

    @Test
    fun normalisesNumbersAsTheServerDoes() {
        assertEquals("919811100000", PhoneNumbers.normalize("+91-98111-00000"))
        assertEquals("914040001000", PhoneNumbers.normalize("914040001000"))
        assertEquals("04040001000", PhoneNumbers.normalize("04040001000"))
        assertEquals("", PhoneNumbers.normalize("-2"))
    }

    @Test
    fun aListedNumbersCallNeverReachesTheOutbox() {
        val rows = listOf(
            CallLogRow(1, "+91 98111 00000", "Director", 1, 1_000, 60, "company"),
            CallLogRow(2, "9900011111", null, 2, 2_000, 30, "company"),
        )
        val added = mutableListOf<OutgoingCall>()
        val outbox = object : Outbox {
            override fun add(call: OutgoingCall) { added += call }
            override fun pending(limit: Int) = emptyList<OutgoingCall>()
            override fun markSent(ids: Collection<String>, at: Long) {}
            override fun drop(ids: Collection<String>) {}
            override fun pendingCount() = 0
        }
        val source = object : CallLogSource { override fun rowsAfter(afterId: Long, sinceMs: Long) = rows }
        val ends = object : CallEnds {
            override fun record(endedAtMs: Long) {}
            override fun between(fromMs: Long, toMs: Long) = emptyList<Long>()
        }
        val last = CallSync(source, outbox, ends).collect(0, 0, CompanySimMatcher(setOf("company"), false), director)
        assertEquals(listOf("9900011111"), added.map { it.number })
        assertEquals("the skipped row is never read again", 2L, last)
    }
}
