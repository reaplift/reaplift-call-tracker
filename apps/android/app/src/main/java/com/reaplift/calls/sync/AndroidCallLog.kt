package com.reaplift.calls.sync

import android.annotation.SuppressLint
import android.content.Context
import android.provider.CallLog

/** Reads Android's call log. Needs `READ_CALL_LOG`, checked before sync runs. */
class AndroidCallLog(private val context: Context) : CallLogSource {
    @SuppressLint("MissingPermission")
    override fun rowsAfter(afterId: Long, sinceMs: Long): List<CallLogRow> {
        val columns = arrayOf(
            CallLog.Calls._ID,
            CallLog.Calls.NUMBER,
            CallLog.Calls.CACHED_NAME,
            CallLog.Calls.TYPE,
            CallLog.Calls.DATE,
            CallLog.Calls.DURATION,
            CallLog.Calls.PHONE_ACCOUNT_ID,
        )
        val cursor = context.contentResolver.query(
            CallLog.Calls.CONTENT_URI,
            columns,
            "${CallLog.Calls._ID} > ? and ${CallLog.Calls.DATE} >= ?",
            arrayOf(afterId.toString(), sinceMs.toString()),
            "${CallLog.Calls._ID} asc",
        ) ?: return emptyList()
        return cursor.use { c ->
            buildList {
                while (c.moveToNext()) {
                    add(
                        CallLogRow(
                            id = c.getLong(0),
                            number = c.getString(1),
                            cachedName = c.getString(2),
                            type = c.getInt(3),
                            dateMs = c.getLong(4),
                            durationSeconds = c.getLong(5),
                            phoneAccountId = c.getString(6),
                        ),
                    )
                }
            }
        }
    }
}
