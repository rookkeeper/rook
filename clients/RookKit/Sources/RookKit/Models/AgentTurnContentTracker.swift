import Foundation

/// Tracks whether a prompt produced real agent output. pi-acp presents its
/// automatic retry progress as ordinary agent message chunks, so those chunks
/// must not make an exhausted retry sequence look like a successful turn.
struct AgentTurnContentTracker {
    private(set) var hasActualContent = false
    private(set) var sawAutomaticRetry = false

    mutating func reset() {
        hasActualContent = false
        sawAutomaticRetry = false
    }

    mutating func recordAgentMessage(_ text: String) {
        if isAutomaticRetryStatus(text) {
            sawAutomaticRetry = true
        } else if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            hasActualContent = true
        }
    }

    mutating func recordActualContent() {
        hasActualContent = true
    }

    var completionErrorMessage: String? {
        guard !hasActualContent else { return nil }
        if sawAutomaticRetry {
            return "Runtime retries exhausted before producing a response."
        }
        return "Agent produced no response — the model call likely failed upstream (check provider billing/auth)."
    }
}

func isAutomaticRetryStatus(_ text: String) -> Bool {
    let normalized = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if normalized == "Retrying..." || normalized == "Retry finished, resuming." {
        return true
    }
    return normalized.hasPrefix("Retrying (attempt ") && normalized.hasSuffix(")...")
}
