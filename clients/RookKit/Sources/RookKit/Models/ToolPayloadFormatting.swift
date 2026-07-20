import Foundation

public enum ToolPayloadFormatting {
    public static func displayArguments(_ raw: String) -> String {
        var parser = JSONParser(raw)
        guard let value = try? parser.parse() else {
            return raw
        }
        return YAMLRenderer.render(value)
    }
}

private enum OrderedJSONValue {
    case object([(String, OrderedJSONValue)])
    case array([OrderedJSONValue])
    case string(String)
    case number(String)
    case bool(Bool)
    case null
}

private struct JSONParser {
    private let input: String
    private var index: String.Index

    init(_ input: String) {
        self.input = input
        self.index = input.startIndex
    }

    mutating func parse() throws -> OrderedJSONValue {
        skipWhitespace()
        let value = try parseValue()
        skipWhitespace()
        guard index == input.endIndex else { throw Error.invalidSyntax }
        return value
    }

    private mutating func parseValue() throws -> OrderedJSONValue {
        guard let char = current else { throw Error.unexpectedEnd }
        switch char {
        case "{":
            return try parseObject()
        case "[":
            return try parseArray()
        case "\"":
            return .string(try parseString())
        case "t":
            try consumeLiteral("true")
            return .bool(true)
        case "f":
            try consumeLiteral("false")
            return .bool(false)
        case "n":
            try consumeLiteral("null")
            return .null
        case "-", "0"..."9":
            return .number(try parseNumber())
        default:
            throw Error.invalidSyntax
        }
    }

    private mutating func parseObject() throws -> OrderedJSONValue {
        try consume("{")
        skipWhitespace()
        if consumeIfPresent("}") {
            return .object([])
        }

        var pairs: [(String, OrderedJSONValue)] = []
        while true {
            skipWhitespace()
            let key = try parseString()
            skipWhitespace()
            try consume(":")
            skipWhitespace()
            let value = try parseValue()
            pairs.append((key, value))
            skipWhitespace()
            if consumeIfPresent("}") {
                return .object(pairs)
            }
            try consume(",")
            skipWhitespace()
        }
    }

    private mutating func parseArray() throws -> OrderedJSONValue {
        try consume("[")
        skipWhitespace()
        if consumeIfPresent("]") {
            return .array([])
        }

        var items: [OrderedJSONValue] = []
        while true {
            skipWhitespace()
            items.append(try parseValue())
            skipWhitespace()
            if consumeIfPresent("]") {
                return .array(items)
            }
            try consume(",")
            skipWhitespace()
        }
    }

    private mutating func parseString() throws -> String {
        try consume("\"")
        var result = ""

        while let char = current {
            advance()
            switch char {
            case "\"":
                return result
            case "\\":
                guard let escape = current else { throw Error.unexpectedEnd }
                advance()
                switch escape {
                case "\"": result.append("\"")
                case "\\": result.append("\\")
                case "/": result.append("/")
                case "b": result.append("\u{08}")
                case "f": result.append("\u{0C}")
                case "n": result.append("\n")
                case "r": result.append("\r")
                case "t": result.append("\t")
                case "u": result.append(try parseUnicodeScalar())
                default: throw Error.invalidSyntax
                }
            default:
                result.append(char)
            }
        }

        throw Error.unexpectedEnd
    }

    private mutating func parseUnicodeScalar() throws -> String {
        let first = try parseHexQuad()
        if (0xD800...0xDBFF).contains(first) {
            let checkpoint = index
            if consumeIfPresent("\\"), consumeIfPresent("u") {
                let second = try parseHexQuad()
                guard (0xDC00...0xDFFF).contains(second) else { throw Error.invalidSyntax }
                let scalarValue = 0x10000 + ((first - 0xD800) << 10) + (second - 0xDC00)
                guard let scalar = UnicodeScalar(scalarValue) else { throw Error.invalidSyntax }
                return String(scalar)
            }
            index = checkpoint
            throw Error.invalidSyntax
        }
        guard let scalar = UnicodeScalar(first) else { throw Error.invalidSyntax }
        return String(scalar)
    }

