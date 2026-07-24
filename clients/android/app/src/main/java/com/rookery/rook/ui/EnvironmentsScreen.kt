// Mirrors clients/iphone/Sources/Views/EnvironmentsScreen.swift — the environments known to
// the manager, with Join/Leave per row and loading/error/empty states.
package com.rookery.rook.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.rookery.rook.RookViewModel
import com.rookery.rook.model.EnvironmentListItem
import com.rookery.rook.ui.chat.PanelButton
import com.rookery.rook.ui.chat.PanelCard
import com.rookery.rook.ui.chat.PanelPalette
import com.rookery.rook.ui.chat.StatusDot

private fun shouldShowSourceName(item: EnvironmentListItem): Boolean {
    val sourceName = item.sourceName ?: return false
    if (sourceName == item.displayName || sourceName == item.environmentId) return false
    if (item.environmentId.startsWith("web:")) return false
    val lower = sourceName.lowercase()
    return !lower.startsWith("http://") && !lower.startsWith("https://")
}

@Composable
fun EnvironmentsScreen(viewModel: RookViewModel) {
    val loading by viewModel.environmentsLoading.collectAsState()
    val error by viewModel.environmentsError.collectAsState()
    val items by viewModel.environmentListItems.collectAsState()

    SheetScaffold(title = "Environments", onClose = { viewModel.setShowEnvironments(false) }) {
        when {
            loading && items.isEmpty() -> Box(Modifier.fillMaxWidth().padding(24.dp), Alignment.Center) {
                CircularProgressIndicator(color = PanelPalette.accent)
            }
            error.isNotEmpty() -> Text(error, fontSize = 14.sp, color = PanelPalette.danger)
            items.isEmpty() -> Text("No environments in memory.", fontSize = 14.sp, color = PanelPalette.textMuted)
            else -> items.forEach { EnvironmentRow(it, viewModel) }
        }
    }
}

@Composable
private fun EnvironmentRow(item: EnvironmentListItem, viewModel: RookViewModel) {
    PanelCard {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            StatusDot(if (item.entered) PanelPalette.success else PanelPalette.textMuted)
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(
                    text = item.displayName,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = PanelPalette.textNormal
                )
                Text(
                    text = item.environmentId,
                    fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace,
                    color = PanelPalette.textMuted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                if (shouldShowSourceName(item)) {
                    Text(
                        text = item.sourceName.orEmpty(),
                        fontSize = 11.sp,
                        color = PanelPalette.textMuted,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                Text(
                    text = "${if (item.status == "active") "Active" else "Recent"} • ${item.approvedBundleCount}/${item.bundleCount} bundles",
                    fontSize = 11.sp,
                    color = PanelPalette.textMuted
                )
            }
            if (item.entered) {
                PanelButton("Leave", { viewModel.leaveEnvironment(item.environmentId) }, Modifier.padding(0.dp), PanelPalette.danger, filled = false)
            } else {
                PanelButton("Join", { viewModel.joinEnvironment(item.environmentId) }, Modifier.padding(0.dp), PanelPalette.accent, filled = false)
            }
        }
    }
}
