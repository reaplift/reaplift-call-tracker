package com.reaplift.calls.sync

import android.Manifest
import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.provider.MediaStore

/**
 * Reads the media index for audio files added in a time window (M6). Only names, folders, times, lengths and sizes
 * are read here; no file is opened. Works across dialers' folders (Vivo "Record/Call", Samsung "Recordings/Call",
 * Oppo "Music/Recordings/Call Recordings" and others) without all-files access.
 */
class MediaStoreAudio(private val context: Context) : AudioSource {
    override fun filesAddedBetween(fromMs: Long, toMs: Long): List<AudioFile> {
        if (!hasPermission(context)) return emptyList()
        val collection = if (Build.VERSION.SDK_INT >= 29) MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
        else MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
        val folderColumn = if (Build.VERSION.SDK_INT >= 29) MediaStore.Audio.Media.RELATIVE_PATH else MediaStore.Audio.Media.DATA
        val columns = arrayOf(
            MediaStore.Audio.Media._ID,
            MediaStore.Audio.Media.DISPLAY_NAME,
            folderColumn,
            MediaStore.Audio.Media.DATE_ADDED,
            MediaStore.Audio.Media.DATE_MODIFIED,
            MediaStore.Audio.Media.DURATION,
            MediaStore.Audio.Media.SIZE,
            MediaStore.Audio.Media.MIME_TYPE,
        )
        // date_added and date_modified are seconds. Either may be the save time, depending on the brand.
        val selection = "(${MediaStore.Audio.Media.DATE_ADDED} between ? and ?) or (${MediaStore.Audio.Media.DATE_MODIFIED} between ? and ?)"
        val from = (fromMs / 1000).toString()
        val to = (toMs / 1000).toString()
        return try {
            context.contentResolver.query(collection, columns, selection, arrayOf(from, to, from, to), null)?.use { c ->
                buildList {
                    while (c.moveToNext()) {
                        val id = c.getLong(0)
                        val added = c.getLong(3) * 1000
                        val modified = c.getLong(4) * 1000
                        // The save time closer to the window is the one the dialer wrote.
                        val saved = if (modified in fromMs..toMs) modified else added
                        add(
                            AudioFile(
                                uri = ContentUris.withAppendedId(collection, id).toString(),
                                name = c.getString(1).orEmpty(),
                                folder = c.getString(2).orEmpty(),
                                addedAtMs = saved,
                                durationMs = if (c.isNull(5)) null else c.getLong(5),
                                sizeBytes = c.getLong(6),
                                mimeType = c.getString(7),
                            ),
                        )
                    }
                }
            } ?: emptyList()
        } catch (e: SecurityException) {
            emptyList()
        }
    }

    companion object {
        val PERMISSION: String =
            if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_AUDIO else Manifest.permission.READ_EXTERNAL_STORAGE

        fun hasPermission(context: Context) = context.checkSelfPermission(PERMISSION) == PackageManager.PERMISSION_GRANTED
    }
}