    private mutating func parseHexQuad() throws -> UInt32 {
        var value: UInt32 = 0
        for _ in 0..<4 {
            guard let char = current, let digit = char.hexDigitValue else { throw Error.invalidSyntax }
            value = (value << 4) | UInt32(digit)
            advance()
        }
        return value
    }

    private mutating func parseNumber() throws -> String {
        let start = index
        consumeIfPresent("-")

        if consumeIfPresent("0") {
            // leading zero is only valid by itself before fraction/exponent
        } else {
            try consumeDigits()
        }

        if consumeIfPresent(".") {
            try consumeDigits()
        }

        if consumeIfPresent("e") || consumeIfPresent("E") {
            _ = consumeIfPresent("+") || consumeIfPresent("-")
            try consumeDigits()
        }

        return String(input[start..<index])
    }

    private mutating func consumeDigits() throws {
        guard let char = current, char.isNumber else { throw Error.invalidSyntax }
        while let char = current, char.isNumber {
            advance()
        }
    }

    private mutating func consumeLiteral(_ literal: String) throws {
        for expected in literal {
            try consume(expected)
        }
    }

    private mutating func consume(_ expected: Character) throws {
        guard current == expected else { throw Error.invalidSyntax }
        advance()
    }

    @discardableResult
    private mutating func consumeIfPresent(_ expected: Character) -> Bool {
        guard current == expected else { return false }
        advance()
        return true
    }

    private mutating func skipWhitespace() {
        while let char = current, char.isWhitespace {
            advance()
        }
    }

    private var current: Character? {
        guard index < input.endIndex else { return nil }
        return input[index]
    }

    private mutating func advance() {
        index = input.index(after: index)
    }

    private enum Error: Swift.Error {
        case invalidSyntax
        case unexpectedEnd
    }
}

private enum YAMLRenderer {
    static func render(_ value: OrderedJSONValue) -> String {
        lines(for: value, indent: 0).joined(separator: "\n")
    }

    private static func lines(for value: OrderedJSONValue, indent: Int) -> [String] {
        let prefix = String(repeating: " ", count: indent)

        switch value {
        case .object(let pairs):
            if pairs.isEmpty { return [prefix + "{}"] }
            return pairs.flatMap { key, value in
                linesForMappingValue(key: renderKey(key), value: value, indent: indent)
            }
        case .array(let items):
            if items.isEmpty { return [prefix + "[]"] }
            return items.flatMap { item in
                linesForSequenceValue(item, indent: indent)
            }
        case .null:
            return [prefix + "null"]
        case .bool(let bool):
            return [prefix + (bool ? "true" : "false")]
        case .number(let number):
            return [prefix + number]
        case .string(let string):
            return renderString(string, indent: indent)
        }
    }

    private static func linesForMappingValue(key: String, value: OrderedJSONValue, indent: Int) -> [String] {
        let prefix = String(repeating: " ", count: indent)
        switch value {
        case .string(let string):
            if string.contains("\n") {
                let indicator = string.hasSuffix("\n") ? "|" : "|-"
                let body = blockStringLines(string, indent: indent + 2)
                return [prefix + "\(key): \(indicator)"] + body
            }
            return [prefix + "\(key): \(renderInlineString(string))"]
        case .object(let pairs):
            if pairs.isEmpty { return [prefix + "\(key): {}"] }
            return [prefix + "\(key):"] + lines(for: value, indent: indent + 2)
        case .array(let items):
            if items.isEmpty { return [prefix + "\(key): []"] }
            return [prefix + "\(key):"] + lines(for: value, indent: indent + 2)
        case .null:
            return [prefix + "\(key): null"]
        case .bool(let bool):
            return [prefix + "\(key): " + (bool ? "true" : "false")]
        case .number(let number):
            return [prefix + "\(key): \(number)"]
        }
    }

