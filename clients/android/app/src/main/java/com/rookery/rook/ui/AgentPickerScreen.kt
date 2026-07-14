package com.rookery.rook.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.weight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.HourglassEmpty
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.WarningAmber
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.rookery.rook.RookViewModel
import com.rookery.rook.ServerState
import com.rookery.rook.buildAgentTree
import com.rookery.rook.model.AgentDefinition
import com.rookery.rook.model.AgentSessionSummary
import com.rookery.rook.ui.chat.PanelPalette

@Composable
fun AgentPickerScreen(viewModel: RookViewModel) {
    val serverState by viewModel.serverState.collectAsState()
    val agents by viewModel.agents.collectAsState()
    val agentsError by viewModel.agentsError.collectAsState()
    val sessions by viewModel.sessions.collectAsState()
    val sessionsLoading by viewModel.sessionsLoading.collectAsState()
    val sessionsError by viewModel.sessionsError.collectAsState()
    val currentSession by viewModel.currentSession.collectAsState()
    val chatVisible by viewModel.chatVisible.collectAsState()
    val isRunning by viewModel.isRunning.collectAsState()
    val startingSession by viewModel.startingSession.collectAsState()
    val agentTree = remember(agents) { buildAgentTree(agents) }
    var newSessionName by remember { mutableStateOf("") }
    var selectedRuntimeId by remember(agents) { mutableStateOf(agents.firstOrNull()?.id ?: "") }

    Column(modifier = Modifier.fillMaxSize().background(PanelPalette.backgroundPrimary)) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(start = 16.dp, top = 8.dp, bottom = 4.dp, end = 8.dp)) {
            Text("Rook", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = PanelPalette.textNormal)
            Spacer(Modifier.weight(1f))
            IconButton(onClick = { viewModel.setShowPlaces(true) }) { Icon(Icons.Filled.Place, contentDescription = "Places", tint = PanelPalette.textMuted) }
            IconButton(onClick = { viewModel.setShowSettings(true) }) { Icon(Icons.Filled.Settings, contentDescription = "Settings", tint = PanelPalette.textMuted) }
        }

        LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (serverState == ServerState.OFFLINE || serverState == ServerState.UNAUTHORIZED) {
                item {
                    MessageBanner(
                        tint = PanelPalette.danger,
                        text = if (serverState == ServerState.UNAUTHORIZED) "Server requires authorization at ${viewModel.baseUrlString}." else "Server unreachable at ${viewModel.baseUrlString}. Run `npm run dev` on the host."
                    )
                }
            }

            if (currentSession != null && !chatVisible) {
                item { ResumeRow(session = currentSession!!, isRunning = isRunning, onClick = viewModel::openChat) }
            }

            item {
                PanelCardColumn {
                    Text("New chat", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = PanelPalette.textNormal)
                    if (agentTree.isEmpty()) {
                        Text(if (serverState == ServerState.ONLINE) "No configured runtimes" else "Waiting for the server…", fontSize = 14.sp, color = PanelPalette.textMuted)
                    } else {
                        RuntimePicker(agentTree = agentTree, selectedRuntimeId = selectedRuntimeId, onSelect = { selectedRuntimeId = it })
                    }
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                        NewChatNameField(value = newSessionName, onValueChange = { newSessionName = it }, onSubmit = {
                            if (selectedRuntimeId.isNotEmpty()) viewModel.startNewSession(selectedRuntimeId, newSessionName)
                        }, modifier = Modifier.weight(1f))
                        Box(modifier = Modifier.size(42.dp).clip(CircleShape).background(PanelPalette.accent).clickable(enabled = !startingSession && selectedRuntimeId.isNotEmpty()) { viewModel.startNewSession(selectedRuntimeId, newSessionName) }, contentAlignment = Alignment.Center) {
                            Icon(if (startingSession) Icons.Filled.HourglassEmpty else Icons.Filled.ArrowUpward, contentDescription = "Start", tint = Color.White, modifier = Modifier.size(18.dp))
                        }
                    }
                }
            }

            item {
                PanelCardColumn {
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                        Text("Sessions", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = PanelPalette.textNormal, modifier = Modifier.weight(1f))
                        if (sessionsLoading) CircularProgressIndicator(modifier = Modifier.size(14.dp), strokeWidth = 2.dp, color = PanelPalette.textMuted)
                    }
                    if (sessionsError.isNotEmpty()) Text(sessionsError, fontSize = 12.sp, color = PanelPalette.warning)
                    if (agentsError.isNotEmpty()) Text(agentsError, fontSize = 12.sp, color = PanelPalette.warning)
                    if (sessions.isEmpty() && !sessionsLoading) {
                        Text("No sessions yet — start a new chat above.", fontSize = 14.sp, color = PanelPalette.textMuted, modifier = Modifier.fillMaxWidth().padding(vertical = 24.dp))
                    } else {
                        sessions.forEachIndexed { index, session ->
                            SessionRow(session = session, enabled = !startingSession, onClick = { viewModel.resumeSession(session) })
                            if (index < sessions.lastIndex) HorizontalDivider(color = PanelPalette.border)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun RuntimePicker(agentTree: List<Pair<AgentDefinition, Int>>, selectedRuntimeId: String, onSelect: (String) -> Unit) {
    Column(modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(PanelPalette.backgroundPrimary.copy(alpha = 0.8f)).border(1.dp, PanelPalette.border, RoundedCornerShape(10.dp)).padding(vertical = 4.dp)) {
        agentTree.forEachIndexed { index, (agent, depth) ->
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(9.dp),
                modifier = Modifier.fillMaxWidth().clickable { onSelect(agent.id) }.padding(start = 12.dp + (depth * 16).dp, end = 12.dp, top = 10.dp, bottom = 10.dp)
            ) {
                Box(modifier = Modifier.size(24.dp).clip(CircleShape).background(PanelPalette.info.copy(alpha = 0.14f)), contentAlignment = Alignment.Center) {
                    Icon(if (depth > 0) Icons.Filled.Settings else Icons.Filled.AutoAwesome, contentDescription = null, tint = PanelPalette.info, modifier = Modifier.size(13.dp))
                }
                Text(agent.id, fontSize = 15.sp, fontWeight = if (agent.id == selectedRuntimeId) FontWeight.SemiBold else FontWeight.Medium, color = PanelPalette.textNormal, modifier = Modifier.weight(1f))
                if (agent.id == selectedRuntimeId) {
                    Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = PanelPalette.textMuted)
                }
            }
            if (index < agentTree.lastIndex) HorizontalDivider(color = PanelPalette.border, modifier = Modifier.padding(start = 16.dp))
        }
    }
}

@Composable
private fun ResumeRow(session: AgentSessionSummary, isRunning: Boolean, onClick: () -> Unit) {
    val resumeLine = if (session.name == "default") session.agent else "${session.agent} · ${session.name}"
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(11.dp),
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(PanelPalette.accent.copy(alpha = 0.14f)).border(1.dp, PanelPalette.accent.copy(alpha = 0.4f), RoundedCornerShape(14.dp)).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 11.dp)
    ) {
        Box(modifier = Modifier.size(32.dp).clip(CircleShape).background(PanelPalette.accent), contentAlignment = Alignment.Center) {
            Icon(Icons.Filled.PlayArrow, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
        }
        Column(modifier = Modifier.weight(1f)) {
            Text("Resume chat", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = PanelPalette.textNormal)
            Text(text = resumeLine, fontSize = 12.sp, color = PanelPalette.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (isRunning) Box(modifier = Modifier.size(7.dp).clip(CircleShape).background(PanelPalette.warning))
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = PanelPalette.textMuted)
    }
}

@Composable
private fun NewChatNameField(value: String, onValueChange: (String) -> Unit, onSubmit: () -> Unit, modifier: Modifier = Modifier) {
    Box(modifier = modifier.clip(RoundedCornerShape(10.dp)).background(PanelPalette.backgroundPrimary.copy(alpha = 0.8f)).border(1.dp, PanelPalette.border, RoundedCornerShape(10.dp)).padding(horizontal = 12.dp, vertical = 10.dp)) {
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            textStyle = TextStyle(color = PanelPalette.textNormal, fontSize = 15.sp),
            cursorBrush = SolidColor(PanelPalette.accent),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go),
            keyboardActions = KeyboardActions(onGo = { onSubmit() }),
            decorationBox = { inner ->
                if (value.isEmpty()) Text("Name (optional)", color = PanelPalette.textMuted, fontSize = 15.sp)
                inner()
            }
        )
    }
}

