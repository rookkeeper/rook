package com.rookery.rook

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.rookery.rook.net.RookApi
import com.rookery.rook.ui.theme.RookTheme

// Mirrors clients/iphone/Sources/Views/RootView.swift (navigation host, wired up by RookApp.kt)
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // run-rook.sh's android target passes this via `adb shell am start --es server_url <url>`
        // when --server-url is given, mirroring iOS's ROOK_SERVER_BASE_URL launch-env override.
        val serverUrl = intent.getStringExtra(EXTRA_SERVER_URL)
        setContent {
            RookTheme {
                val viewModel: RookViewModel = viewModel(
                    factory = viewModelFactory {
                        initializer {
                            if (serverUrl != null) RookViewModel(api = RookApi(serverUrl)) else RookViewModel()
                        }
                    }
                )
                RookApp(viewModel)
            }
        }
    }

    companion object {
        private const val EXTRA_SERVER_URL = "server_url"
    }
}
