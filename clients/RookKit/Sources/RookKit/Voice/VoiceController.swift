import AVFoundation
import Foundation
import Speech

/// Local voice loop: on-device speech-to-text (Apple Speech) for input and
/// AVSpeechSynthesizer for spoken replies. Cross-platform — on iOS it also
/// configures the shared AVAudioSession (macOS has none).
@MainActor
public final class VoiceController: NSObject {
    private static let logger = RookLog.voice

    public var onTranscript: ((String) -> Void)?              // final utterance → agent
    public var onListeningChanged: ((Bool) -> Void)?
    public var onSpeakingChanged: ((Bool) -> Void)?
    public var onPartial: ((String) -> Void)?
    public var onError: ((String) -> Void)?

    private let synthesizer = AVSpeechSynthesizer()
    private let audioEngine = AVAudioEngine()
    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var silenceTimer: Timer?
    private var latestTranscript = ""

    public private(set) var isListening = false
    public private(set) var isSpeaking = false

    public override init() {
        super.init()
        synthesizer.delegate = self
        #if os(iOS)
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleAudioInterruption(_:)),
            name: AVAudioSession.interruptionNotification,
            object: nil
        )
        #endif
    }

    #if os(iOS)
    /// A phone call / Siri / other app grabbing the audio session would otherwise
    /// leave listening "stuck on" (engine tap dead, `isListening` still true). Stop
    /// cleanly on interruption so a single tap restarts, rather than two.
    @objc private nonisolated func handleAudioInterruption(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              AVAudioSession.InterruptionType(rawValue: raw) == .began else {
            return
        }
        Task { @MainActor in
            Self.logger.info("voice audio interruption began")
            self.stopSpeaking()
            if self.isListening {
                self.stopListening(send: false)
            }
        }
    }
    #endif

    // MARK: - Permissions

    public func authorized() -> Bool {
        SFSpeechRecognizer.authorizationStatus() == .authorized
            && AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
    }

    public func requestPermissions(_ completion: @escaping (Bool) -> Void) {
        Self.logger.info("voice request permissions")
        SFSpeechRecognizer.requestAuthorization { speechStatus in
            AVCaptureDevice.requestAccess(for: .audio) { micGranted in
                Task { @MainActor in
                    let granted = speechStatus == .authorized && micGranted
                    Self.logger.info("voice permissions result granted=\(granted, privacy: .public)")
                    completion(granted)
                }
            }
        }
    }

    // MARK: - Audio session (iOS only)

    private func configureAudioSession(forRecording: Bool) {
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(
            forRecording ? .playAndRecord : .playback,
            mode: .spokenAudio,
            options: [.duckOthers, .defaultToSpeaker, .allowBluetooth]
        )
        try? session.setActive(true, options: [])
        #endif
    }

    private func deactivateAudioSession() {
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        #endif
    }

    // MARK: - Listening (speech → text)

    public func toggleListening() {
        if isListening {
            stopListening(send: true)
        } else {
            startListening()
        }
    }

    public func startListening() {
        Self.logger.info("voice start listening authorized=\(self.authorized(), privacy: .public)")
        guard !isListening else {
            return
        }
        guard authorized() else {
            Self.logger.error("voice start rejected not authorized")
            onError?("Microphone or speech recognition not authorized")
            return
        }
        stopSpeaking()
        configureAudioSession(forRecording: true)

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        if recognizer?.supportsOnDeviceRecognition == true {
            request.requiresOnDeviceRecognition = true
        }
        self.request = request
        latestTranscript = ""

        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.request?.append(buffer)
        }
        audioEngine.prepare()
        do {
            try audioEngine.start()
        } catch {
            Self.logger.error("voice audio engine start failed error=\(error.localizedDescription, privacy: .public)")
            onError?("Audio engine failed: \(error.localizedDescription)")
            cleanupAudio()
            return
        }

        task = recognizer?.recognitionTask(with: request) { [weak self] result, error in
            Task { @MainActor in
                guard let self else {
                    return
                }
                if let result {
                    self.latestTranscript = result.bestTranscription.formattedString
                    self.onPartial?(self.latestTranscript)
                    self.resetSilenceTimer()
                    if result.isFinal {
                        self.stopListening(send: true)
                    }
                }
                if error != nil {
                    self.stopListening(send: !self.latestTranscript.isEmpty)
                }
            }
        }

        isListening = true
        Self.logger.info("voice listening started")
        onListeningChanged?(true)
    }

    public func stopListening(send: Bool) {
        guard isListening else {
            return
        }
        silenceTimer?.invalidate()
        silenceTimer = nil
        cleanupAudio()
        task?.finish()
        task = nil
        isListening = false
        onListeningChanged?(false)

        let transcript = latestTranscript.trimmingCharacters(in: .whitespacesAndNewlines)
        latestTranscript = ""
        Self.logger.info("voice listening stopped send=\(send, privacy: .public) transcriptChars=\(transcript.count, privacy: .public)")
        if send, !transcript.isEmpty {
            onTranscript?(transcript)
        }
    }

    private func cleanupAudio() {
        if audioEngine.isRunning {
            audioEngine.stop()
        }
        audioEngine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        request = nil
        deactivateAudioSession()
    }

    /// Apple Speech doesn't reliably auto-endpoint; finalize after a short
    /// silence following the last partial result.
    private func resetSilenceTimer() {
        silenceTimer?.invalidate()
        silenceTimer = Timer.scheduledTimer(withTimeInterval: 1.4, repeats: false) { [weak self] _ in
            Task { @MainActor in
                self?.stopListening(send: true)
            }
        }
    }

    // MARK: - Speaking (text → speech)

    public func speak(_ text: String) {
        let cleaned = Self.cleanForSpeech(text)
        Self.logger.info("voice speak requested inputChars=\(text.count, privacy: .public) outputChars=\(cleaned.count, privacy: .public)")
        guard !cleaned.isEmpty else {
            return
        }
        configureAudioSession(forRecording: false)
        let utterance = AVSpeechUtterance(string: cleaned)
        utterance.voice = Self.preferredVoice()
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate
        synthesizer.speak(utterance)
    }

    public func stopSpeaking() {
        if synthesizer.isSpeaking {
            Self.logger.info("voice speaking stopped")
            synthesizer.stopSpeaking(at: .immediate)
        }
    }

    /// Best installed English voice: premium → enhanced → default. Override with
    /// the `VoiceIdentifier` user default.
    public static func preferredVoice() -> AVSpeechSynthesisVoice? {
        if let id = UserDefaults.standard.string(forKey: "VoiceIdentifier"),
           let voice = AVSpeechSynthesisVoice(identifier: id) {
            return voice
        }
        let english = AVSpeechSynthesisVoice.speechVoices().filter { $0.language.hasPrefix("en") }
        func best(_ quality: AVSpeechSynthesisVoiceQuality) -> AVSpeechSynthesisVoice? {
            english.filter { $0.quality == quality }
                .sorted { ($0.language == "en-US" ? 0 : 1) < ($1.language == "en-US" ? 0 : 1) }
                .first
        }
        return best(.premium) ?? best(.enhanced) ?? AVSpeechSynthesisVoice(language: "en-US")
    }

    public static func preferredVoiceName() -> String {
        preferredVoice()?.name ?? "System default"
    }

    /// Strip markdown/code so the synthesizer doesn't read syntax aloud.
    public static func cleanForSpeech(_ text: String) -> String {
        var s = text
        s = s.replacingOccurrences(of: "```[\\s\\S]*?```", with: " (code) ", options: .regularExpression)
        s = s.replacingOccurrences(of: "[`*_#>|]", with: "", options: .regularExpression)
        s = s.replacingOccurrences(of: "\\[([^\\]]+)\\]\\([^)]+\\)", with: "$1", options: .regularExpression)
        s = s.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        return s.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

extension VoiceController: AVSpeechSynthesizerDelegate {
    public nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
        Task { @MainActor in
            Self.logger.info("voice speech started")
            self.isSpeaking = true
            self.onSpeakingChanged?(true)
        }
    }

    public nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in
            if !synthesizer.isSpeaking {
                Self.logger.info("voice speech finished")
                self.isSpeaking = false
                self.onSpeakingChanged?(false)
                self.deactivateAudioSession()
            }
        }
    }
}
