import Foundation

public enum ToolPayloadFormatting {
    public static func displayArguments(_ raw: String) -> String {
        guard let json = raw.data(using: .utf8),
              let value = try? JSONSerialization.jsonObject(with: json, options: [.fragmentsAllowed]) else {
            return raw
        }
        return YAMLRenderer.render(value)
    }
}

private enum YAMLRenderer {
    static func render(_ value: Any) -> String {
        lines(for: value, indent: 0).joined(separator: "\n")
    }

    private static func lines(for value: Any, indent: Int) -> [String] {
        let prefix = String(repeating: " ", count: indent)

        switch value {
        case let dict as [String: Any]:
            if dict.isEmpty { return [prefix + "{}"] }
            return dict.keys.sorted().flatMap { key in
                let renderedKey = renderKey(key)
                return linesForMappingValue(key: renderedKey, value: dict[key] as Any, indent: indent)
            }
        case let array as [Any]:
            if array.isEmpty { return [prefix + "[]"] }
            return array.flatMap { item in
                linesForSequenceValue(item, indent: indent)
            }
        case _ as NSNull:
            return [prefix + "null"]
        case let number as NSNumber:
            if CFGetTypeID(number) == CFBooleanGetTypeID() {
                return [prefix + (number.boolValue ? "true" : "false")]
            }
            return [prefix + renderNumber(number)]
        case let string as String:
            return renderString(string, indent: indent)
        default:
            return [prefix + renderQuotedString(String(describing: value))]
        }
    }

    private static func linesForMappingValue(key: String, value: Any, indent: Int) -> [String] {
        let prefix = String(repeating: " ", count: indent)
        if let string = value as? String {
            if string.contains("\n") {
                let indicator = string.hasSuffix("\n") ? "|" : "|-"
                let body = blockStringLines(string, indent: indent + 2)
                return [prefix + "\(key): \(indicator)"] + body
            }
            return [prefix + "\(key): \(renderInlineString(string))"]
        }
        if let dict = value as? [String: Any] {
            if dict.isEmpty {
                return [prefix + "\(key): {}"]
            }
            let nested = lines(for: dict, indent: indent + 2)
            return [prefix + "\(key):"] + nested
        }
        if let array = value as? [Any] {
            if array.isEmpty {
                return [prefix + "\(key): []"]
            }
            let nested = lines(for: array, indent: indent + 2)
            return [prefix + "\(key):"] + nested
        }
        if value is NSNull {
            return [prefix + "\(key): null"]
        }
        if let number = value as? NSNumber {
            if CFGetTypeID(number) == CFBooleanGetTypeID() {
                return [prefix + "\(key): " + (number.boolValue ? "true" : "false")]
            }
            return [prefix + "\(key): " + renderNumber(number)]
        }
        return [prefix + "\(key): " + renderQuotedString(String(describing: value))]
    }

    private static func linesForSequenceValue(_ value: Any, indent: Int) -> [String] {
        let prefix = String(repeating: " ", count: indent)
        if let string = value as? String {
            if string.contains("\n") {
                let indicator = string.hasSuffix("\n") ? "|" : "|-"
                let body = blockStringLines(string, indent: indent + 2)
                return [prefix + "- \(indicator)"] + body
            }
            return [prefix + "- \(renderInlineString(string))"]
        }
        if let dict = value as? [String: Any], dict.isEmpty {
            return [prefix + "- {}"]
        }
        if let array = value as? [Any], array.isEmpty {
            return [prefix + "- []"]
        }
        if let dict = value as? [String: Any] {
            let sortedKeys = dict.keys.sorted()
            guard let firstKey = sortedKeys.first else {
                return [prefix + "- {}"]
            }
            var result: [String] = []
            let firstLines = linesForMappingValue(key: renderKey(firstKey), value: dict[firstKey] as Any, indent: indent + 2)
            if let first = firstLines.first {
                result.append(prefix + "- " + first.trimmingCharacters(in: .whitespaces))
                result.append(contentsOf: firstLines.dropFirst())
            }
            for key in sortedKeys.dropFirst() {
                result.append(contentsOf: linesForMappingValue(key: renderKey(key), value: dict[key] as Any, indent: indent + 2))
            }
            return result
        }
        if let array = value as? [Any] {
            let nested = array.flatMap { linesForSequenceValue($0, indent: indent + 2) }
            guard let first = nested.first else { return [prefix + "- []"] }
            return [prefix + "- " + first.trimmingCharacters(in: .whitespaces)] + Array(nested.dropFirst())
        }
        if value is NSNull {
            return [prefix + "- null"]
        }
        if let number = value as? NSNumber {
            if CFGetTypeID(number) == CFBooleanGetTypeID() {
                return [prefix + "- " + (number.boolValue ? "true" : "false")]
            }
            return [prefix + "- " + renderNumber(number)]
        }
        return [prefix + "- " + renderQuotedString(String(describing: value))]
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

    private static func renderNumber(_ number: NSNumber) -> String {
        let double = number.doubleValue
        if floor(double) == double {
            return String(Int(double))
        }
        return String(double)
    }
}
