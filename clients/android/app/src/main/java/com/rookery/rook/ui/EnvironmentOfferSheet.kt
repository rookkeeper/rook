// Mirrors clients/iphone/Sources/Views/EnvironmentOfferSheet.swift — bundle-level approval:
// the offered source, the skills/MCP-servers/apps it contains, and the four decisions.
package com.rookery.rook.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.rookery.rook.RookViewModel
import com.rookery.rook.model.EnvironmentOffer
import com.rookery.rook.ui.chat.PanelButton
import com.rookery.rook.ui.chat.PanelCard
import com.rookery.rook.ui.chat.PanelPalette

@Composable
fun EnvironmentOfferSheet(viewModel: RookViewModel) {
    val offer by viewModel.pendingOffer.collectAsState()
    val current = offer ?: return

    // onDismiss (swipe/back) → "ignore", matching iOS's cancellation action.
    SheetScaffold(title = "New bundle", onClose = { viewModel.decideEnvironment("ignore") }, closeLabel = "Not now") {
        PanelCard {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier.size(30.dp).clip(CircleShape).background(PanelPalette.accent.copy(alpha = 0.18f)),
                    contentAlignment = Alignment.Center
                ) {
                    Text("📦", fontSize = 15.sp)
                }
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        text = current.sourceName ?: current.environmentId,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = PanelPalette.textNormal
                    )
                    Text(
                        text = "wants to load bundle ${current.bundleId} into this session",
                        fontSize = 12.sp,
                        color = PanelPalette.textMuted
                    )
                    Text(
                        text = current.environmentId,
                        fontSize = 11.sp,
                        fontFamily = FontFamily.Monospace,
                        color = PanelPalette.textMuted
                    )
                }
            }
        }

        PanelCard {
            Text(current.bundleId, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = PanelPalette.textNormal)
            CapabilitySection("Skills", current.skills)
            CapabilitySection("MCP Servers", current.mcpServers)
            CapabilitySection("Apps", current.apps)
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            PanelButton("Allow this visit", { viewModel.decideEnvironment("accept") }, Modifier.weight(1f), PanelPalette.success)
            PanelButton("Always allow", { viewModel.decideEnvironment("approve") }, Modifier.weight(1f), PanelPalette.info)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            PanelButton("Not now", { viewModel.decideEnvironment("ignore") }, Modifier.weight(1f), PanelPalette.textMuted, filled = false)
            PanelButton("Never", { viewModel.decideEnvironment("reject") }, Modifier.weight(1f), PanelPalette.danger, filled = false)
        }
    }
}

@Composable
private fun CapabilitySection(title: String, items: List<String>) {
    Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Text(title.uppercase(), fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = PanelPalette.textMuted)
        if (items.isEmpty()) {
            Text("None", fontSize = 12.sp, color = PanelPalette.textMuted)
        } else {
            items.forEach { item ->
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(modifier = Modifier.size(4.dp).clip(CircleShape).background(PanelPalette.textMuted))
                    Text(item, fontSize = 12.sp, fontFamily = FontFamily.Monospace, color = PanelPalette.textNormal)
                }
            }
        }
    }
}