@Composable
private fun SessionRow(session: AgentSessionSummary, enabled: Boolean, onClick: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth().clickable(enabled = enabled, onClick = onClick).padding(vertical = 9.dp)) {
        Box(modifier = Modifier.size(30.dp).clip(CircleShape).background(PanelPalette.info.copy(alpha = 0.14f)), contentAlignment = Alignment.Center) {
            Icon(Icons.Filled.AutoAwesome, contentDescription = null, tint = PanelPalette.info, modifier = Modifier.size(14.dp))
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(session.name, fontSize = 15.sp, fontWeight = FontWeight.Medium, color = PanelPalette.textNormal, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(session.agent, fontSize = 12.sp, color = PanelPalette.textMuted, maxLines = 1)
            if (session.updatedAtLabel.isNotEmpty()) Text("Updated ${session.updatedAtLabel}", fontSize = 11.sp, color = PanelPalette.textMuted, maxLines = 1)
        }
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = PanelPalette.textMuted)
    }
}

@Composable
private fun MessageBanner(tint: Color, text: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(tint.copy(alpha = 0.12f)).border(1.dp, tint.copy(alpha = 0.45f), RoundedCornerShape(12.dp)).padding(12.dp)) {
        Icon(Icons.Filled.WarningAmber, contentDescription = null, tint = tint)
        Text(text = text, color = PanelPalette.textNormal, fontSize = 13.sp)
    }
}

@Composable
private fun PanelCardColumn(content: @Composable ColumnScope.() -> Unit) {
    Column(modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(PanelPalette.backgroundSecondary).border(1.dp, PanelPalette.border, RoundedCornerShape(12.dp)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp), content = content)
}
