// Mirrors clients/iphone/Sources/Views/PlacesScreen.swift — enable/add place, frequented-place
// suggestions (promote/dismiss), and the saved-places list with per-place skill badges.
package com.rookery.rook.ui

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.rookery.rook.RookViewModel
import com.rookery.rook.location.LocationAuthStatus
import com.rookery.rook.model.Place
import com.rookery.rook.model.PlaceSuggestion
import com.rookery.rook.ui.chat.PanelButton
import com.rookery.rook.ui.chat.PanelCard
import com.rookery.rook.ui.chat.PanelPalette
import kotlinx.coroutines.flow.MutableStateFlow
import java.util.Locale

@Composable
fun PlacesScreen(viewModel: RookViewModel) {
    val authStatus by remember {
        viewModel.locationAuthStatus ?: MutableStateFlow(LocationAuthStatus.DENIED)
    }.collectAsState()
    val places by viewModel.places.collectAsState()
    val suggestions by viewModel.suggestions.collectAsState()
    val skillStatus by viewModel.placeSkillStatus.collectAsState()
    val currentPlaceName by viewModel.currentPlaceName.collectAsState()
    val currentLocation by remember { viewModel.currentLocation ?: MutableStateFlow(null) }.collectAsState()

    var newName by remember { mutableStateOf("") }
    var radius by remember { mutableStateOf(150f) }

    val fineLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { grants ->
        viewModel.refreshAuthorizationStatus()
        if (grants[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
            grants[Manifest.permission.ACCESS_COARSE_LOCATION] == true
        ) {
            viewModel.enableLocation()
            viewModel.requestCurrentLocation()
        }
    }

    LaunchedEffect(Unit) {
        if (authStatus != LocationAuthStatus.DENIED) viewModel.requestCurrentLocation()
        viewModel.refreshPlaceSkillStatus()
    }

    SheetScaffold(title = "Places", onClose = { viewModel.setShowPlaces(false) }) {
        if (authStatus == LocationAuthStatus.DENIED) {
            PanelCard {
                Text("Location", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = PanelPalette.textNormal)
                Text(
                    "Rook uses your location to load a place's skills when you arrive — including in the background.",
                    fontSize = 11.sp,
                    color = PanelPalette.textMuted
                )
                PanelButton("Enable location", {
                    val base = listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
                    val perms = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        (base + Manifest.permission.POST_NOTIFICATIONS).toTypedArray()
                    } else base.toTypedArray()
                    fineLauncher.launch(perms)
                }, Modifier.fillMaxWidth())
            }
        } else {
            PanelCard {
                Text("Save a place", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = PanelPalette.textNormal)
                OutlinedTextField(
                    value = newName,
                    onValueChange = { newName = it },
                    label = { Text("Name (e.g. Office)") },
                    singleLine = true,
                    colors = androidx.compose.material3.OutlinedTextFieldDefaults.colors(
                        focusedTextColor = PanelPalette.textNormal,
                        unfocusedTextColor = PanelPalette.textNormal,
                        focusedBorderColor = PanelPalette.accent,
                        unfocusedBorderColor = PanelPalette.border,
                        focusedLabelColor = PanelPalette.textMuted,
                        unfocusedLabelColor = PanelPalette.textMuted,
                        cursorColor = PanelPalette.accent
                    ),
                    modifier = Modifier.fillMaxWidth()
                )
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Radius", fontSize = 12.sp, color = PanelPalette.textMuted)
                    Slider(
                        value = radius,
                        onValueChange = { radius = it },
                        valueRange = 50f..500f,
                        steps = 44,
                        modifier = Modifier.weight(1f)
                    )
                    Text("${radius.toInt()} m", fontSize = 12.sp, fontFamily = FontFamily.Monospace, color = PanelPalette.textMuted)
                }
                val location = currentLocation
                if (location != null) {
                    Text(
                        String.format(Locale.US, "Here: %.4f, %.4f", location.latitude, location.longitude),
                        fontSize = 11.sp,
                        fontFamily = FontFamily.Monospace,
                        color = PanelPalette.textMuted
                    )
                } else {
                    Text("Getting your location…", fontSize = 11.sp, color = PanelPalette.textMuted)
                }
                PanelButton(
                    text = "Save current location as “${newName.ifBlank { "place" }}”",
                    onClick = {
                        val here = currentLocation
                        if (here == null) {
                            viewModel.requestCurrentLocation()
                        } else {
                            viewModel.addPlace(newName, here.latitude, here.longitude, radius.toDouble())
                            newName = ""
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = currentLocation != null
                )
            }
        }

        if (suggestions.isNotEmpty()) {
            PanelCard {
                Text("PLACES YOU FREQUENT", fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = PanelPalette.textMuted)
                suggestions.forEach { SuggestionRow(it, radius.toDouble(), viewModel) }
            }
        }

        if (places.isNotEmpty()) {
            PanelCard {
                Text("YOUR PLACES", fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = PanelPalette.textMuted)
                places.forEach { place ->
                    PlaceRow(place, currentPlaceName == place.name, skillStatus[place.id], viewModel)
                }
            }
        }

        Text(
            "Define a place here, and create a matching skill bundle on the server at " +
                "environment-repository/location/<slug>/. When you arrive, Rook offers that place's skills.",
            fontSize = 11.sp,
            color = PanelPalette.textMuted
        )
    }
}

@Composable
private fun PlaceRow(place: Place, isCurrent: Boolean, hasSkills: Boolean?, viewModel: RookViewModel) {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        Text("📍", fontSize = 14.sp)
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                place.name,
                fontSize = 15.sp,
                fontWeight = FontWeight.Medium,
                color = if (isCurrent) PanelPalette.success else PanelPalette.textNormal
            )
            Text(
                "location:${place.id} · ${place.radius.toInt()} m",
                fontSize = 11.sp,
                fontFamily = FontFamily.Monospace,
                color = PanelPalette.textMuted
            )
            when (hasSkills) {
                true -> Text("✓ skills available", fontSize = 11.sp, color = PanelPalette.success)
                false -> Text("! no server bundle", fontSize = 11.sp, color = PanelPalette.warning)
                null -> {}
            }
        }
        PanelButton("Remove", { viewModel.removePlace(place) }, Modifier, PanelPalette.danger, filled = false)
    }
}

