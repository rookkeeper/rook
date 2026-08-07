import AppKit
import XCTest
@testable import Rook
import RookKit

final class MacImageAttachmentFactoryTests: XCTestCase {
    func testClipboardPngBecomesBoundedAttachment() throws {
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1, pixelsHigh: 1, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bitmapFormat: [], bytesPerRow: 0, bitsPerPixel: 0)!
        bitmap.setColor(NSColor(red: 0.1, green: 0.2, blue: 0.9, alpha: 1), atX: 0, y: 0)
        let png = bitmap.representation(using: .png, properties: [:])!

        let pasteboard = NSPasteboard(name: NSPasteboard.Name("rook-image-test-png"))
        pasteboard.clearContents()
        pasteboard.setData(png, forType: NSPasteboard.PasteboardType.png)

        let attachment = try XCTUnwrap(MacImageAttachmentFactory.make(from: pasteboard))
        XCTAssertEqual(attachment.mimeType, "image/png")
        XCTAssertNotNil(attachment.data)
        XCTAssertNotNil(NSImage(data: try XCTUnwrap(attachment.data)))
    }

    func testFileURLPasteboardResolvesPiClipboardImagePath() throws {
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1, pixelsHigh: 1, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bitmapFormat: [], bytesPerRow: 0, bitsPerPixel: 0)!
        bitmap.setColor(.systemBlue, atX: 0, y: 0)
        let png = bitmap.representation(using: .png, properties: [:])!
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("pi-clipboard-test.png")
        try png.write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }

        let pasteboard = NSPasteboard(name: NSPasteboard.Name("rook-image-test-file-url"))
        pasteboard.clearContents()
        pasteboard.setString(url.absoluteString, forType: .fileURL)

        let attachment = try XCTUnwrap(MacImageAttachmentFactory.make(from: pasteboard))
        XCTAssertNotNil(attachment.data)
    }

    func testTextOnlyPasteReturnsNoAttachment() throws {
        let pasteboard = NSPasteboard(name: NSPasteboard.Name("rook-image-test-text"))
        pasteboard.clearContents()
        pasteboard.setString("hello", forType: NSPasteboard.PasteboardType.string)

        XCTAssertNil(try MacImageAttachmentFactory.make(from: pasteboard))
    }
}
