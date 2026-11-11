package com.reaplift.calls.ui

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.reaplift.calls.BuildConfig
import com.reaplift.calls.data.LocalCall
import com.reaplift.calls.data.LocalDb
import com.reaplift.calls.data.Prefs
import com.reaplift.calls.data.TrackingState
import com.reaplift.calls.net.ApiClient
import com.reaplift.calls.net.ApiException
import com.reaplift.calls.net.PairRequest
import com.reaplift.calls.sync.Notifications
import com.reaplift.calls.sync.Outcome
import com.reaplift.calls.sync.SimInfo
import com.reaplift.calls.sync.Sims
import com.reaplift.calls.sync.SyncWorker
import com.reaplift.calls.sync.Tracking
import com.reaplift.calls.sync.TrackingService
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

enum class Step(val number: Int) { CONSENT(1), PERMISSIONS(2), KEEP_RUNNING(3), SIM(4), PAIR(5), TEST_CALL(6), HOME(7) }

/** The setup wizard resumes at the first step not done (M1 task 1.4); after it, the home screen. */
fun currentStep(context: Context, prefs: Prefs): Step = when {
    prefs.consentAt == 0L -> Step.CONSENT
    !Tracking.hasPermissions(context) -> Step.PERMISSIONS
    !prefs.batteryStepDone -> Step.KEEP_RUNNING
    prefs.companySubId < 0 || prefs.state == TrackingState.SIM_MISSING -> Step.SIM
    !prefs.isPaired -> Step.PAIR
    !prefs.testCallDone -> Step.TEST_CALL
    else -> Step.HOME
}

@Composable
fun App(pairLink: PairLink?, commentCall: String? = null, onCommentClosed: () -> Unit = {}) {
    val context = LocalContext.current
    val prefs = remember { Prefs(context) }
    // Bumped after every step, so currentStep is read again.
    var version by remember { mutableIntStateOf(0) }
    val next: () -> Unit = { version++ }
    val step = remember(version) { currentStep(context, prefs) }
    // A call picked from the home screen's list, or from the "How did the call go?" notification.
    var commenting by remember(commentCall) { mutableStateOf(commentCall) }

    Column(
        // Android 15 draws apps under the status and navigation bars; keep text clear of them.
        modifier = Modifier.windowInsetsPadding(WindowInsets.safeDrawing).padding(20.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        if (step != Step.HOME) {
            Text("Set up ReapLift Calls · step ${step.number} of 6", style = MaterialTheme.typography.labelLarge)
            LinearProgressIndicator(progress = { step.number / 6f }, modifier = Modifier.fillMaxWidth())
        }
        when (step) {
            Step.CONSENT -> ConsentStep(onAgree = { prefs.consentAt = System.currentTimeMillis(); next() })
            Step.PERMISSIONS -> PermissionsStep(next)
            Step.KEEP_RUNNING -> KeepRunningStep(onDone = { prefs.batteryStepDone = true; next() })
            Step.SIM -> SimStep(prefs, next)
            Step.PAIR -> PairStep(prefs, pairLink, next)
            Step.TEST_CALL -> TestCallStep(prefs, next)
            Step.HOME -> {
                val id = commenting
                if (id != null) {
                    CommentScreen(id, onDone = { commenting = null; onCommentClosed(); next() })
                } else {
                    HomeScreen(prefs, onChanged = next, onComment = { commenting = it })
                }
            }
        }
    }
}

@Composable
private fun Title(text: String) = Text(text, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)

@Composable
private fun Bullets(items: List<String>) = Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
    items.forEach { Text("•  $it") }
}

@Composable
private fun ConsentStep(onAgree: () -> Unit) {
    Title("Before you start")
    Text("ReapLift Calls keeps a record of your work calls so your managers can see call history and reports.")
    Text("What is collected", fontWeight = FontWeight.SemiBold)
    Bullets(CONSENT_COLLECTED)
    Text("What is never collected", fontWeight = FontWeight.SemiBold)
    Bullets(CONSENT_NEVER)
    Text(CONSENT_WHO)
    Button(onClick = onAgree, modifier = Modifier.fillMaxWidth()) { Text("I agree") }
    Text(
        "If you do not agree, close the app and tell your admin. Nothing is collected until you tap I agree.",
        style = MaterialTheme.typography.bodySmall,
    )
}

