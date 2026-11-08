package com.reaplift.calls.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import com.reaplift.calls.sync.CallEnds
import com.reaplift.calls.sync.Outbox
import com.reaplift.calls.sync.OutgoingCall

/**
 * The app's own database: the outbox of company-SIM calls waiting to be sent (and those sent, for the
 * "what was synced" screen), and the call end times the tracking service saw (for ringing time).
 * Nothing from a personal SIM is ever written here.
 */
class LocalDb(context: Context) :
    SQLiteOpenHelper(context, "calls.db", null, 1), Outbox, CallEnds {

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
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

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
        writableDatabase.transaction { execSQL("delete from outbox"); execSQL("delete from call_ends") }
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
