package com.reaplift.calls.ui

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import com.reaplift.calls.sync.Notifications

class MainActivity : ComponentActivity() {
    private val pairLink = mutableStateOf<PairLink?>(null)
    /** Set when the "How did the call go?" notification was tapped: open the after-call form for that call. */
    private val commentCall = mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        pairLink.value = parsePairLink(intent?.data)
        commentCall.value = intent?.getStringExtra(Notifications.EXTRA_COMMENT_CALL)
        setContent {
            CallitTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    App(pairLink.value, commentCall.value, onCommentClosed = { commentCall.value = null })
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        parsePairLink(intent.data)?.let { pairLink.value = it }
        intent.getStringExtra(Notifications.EXTRA_COMMENT_CALL)?.let { commentCall.value = it }
    }
}
