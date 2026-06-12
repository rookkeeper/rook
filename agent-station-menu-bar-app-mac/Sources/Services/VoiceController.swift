import AVFoundation
import Foundation
import Speech

/// Local voice loop: on-device speech-to-text (Apple Speech) for input and
/// AVSpeechSynthesizer for spoken replies. Plain service with callbacks — the
/// model holds the @Published mirror state, matching the other services.
@MainActor
final class VoiceController: NSObject {
    var onTranscript: ((String) -> Void)?                  // final utterance → agent
    var onListeningChanged: ((Bool) -> Void)?
    var onSpeakingChanged: ((Bool) -> Void)?
    var onPartial: ((String) -> Void)?
    var onError: ((String) -> Void)?

    private let synthesizer = AVSpeechSynthesizer()
    private let audioEngine = AVAudioEngine()
    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var silenceTimer: Timer?
    private var latestTranscript = ""
    private var speechBuffer = ""   // accumulates streamed assistant text for sentence flushing

    private(set) var isListening = false
    private(set) var isSpeaking = false

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    // MARK: - Permissions

    func authorized() -> Bool {
        SFSpeechRecognizer.authorizationStatus() == .authorized
            && AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
    }

    func requestPermissions(_ completion: @escaping (Bool) -> Void) {
        SFSpeechRecognizer.requestAuthorization { speechStatus in
            AVCaptureDevice.requestAccess(for: .audio) { micGranted in
                Task { @MainActor in
                    completion(speechStatus == .authorized && micGranted)
                }
            }
        }
    }

    // MARK: - Listening (speech → text)

    func toggleListening() {
        if isListening {
            stopListening(send: true)
        } else {
            startListening()
        }
    }

    func startListening() {
        guard !isListening else {
            return
        }
        guard authorized() else {
            onError?("Microphone or speech recognition not authorized")
            return
        }
        // Don't capture our own TTS.
        stopSpeaking()

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
        onListeningChanged?(true)
    }

    func stopListening(send: Bool) {
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
    }

    /// Apple Speech doesn't reliably auto-endpoint on macOS; finalize after a
    /// short silence following the last partial result.
    private func resetSilenceTimer() {
        silenceTimer?.invalidate()
        silenceTimer = Timer.scheduledTimer(withTimeInterval: 1.4, repeats: false) { [weak self] _ in
            Task { @MainActor in
                self?.stopListening(send: true)
            }
        }
    }

    // MARK: - Speaking (text → speech)

    /// Feed streamed assistant text; complete sentences are spoken as they form
    /// so the reply starts before the full turn finishes.
    func appendAssistantText(_ chunk: String) {
        speechBuffer += chunk
        flushCompleteSentences()
    }

    func flushRemainder() {
        let remainder = Self.cleanForSpeech(speechBuffer)
        speechBuffer = ""
        if !remainder.isEmpty {
            enqueue(remainder)
        }
    }

    private func flushCompleteSentences() {
        // Find the last sentence-ending punctuation and speak up to it.
        guard let lastBreak = speechBuffer.lastIndex(where: { ".!?\n".contains($0) }) else {
            return
        }
        let upToBreak = String(speechBuffer[...lastBreak])
        speechBuffer = String(speechBuffer[speechBuffer.index(after: lastBreak)...])
        let spoken = Self.cleanForSpeech(upToBreak)
        if !spoken.isEmpty {
            enqueue(spoken)
        }
    }

    func speak(_ text: String) {
        let cleaned = Self.cleanForSpeech(text)
        guard !cleaned.isEmpty else {
            return
        }
        enqueue(cleaned)
    }

    func stopSpeaking() {
        speechBuffer = ""
        if synthesizer.isSpeaking {
            synthesizer.stopSpeaking(at: .immediate)
        }
    }

    private func enqueue(_ text: String) {
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate
        synthesizer.speak(utterance)
    }

    /// Strip markdown/code so the synthesizer doesn't read syntax aloud.
    static func cleanForSpeech(_ text: String) -> String {
        var s = text
        // Drop fenced code blocks entirely.
        s = s.replacingOccurrences(of: "```[\\s\\S]*?```", with: " (code) ", options: .regularExpression)
        // Inline code / emphasis / headings / list / quote markers.
        s = s.replacingOccurrences(of: "[`*_#>|]", with: "", options: .regularExpression)
        // Markdown links [text](url) → text.
        s = s.replacingOccurrences(of: "\\[([^\\]]+)\\]\\([^)]+\\)", with: "$1", options: .regularExpression)
        // Collapse whitespace.
        s = s.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        return s.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

extension VoiceController: AVSpeechSynthesizerDelegate {
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
        Task { @MainActor in
            self.isSpeaking = true
            self.onSpeakingChanged?(true)
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in
            if !synthesizer.isSpeaking {
                self.isSpeaking = false
                self.onSpeakingChanged?(false)
            }
        }
    }
}
