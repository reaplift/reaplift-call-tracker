package com.reaplift.calls

import com.reaplift.calls.sync.AudioFile
import com.reaplift.calls.sync.AudioSource
import com.reaplift.calls.sync.DeviceRevokedException
import com.reaplift.calls.sync.MissingReason
import com.reaplift.calls.sync.OutgoingCall
import com.reaplift.calls.sync.RecordingLedger
import com.reaplift.calls.sync.RecordingMatcher
import com.reaplift.calls.sync.RecordingSync
import com.reaplift.calls.sync.RecordingUploader
import com.reaplift.calls.sync.SendResult
import com.reaplift.calls.sync.UploadResult
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private const val T0 = 1_762_930_000_000L // a call starts here
private fun call(id: String, talk: Int, type: String = "outgoing", start: Long = T0, number: String = "919845012345", name: String? = null) =
    OutgoingCall(id, number, name, type, start, talk, 5, start + (talk + 5) * 1000L)

private fun file(uri: String, name: String, savedAt: Long, seconds: Long?, folder: String = "Record/Call/") =
    AudioFile(uri, name, folder, savedAt, seconds?.let { it * 1000 }, 900_000, "audio/mp4")

private class FakeLedger(vararg calls: OutgoingCall) : RecordingLedger {
    val waiting = calls.toMutableList()
    val marks = linkedMapOf<String, Pair<String, String?>>()
    override fun callsNeedingRecording(sinceMs: Long, limit: Int) = waiting.filter { it.deviceCallId !in marks && it.startedAtMs >= sinceMs }.take(limit)
    override fun markRecording(deviceCallId: String, status: String, uri: String?, at: Long) {
        marks[deviceCallId] = status to uri
    }
    override fun usedRecordingUris() = marks.values.mapNotNull { it.second }.toSet()
}

private class FakeAudio(vararg files: AudioFile) : AudioSource {
    val all = files.toList()
    val windows = mutableListOf<Pair<Long, Long>>()
    override fun filesAddedBetween(fromMs: Long, toMs: Long): List<AudioFile> {
        windows += fromMs to toMs
        return all.filter { it.addedAtMs in fromMs..toMs }
    }
}

private class FakeUploader(private val answer: UploadResult = UploadResult.Done, private val notSynced: Set<String> = emptySet()) : RecordingUploader {
    var missingRequests = 0
    val uploaded = mutableListOf<Pair<String, String>>()
    val missing = mutableListOf<String>()
    val reasons = mutableListOf<MissingReason>()
    override suspend fun upload(call: OutgoingCall, file: AudioFile, score: Int): UploadResult {
        uploaded += call.deviceCallId to file.uri
        return answer
    }
    override suspend fun reportMissing(calls: List<Pair<OutgoingCall, MissingReason>>): Set<String> {
        missingRequests++
        missing += calls.map { it.first.deviceCallId }
        reasons += calls.map { it.second }
        return notSynced
    }
}

class RecordingSyncTest {
    private val c = call("1", talk = 185)
    private val end = T0 + 190_000

    @Test
    fun aFileSavedAtTheEndWithTheRightLengthAndNumberIsACertainMatch() {
        assertEquals(100, RecordingMatcher.score(c, file("u1", "Call_9845012345_20261112.m4a", end + 2_000, 184)))
    }

    @Test
    fun theRightLengthAndTimeIsEnoughWithoutTheNumberInTheName() {
        assertTrue(RecordingMatcher.score(c, file("u1", "REC0001.m4a", end + 2_000, 186)) >= 60)
    }

    @Test
    fun aSongOrVoiceNoteOfTheWrongLengthIsNotAMatch() {
        // Saved at the right time but 40 seconds long: a voice note, not this 3-minute call.
        assertTrue(RecordingMatcher.score(c, file("u1", "voice note.m4a", end + 5_000, 40, folder = "WhatsApp/Media/")) < 60)
    }

    @Test
    fun picksTheBestFileAndNeverUsesOneTwice() {
        val good = file("good", "Call_9845012345.m4a", end + 1_000, 185)
        val other = file("other", "Call_9900011111.m4a", end + 3_000, 185)
        assertEquals("good", RecordingMatcher.best(c, listOf(other, good), emptySet())!!.first.uri)
        assertEquals("other", RecordingMatcher.best(c, listOf(other, good), setOf("good"))?.first?.uri)
        assertNull(RecordingMatcher.best(c, listOf(good), setOf("good")))
    }

    @Test
    fun uploadsTheMatchAndRemembersIt() = runTest {
        val ledger = FakeLedger(c)
        val uploader = FakeUploader()
        val result = RecordingSync(ledger, FakeAudio(file("u1", "Call_9845012345.m4a", end + 2_000, 185))).run(uploader, 0) { end + 60_000 }
        assertEquals(SendResult.Done(1, 0), result)
        assertEquals(listOf("1" to "u1"), uploader.uploaded)
        assertEquals("uploaded" to "u1", ledger.marks["1"])
    }

