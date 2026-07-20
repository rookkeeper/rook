import XCTest
@testable import RookKit

final class JSONValueTests: XCTestCase {
    // MARK: - Encoding

    func testEncodeNull() throws {
        let value = JSONValue.null
        let data = try JSONEncoder().encode(value)
        let json = try JSONSerialization.jsonObject(with: data, options: .fragmentsAllowed) as! NSNull
        XCTAssertEqual(json, NSNull())
    }

    func testEncodeBool() throws {
        let value = JSONValue.bool(true)
        let data = try JSONEncoder().encode(value)
        let json = try JSONSerialization.jsonObject(with: data, options: .fragmentsAllowed) as! Bool
        XCTAssertTrue(json)
    }

    func testEncodeNumber() throws {
        let value = JSONValue.number(42.5)
        let data = try JSONEncoder().encode(value)
        let json = try JSONSerialization.jsonObject(with: data, options: .fragmentsAllowed) as! Double
        XCTAssertEqual(json, 42.5)
    }

    func testEncodeString() throws {
        let value = JSONValue.string("hello")
        let data = try JSONEncoder().encode(value)
        let json = try JSONSerialization.jsonObject(with: data, options: .fragmentsAllowed) as! String
        XCTAssertEqual(json, "hello")
    }

    func testEncodeArray() throws {
        let value = JSONValue.array([.string("a"), .number(1)])
        let data = try JSONEncoder().encode(value)
        let json = try JSONSerialization.jsonObject(with: data) as! [Any]
        XCTAssertEqual(json.count, 2)
    }

    func testEncodeObject() throws {
        let value = JSONValue.object(["key": .string("val")])
        let data = try JSONEncoder().encode(value)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: String]
        XCTAssertEqual(json["key"], "val")
    }

    // MARK: - Decoding

    func testDecodeNull() throws {
        let json = "null".data(using: .utf8)!
        let value = try JSONDecoder().decode(JSONValue.self, from: json)
        XCTAssertEqual(value, .null)
    }

    func testDecodeBool() throws {
        let json = "false".data(using: .utf8)!
        let value = try JSONDecoder().decode(JSONValue.self, from: json)
        XCTAssertEqual(value, .bool(false))
    }

    func testDecodeNumber() throws {
        let json = "-3.14".data(using: .utf8)!
        let value = try JSONDecoder().decode(JSONValue.self, from: json)
        XCTAssertEqual(value, .number(-3.14))
    }

    func testDecodeString() throws {
        let json = "\"world\"".data(using: .utf8)!
        let value = try JSONDecoder().decode(JSONValue.self, from: json)
        XCTAssertEqual(value, .string("world"))
    }

    func testDecodeArray() throws {
        let json = "[1, true]".data(using: .utf8)!
        let value = try JSONDecoder().decode(JSONValue.self, from: json)
        XCTAssertEqual(value, .array([.number(1), .bool(true)]))
    }

    func testDecodeObject() throws {
        let json = #"{"a": 1, "b": "c"}"#.data(using: .utf8)!
        let value = try JSONDecoder().decode(JSONValue.self, from: json)
        XCTAssertEqual(value, .object(["a": .number(1), "b": .string("c")]))
    }

    // MARK: - Round-trip

    func testRoundTripComplex() throws {
        let original = JSONValue.object([
            "sessionId": .string("abc-123"),
            "running": .bool(false),
            "count": .number(7),
            "tags": .array([.string("a"), .null, .number(0)]),
            "nested": .object(["deep": .bool(true)])
        ])
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(JSONValue.self, from: data)
        XCTAssertEqual(original, decoded)
    }

    // MARK: - Subscript access

    func testObjectSubscriptExistingKey() {
        let obj = JSONValue.object(["name": .string("Rook")])
        XCTAssertEqual(obj["name"], .string("Rook"))
    }

    func testObjectSubscriptMissingKey() {
        let obj = JSONValue.object(["name": .string("Rook")])
        XCTAssertNil(obj["missing"])
    }

    func testSubscriptOnNonObject() {
        let arr = JSONValue.array([.string("a")])
        XCTAssertNil(arr["any"])
    }

    // MARK: - Typed accessors

    func testStringValue() {
        XCTAssertEqual(JSONValue.string("hi").stringValue, "hi")
        XCTAssertNil(JSONValue.number(1).stringValue)
    }

    func testBoolValue() {
        XCTAssertEqual(JSONValue.bool(true).boolValue, true)
        XCTAssertNil(JSONValue.string("true").boolValue)
    }

    func testNumberValue() {
        XCTAssertEqual(JSONValue.number(3.14).numberValue, 3.14)
        XCTAssertNil(JSONValue.string("3.14").numberValue)
    }
}
