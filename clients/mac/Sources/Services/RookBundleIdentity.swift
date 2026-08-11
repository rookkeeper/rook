import Foundation

/// Bundle identities used by the production app and isolated development builds.
/// Internal Rook processes must never be treated as user-facing environment targets.
enum RookBundleIdentity {
    static let productionBundleId = "com.rookkeeper.Rook"
    static let developmentBundleIdPrefix = "com.rookkeeper.Rook.Dev."
    private static let legacyProductionBundleId = "com.rookery.Rook"
    private static let legacyDevelopmentBundleIdPrefix = "com.rookery.Rook.Dev."

    static func isInternalRookBundleId(_ bundleId: String, currentBundleId: String? = Bundle.main.bundleIdentifier) -> Bool {
        if bundleId == productionBundleId
            || bundleId.hasPrefix(developmentBundleIdPrefix)
            || bundleId == legacyProductionBundleId
            || bundleId.hasPrefix(legacyDevelopmentBundleIdPrefix) {
            return true
        }
        return bundleId == currentBundleId
    }
}
