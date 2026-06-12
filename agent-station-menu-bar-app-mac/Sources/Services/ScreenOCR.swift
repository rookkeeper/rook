import CoreGraphics
import Foundation
import Vision

/// On-device OCR (Apple Vision) of a captured image. This is the request-free
/// way to read what's on screen: it reads pixels the user's real browser
/// already rendered, so it works on logged-in pages, virtualized SPAs, and
/// bot-protected sites (Amazon, X) that block any fresh HTTP request — and on
/// content Chromium's accessibility tree doesn't expose.
enum ScreenOCR {
    static func recognizeText(in image: CGImage) -> String? {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true

        let handler = VNImageRequestHandler(cgImage: image, options: [:])
        guard (try? handler.perform([request])) != nil,
              let observations = request.results, !observations.isEmpty else {
            return nil
        }

        // Reading order: top-to-bottom, then left-to-right. Vision's bounding
        // boxes are normalized with a bottom-left origin, so larger midY = higher
        // on screen. Bucket rows by y so words on the same visual line stay
        // together regardless of small vertical jitter.
        let lines = observations.compactMap { observation -> (y: CGFloat, x: CGFloat, text: String)? in
            guard let text = observation.topCandidates(1).first?.string else {
                return nil
            }
            let box = observation.boundingBox
            return (y: box.midY, x: box.minX, text: text)
        }
        let sorted = lines.sorted { lhs, rhs in
            if abs(lhs.y - rhs.y) > 0.012 {
                return lhs.y > rhs.y
            }
            return lhs.x < rhs.x
        }

        var result: [String] = []
        var currentRowY: CGFloat?
        var currentRow: [String] = []
        for line in sorted {
            if let rowY = currentRowY, abs(line.y - rowY) <= 0.012 {
                currentRow.append(line.text)
            } else {
                if !currentRow.isEmpty {
                    result.append(currentRow.joined(separator: "  "))
                }
                currentRow = [line.text]
                currentRowY = line.y
            }
        }
        if !currentRow.isEmpty {
            result.append(currentRow.joined(separator: "  "))
        }
        let joined = result.joined(separator: "\n")
        return joined.isEmpty ? nil : joined
    }
}