@Composable
private fun SuggestionRow(suggestion: PlaceSuggestion, radius: Double, viewModel: RookViewModel) {
    var name by remember { mutableStateOf("") }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(vertical = 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("📍", fontSize = 14.sp)
            Text(
                "You've been here ${suggestion.visitCount}×",
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
                color = PanelPalette.textNormal,
                modifier = Modifier.weight(1f)
            )
            PanelButton("Dismiss", { viewModel.dismissSuggestion(suggestion) }, Modifier, PanelPalette.textMuted, filled = false)
        }
        Text(
            String.format(Locale.US, "%.4f, %.4f", suggestion.latitude, suggestion.longitude),
            fontSize = 11.sp,
            fontFamily = FontFamily.Monospace,
            color = PanelPalette.textMuted
        )
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text("Name this place") },
                singleLine = true,
                colors = androidx.compose.material3.OutlinedTextFieldDefaults.colors(
                    focusedTextColor = PanelPalette.textNormal,
                    unfocusedTextColor = PanelPalette.textNormal,
                    focusedBorderColor = PanelPalette.accent,
                    unfocusedBorderColor = PanelPalette.border,
                    cursorColor = PanelPalette.accent
                ),
                modifier = Modifier.weight(1f)
            )
            PanelButton(
                text = "Add",
                onClick = { viewModel.promoteSuggestion(suggestion, name, radius) },
                modifier = Modifier,
                enabled = name.isNotBlank()
            )
        }
    }
}
