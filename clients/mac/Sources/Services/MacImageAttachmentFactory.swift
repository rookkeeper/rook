import AppKit
import Foundation
import ImageIO
import RookKit
import UniformTypeIdentifiers

/// Converts macOS clipboard and drag/drop image representations into bounded
/// ACP-ready attachments. Images are normalized to PNG before transmission.
enum MacImageAttachmentFactory {
    private static let maxBytes = 12 * 1024 * 1024
    private static let maxPixelSize = 4096

    static func make(from pasteboard: NSPasteboard) throws -> ChatImageAttachment? {
        if let objects = pasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]),
           let object = objects.first {
            if let url = object as? URL {
                return try make(from: url)
            }
            if let url = object as? NSURL, url.isFileURL, let path = url.path {
                return try make(from: URL(fileURLWithPath: path))
            }
        }

        let imageTypes: [NSPasteboard.PasteboardType] = [
            .png,
            NSPasteboard.PasteboardType(UTType.png.identifier),
            .tiff,
            NSPasteboard.PasteboardType(UTType.tiff.identifier),
            NSPasteboard.PasteboardType(UTType.jpeg.identifier),
            NSPasteboard.PasteboardType(UTType.gif.identifier),
            NSPasteboard.PasteboardType(UTType.webP.identifier),
            NSPasteboard.PasteboardType(UTType.image.identifier),
        ]
        for type in imageTypes {
            if let imageData = pasteboard.data(forType: type) {
                return try make(data: imageData)
            }
        }
        return nil
    }

    static func make(from url: URL) throws -> ChatImageAttachment? {
        guard url.isFileURL else { return nil }
        let values = try? url.resourceValues(forKeys: [.contentTypeKey])
        if let contentType = values?.contentType, !contentType.conforms(to: .image) {
            return nil
        }
        let data = try Data(contentsOf: url)
        return try make(data: data)
    }

    private static func make(data: Data) throws -> ChatImageAttachment {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else {
            throw ImageAttachmentError.invalidImage
        }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
            throw ImageAttachmentError.invalidImage
        }
        let bitmap = NSBitmapImageRep(cgImage: image)
        guard let pngData = bitmap.representation(using: .png, properties: [:]) else {
            throw ImageAttachmentError.invalidImage
        }
        guard pngData.count <= maxBytes else {
            throw ImageAttachmentError.tooLarge
        }
        return ChatImageAttachment(
            mimeType: "image/png",
            base64Data: pngData.base64EncodedString()
        )
    }

    enum ImageAttachmentError: LocalizedError {
        case invalidImage
        case tooLarge

        var errorDescription: String? {
            switch self {
            case .invalidImage:
                return "That file does not contain a readable image."
            case .tooLarge:
                return "That image is too large to attach (12 MB maximum)."
            }
        }
    }
}
