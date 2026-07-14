// Mirrors clients/iphone/Sources/Views/RootView.swift
package com.rookery.rook

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.rookery.rook.ui.AgentPickerScreen
import com.rookery.rook.ui.ChatScreen
import com.rookery.rook.ui.EnvironmentOfferSheet
import com.rookery.rook.ui.EnvironmentsScreen
import com.rookery.rook.ui.PlacesScreen
import com.rookery.rook.ui.SettingsScreen
import com.rookery.rook.ui.chat.PanelPalette

@Composable
fun RookApp(viewModel: RookViewModel, simulateArrival: Pair<Double, Double>? = null) {
    LaunchedEffect(Unit) {
        viewModel.start()
        simulateArrival?.let { (lat, lon) -> viewModel.simulateArrival(lat, lon) }
    }

    val currentSession by viewModel.currentSession.collectAsState()
    val chatVisible by viewModel.chatVisible.collectAsState()
    val showSettings by viewModel.showSettings.collectAsState()
    val showPlaces by viewModel.showPlaces.collectAsState()
    val showEnvironments by viewModel.showEnvironments.collectAsState()
    val pendingOffer by viewModel.pendingOffer.collectAsState()

    // ponytail: targetSdk 35 forces edge-to-edge (no opt-out) — safeDrawingPadding keeps
    // content clear of the status bar / nav bar / cutouts, the SwiftUI safe-area equivalent.
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(PanelPalette.backgroundPrimary)
            .safeDrawingPadding()
    ) {
        when {
            currentSession != null && chatVisible -> ChatScreen(viewModel)
            else -> AgentPickerScreen(viewModel)
        }
    }

    // Sheets (Compose Dialogs) — mirror iOS's .sheet presentations.
    val wideDialog = DialogProperties(usePlatformDefaultWidth = false)
    if (showSettings) {
        Dialog(onDismissRequest = { viewModel.setShowSettings(false) }, properties = wideDialog) {
            SettingsScreen(viewModel)
        }
    }
    if (showPlaces) {
        Dialog(onDismissRequest = { viewModel.setShowPlaces(false) }, properties = wideDialog) {
            PlacesScreen(viewModel)
        }
    }
    if (showEnvironments) {
        Dialog(onDismissRequest = { viewModel.setShowEnvironments(false) }, properties = wideDialog) {
            EnvironmentsScreen(viewModel)
        }
    }
    if (pendingOffer != null) {
        // Swipe/back dismiss → "ignore" (matches iOS's cancellation action).
        Dialog(onDismissRequest = { viewModel.decideEnvironment("ignore") }, properties = wideDialog) {
            EnvironmentOfferSheet(viewModel)
        }
    }
}
