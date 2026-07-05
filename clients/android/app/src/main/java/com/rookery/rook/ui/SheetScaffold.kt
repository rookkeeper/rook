// Shared modal-sheet chrome for the location/settings screens — the Compose analog of the
// iOS `.sheet` + NavigationStack(title + Done) each of these screens wraps itself in.
package com.rookery.rook.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.rookery.rook.ui.chat.PanelPalette

@Composable
fun SheetScaffold(
    title: String,
    onClose: () -> Unit,
    closeLabel: String = "Done",
    content: @Composable ColumnScope.() -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth(0.94f)
            .fillMaxHeight(0.9f)
            .clip(RoundedCornerShape(16.dp))
            .background(PanelPalette.backgroundPrimary)
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 4.dp)
        ) {
            Text(title, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = PanelPalette.textNormal)
            Spacer(Modifier.weight(1f))
            TextButton(onClick = onClose) {
                Text(closeLabel, color = PanelPalette.accent, fontWeight = FontWeight.SemiBold)
            }
        }
        Column(
            verticalArrangement = Arrangement.spacedBy(14.dp),
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            content = content
        )
    }
}
