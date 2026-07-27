import Foundation
import OSLog
import RookKit

struct EnvironmentCandidate: Equatable {
    let id: String
    let metadata: [String: JSONValue]
}

@MainActor
protocol SpecializedEnvironmentProvider: AnyObject {
    var supportedBundleIds: [String] { get }
    var onStateChange: (() -> Void)? { get set }
    var currentAppEnvironmentId: String? { get }
    var currentSiteEnvironmentId: String? { get }

    func activate(app: ForegroundApp, title: String?)
    func update(app: ForegroundApp, title: String?)
    func deactivate()
    func setServerOnline(_ online: Bool)
}

@MainActor
final class EnvironmentRegistrationController {
    private static let duplicateSuppressionWindow: TimeInterval = 60

    private let register: ([EnvironmentCandidate], String) -> Void
    private var timer: Timer?
    private var currentSignature: String?
    private var currentCandidates: [EnvironmentCandidate] = []
    private var currentReason = ""
    private var readyToEmit = false
    private var isServerOnline = false
    private var lastEmissionAtByEnvironmentId: [String: Date] = [:]

    init(register: @escaping ([EnvironmentCandidate], String) -> Void) {
        self.register = register
    }

    func setServerOnline(_ online: Bool) {
        isServerOnline = online
        flushIfPossible()
    }

    func update(candidates: [EnvironmentCandidate], delay: TimeInterval, reason: String) {
        let signature = Self.signature(for: candidates)
        guard !signature.isEmpty else {
            clear()
            return
        }
        currentCandidates = candidates
        currentReason = reason
        if signature == currentSignature {
            flushIfPossible()
            return
        }
        timer?.invalidate()
        timer = nil
        currentSignature = signature
        readyToEmit = false
        if delay <= 0 {
            readyToEmit = true
            flushIfPossible()
            return
        }
        timer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.readyToEmit = true
                self.flushIfPossible()
            }
        }
    }

    func emitNow(candidates: [EnvironmentCandidate], reason: String) {
        currentCandidates = candidates
        currentReason = reason
        readyToEmit = true
        flushIfPossible()
    }

    func clear() {
        timer?.invalidate()
        timer = nil
        currentSignature = nil
        currentCandidates = []
        currentReason = ""
        readyToEmit = false
    }

    private func flushIfPossible() {
        guard readyToEmit, isServerOnline, !currentCandidates.isEmpty else { return }
        let now = Date()
        let eligible = currentCandidates.filter { candidate in
            guard let lastEmission = lastEmissionAtByEnvironmentId[candidate.id] else {
                return true
            }
            return now.timeIntervalSince(lastEmission) >= Self.duplicateSuppressionWindow
        }
        guard !eligible.isEmpty else { return }
        for candidate in eligible {
            lastEmissionAtByEnvironmentId[candidate.id] = now
        }
        register(eligible, currentReason)
    }

    private static func signature(for candidates: [EnvironmentCandidate]) -> String {
        candidates.map(\.id).sorted().joined(separator: "|")
    }
}

enum EnvironmentIDEncoding {
    static func encodePathComponent(_ raw: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
        return raw.addingPercentEncoding(withAllowedCharacters: allowed) ?? raw
    }

    static func depth(_ id: String) -> Int {
        id.split(separator: "/").count
    }
}

enum CandidateMetadata {
    static func base(app: ForegroundApp, title: String?) -> [String: JSONValue] {
        var metadata: [String: JSONValue] = [
            "bundleId": .string(app.bundleId),
            "appName": .string(app.name),
        ]
        if let title, !title.isEmpty {
            metadata["windowTitle"] = .string(title)
        }
        return metadata
    }
}

struct SpecialistProviderRegistry {
    @MainActor
    static func makeProviders(register: @escaping ([EnvironmentCandidate], String) -> Void) -> [String: SpecializedEnvironmentProvider] {
        let providers: [SpecializedEnvironmentProvider] = [
            ObsidianEnvironmentProvider(register: register),
            SlackEnvironmentProvider(register: register),
            OBSStudioEnvironmentProvider(register: register),
            DescriptEnvironmentProvider(register: register),
            DiscordEnvironmentProvider(register: register),
        ]

        var byBundleId: [String: SpecializedEnvironmentProvider] = [:]
        for provider in providers {
            for bundleId in provider.supportedBundleIds {
                byBundleId[bundleId] = provider
            }
        }
        return byBundleId
    }
}
