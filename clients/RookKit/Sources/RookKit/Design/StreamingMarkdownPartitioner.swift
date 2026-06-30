import Foundation

struct StreamingMarkdownPartition: Equatable {
    var stablePrefix: String
    var unstableTail: String
}

enum StreamingMarkdownPartitioner {
    static func partition(_ markdown: String) -> StreamingMarkdownPartition {
        guard !markdown.isEmpty else {
            return StreamingMarkdownPartition(stablePrefix: "", unstableTail: "")
        }

        var stableEnd = markdown.startIndex
        var lineStart = markdown.startIndex
        var fence: FenceState?

        while lineStart < markdown.endIndex {
            guard let lineEnd = markdown[lineStart...].firstIndex(of: "\n") else {
                break
            }
            let nextLineStart = markdown.index(after: lineEnd)
            let line = String(markdown[lineStart..<lineEnd])

            if let candidate = fenceTransition(for: line, currentFence: fence) {
                fence = candidate.nextFence
                if candidate.closedFence {
                    stableEnd = nextLineStart
                }
            } else if fence == nil {
                stableEnd = nextLineStart
            }

            lineStart = nextLineStart
        }

        return StreamingMarkdownPartition(
            stablePrefix: String(markdown[..<stableEnd]),
            unstableTail: String(markdown[stableEnd...])
        )
    }

    private static func fenceTransition(for line: String, currentFence: FenceState?) -> FenceTransition? {
        let leadingSpaces = line.prefix { $0 == " " }
        guard leadingSpaces.count <= 3 else { return nil }

        let trimmed = line.dropFirst(leadingSpaces.count)
        guard let marker = trimmed.first, marker == "`" || marker == "~" else {
            return nil
        }

        let count = trimmed.prefix { $0 == marker }.count
        guard count >= 3 else { return nil }

        if let currentFence {
            guard currentFence.marker == marker, count >= currentFence.count else {
                return FenceTransition(nextFence: currentFence, closedFence: false)
            }
            let remainder = trimmed.dropFirst(count)
            guard remainder.trimmingCharacters(in: .whitespaces).isEmpty else {
                return FenceTransition(nextFence: currentFence, closedFence: false)
            }
            return FenceTransition(nextFence: nil, closedFence: true)
        }

        return FenceTransition(nextFence: FenceState(marker: marker, count: count), closedFence: false)
    }
}

private struct FenceState: Equatable {
    var marker: Character
    var count: Int
}

private struct FenceTransition {
    var nextFence: FenceState?
    var closedFence: Bool
}
