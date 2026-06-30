import XCTest
@testable import RookKit

final class ToolPayloadFormattingTests: XCTestCase {
    func testLeavesInvalidJsonUntouched() {
        let raw = "{not json"
        XCTAssertEqual(ToolPayloadFormatting.displayArguments(raw), raw)
    }

    func testRendersJsonObjectAsYaml() {
        let raw = "{\"timeout\":30,\"path\":\"/tmp/demo\",\"enabled\":true}"
        XCTAssertEqual(
            ToolPayloadFormatting.displayArguments(raw),
            "enabled: true\npath: /tmp/demo\ntimeout: 30"
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
