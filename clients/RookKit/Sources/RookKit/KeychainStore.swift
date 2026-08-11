import Foundation
import Security

public enum KeychainStore {
    private static let service = "com.rookkeeper.Rook"
    private static let legacyService = "com.rookery.Rook"

    public static func string(for account: String) -> String? {
        if let value = readString(for: account, service: service) {
            return value
        }

        guard let legacyValue = readString(for: account, service: legacyService) else {
            return nil
        }

        // Preserve existing auth tokens across the bundle/service migration.
        if setString(legacyValue, for: account) {
            deleteString(for: account, service: legacyService)
        }
        return legacyValue
    }

    @discardableResult
    public static func setString(_ value: String, for account: String) -> Bool {
        guard let data = value.data(using: .utf8) else {
            return false
        }

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]

        let attributes: [String: Any] = {
            var base: [String: Any] = [
                kSecValueData as String: data,
            ]
            #if os(iOS)
            base[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            #endif
            return base
        }()

        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess {
            return true
        }

        var create = query
        attributes.forEach { create[$0.key] = $0.value }
        return SecItemAdd(create as CFDictionary, nil) == errSecSuccess
    }

    @discardableResult
    public static func removeString(for account: String) -> Bool {
        let currentStatus = deleteString(for: account, service: service)
        let legacyStatus = deleteString(for: account, service: legacyService)
        return currentStatus && legacyStatus
    }

    private static func readString(for account: String, service: String) -> String? {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        #if os(iOS)
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        #endif

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess,
              let data = item as? Data,
              let value = String(data: data, encoding: .utf8) else {
            return nil
        }
        return value
    }

    @discardableResult
    private static func deleteString(for account: String, service: String) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let status = SecItemDelete(query as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }
}
