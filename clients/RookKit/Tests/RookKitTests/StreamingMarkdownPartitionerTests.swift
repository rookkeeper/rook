import XCTest
@testable import RookKit

final class StreamingMarkdownPartitionerTests: XCTestCase {
    func testKeepsSingleIncompleteLineInTail() {
        XCTAssertEqual(
            StreamingMarkdownPartitioner.partition("# Heading"),
            StreamingMarkdownPartition(stablePrefix: "", unstableTail: "# Heading")
        )
    }

    func testRendersCompletedLinesAndLeavesPartialTail() {
        XCTAssertEqual(
            StreamingMarkdownPartitioner.partition("# Heading\n\nA stable paragraph.\nPartial"),
            StreamingMarkdownPartition(stablePrefix: "# Heading\n\nA stable paragraph.\n", unstableTail: "Partial")
        )
    }

    func testKeepsUnclosedFenceInTail() {
        XCTAssertEqual(
            StreamingMarkdownPartitioner.partition("Before\n```python\nprint(1)\n"),
            StreamingMarkdownPartition(stablePrefix: "Before\n", unstableTail: "```python\nprint(1)\n")
        )
    }

    func testRendersClosedFenceAndLeavesFollowingTail() {
        XCTAssertEqual(
            StreamingMarkdownPartitioner.partition("Before\n```python\nprint(1)\n```\nAfter"),
            StreamingMarkdownPartition(stablePrefix: "Before\n```python\nprint(1)\n```\n", unstableTail: "After")
        )
    }
}
