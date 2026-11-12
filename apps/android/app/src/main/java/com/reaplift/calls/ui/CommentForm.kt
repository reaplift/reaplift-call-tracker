package com.reaplift.calls.ui

import android.app.DatePickerDialog
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.speech.RecognizerIntent
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.reaplift.calls.data.LocalCall
import com.reaplift.calls.data.LocalDb
import com.reaplift.calls.sync.Notifications
import com.reaplift.calls.sync.Outcome
import com.reaplift.calls.sync.SyncWorker
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * The after-call form (M4, and the client's pop-up of 12 November 2026): outcome, comment with ready-made notes
 * ("/" or a chip) and voice typing, follow-up date, and Save & exit or Save & call again. Saved on the phone at once
 * and sent by the next sync, so it works offline. Used by the pop-up and by the app's call screens.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CommentForm(item: LocalCall, onDone: () -> Unit) {
    val context = LocalContext.current
    val db = remember { LocalDb(context) }
    val outcomes = remember { db.outcomes() }
    val templates = remember { db.noteTemplates() }
    var outcomeId by remember { mutableStateOf(item.outcomeId) }
    var note by remember { mutableStateOf(item.note.orEmpty()) }
    var followUp by remember { mutableStateOf(item.followUpAtMs) }
    val call = item.call
    val who = call.contactName ?: formatNumber(call.number)

    val speech = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val heard = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
        if (!heard.isNullOrBlank()) note = listOf(note.trim(), heard.trim()).filter { it.isNotEmpty() }.joinToString(" ").take(1000)
    }

    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Column {
            Text(who, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            if (call.contactName != null) Text(formatNumber(call.number))
            Text(
                "${typeLabel(call.type)} · ${formatDay(call.startedAtMs)} ${formatClock(call.startedAtMs)} · " +
                    formatTalk(call.talkSeconds, call.ringSeconds),
                style = MaterialTheme.typography.bodySmall,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { dial(context, call.number) }) { Text("Call") }
            OutlinedButton(onClick = { whatsapp(context, call.number) }) { Text("WhatsApp") }
        }

        if (outcomes.isNotEmpty()) {
            Text("Outcome", fontWeight = FontWeight.SemiBold)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                outcomes.forEach { o ->
                    FilterChip(
                        selected = outcomeId == o.id,
                        onClick = { outcomeId = if (outcomeId == o.id) null else o.id },
                        label = { Text(o.label) },
                    )
                }
            }
        }

        Text("Note", fontWeight = FontWeight.SemiBold)
        OutlinedTextField(
            value = note,
            onValueChange = { if (it.length <= 1000) note = it },
            placeholder = { Text("Type your call summary, or type / for a ready-made note") },
            modifier = Modifier.fillMaxWidth(),
            minLines = 3,
        )
        // "/" at the end opens the ready-made notes, as the client's reference app does.
        if (note.endsWith("/") && templates.isNotEmpty()) {
            Column {
                templates.forEach { t ->
                    TextButton(onClick = { note = (note.dropLast(1) + t).take(1000) }, modifier = Modifier.fillMaxWidth()) { Text(t) }
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = {
                val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    .putExtra(RecognizerIntent.EXTRA_PROMPT, "Say your call summary")
                try {
                    speech.launch(intent)
                } catch (e: ActivityNotFoundException) {
                    Toast.makeText(context, "Voice typing is not available on this phone", Toast.LENGTH_SHORT).show()
                }
            }) { Text("🎤 Speak") }
        }
        if (templates.isNotEmpty()) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                templates.take(8).forEach { t ->
                    AssistChip(onClick = { note = listOf(note.trim(), t).filter { it.isNotEmpty() }.joinToString(". ").take(1000) }, label = { Text(t) })
                }
            }
        }

        Text("Follow up", fontWeight = FontWeight.SemiBold)
        val choices = remember { followUpChoices() }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            choices.forEach { (label, at) -> FilterChip(selected = followUp == at, onClick = { followUp = at }, label = { Text(label) }) }
            val custom = followUp != null && choices.none { it.second == followUp }
            FilterChip(
                selected = custom,
                onClick = { pickDate(context, followUp) { followUp = it } },
                label = { Text(if (custom) "On ${formatDay(followUp!!)}" else "Pick a date") },
            )
        }

        val canSave = outcomeId != null || note.isNotBlank()
        val save = {
            val outcome: Outcome? = outcomes.firstOrNull { it.id == outcomeId }
            db.saveComment(call.deviceCallId, outcome, note.trim().ifBlank { null }, followUp, System.currentTimeMillis())
            Notifications.cancelComment(context, call.deviceCallId)
            // WorkManager, not this screen's scope: the pop-up closes straight away.
            SyncWorker.syncSoon(context, delaySeconds = 0)
        }
        Button(enabled = canSave, onClick = { save(); onDone() }, modifier = Modifier.fillMaxWidth()) { Text("Save & exit") }
        OutlinedButton(enabled = canSave, onClick = { save(); dial(context, call.number); onDone() }, modifier = Modifier.fillMaxWidth()) {
            Text("Save & call again")
        }
        TextButton(onClick = onDone, modifier = Modifier.fillMaxWidth()) { Text("Later") }
    }
}

