// Mirrors PanelPalette (clients/RookKit/Sources/RookKit/Design/PanelComponents.swift)
//
// ponytail: only PanelPalette is ported here — the rest of the Swift file (PanelBackground,
// PanelCard, StatusGlyph/StatusDot, CompactActionButton, FooterIconButton, PanelMessageView,
// hover/cursor modifiers, inlineMarkdown) is macOS menu-bar chrome or hover-only concerns that
// chat block rendering doesn't need. Add an equivalent if a later screen (AgentPicker/Sessions)
// needs one of these.
package com.rookery.rook.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

object PanelPalette {
    val accent = Color(red = 0.486f, green = 0.227f, blue = 0.929f) // #7c3aed
    val accentHover = Color(red = 0.545f, green = 0.361f, blue = 0.965f) // #8b5cf6
    val backgroundPrimary = Color(red = 0.098f, green = 0.078f, blue = 0.122f) // #19141f
    val backgroundSecondary = Color(red = 0.137f, green = 0.110f, blue = 0.176f) // #231c2d
    val border = Color(red = 0.239f, green = 0.192f, blue = 0.302f) // #3d314d
    val hover = Color(red = 0.184f, green = 0.149f, blue = 0.231f) // #2f263b
    val textNormal = Color(red = 0.929f, green = 0.914f, blue = 0.961f) // #ede9f5
    val textMuted = Color(red = 0.710f, green = 0.663f, blue = 0.788f) // #b5a9c9

    val success = Color(red = 0.624f, green = 0.941f, blue = 0.706f) // #9ff0b4
    val warning = Color(red = 0.973f, green = 0.831f, blue = 0.467f) // #f8d477
    val danger = Color(red = 1.0f, green = 0.612f, blue = 0.639f) // #ff9ca3
    val info = accent
    val secondaryText = textMuted

    // color-mix(in srgb, accent 35%, background-primary) — thinking bubble.
    val thinkingFill = Color(red = 0.234f, green = 0.131f, blue = 0.404f)
}

// Mirrors PanelCard (PanelComponents.swift) — the standard rounded container the location
// screens use for each section.
@Composable
fun PanelCard(modifier: Modifier = Modifier, content: @Composable (androidx.compose.foundation.layout.ColumnScope.() -> Unit)) {
    Column(
        verticalArrangement = Arrangement.spacedBy(9.dp),
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(PanelPalette.backgroundSecondary.copy(alpha = 0.88f))
            .border(1.dp, Color.White.copy(alpha = 0.12f), RoundedCornerShape(12.dp))
            .padding(12.dp),
        content = content
    )
}

// Mirrors StatusDot (PanelComponents.swift) — a small tinted dot used in list rows.
@Composable
fun StatusDot(tint: Color, modifier: Modifier = Modifier) {
    androidx.compose.foundation.layout.Box(
        modifier = modifier
            .size(7.dp)
            .clip(CircleShape)
            .background(tint)
    )
}

// Mirrors CompactActionButton (PanelComponents.swift) — the location screens' action button.
// Material3 Button tinted with PanelPalette; `filled` false gives the subtle variant.
@Composable
fun PanelButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tint: Color = PanelPalette.accent,
    filled: Boolean = true,
    enabled: Boolean = true
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier,
        shape = RoundedCornerShape(8.dp),
        colors = if (filled) {
            ButtonDefaults.buttonColors(containerColor = tint, contentColor = Color.White)
        } else {
            ButtonDefaults.buttonColors(containerColor = tint.copy(alpha = 0.16f), contentColor = tint)
        }
    ) {
        Text(text, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
    }
}