    private static func linesForSequenceValue(_ value: OrderedJSONValue, indent: Int) -> [String] {
        let prefix = String(repeating: " ", count: indent)
        switch value {
        case .string(let string):
            if string.contains("\n") {
                let indicator = string.hasSuffix("\n") ? "|" : "|-"
                let body = blockStringLines(string, indent: indent + 2)
                return [prefix + "- \(indicator)"] + body
            }
            return [prefix + "- \(renderInlineString(string))"]
        case .object(let pairs):
            if pairs.isEmpty { return [prefix + "- {}"] }
            guard let first = pairs.first else { return [prefix + "- {}"] }
            var result: [String] = []
            let firstLines = linesForMappingValue(key: renderKey(first.0), value: first.1, indent: indent + 2)
            if let firstLine = firstLines.first {
                result.append(prefix + "- " + firstLine.trimmingCharacters(in: CharacterSet.whitespaces))
                result.append(contentsOf: firstLines.dropFirst())
            }
            for pair in pairs.dropFirst() {
                result.append(contentsOf: linesForMappingValue(key: renderKey(pair.0), value: pair.1, indent: indent + 2))
            }
            return result
        case .array(let items):
            if items.isEmpty { return [prefix + "- []"] }
            let nested = items.flatMap { linesForSequenceValue($0, indent: indent + 2) }
            guard let first = nested.first else { return [prefix + "- []"] }
            return [prefix + "- " + first.trimmingCharacters(in: CharacterSet.whitespaces)] + Array(nested.dropFirst())
        case .null:
            return [prefix + "- null"]
        case .bool(let bool):
            return [prefix + "- " + (bool ? "true" : "false")]
        case .number(let number):
            return [prefix + "- \(number)"]
        }
    }

    private static func renderString(_ string: String, indent: Int) -> [String] {
        if string.contains("\n") {
            let indicator = string.hasSuffix("\n") ? "|" : "|-"
            return [String(repeating: " ", count: indent) + indicator] + blockStringLines(string, indent: indent + 2)
        }
        return [String(repeating: " ", count: indent) + renderInlineString(string)]
    }

    private static func blockStringLines(_ string: String, indent: Int) -> [String] {
        let prefix = String(repeating: " ", count: indent)
        let normalized = string.replacingOccurrences(of: "\r\n", with: "\n")
        let lines = normalized.split(separator: "\n", omittingEmptySubsequences: false)
        if lines.isEmpty {
            return [prefix]
        }
        return lines.map { prefix + $0 }
    }

    private static func renderInlineString(_ string: String) -> String {
        if string.isEmpty { return "\"\"" }
        if string == "null" || string == "true" || string == "false" { return renderQuotedString(string) }
        if Double(string) != nil { return renderQuotedString(string) }
        if needsQuotedString(string) { return renderQuotedString(string) }
        return string
    }

    private static func needsQuotedString(_ string: String) -> Bool {
        let disallowed = CharacterSet(charactersIn: ":#{}[]&,*!?|>'\"%@`\\")
        if string.rangeOfCharacter(from: .newlines) != nil { return true }
        if string.rangeOfCharacter(from: disallowed) != nil { return true }
        if string.hasPrefix(" ") || string.hasSuffix(" ") || string.hasPrefix("-") { return true }
        return false
    }

    private static func renderQuotedString(_ string: String) -> String {
        var escaped = ""
        for scalar in string.unicodeScalars {
            switch scalar {
            case "\\": escaped += "\\\\"
            case "\"": escaped += "\\\""
            case "\n": escaped += "\\n"
            case "\r": escaped += "\\r"
            case "\t": escaped += "\\t"
            default: escaped.append(String(scalar))
            }
        }
        return "\"\(escaped)\""
    }

    private static func renderKey(_ key: String) -> String {
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")
        if key.isEmpty || key.rangeOfCharacter(from: allowed.inverted) != nil {
            return renderQuotedString(key)
        }
        return key
    }
}
