package com.reaplift.calls.whatsapp

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.reaplift.calls.data.LocalDb
import com.reaplift.calls.data.Prefs
import com.reaplift.calls.sync.SyncWorker
import com.reaplift.calls.ui.formatDay
import com.reaplift.calls.ui.whatsapp
import java.util.UUID

/** Blanks the app always fills itself and the employee doesn't see as boxes. */
private val HIDDEN_BLANKS = setOf("employee_name", "company_name")
private val WA_GREEN = Color(0xFFE5F4EE)

/**
 * M10: send a company WhatsApp template to the client. Three steps in one pop-up: pick a template, fill the blanks
 * the app doesn't know (client's name pre-filled from the contact), check the message, then WhatsApp opens on the
 * client's chat with the text ready and the employee presses WhatsApp's send button. The send is logged on the
 * phone and uploaded with the next sync.
 */
@Composable
fun WhatsAppDialog(number: String, contactName: String?, deviceCallId: String?, followUpAtMs: Long?, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val db = remember { LocalDb(context) }
    val prefs = remember { Prefs(context) }
    val templates = remember { db.messageTemplates() }
    var chosen by remember { mutableStateOf<MessageTemplate?>(null) }
    var reviewing by remember { mutableStateOf(false) }
    val values = remember { mutableStateMapOf<String, String>() }

    fun pick(t: MessageTemplate) {
        values.clear()
        contactName?.takeIf { it.isNotBlank() }?.let { values["name"] = it }
        prefs.employeeName?.let { values["employee_name"] = it }
        prefs.companyName?.let { values["company_name"] = it }
        followUpAtMs?.let { values["follow_up_date"] = formatDay(it) }
        chosen = t
        // Nothing for the employee to fill or change: straight to the check.
        reviewing = Templates.blanks(t.body).none { it !in HIDDEN_BLANKS }
    }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(shape = RoundedCornerShape(20.dp), modifier = Modifier.fillMaxWidth(0.94f)) {
            Column(
                Modifier.padding(18.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                val t = chosen
                when {
                    t == null -> {
                        Text("Send on WhatsApp", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                        Text("to ${contactName ?: formatTo(number)}", style = MaterialTheme.typography.bodySmall)
                        if (templates.isEmpty()) {
                            Text("Your admin hasn't added any WhatsApp templates yet.", style = MaterialTheme.typography.bodyMedium)
                        }
                        templates.forEach { tpl ->
                            Card(Modifier.fillMaxWidth().clickable { pick(tpl) }.testTag("template-${tpl.title}")) {
                                Column(Modifier.padding(12.dp)) {
                                    Text(tpl.title, fontWeight = FontWeight.SemiBold)
                                    Text(tpl.body, style = MaterialTheme.typography.bodySmall, maxLines = 2)
                                }
                            }
                        }
                        TextButton(onClick = { whatsapp(context, number); onDismiss() }, modifier = Modifier.fillMaxWidth()) {
                            Text("Open chat without a template")
                        }
                        TextButton(onClick = onDismiss, modifier = Modifier.fillMaxWidth()) { Text("Cancel") }
                    }
                    !reviewing -> {
                        Text(t.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                        Text("Fill in the blanks. The rest of the message can't be changed.", style = MaterialTheme.typography.bodySmall)
                        Templates.blanks(t.body).filter { it !in HIDDEN_BLANKS }.forEach { blank ->
                            OutlinedTextField(
                                value = values[blank].orEmpty(),
                                onValueChange = { values[blank] = it.take(200) },
                                label = { Text(Templates.label(blank)) },
                                isError = values[blank].isNullOrBlank(),
                                supportingText = {
                                    when {
                                        values[blank].isNullOrBlank() -> Text("Needed before sending")
                                        blank == "name" && contactName != null -> Text("From your contact \"$contactName\". You can change it.")
                                    }
                                },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                        Button(
                            enabled = Templates.missing(t.body, values).isEmpty(),
                            onClick = { reviewing = true },
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text("Check the message") }
                        TextButton(onClick = { chosen = null }, modifier = Modifier.fillMaxWidth()) { Text("Back") }
                    }
                    else -> {
                        val text = Templates.fill(t.body, values)
                        Text("Check the message", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                        Text(
                            text,
                            modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(WA_GREEN).padding(12.dp),
                            color = Color(0xFF1B1B1B),
                        )
                        Text("To ${formatTo(number)} · ${t.title}", style = MaterialTheme.typography.bodySmall)
                        val missing = Templates.missing(t.body, values)
                        if (missing.isNotEmpty()) {
                            Text("Fill ${missing.joinToString { Templates.label(it) }} first.", color = MaterialTheme.colorScheme.error)
                        }
                        Button(
                            enabled = missing.isEmpty(),
                            onClick = {
                                if (openWhatsApp(context, number, text, t, deviceCallId, db)) onDismiss()
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text("Send on WhatsApp") }
                        OutlinedButton(onClick = {
                            if (Templates.blanks(t.body).none { it !in HIDDEN_BLANKS }) chosen = null else reviewing = false
                        }, modifier = Modifier.fillMaxWidth()) { Text("Back") }
                    }
                }
            }
        }
    }
}

private fun formatTo(number: String) = com.reaplift.calls.ui.formatNumber(number)

/** WhatsApp Business if installed, otherwise WhatsApp (question W3: neither is required). */
fun whatsAppPackage(context: Context): Pair<String, String>? =
    listOf("com.whatsapp.w4b" to "whatsapp_business", "com.whatsapp" to "whatsapp")
        .firstOrNull { (pkg, _) -> context.packageManager.getLaunchIntentForPackage(pkg) != null }

/** Opens the client's chat with the text and logs the send. False (and nothing logged) when WhatsApp isn't installed. */
private fun openWhatsApp(context: Context, number: String, text: String, t: MessageTemplate, deviceCallId: String?, db: LocalDb): Boolean {
    val app = whatsAppPackage(context)
    if (app == null) {
        Toast.makeText(context, "WhatsApp is not installed", Toast.LENGTH_SHORT).show()
        return false
    }
    val digits = number.filter(Char::isDigit).let { if (it.length == 10) "91$it" else it }
    context.startActivity(
        Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$digits?text=${Uri.encode(text)}"))
            .setPackage(app.first)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
    db.addSend(PendingSend(UUID.randomUUID().toString(), t.id, number, deviceCallId, text, app.second, System.currentTimeMillis()))
    SyncWorker.syncSoon(context, delaySeconds = 0)
    return true
}