@Composable
private fun PermissionsStep(onDone: () -> Unit) {
    val context = LocalContext.current
    var denied by remember { mutableStateOf(false) }
    val permissions = buildList {
        addAll(Tracking.REQUIRED_PERMISSIONS)
        add(Manifest.permission.READ_PHONE_NUMBERS)
        if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
    }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        if (Tracking.hasPermissions(context)) onDone() else denied = true
    }
    Title("Allow access")
    Bullets(
        listOf(
            "Call logs: to read your company-SIM calls.",
            "Phone: to tell your company SIM from your personal SIM, and to measure ringing time.",
            "Notifications: to show that tracking is on, and to tell you if something stops it.",
        ),
    )
    Button(onClick = { launcher.launch(permissions.toTypedArray()) }, modifier = Modifier.fillMaxWidth()) { Text("Allow") }
    if (denied) {
        Text("Call logs and Phone are needed. Open settings, then Permissions, and allow both.", color = MaterialTheme.colorScheme.error)
        OutlinedButton(onClick = {
            context.startActivity(
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        }, modifier = Modifier.fillMaxWidth()) { Text("Open settings") }
        TextButton(onClick = { if (Tracking.hasPermissions(context)) onDone() }) { Text("I have allowed them") }
    }
}

@SuppressLint("BatteryLife")
@Composable
private fun KeepRunningStep(onDone: () -> Unit) {
    val context = LocalContext.current
    val guide = remember { guideForThisPhone() }
    Title("Keep it running")
    Text("Phones close apps in the background to save battery. These settings stop ${guide.brand} from closing ReapLift Calls, so no call is missed.")
    Button(onClick = {
        val power = context.getSystemService(PowerManager::class.java)
        if (!power.isIgnoringBatteryOptimizations(context.packageName)) {
            context.startActivity(
                Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}")),
            )
        }
    }, modifier = Modifier.fillMaxWidth()) { Text("1. Allow running in the background") }
    Text("2. Then on ${guide.brand}:", fontWeight = FontWeight.SemiBold)
    Bullets(guide.steps)
    OutlinedButton(onClick = { openAutostartSettings(context, guide) }, modifier = Modifier.fillMaxWidth()) {
        Text("Open the settings")
    }
    Button(onClick = onDone, modifier = Modifier.fillMaxWidth()) { Text("Done, next") }
}

@Composable
private fun SimStep(prefs: Prefs, onDone: () -> Unit) {
    val context = LocalContext.current
    val sims = remember { Sims(context).active() }
    var chosen by remember { mutableStateOf(sims.firstOrNull { it.subId == prefs.companySubId }?.subId) }
    val company = prefs.companyNumber
    // Preselect the SIM whose number Android reports as the company number.
    LaunchedEffect(sims) {
        if (chosen == null && company != null) chosen = sims.firstOrNull { it.number != null && company.endsWith(it.number.takeLast(10)) }?.subId
    }
    Title(if (prefs.state == TrackingState.SIM_MISSING) "Pick your company SIM again" else "Which is your company SIM?")
    if (prefs.state == TrackingState.SIM_MISSING) Text("Your SIMs changed, so tracking is paused until you choose. Nothing was read meanwhile.")
    if (company != null) Text("Your company number: ${formatNumber(company)}")
    Text("Only calls on this SIM are recorded. Calls on your other SIM never leave your phone.")
    if (sims.isEmpty()) Text("No SIM found. Insert your company SIM and open this screen again.", color = MaterialTheme.colorScheme.error)
    sims.forEach { sim -> SimRow(sim, chosen == sim.subId) { chosen = sim.subId } }
    Button(
        enabled = chosen != null,
        onClick = {
            val sim = sims.first { it.subId == chosen }
            prefs.companySubId = sim.subId
            prefs.companySimSlot = sim.slot
            prefs.companySimCarrier = sim.carrier
            if (prefs.state == TrackingState.SIM_MISSING) {
                prefs.state = TrackingState.ON
                TrackingService.restart(context)
            }
            onDone()
        },
        modifier = Modifier.fillMaxWidth(),
    ) { Text("This is my company SIM") }
}

