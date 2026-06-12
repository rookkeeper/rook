import Foundation

enum ToolBlockStatus: Equatable {
    case pending
    case inputStreaming
    case ready
    case running
    case completed
    case failed
    case cancelled

    var label: String {
        switch self {
        case .pending: return "Pending"
        case .inputStreaming: return "Preparing"
        case .ready: return "Ready"
        case .running: return "Running"
        case .completed: return "Done"
        case .failed: return "Failed"
        case .cancelled: return "Cancelled"
        }
    }

    var isTerminal: Bool {
        switch self {
        case .completed, .failed, .cancelled:
            return true
        default:
            return false
        }
    }
}

struct ToolBlockState: Equatable {
    var toolCallId: String
    var title: String
    var kindLabel: String
    var status: ToolBlockStatus
    var arguments: String
    var output: String
}

struct PlanEntry: Equatable, Identifiable {
    let id: Int
    var content: String
    var priority: String
    var status: String
}

enum ChatBlockKind: Equatable {
    case user(text: String)
    case assistantText(text: String, streaming: Bool)
    case thinking(text: String, streaming: Bool)
    case tool(ToolBlockState)
    case error(source: String, message: String)
    case system(text: String)
    case plan(entries: [PlanEntry])
}

struct ChatBlock: Equatable, Identifiable {
    let id: String
    var kind: ChatBlockKind
}

/// Flat client-side event union parsed off the ACP websocket — the Swift
/// counterpart of the React client's `AcpClientEvent`.
enum AcpClientEvent {
    case agentMessageChunk(text: String)
    case agentThoughtChunk(text: String)
    case toolCallStarted(toolCallId: String, title: String, kind: String, status: String, rawInput: String?)
    case toolCallUpdate(toolCallId: String, status: String, toolName: String?, output: String?)
    case toolInputDelta(toolCallId: String, toolName: String?, delta: String)
    case toolCallReady(toolCallId: String, toolName: String?)
    case toolOutputDelta(toolCallId: String, toolName: String?, delta: String)
    case planUpdate(entries: [PlanEntry])
    case usageUpdate(used: Int, size: Int)
    case runCompleted(stopReason: String)
    case runFailed(message: String)
    case protocolError(message: String)
    case connectionError(message: String)
    case environmentOffered(EnvironmentOffer)
    case environmentOfferResolved(environmentId: String)
    case environmentEntered(environmentId: String)
    case environmentExited(environmentId: String, error: String?)
}
