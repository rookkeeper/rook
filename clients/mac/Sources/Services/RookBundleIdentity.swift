import Foundation

/// Bundle identities used by the production app and isolated development builds.
/// Internal Rook processes must never be treated as user-facing environment targets.
enum RookBundleIdentity {
    static let productionBundleId = "com.rookkeeper.Rook"
    static let developmentBundleIdPrefix = "com.rookkeeper.Rook.Dev."

    static func isInternalRookBundleId(_ bundleId: String, currentBundleId: String? = Bundle.main.bundleIdentifier) -> Bool {
        if bundleId == productionBundleId || bundleId.hasPrefix(developmentBundleIdPrefix) {
            return true
        }
        return bundleId == currentBundleId
    }
}
