package com.reaplift.calls.whatsapp

/**
 * WhatsApp template blanks (M10), the same rules as the server and panel (packages/shared/src/templates.ts):
 * "Hi {{name}}, this is {{employee_name}}". The app fills the blanks it knows; the employee fills the rest and
 * can't change the wording.
 */
object Templates {
    val AUTO = listOf("name", "employee_name", "company_name", "follow_up_date")
    private val BLANK = Regex("""\{\{\s*([^{}]*?)\s*\}\}""")
    private val LABELS = mapOf(
        "name" to "Client's name",
        "employee_name" to "Your name",
        "company_name" to "Company name",
        "follow_up_date" to "Follow-up date",
    )

    /** Each blank once, in order of first appearance. */
    fun blanks(body: String): List<String> = BLANK.findAll(body).map { it.groupValues[1] }.distinct().toList()

    /** "site_name" → "Site name". */
    fun label(name: String): String = LABELS[name] ?: name.replace('_', ' ').replaceFirstChar { it.uppercase() }

    /** Every blank replaced; a blank with no value stays visible. */
    fun fill(body: String, values: Map<String, String>): String =
        BLANK.replace(body) { m -> values[m.groupValues[1]]?.trim()?.takeIf { it.isNotEmpty() } ?: m.value }

    /** Blanks still empty after filling. Sending is blocked until there are none. */
    fun missing(body: String, values: Map<String, String>): List<String> =
        blanks(body).filter { values[it].isNullOrBlank() }
}

/** A template from the company, as the phone keeps it. */
data class MessageTemplate(val id: String, val title: String, val body: String)

/** A WhatsApp send waiting in the outbox. */
data class PendingSend(
    val deviceSendId: String,
    val templateId: String?,
    val number: String,
    val deviceCallId: String?,
    val body: String,
    val app: String,
    val openedAtMs: Long,
)
