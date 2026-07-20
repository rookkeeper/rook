import XCTest
@testable import RookKit

final class ToolPayloadFormattingTests: XCTestCase {
    func testLeavesInvalidJsonUntouched() {
        let raw = "{not json"
        XCTAssertEqual(ToolPayloadFormatting.displayArguments(raw), raw)
    }

    func testRendersJsonObjectAsYamlPreservingKeyOrder() {
        let raw = "{\"timeout\":30,\"path\":\"/tmp/demo\",\"enabled\":true}"
        XCTAssertEqual(
            ToolPayloadFormatting.displayArguments(raw),
            "timeout: 30\npath: /tmp/demo\nenabled: true"
        )
    }

    func testRendersNestedEditPayloadPreservingKeyOrder() {
        let raw = #"{"path":"/tmp/demo","edits":[{"oldText":"before","newText":"after"}]}"#
        XCTAssertEqual(
            ToolPayloadFormatting.displayArguments(raw),
            "path: /tmp/demo\nedits:\n  - oldText: before\n    newText: after"
        )
    }

    func testRendersMultilineStringsAsLiteralBlocks() {
        let raw = #"{"command":"python - <<'PY'\nprint(1)\nPY"}"#
        XCTAssertEqual(
            ToolPayloadFormatting.displayArguments(raw),
            "command: |-\n  python - <<'PY'\n  print(1)\n  PY"
        )
    }
}
