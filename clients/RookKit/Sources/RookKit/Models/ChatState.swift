import Foundation

// MARK: - Shared chat state types used by both Apple clients

public struct QueuedChatMessage: Identifiable, Equatable {
    public let id: String
    public var text: String
    public var draftText: String
    public var isEditing = false

    public init(id: String, text: String, draftText: String, isEditing: Bool = false) {
        self.id = id
        self.text = text
        self.draftText = draftText
        self.isEditing = isEditing
    }
}

public struct PendingPermissionRequest: Equatable {
    public var requestId: String
    public var toolCall: AcpPermissionToolCall
    public var options: [AcpPermissionOption]

    public init(requestId: String, toolCall: AcpPermissionToolCall, options: [AcpPermissionOption]) {
        self.requestId = requestId
        self.toolCall = toolCall
        self.options = options
    }
}

public struct ContextUsageState: Equatable {
    public var used: Int
    public var size: Int
    public var cost: AcpUsageCost?

    public init(used: Int, size: Int, cost: AcpUsageCost? = nil) {
        self.used = used
        self.size = size
        self.cost = cost
    }
}
