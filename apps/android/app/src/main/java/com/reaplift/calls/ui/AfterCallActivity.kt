package com.reaplift.calls.ui

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.reaplift.calls.data.LocalCall
import com.reaplift.calls.data.LocalDb
import com.reaplift.calls.sync.Tracking
import kotlinx.coroutines.delay

/**
 * The after-call pop-up (client, 12 November 2026). The tracking service opens it when a call ends, if the employee
 * allowed "Display over other apps". It stays invisible and lets touches through until the call log shows a
 * company-SIM call that started after `EXTRA_SINCE`; if none appears (a personal-SIM call), it closes unseen.
 */
class AfterCallActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val since = intent.getLongExtra(EXTRA_SINCE, 0L)
        // Touches pass through while we look for the call, so an invisible window never blocks the phone.
        window.addFlags(WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE)
        setContent {
            MaterialTheme {
                AfterCallPopup(
                    since = since,
                    onFound = { window.clearFlags(WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE) },
                    onClose = { finish() },
                )
            }
        }
    }

    companion object {
        const val EXTRA_SINCE = "since"

        fun start(context: Context, sinceMs: Long) {
            context.startActivity(
                Intent(context, AfterCallActivity::class.java)
                    .putExtra(EXTRA_SINCE, sinceMs)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION),
            )
        }
    }
}

@Composable
private fun AfterCallPopup(since: Long, onFound: () -> Unit, onClose: () -> Unit) {
    val context = LocalContext.current
    val db = remember { LocalDb(context) }
    var item by remember { mutableStateOf<LocalCall?>(null) }

    LaunchedEffect(since) {
        // The call log row is written a moment after the call ends.
        repeat(10) {
            Tracking.collectNow(context)
            val found = db.latestCallSince(since)
            if (found != null) {
                db.markPrompted(found.call.deviceCallId, System.currentTimeMillis())
                item = found
                onFound()
                return@LaunchedEffect
            }
            delay(700)
        }
        onClose()
    }

    val current = item ?: return
    Box(
        Modifier.fillMaxSize().background(Color(0x99000000)).windowInsetsPadding(WindowInsets.safeDrawing),
        contentAlignment = Alignment.Center,
    ) {
        Card(Modifier.fillMaxWidth().padding(16.dp)) {
            Column(Modifier.padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("Last call details", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                    TextButton(onClick = onClose) { Text("✕") }
                }
                CommentForm(current, onDone = onClose)
            }
        }
    }
}
