package com.reaplift.calls.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/**
 * The app in the CRM's colours (M11, client 12 November 2026): ReapLift purple for buttons and selected chips, its
 * light pink for selected backgrounds, and its orange as the second colour. Android's own controls stay as they are.
 */
private val CrmColors = lightColorScheme(
    primary = Color(0xFF92419A),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFFEF3FF),
    onPrimaryContainer = Color(0xFF5A1F61),
    secondary = Color(0xFFFF7D09),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFFFF1E3),
    onSecondaryContainer = Color(0xFF6B3300),
    tertiary = Color(0xFF012970),
    surfaceVariant = Color(0xFFF7EEF6),
    outline = Color(0xFFB79AB5),
)

@Composable
fun CallitTheme(content: @Composable () -> Unit) = MaterialTheme(colorScheme = CrmColors, content = content)
