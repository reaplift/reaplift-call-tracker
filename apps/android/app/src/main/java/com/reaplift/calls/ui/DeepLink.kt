package com.reaplift.calls.ui

import android.net.Uri
import com.reaplift.calls.BuildConfig

data class PairLink(val code: String, val server: String?)

/**
 * Reads `reaplift-calls://pair?code=482913&server=...` from the install page's "Open the app" button.
 * A release build only accepts its own server, so a stranger's link cannot send calls elsewhere.
 */
fun parsePairLink(uri: Uri?, allowAnyServer: Boolean = BuildConfig.DEBUG): PairLink? {
    if (uri == null || uri.scheme != "reaplift-calls" || uri.host != "pair") return null
    val code = uri.getQueryParameter("code")?.filter { it.isDigit() }?.takeIf { it.length == 6 } ?: return null
    val server = uri.getQueryParameter("server")?.trimEnd('/')
    return PairLink(code, server?.takeIf { allowAnyServer || it == BuildConfig.DEFAULT_SERVER_URL.trimEnd('/') })
}
