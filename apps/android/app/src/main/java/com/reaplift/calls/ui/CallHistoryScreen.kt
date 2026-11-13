package com.reaplift.calls.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.reaplift.calls.data.LocalCall
import com.reaplift.calls.data.LocalDb
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

private val TABS = listOf<Pair<String, String?>>("All" to null, "Incoming" to "incoming", "Outgoing" to "outgoing", "Missed" to "missed")

/**
 * The app's call history (client, 12 November 2026): company-SIM calls only, by day, with tabs, search, call and
 * WhatsApp buttons, the recording, and the note. Personal-SIM calls are never here: they never enter the app.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CallHistoryScreen(refresh: Int, onComment: (String) -> Unit) {
    val context = LocalContext.current
    val db = remember { LocalDb(context) }
    var tab by remember { mutableStateOf<String?>(null) }
    var search by remember { mutableStateOf("") }
    val calls = remember(tab, search, refresh) { db.history(tab, search) }

    Text("Call history", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
    // Wraps onto a second line on narrow phones instead of pushing "Missed" off the screen.
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        TABS.forEach { (label, type) -> FilterChip(selected = tab == type, onClick = { tab = type }, label = { Text(label, maxLines = 1) }) }
    }
    OutlinedTextField(
        value = search,
        onValueChange = { search = it.take(40) },
        placeholder = { Text("Search name or number") },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
    )
    if (calls.isEmpty()) {
        Text(if (search.isBlank()) "No company-SIM calls yet." else "No calls match.", style = MaterialTheme.typography.bodySmall)
        return
    }
    var lastDay = ""
    calls.forEach { item ->
        val day = dayHeading(item.call.startedAtMs)
        if (day != lastDay) {
            Text(day, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 6.dp))
            lastDay = day
        }
        CallCard(item, onComment = { onComment(item.call.deviceCallId) }, onPlay = { playRecording(context, db, item) })
    }
}

@Composable
private fun CallCard(item: LocalCall, onComment: () -> Unit, onPlay: () -> Unit) {
    val context = LocalContext.current
    val call = item.call
    var whatsAppOpen by remember { mutableStateOf(false) }
    if (whatsAppOpen) {
        com.reaplift.calls.whatsapp.WhatsAppDialog(call.number, call.contactName, call.deviceCallId, item.followUpAtMs) { whatsAppOpen = false }
    }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                TypeBadge(call.type)
                // The name or number gets the full width; time and talk time go on the line below.
                Column(Modifier.weight(1f).padding(start = 10.dp)) {
                    Text(call.contactName ?: formatNumber(call.number), fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (call.contactName != null) Text(formatNumber(call.number), style = MaterialTheme.typography.bodySmall)
                    Text(
                        "${typeLabel(call.type)} · ${formatClock(call.startedAtMs)} · ${formatTalk(call.talkSeconds, call.ringSeconds)}",
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(2.dp), verticalArrangement = Arrangement.Center) {
                TextButton(onClick = { dial(context, call.number) }) { Text("Call", maxLines = 1) }
                TextButton(onClick = { whatsAppOpen = true }) { Text("WhatsApp", maxLines = 1) }
                when (item.recordingStatus) {
                    "uploaded" -> TextButton(onClick = onPlay) { Text("▶ Play", maxLines = 1) }
                    "missing" -> TextButton(onClick = {}, enabled = false) { Text("No recording", maxLines = 1, color = MaterialTheme.colorScheme.error) }
                }
            }
            Box(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceVariant)
                    .clickable(onClick = onComment).padding(10.dp),
            ) {
                if (item.commentedAtMs == null) {
                    Text("Tap here to add notes", color = MaterialTheme.colorScheme.onSurfaceVariant)
                } else {
                    Column {
                        item.outcomeLabel?.let { Text(it, fontWeight = FontWeight.SemiBold) }
                        item.note?.let { Text(it) }
                        item.followUpAtMs?.let { Text("Follow up ${formatDay(it)} ${formatClock(it)}", style = MaterialTheme.typography.bodySmall) }
                    }
                }
            }
        }
    }
}

@Composable
private fun TypeBadge(type: String) {
    val (symbol, color) = when (type) {
        "incoming" -> "↙" to Color(0xFF7CB342)
        "outgoing" -> "↗" to Color(0xFFF59E0B)
        "missed" -> "✕" to Color(0xFFC62828)
        else -> "⊘" to Color(0xFF8E1B1B)
    }
    Box(Modifier.size(40.dp).clip(CircleShape).background(color), contentAlignment = Alignment.Center) {
        Text(symbol, color = Color.White, fontWeight = FontWeight.Bold)
    }
}

/** Plays the phone's own copy of the recording in the phone's audio player. */
private fun playRecording(context: Context, db: LocalDb, item: LocalCall) {
    val uri = db.recordingUri(item.call.deviceCallId) ?: return
    try {
        context.startActivity(
            Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(uri), "audio/*")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    } catch (e: ActivityNotFoundException) {
        Toast.makeText(context, "No audio player on this phone", Toast.LENGTH_SHORT).show()
    } catch (e: SecurityException) {
        Toast.makeText(context, "The recording is no longer on this phone", Toast.LENGTH_SHORT).show()
    }
}

private fun dayHeading(ms: Long): String {
    val day = Calendar.getInstance().apply { timeInMillis = ms }
    val today = Calendar.getInstance()
    fun same(a: Calendar, b: Calendar) = a.get(Calendar.YEAR) == b.get(Calendar.YEAR) && a.get(Calendar.DAY_OF_YEAR) == b.get(Calendar.DAY_OF_YEAR)
    if (same(day, today)) return "Today"
    today.add(Calendar.DAY_OF_YEAR, -1)
    if (same(day, today)) return "Yesterday"
    return SimpleDateFormat("EEE, d MMM yyyy", Locale.getDefault()).format(Date(ms))
}