@Composable
private fun SimRow(sim: SimInfo, selected: Boolean, onSelect: () -> Unit) {
    Card(onClick = onSelect, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            RadioButton(selected = selected, onClick = onSelect)
            Column {
                Text("SIM ${sim.slot + 1} · ${sim.carrier}", fontWeight = FontWeight.SemiBold)
                sim.number?.let { Text(formatNumber(it), style = MaterialTheme.typography.bodySmall) }
            }
        }
    }
}

@Composable
private fun PairStep(prefs: Prefs, link: PairLink?, onDone: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var code by remember(link) { mutableStateOf(link?.code ?: "") }
    var server by remember(link) { mutableStateOf(link?.server ?: prefs.serverUrl ?: BuildConfig.DEFAULT_SERVER_URL) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    Title("Connect to ReapLift")
    Text(if (link != null) "Your code was filled in from the install page." else "Type the 6-digit code from the install page, or ask your admin for one.")
    OutlinedTextField(
        value = code,
        onValueChange = { code = it.filter(Char::isDigit).take(6) },
        label = { Text("Pairing code") },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
        modifier = Modifier.fillMaxWidth(),
    )
    // Release builds have their server built in; debug builds can point at a laptop (README).
    if (BuildConfig.DEBUG || BuildConfig.DEFAULT_SERVER_URL.isBlank()) {
        OutlinedTextField(value = server, onValueChange = { server = it.trim() }, label = { Text("Server") }, modifier = Modifier.fillMaxWidth())
    }
    error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    Button(
        enabled = code.length == 6 && server.isNotBlank() && !busy,
        onClick = {
            busy = true
            error = null
            scope.launch {
                try {
                    val sims = Sims(context)
                    val response = ApiClient(server).pair(
                        PairRequest(
                            code = code,
                            brand = Build.MANUFACTURER,
                            model = Build.MODEL,
                            androidVersion = Build.VERSION.RELEASE,
                            sdkInt = Build.VERSION.SDK_INT,
                            appVersion = BuildConfig.VERSION_NAME,
                            defaultDialer = sims.defaultDialer(),
                            simSlot = prefs.companySimSlot.coerceAtLeast(0),
                            simCarrier = prefs.companySimCarrier,
                            phoneAccountId = prefs.companySubId.toString(),
                            consentVersion = CONSENT_VERSION,
                        ),
                    )
                    LocalDb(context).clear()
                    prefs.serverUrl = server.trimEnd('/')
                    prefs.deviceToken = response.deviceToken
                    prefs.employeeName = response.employee.name
                    prefs.companyName = response.company?.name
                    prefs.companyNumber = response.employee.companyNumber
                    prefs.initialSyncDays = response.settings.initialSyncDays
                    prefs.lastCallLogId = 0
                    prefs.state = TrackingState.ON
                    prefs.pairedAt = System.currentTimeMillis()
                    SyncWorker.schedulePeriodic(context)
                    TrackingService.start(context)
                    onDone()
                } catch (e: ApiException) {
                    error = e.message
                } catch (e: Exception) {
                    error = "Could not reach the server. Check the internet connection and try again."
                } finally {
                    busy = false
                }
            }
        },
        modifier = Modifier.fillMaxWidth(),
    ) { Text(if (busy) "Connecting…" else "Connect") }
}

@Composable
private fun TestCallStep(prefs: Prefs, onDone: () -> Unit) {
    val context = LocalContext.current
    var synced by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        while (!synced) {
            Tracking.syncNow(context)
            synced = LocalDb(context).anySentSince(prefs.pairedAt - 60_000)
            if (!synced) delay(5_000)
        }
    }
    Title("Paired as ${prefs.employeeName}")
    Text("Last step: make a short call on SIM ${prefs.companySimSlot + 1} (${prefs.companySimCarrier}), your company SIM. Any number, a few seconds is enough.")
    if (synced) {
        Text("Test call synced ✓", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold)
        Button(onClick = { prefs.testCallDone = true; onDone() }, modifier = Modifier.fillMaxWidth()) { Text("Finish") }
    } else {
        Text("Waiting for the call…")
        LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
        TextButton(onClick = { prefs.testCallDone = true; onDone() }) { Text("Skip for now") }
    }
}