/** Opens the phone's dialer with the number filled in; the employee taps call (calling directly is M9). */
fun dial(context: Context, number: String) {
    val digits = number.filter { it.isDigit() || it == '+' }
    if (digits.isEmpty()) return
    context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$digits")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}

/** Opens a WhatsApp chat with the number (wa.me needs the country code, which stored numbers have). */
fun whatsapp(context: Context, number: String) {
    val digits = number.filter(Char::isDigit).let { if (it.length == 10) "91$it" else it }
    if (digits.isEmpty()) return
    try {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$digits")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (e: ActivityNotFoundException) {
        Toast.makeText(context, "WhatsApp is not installed", Toast.LENGTH_SHORT).show()
    }
}

private fun pickDate(context: Context, current: Long?, onPicked: (Long) -> Unit) {
    val cal = Calendar.getInstance().apply { timeInMillis = current ?: (System.currentTimeMillis() + 86_400_000L) }
    DatePickerDialog(context, { _, y, m, d ->
        val at = Calendar.getInstance().apply { set(y, m, d, 10, 0, 0); set(Calendar.MILLISECOND, 0) }
        onPicked(at.timeInMillis)
    }, cal.get(Calendar.YEAR), cal.get(Calendar.MONTH), cal.get(Calendar.DAY_OF_MONTH)).apply {
        datePicker.minDate = System.currentTimeMillis() - 60_000
    }.show()
}

/** "No follow-up", tomorrow, in 3 days and next week, each at 10:00 on the phone's clock. */
private fun followUpChoices(): List<Pair<String, Long?>> {
    fun daysAhead(days: Int): Long = Calendar.getInstance().apply {
        add(Calendar.DAY_OF_YEAR, days); set(Calendar.HOUR_OF_DAY, 10); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
    }.timeInMillis
    return listOf("No follow-up" to null, "Tomorrow" to daysAhead(1), "In 3 days" to daysAhead(3), "Next week" to daysAhead(7))
}

fun typeLabel(type: String) = when (type) {
    "incoming" -> "Incoming"
    "outgoing" -> "Outgoing"
    "missed" -> "Missed"
    "rejected" -> "Rejected"
    else -> type
}

/** "3m 15s (rang 8s)", as the client's reference app shows it. */
fun formatTalk(talkSeconds: Int, ringSeconds: Int?): String {
    val h = talkSeconds / 3600
    val m = (talkSeconds % 3600) / 60
    val s = talkSeconds % 60
    val talk = (if (h > 0) "${h}h " else "") + "${m}m ${s}s"
    return talk + (ringSeconds?.let { " (rang ${it}s)" } ?: "")
}

fun formatDay(ms: Long): String = SimpleDateFormat("d MMM", Locale.getDefault()).format(Date(ms))
fun formatClock(ms: Long): String = SimpleDateFormat("h:mm a", Locale.getDefault()).format(Date(ms))
