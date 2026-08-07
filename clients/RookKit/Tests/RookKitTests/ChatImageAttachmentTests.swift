import XCTest
@testable import RookKit

final class ChatImageAttachmentTests: XCTestCase {
    func testImageAttachmentDecodesBase64Data() {
        let attachment = ChatImageAttachment(mimeType: "image/png", base64Data: Data("image".utf8).base64EncodedString())

        XCTAssertEqual(attachment.mimeType, "image/png")
        XCTAssertEqual(attachment.data, Data("image".utf8))
    }

    func testQueuedMessageRetainsImages() {
        let image = ChatImageAttachment(mimeType: "image/png", base64Data: "aGVsbG8=")
        let message = QueuedChatMessage(id: "queued-1", content: [.text("describe"), .image(image)])

        XCTAssertEqual(message.images, [image])
    }

    func testPromptContentPreservesTextImageTextOrder() {
        let first = ChatImageAttachment(mimeType: "image/png", base64Data: "Zmlyc3Q=")
        let second = ChatImageAttachment(mimeType: "image/png", base64Data: "c2Vjb25k")
        let content: [ChatPromptContent] = [
            .text("before"),
            .image(first),
            .text("between"),
            .image(second),
            .text("after"),
        ]

        XCTAssertEqual(content.images, [first, second])
        XCTAssertEqual(content.textValue, "beforebetweenafter")
        XCTAssertEqual(content.replacingText(with: "edited").images, [first, second])
    }
}
