package com.reaplift.calls.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import com.reaplift.calls.sync.AfterCall
import com.reaplift.calls.sync.CallEnds
import com.reaplift.calls.sync.CommentStore
import com.reaplift.calls.sync.Outbox
import com.reaplift.calls.sync.Outcome
import com.reaplift.calls.sync.OutgoingCall
import com.reaplift.calls.sync.PendingComment
import com.reaplift.calls.sync.RecordingLedger

/** A synced call with its after-call form (M4), for the screens. */
data class LocalCall(
    val call: OutgoingCall,
    val outcomeId: String?,
    val outcomeLabel: String?,
    val note: String?,
    val followUpAtMs: Long?,
    val commentedAtMs: Long?,
    /** M6: null until looked for; then uploaded, missing or not_expected. */
    val recordingStatus: String? = null,
)

/**
 * The app's own database: the outbox of company-SIM calls waiting to be sent (and those sent, for the
 * "what was synced" screen), the call end times the tracking service saw (for ringing time), and the
 * after-call forms (M4) with the company's outcomes. Nothing from a personal SIM is ever written here.
 */
class LocalDb(context: Context) :
    SQLiteOpenHelper(context, "calls.db", null, 3), Outbox, CallEnds, CommentStore, RecordingLedger {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            create table outbox (
              device_call_id text primary key,
              number text not null,
              contact_name text,
              type text not null,
              started_at integer not null,
              talk_seconds integer not null,
              ring_seconds integer,
              ended_at integer,
              sent_at integer
            )
            """.trimIndent(),
        )
        db.execSQL("create index outbox_pending on outbox (sent_at, started_at)")
        db.execSQL("create table call_ends (ended_at integer not null)")
        addAfterCallForm(db)
        addRecordings(db)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // Version 2 (M4): the after-call form. Version 3 (M6): recordings. Older phones keep their outbox.
        if (oldVersion < 2) addAfterCallForm(db)
        if (oldVersion < 3) addRecordings(db)
    }

    private fun addRecordings(db: SQLiteDatabase) {
        for (column in listOf("recording_status text", "recording_uri text", "recording_at integer")) {
            db.execSQL("alter table outbox add column $column")
        }
    }

    override fun callsNeedingRecording(sinceMs: Long, limit: Int): List<OutgoingCall> =
        query("sent_at is not null and recording_status is null and started_at >= $sinceMs", "started_at asc", limit)

    override fun markRecording(deviceCallId: String, status: String, uri: String?, at: Long) {
        writableDatabase.execSQL(
            "update outbox set recording_status = ?, recording_uri = ?, recording_at = ? where device_call_id = ?",
            arrayOf(status, uri, at, deviceCallId),
        )
    }

    override fun usedRecordingUris(): Set<String> =
        readableDatabase.rawQuery("select recording_uri from outbox where recording_uri is not null", null)
            .use { c -> buildSet { while (c.moveToNext()) add(c.getString(0)) } }

    private fun addAfterCallForm(db: SQLiteDatabase) {
        for (column in listOf(
            "outcome_id text", "outcome_label text", "note text", "follow_up_at integer",
            "commented_at integer", "comment_sent_at integer", "prompted_at integer",
        )) db.execSQL("alter table outbox add column $column")
        db.execSQL("create table outcomes (id text primary key, label text not null, sort integer not null)")
    }

    override fun add(call: OutgoingCall) {
        val values = ContentValues().apply {
            put("device_call_id", call.deviceCallId)
            put("number", call.number)
            put("contact_name", call.contactName)
            put("type", call.type)
            put("started_at", call.startedAtMs)
            put("talk_seconds", call.talkSeconds)
            call.ringSeconds?.let { put("ring_seconds", it) }
            call.endedAtMs?.let { put("ended_at", it) }
        }
        writableDatabase.insertWithOnConflict("outbox", null, values, SQLiteDatabase.CONFLICT_IGNORE)
    }

    override fun pending(limit: Int): List<OutgoingCall> = query("sent_at is null", "started_at asc", limit)

    override fun markSent(ids: Collection<String>, at: Long) {
        writableDatabase.transaction { ids.forEach { execSQL("update outbox set sent_at = ? where device_call_id = ?", arrayOf(at, it)) } }
    }

    override fun drop(ids: Collection<String>) {
        writableDatabase.transaction { ids.forEach { execSQL("delete from outbox where device_call_id = ?", arrayOf(it)) } }
    }

    override fun pendingCount(): Int =
        readableDatabase.rawQuery("select count(*) from outbox where sent_at is null", null).use { it.moveToFirst(); it.getInt(0) }

    /** Calls sent since `since`, newest first: what the server has, as far as this phone knows. */
    fun sentSince(since: Long): List<OutgoingCall> = query("sent_at is not null and started_at >= $since", "started_at desc", 200)

    fun anySentSince(since: Long): Boolean =
        readableDatabase.rawQuery("select 1 from outbox where sent_at is not null and started_at >= ? limit 1", arrayOf(since.toString()))
            .use { it.moveToFirst() }

    fun clear() {
        writableDatabase.transaction { execSQL("delete from outbox"); execSQL("delete from call_ends"); execSQL("delete from outcomes") }
    }

    /** The employee's after-call form, kept here until the next sync sends it. */
    fun saveComment(deviceCallId: String, outcome: Outcome?, note: String?, followUpAtMs: Long?, now: Long) {
        writableDatabase.execSQL(
            "update outbox set outcome_id = ?, outcome_label = ?, note = ?, follow_up_at = ?, commented_at = ?, " +
                "comment_sent_at = null, prompted_at = coalesce(prompted_at, ?) where device_call_id = ?",
            arrayOf(outcome?.id, outcome?.label, note, followUpAtMs, now, now, deviceCallId),
        )
    }

    override fun commentsToSend(limit: Int): List<PendingComment> =
        readableDatabase.rawQuery(
            "select device_call_id, outcome_id, note, follow_up_at from outbox " +
                "where commented_at is not null and comment_sent_at is null and sent_at is not null " +
                "order by commented_at limit $limit",
            null,
        ).use { c ->
            buildList {
                while (c.moveToNext()) {
                    add(PendingComment(c.getString(0), c.getString(1), c.getString(2), if (c.isNull(3)) null else c.getLong(3)))
                }
            }
        }

    override fun markCommentSent(deviceCallId: String, at: Long) {
        writableDatabase.execSQL("update outbox set comment_sent_at = ? where device_call_id = ?", arrayOf(at, deviceCallId))
    }

    /** Calls since `since` with no form yet, newest first (the home screen's "needs a comment"). */
    fun needsComment(since: Long): List<LocalCall> =
        localCalls("commented_at is null and started_at >= $since", "started_at desc", 50)

    /** Recent calls that have not had their "how did it go?" notification yet. Marks them, so each is asked once. */
    fun takeCallsToPrompt(pairedAtMs: Long, now: Long): List<OutgoingCall> {
        val calls = query("prompted_at is null and commented_at is null", "started_at asc", 50)
        writableDatabase.transaction {
            calls.forEach { execSQL("update outbox set prompted_at = ? where device_call_id = ?", arrayOf(now, it.deviceCallId)) }
        }
        return calls.filter { AfterCall.shouldPrompt(it, pairedAtMs, now) }
    }

    /** Call log row IDs are digits; anything else is dropped before it reaches the query. */
    fun find(deviceCallId: String): LocalCall? =
        localCalls("device_call_id = '${deviceCallId.filter(Char::isLetterOrDigit)}'", "started_at", 1).firstOrNull()

    fun sentSinceWithComments(since: Long): List<LocalCall> = localCalls("sent_at is not null and started_at >= $since", "started_at desc", 200)

    fun outcomes(): List<Outcome> =
        readableDatabase.rawQuery("select id, label from outcomes order by sort", null)
            .use { c -> buildList { while (c.moveToNext()) add(Outcome(c.getString(0), c.getString(1))) } }

    /** The company's current list, from `/device/v1/config` on each sync. */
    fun replaceOutcomes(outcomes: List<Outcome>) {
        writableDatabase.transaction {
            execSQL("delete from outcomes")
            outcomes.forEachIndexed { i, o -> execSQL("insert into outcomes (id, label, sort) values (?, ?, ?)", arrayOf(o.id, o.label, i)) }
        }
    }

    private fun localCalls(where: String, order: String, limit: Int): List<LocalCall> =
        readableDatabase.rawQuery(
            "select device_call_id, number, contact_name, type, started_at, talk_seconds, ring_seconds, ended_at, " +
                "outcome_id, outcome_label, note, follow_up_at, commented_at, recording_status from outbox " +
                "where $where order by $order limit $limit",
            null,
        ).use { c ->
            buildList {
                while (c.moveToNext()) {
                    add(
                        LocalCall(
                            call = OutgoingCall(
                                deviceCallId = c.getString(0),
                                number = c.getString(1),
                                contactName = c.getString(2),
                                type = c.getString(3),
                                startedAtMs = c.getLong(4),
                                talkSeconds = c.getInt(5),
                                ringSeconds = if (c.isNull(6)) null else c.getInt(6),
                                endedAtMs = if (c.isNull(7)) null else c.getLong(7),
                            ),
                            outcomeId = c.getString(8),
                            outcomeLabel = c.getString(9),
                            note = c.getString(10),
                            followUpAtMs = if (c.isNull(11)) null else c.getLong(11),
                            commentedAtMs = if (c.isNull(12)) null else c.getLong(12),
                            recordingStatus = c.getString(13),
                        ),
                    )
                }
            }
        }

    override fun record(endedAtMs: Long) {
        writableDatabase.execSQL("insert into call_ends (ended_at) values (?)", arrayOf(endedAtMs))
        // A day is far more than any call needs.
        writableDatabase.execSQL("delete from call_ends where ended_at < ?", arrayOf(endedAtMs - 86_400_000L))
    }

    override fun between(fromMs: Long, toMs: Long): List<Long> =
        readableDatabase.rawQuery(
            "select ended_at from call_ends where ended_at between ? and ? order by ended_at",
            arrayOf(fromMs.toString(), toMs.toString()),
        ).use { c -> buildList { while (c.moveToNext()) add(c.getLong(0)) } }

    private fun query(where: String, order: String, limit: Int): List<OutgoingCall> =
        readableDatabase.rawQuery(
            "select device_call_id, number, contact_name, type, started_at, talk_seconds, ring_seconds, ended_at " +
                "from outbox where $where order by $order limit $limit",
            null,
        ).use { c ->
            buildList {
                while (c.moveToNext()) {
                    add(
                        OutgoingCall(
                            deviceCallId = c.getString(0),
                            number = c.getString(1),
                            contactName = c.getString(2),
                            type = c.getString(3),
                            startedAtMs = c.getLong(4),
                            talkSeconds = c.getInt(5),
                            ringSeconds = if (c.isNull(6)) null else c.getInt(6),
                            endedAtMs = if (c.isNull(7)) null else c.getLong(7),
                        ),
                    )
                }
            }
        }

    private inline fun SQLiteDatabase.transaction(block: SQLiteDatabase.() -> Unit) {
        beginTransaction()
        try {
            block()
            setTransactionSuccessful()
        } finally {
            endTransaction()
        }
    }
}
