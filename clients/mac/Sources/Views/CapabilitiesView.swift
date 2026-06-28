import Foundation
import RookKit
import SwiftUI

/// The configuration surface, moved off the home panel: the toggles, permission
/// grants, and helper copy for Voice, Computer Control, and the Context Bridge,
/// plus the current foreground-app environment detail. Reached from the home
/// "Capabilities" strip so the home panel stays focused on chat.
struct CapabilitiesDetail: View {
    @ObservedObject var model: RookMacModel

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            DetailHeader(
                title: "Capabilities",
                systemImage: "slider.horizontal.3",
                trailing: ""
            ) {
                model.goHome()
            }

            voiceCard
            computerControlCard
            contextBridgeCard
            if model.foregroundEnvironmentId != nil {
                foregroundEnvironmentCard
            }
        }
    }

    // MARK: - Voice

    private var voiceCard: some View {
        PanelCard {
            HStack(spacing: 8) {
                Label("Voice", systemImage: "mic.fill")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                Spacer()
                Toggle("", isOn: Binding(
                    get: { model.voiceModeEnabled },
                    set: { model.setVoiceMode($0) }
                ))
                .labelsHidden()
                .toggleStyle(.switch)
                .tint(PanelPalette.accent)
            }

            if model.voiceModeEnabled {
                HStack(spacing: 8) {
                    Button {
                        model.toggleVoiceListening()
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: model.voiceListening ? "waveform.circle.fill" : "mic.circle")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(model.voiceListening ? PanelPalette.danger : PanelPalette.accent)
                                .symbolEffect(.pulse, isActive: model.voiceListening)
                            Text(voiceStatusText)
                                .font(.caption)
                                .foregroundStyle(model.voiceListening ? PanelPalette.textNormal : PanelPalette.textMuted)
                                .lineLimit(2)
                            Spacer(minLength: 0)
                        }
                        .padding(.vertical, 6)
                        .padding(.horizontal, 8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .fill(model.voiceListening ? PanelPalette.danger.opacity(0.14) : PanelPalette.backgroundPrimary.opacity(0.5))
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .strokeBorder(model.voiceListening ? PanelPalette.danger.opacity(0.5) : PanelPalette.border)
                        )
                    }
                    .buttonStyle(.plain)
                    .help("Press to talk (or ⌃⌥Space anywhere)")
                    .pointingHandOnHover()

                    if model.voiceSpeaking {
                        Button {
                            model.stopSpeaking()
                        } label: {
                            Image(systemName: "stop.fill")
                                .font(.system(size: 13, weight: .bold))
                                .foregroundStyle(.white)
                                .frame(width: 34, height: 34)
                                .background(Circle().fill(PanelPalette.danger))
                        }
                        .buttonStyle(.plain)
                        .help("Stop speaking")
                        .pointingHandOnHover()
                    }
                }

                Text(model.voiceAuthorized
                     ? "Press to talk or ⌃⌥Space from any app. Voice: \(model.voiceName). Talking interrupts playback."
                     : "Voice needs Microphone + Speech Recognition permission.")
                    .font(.caption2)
                    .foregroundStyle(PanelPalette.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Text("Talk to your agent hands-free — speak and hear replies aloud.")
                    .font(.caption)
                    .foregroundStyle(PanelPalette.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var voiceStatusText: String {
        if model.voiceListening {
            return model.voicePartial.isEmpty ? "Listening…" : model.voicePartial
        }
        if model.voiceSpeaking {
            return "Speaking…"
        }
        return "Press to talk"
    }

    // MARK: - Computer Control

    private var computerControlCard: some View {
        PanelCard {
            HStack(spacing: 8) {
                Label("Computer Control", systemImage: "cursorarrow.rays")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                Spacer()
                Toggle("", isOn: Binding(
                    get: { model.computerControlEnabled },
                    set: { model.setComputerControlEnabled($0) }
                ))
                .labelsHidden()
                .toggleStyle(.switch)
                .tint(PanelPalette.accent)
            }

            Text(model.computerControlEnabled
                 ? "The agent can move the mouse, click, and type in the frontmost app."
                 : "Off — the agent can read context but cannot drive the mouse/keyboard.")
                .font(.caption)
                .foregroundStyle(model.computerControlEnabled ? PanelPalette.warning : PanelPalette.textMuted)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 8) {
                Image(systemName: model.screenRecordingTrusted ? "checkmark.shield.fill" : "exclamationmark.shield")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(model.screenRecordingTrusted ? PanelPalette.success : PanelPalette.warning)
                Text(model.screenRecordingTrusted
                     ? "Screen Recording granted — screenshots available"
                     : "Screen Recording needed for screenshot (vision) grounding")
                    .font(.caption)
                    .foregroundStyle(PanelPalette.textMuted)
                    .lineLimit(2)
                Spacer(minLength: 4)
                if !model.screenRecordingTrusted {
                    GrantButton(help: "Open System Settings → Privacy → Screen Recording") {
                        model.requestScreenRecording()
                    }
                }
            }
        }
    }

    // MARK: - Context Bridge

    private var contextBridgeCard: some View {
        PanelCard {
            HStack(spacing: 8) {
                Label("Context Bridge", systemImage: "antenna.radiowaves.left.and.right")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                Spacer()
                Text(model.bridgePort > 0 ? ":\(String(model.bridgePort))" : "off")
                    .font(.caption.monospaced())
                    .foregroundStyle(PanelPalette.textMuted)
                StatusDot(tint: model.bridgePort > 0 ? PanelPalette.success : PanelPalette.danger)
            }

            HStack(spacing: 8) {
                Image(systemName: model.accessibilityTrusted ? "checkmark.shield.fill" : "exclamationmark.shield")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(model.accessibilityTrusted ? PanelPalette.success : PanelPalette.warning)
                Text(model.accessibilityTrusted
                     ? "Accessibility granted — window titles visible"
                     : "Grant Accessibility to read window titles")
                    .font(.caption)
                    .foregroundStyle(PanelPalette.textMuted)
                    .lineLimit(2)
                Spacer(minLength: 4)
                if !model.accessibilityTrusted {
                    GrantButton(help: "Open System Settings → Privacy → Accessibility") {
                        model.requestAccessibility()
                    }
                }
            }
        }
    }

    // MARK: - Foreground environment

    private var foregroundEnvironmentCard: some View {
        PanelCard {
            HStack(spacing: 9) {
                Image(systemName: "macwindow.on.rectangle")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(PanelPalette.accentHover)
                    .frame(width: 24, height: 24)
                    .background(Circle().fill(PanelPalette.accent.opacity(0.18)))
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(model.foregroundAppName ?? "App") environment")
                        .font(.subheadline)
                        .fontWeight(.semibold)
                    Text(model.foregroundEnvironmentId ?? "")
                        .font(.caption.monospaced())
                        .foregroundStyle(PanelPalette.textMuted)
                        .lineLimit(1)
                }
                Spacer()
                StatusDot(tint: PanelPalette.success)
            }

            if let title = model.foregroundWindowTitle, !title.isEmpty {
                HStack(spacing: 6) {
                    Image(systemName: "text.window")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(PanelPalette.textMuted)
                    Text(title)
                        .font(.caption)
                        .foregroundStyle(PanelPalette.textNormal)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
        }
    }
}

/// Shared small "Grant" pill for permission requests.
struct GrantButton: View {
    var help: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Text("Grant")
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(.white)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(Capsule().fill(PanelPalette.accent))
        }
        .buttonStyle(.plain)
        .help(help)
        .pointingHandOnHover()
    }
}
