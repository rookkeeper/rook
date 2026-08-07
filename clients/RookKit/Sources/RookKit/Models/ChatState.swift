import Foundation

// MARK: - Shared chat state types used by both Apple clients

public struct QueuedChatMessage: Identifiable, Equatable {
    public let id: String
    public var content: [ChatPromptContent]
    public var draftText: String
    public var isEditing = false

    public var text: String { content.textValue }
    public var images: [ChatImageAttachment] { content.images }

    public init(id: String, content: [ChatPromptContent], draftText: String? = nil, isEditing: Bool = false) {
        self.id = id
        self.content = content
        self.draftText = draftText ?? content.textValue
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
