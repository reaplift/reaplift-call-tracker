package com.reaplift.calls.ui

/** Sent with pairing and stored on the server; raise it whenever the text below changes (M1 task 1.4). */
const val CONSENT_VERSION = "2"

/** Draft for the owner's approval (open question Q4). */
val CONSENT_COLLECTED = listOf(
    "Calls on your company SIM only: the number, the contact name saved on your phone, the date and time, whether it was incoming, outgoing, missed or rejected, how long you talked and how long it rang.",
    "The recordings of those company-SIM calls, made by your phone's own dialer. Only the recording that matches a company-SIM call is opened and sent; other audio files are never opened.",
    "The outcome, comment and follow-up date you add after a call.",
)

val CONSENT_NEVER = listOf(
    "Calls on your personal SIM. They never leave your phone.",
    "Your messages, contacts list, photos, location or other apps.",
)

const val CONSENT_WHO =
    "ReapLift's admins and your managers see your company-SIM calls. You can see everything that was sent in this app."