@Composable
private fun HomeScreen(prefs: Prefs, onChanged: () -> Unit, onComment: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var refresh by remember { mutableIntStateOf(0) }
    val db = remember { LocalDb(context) }
    val todayStart = remember(refresh) { startOfToday() }
    val synced = remember(refresh) { db.sentSinceWithComments(todayStart) }
    val pending = remember(refresh) { db.pendingCount() }
    val needComment = remember(refresh) { db.needsComment(todayStart - 6 * 86_400_000L) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(30_000)
            refresh++
        }
    }

    if (prefs.state == TrackingState.REVOKED) {
        Title("This phone was unpaired")
        Text("Your admin unpaired this phone, so calls are no longer synced. To use it again, ask for a new code.")
        Button(onClick = { prefs.clearPairing(); db.clear(); onChanged() }, modifier = Modifier.fillMaxWidth()) { Text("Pair again") }
        return
    }

    Title("ReapLift Calls")
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            val on = prefs.state == TrackingState.ON
            Text(if (on) "Tracking is on" else "Tracking is paused", fontWeight = FontWeight.SemiBold, color = if (on) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error)
            Text("${prefs.employeeName} · company SIM ${prefs.companySimSlot + 1} (${prefs.companySimCarrier})")
            prefs.companyName?.let { Text("Company: $it") }
            Text("Last sync: ${if (prefs.lastSyncAt > 0) formatTime(prefs.lastSyncAt) else "not yet"}")
            if (pending > 0) Text("$pending call(s) waiting to be sent")
            if (!prefs.testCallDone) Text("Test call not done yet", color = MaterialTheme.colorScheme.error)
        }
    }
    if (prefs.state == TrackingState.PERMISSION_MISSING) {
        Text("Call log or phone permission is off.", color = MaterialTheme.colorScheme.error)
    }
    OutlinedButton(onClick = {
        scope.launch {
            Tracking.syncNow(context)
            refresh++
            onChanged()
        }
    }, modifier = Modifier.fillMaxWidth()) { Text("Sync now") }

    if (needComment.isNotEmpty()) {
        Spacer(Modifier.height(4.dp))
        Text("Needs a comment (${needComment.size})", fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.error)
        Text("Your manager sees which calls have no outcome.", style = MaterialTheme.typography.bodySmall)
        needComment.forEach { item ->
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("${formatDay(item.call.startedAtMs)} ${formatTime(item.call.startedAtMs)} · ${item.call.type}")
                    Text(item.call.contactName ?: formatNumber(item.call.number), style = MaterialTheme.typography.bodySmall)
                }
                TextButton(onClick = { onComment(item.call.deviceCallId) }) { Text("Add") }
            }
            HorizontalDivider()
        }
    }

    Spacer(Modifier.height(4.dp))
    Text("Sent today (what your managers see)", fontWeight = FontWeight.SemiBold)
    if (synced.isEmpty()) Text("No company-SIM calls sent today.", style = MaterialTheme.typography.bodySmall)
    synced.forEach { item ->
        val call = item.call
        Column {
            Text("${formatTime(call.startedAtMs)} · ${call.type} · ${call.contactName ?: formatNumber(call.number)}")
            Text("Talk ${call.talkSeconds}s" + (call.ringSeconds?.let { " · rang ${it}s" } ?: ""), style = MaterialTheme.typography.bodySmall)
            item.outcomeLabel?.let { Text("Outcome: $it", style = MaterialTheme.typography.bodySmall) }
            item.note?.let { Text("“$it”", style = MaterialTheme.typography.bodySmall) }
        }
        HorizontalDivider()
    }
    Text("Version ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodySmall)
}

