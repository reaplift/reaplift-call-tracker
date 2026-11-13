package com.reaplift.calls.sync

import java.security.MessageDigest

/**
 * M12: numbers whose calls are never recorded or kept, set by the super admin. The phone only knows each number's
 * SHA-256 hash, so the list can't be read off the phone. A matching call is dropped before it reaches the outbox,
 * exactly like a personal-SIM call: no history, no pop-up, no recording search, nothing uploaded.
 */
class NeverRecordList(private val hashes: Set<String>) {
    fun contains(rawNumber: String?): Boolean {
        if (hashes.isEmpty() || rawNumber.isNullOrBlank()) return false
        val number = PhoneNumbers.normalize(rawNumber)
        return number.isNotEmpty() && sha256(number) in hashes
    }

    companion object {
        val EMPTY = NeverRecordList(emptySet())

        fun sha256(text: String): String =
            MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    }
}

/** The server's number rule (apps/server/src/lib/phone.ts), so the phone's hash matches the server's. */
object PhoneNumbers {
    private val mobile = Regex("^[6-9]\\d{9}$")

    /** Digits with country code, no plus: "+91 98111 00000" and "09811100000" both give "919811100000". */
    fun normalize(raw: String): String {
        val digits = raw.filter(Char::isDigit)
        if (digits.length < 3 || Regex("^-\\d$").matches(raw.trim())) return ""
        return when {
            mobile.matches(digits) -> "91$digits"
            digits.length == 11 && digits.startsWith("0") && mobile.matches(digits.drop(1)) -> "91${digits.drop(1)}"
            else -> digits
        }
    }
}
