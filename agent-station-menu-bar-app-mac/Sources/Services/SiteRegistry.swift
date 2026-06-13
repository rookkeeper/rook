import Foundation

/// Resolves a browser URL to a per-site environment (`web:<slug>`) using the
/// Chrome extension's `site-registry.json` as the shared source of truth, so a
/// site recognized by the extension is recognized natively too. This is the
/// per-site companion to the foreground provider's per-app resolution: on a
/// recognized site the agent gets the app's generic web skills *and* the
/// site-specific skill bundle.
enum SiteRegistry {
    struct Match {
        let environmentId: String
        let sourceName: String
    }

    private struct RegistryFile: Decodable {
        let sites: [Site]?
        struct Site: Decodable {
            let id: String
            let environmentId: String?
            let sourceName: String?
            let hostSuffixes: [String]?
            let hostsExact: [String]?
        }
    }

    /// Resolve `url` to a known site environment, or nil. Only returns a match
    /// whose skill bundle exists on disk (`environment-repository/<kind>/<path>`),
    /// mirroring the app provider's disk check so we never raise an empty offer.
    static func match(url: String, repoRoot: URL) -> Match? {
        guard let host = URLComponents(string: url)?.host?.lowercased() else {
            return nil
        }
        let registryURL = repoRoot.appending(path: "agent-station-chrome-extension/site-registry.json")
        guard let data = try? Data(contentsOf: registryURL),
              let file = try? JSONDecoder().decode(RegistryFile.self, from: data),
              let sites = file.sites else {
            return nil
        }
        for site in sites {
            let exact = site.hostsExact?.contains { $0.lowercased() == host } ?? false
            let suffix = site.hostSuffixes?.contains { host.hasSuffix($0.lowercased()) } ?? false
            guard exact || suffix else {
                continue
            }
            let environmentId = site.environmentId ?? "web:\(site.id)"
            let parts = environmentId.split(separator: ":", maxSplits: 1).map(String.init)
            guard parts.count == 2 else {
                continue
            }
            let dir = repoRoot.appending(path: "environment-repository/\(parts[0])/\(parts[1])")
            guard FileManager.default.fileExists(atPath: dir.path) else {
                continue
            }
            return Match(environmentId: environmentId, sourceName: site.sourceName ?? site.id)
        }
        return nil
    }
}