/** The after-call form (M4): outcome, comment and follow-up for one company-SIM call. Saved on the phone, sent on the next sync. */
@Composable
private fun CommentScreen(deviceCallId: String, onDone: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val db = remember { LocalDb(context) }
    val item: LocalCall? = remember(deviceCallId) { db.find(deviceCallId) }
    var outcomes by remember { mutableStateOf(db.outcomes()) }
    var outcomeId by remember { mutableStateOf(item?.outcomeId) }
    var note by remember { mutableStateOf(item?.note.orEmpty()) }
    val followUps = remember { followUpChoices() }
    var followUp by remember { mutableStateOf(item?.followUpAtMs) }

    if (item == null) {
        Title("Call not found")
        Text("This call is no longer on the phone.")
        Button(onClick = onDone, modifier = Modifier.fillMaxWidth()) { Text("Back") }
        return
    }
    // A phone that has never synced since this update has no outcomes yet: fetch them once.
    LaunchedEffect(Unit) {
        if (outcomes.isEmpty()) {
            Tracking.syncNow(context)
            outcomes = db.outcomes()
        }
    }

    val call = item.call
    Title("How did the call go?")
    Text("${formatDay(call.startedAtMs)} ${formatTime(call.startedAtMs)} · ${call.type} · ${call.contactName ?: formatNumber(call.number)}")
    Text("Talk ${call.talkSeconds}s", style = MaterialTheme.typography.bodySmall)

    Text("Outcome", fontWeight = FontWeight.SemiBold)
    if (outcomes.isEmpty()) Text("Loading the choices… you can still write a comment.", style = MaterialTheme.typography.bodySmall)
    // The whole row is the tap target: people tap the words, not the small circle.
    outcomes.forEach { o ->
        val selected = outcomeId == o.id
        Row(
            Modifier.fillMaxWidth().selectable(selected = selected, role = Role.RadioButton, onClick = { outcomeId = if (selected) null else o.id }),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            RadioButton(selected = selected, onClick = null)
            Text(o.label)
        }
    }

    OutlinedTextField(
        value = note,
        onValueChange = { if (it.length <= 1000) note = it },
        label = { Text("Comment (optional)") },
        modifier = Modifier.fillMaxWidth(),
        minLines = 3,
    )

    Text("Follow up", fontWeight = FontWeight.SemiBold)
    followUps.forEach { (label, at) ->
        Row(
            Modifier.fillMaxWidth().selectable(selected = followUp == at, role = Role.RadioButton, onClick = { followUp = at }),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            RadioButton(selected = followUp == at, onClick = null)
            Text(label)
        }
    }

    val canSave = outcomeId != null || note.isNotBlank()
    Button(
        enabled = canSave,
        onClick = {
            val outcome: Outcome? = outcomes.firstOrNull { it.id == outcomeId }
            db.saveComment(call.deviceCallId, outcome, note.trim().ifBlank { null }, followUp, System.currentTimeMillis())
            Notifications.cancelComment(context, call.deviceCallId)
            scope.launch { Tracking.syncNow(context) }
            onDone()
        },
        modifier = Modifier.fillMaxWidth(),
    ) { Text("Save") }
    TextButton(onClick = onDone, modifier = Modifier.fillMaxWidth()) { Text("Later") }
}

/** "None", tomorrow, in 3 days and next week, each at 10:00 on the phone's clock. */
private fun followUpChoices(): List<Pair<String, Long?>> {
    fun daysAhead(days: Int): Long {
        val cal = java.util.Calendar.getInstance()
        cal.add(java.util.Calendar.DAY_OF_YEAR, days)
        cal.set(java.util.Calendar.HOUR_OF_DAY, 10)
        cal.set(java.util.Calendar.MINUTE, 0)
        cal.set(java.util.Calendar.SECOND, 0)
        cal.set(java.util.Calendar.MILLISECOND, 0)
        return cal.timeInMillis
    }
    val day = SimpleDateFormat("EEE d MMM", Locale.getDefault())
    return listOf(
        "No follow-up" to null,
        "Tomorrow (${day.format(Date(daysAhead(1)))}, 10:00)" to daysAhead(1),
        "In 3 days (${day.format(Date(daysAhead(3)))}, 10:00)" to daysAhead(3),
        "Next week (${day.format(Date(daysAhead(7)))}, 10:00)" to daysAhead(7),
    )
}

private fun formatDay(ms: Long) = SimpleDateFormat("d MMM", Locale.getDefault()).format(Date(ms))

private fun startOfToday(): Long {
    val cal = java.util.Calendar.getInstance()
    cal.set(java.util.Calendar.HOUR_OF_DAY, 0)
    cal.set(java.util.Calendar.MINUTE, 0)
    cal.set(java.util.Calendar.SECOND, 0)
    cal.set(java.util.Calendar.MILLISECOND, 0)
    return cal.timeInMillis
}

private fun formatTime(ms: Long) = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(ms))

/** 919812345678 or 9812345678 gives "+91 98123 45678". */
fun formatNumber(n: String): String {
    val digits = n.filter(Char::isDigit)
    val ten = if (digits.length == 12 && digits.startsWith("91")) digits.drop(2) else digits
    return if (ten.length == 10) "+91 ${ten.take(5)} ${ten.drop(5)}" else n.ifBlank { "Private number" }
}