    @Test
    fun waitsForTheDialerToSaveThenGivesUpAfterTenMinutes() = runTest {
        val ledger = FakeLedger(c)
        val uploader = FakeUploader()
        val sync = RecordingSync(ledger, FakeAudio())
        sync.run(uploader, 0) { end + 5_000 }
        assertTrue("too early to look", uploader.missing.isEmpty() && ledger.marks.isEmpty())
        sync.run(uploader, 0) { end + 5 * 60_000 }
        assertTrue("still within ten minutes", uploader.missing.isEmpty() && ledger.marks.isEmpty())
        val missingCalls = mutableListOf<String>()
        sync.run(uploader, 0, onMissing = { missingCalls += it.deviceCallId }) { end + 11 * 60_000 }
        assertEquals(listOf("1"), uploader.missing)
        assertEquals("missing" to null, ledger.marks["1"])
        assertEquals("the employee is told", listOf("1"), missingCalls)
    }

    @Test
    fun onlyLooksInsideTheCallsWindow() = runTest {
        val audio = FakeAudio()
        RecordingSync(FakeLedger(c), audio).run(FakeUploader(), 0) { end + 60_000 }
        assertEquals(listOf((T0 - 60_000) to (end + 10 * 60_000)), audio.windows)
    }

    @Test
    fun shortAndMissedCallsAreNotExpectedToHaveOne() = runTest {
        val ledger = FakeLedger(call("2", talk = 3), call("3", talk = 0, type = "missed"))
        val uploader = FakeUploader()
        RecordingSync(ledger, FakeAudio()).run(uploader, 0) { end + 60 * 60_000 }
        assertEquals(mapOf("2" to ("not_expected" to null), "3" to ("not_expected" to null)), ledger.marks)
        assertTrue(uploader.missing.isEmpty())
    }

    @Test
    fun keepsEverythingWhenTheServerIsNotReadyOrTheNetworkFails() = runTest {
        val f = file("u1", "Call_9845012345.m4a", end + 2_000, 185)
        val notReady = FakeLedger(c)
        RecordingSync(notReady, FakeAudio(f)).run(FakeUploader(UploadResult.NotConfigured), 0) { end + 60_000 }
        assertTrue(notReady.marks.isEmpty())
        val down = object : RecordingUploader {
            override suspend fun upload(call: OutgoingCall, file: AudioFile, score: Int): UploadResult = throw java.io.IOException("offline")
            override suspend fun reportMissing(calls: List<Pair<OutgoingCall, MissingReason>>): Set<String> = throw java.io.IOException("offline")
        }
        val offline = FakeLedger(c)
        assertTrue(RecordingSync(offline, FakeAudio(f)).run(down, 0) { end + 60_000 } is SendResult.Failed)
        assertTrue(offline.marks.isEmpty())
        val revoked = object : RecordingUploader {
            override suspend fun upload(call: OutgoingCall, file: AudioFile, score: Int): UploadResult = throw DeviceRevokedException()
            override suspend fun reportMissing(calls: List<Pair<OutgoingCall, MissingReason>>): Set<String> = throw DeviceRevokedException()
        }
        assertEquals(SendResult.Revoked, RecordingSync(FakeLedger(c), FakeAudio(f)).run(revoked, 0) { end + 60_000 })
    }

    @Test
    fun aMissingRecordingSaysWhyWithoutTheFileName() = runTest {
        // Right time and folder, but no length and no number in the name: 50 points, under the 60 needed.
        val near = file("near", "Call recording Asha 2026-11-12.m4a", end + 4_000, null, folder = "Music/Recordings/Call Recordings/")
        val uploader = FakeUploader()
        RecordingSync(FakeLedger(c), FakeAudio(near)).run(uploader, 0) { end + 11 * 60_000 }
        assertEquals(listOf("1"), uploader.missing)
        assertEquals(MissingReason(1, 50, "Music/Recordings/Call Recordings/", null, 4), uploader.reasons.single())
        assertTrue("no file name is sent", uploader.reasons.single().toString().contains("Asha").not())
    }

    @Test
    fun aMissingRecordingWithNoAudioAtAllSaysSo() = runTest {
        val uploader = FakeUploader()
        RecordingSync(FakeLedger(c), FakeAudio()).run(uploader, 0) { end + 11 * 60_000 }
        assertEquals(MissingReason(0, null, null, null, null), uploader.reasons.single())
    }

    @Test
    fun aFolderNamedAfterAClientNumberDoesNotLeaveThePhone() {
        assertEquals("Recorder/#/", RecordingMatcher.withoutNumbers("Recorder/919845012345/"))
        assertEquals("Recordings/Call/", RecordingMatcher.withoutNumbers("Recordings/Call/"))
    }

    @Test
    fun manyMissingRecordingsGoInOneRequest() = runTest {
        val calls = (1..12).map { call("m$it", talk = 60, start = T0 + it * 600_000L) }
        val uploader = FakeUploader()
        val ledger = FakeLedger(*calls.toTypedArray())
        RecordingSync(ledger, FakeAudio()).run(uploader, 0) { T0 + 24 * 3_600_000L }
        assertEquals(1, uploader.missingRequests)
        assertEquals(12, uploader.missing.size)
        assertTrue(ledger.marks.values.all { it.first == "missing" })
    }

    @Test
    fun aCallTheServerDoesNotHaveYetIsReportedAgainLater() = runTest {
        val ledger = FakeLedger(c)
        RecordingSync(ledger, FakeAudio()).run(FakeUploader(notSynced = setOf("1")), 0) { end + 11 * 60_000 }
        assertTrue("not marked, so it is reported again", ledger.marks.isEmpty())
    }
}
