import XCTest
@testable import RookKit

final class ApiTypesTests: XCTestCase {
    // MARK: - AgentDefinition

    func testAgentDefinitionCodableRoundTrip() throws {
        let def = AgentDefinition(id: "agent-1", parentId: "parent-1")
        let data = try JSONEncoder().encode(def)
        let decoded = try JSONDecoder().decode(AgentDefinition.self, from: data)
        XCTAssertEqual(decoded.id, "agent-1")
        XCTAssertEqual(decoded.parentId, "parent-1")
    }

    func testAgentDefinitionWithoutParent() throws {
        let def = AgentDefinition(id: "agent-2", parentId: nil)
        let data = try JSONEncoder().encode(def)
        let decoded = try JSONDecoder().decode(AgentDefinition.self, from: data)
        XCTAssertEqual(decoded.id, "agent-2")
        XCTAssertNil(decoded.parentId)
    }

    // MARK: - AgentSessionSummary

    func testAgentSessionSummaryBasicFields() {
        let raw = JSONValue.object([
            "sessionId": .string("session-1"),
            "runtimeId": .string("MockAgent"),
            "title": .string("my-session"),
            "running": .bool(true),
            "connectedClients": .number(2)
        ])
        let summary = AgentSessionSummary(raw: raw)
        XCTAssertEqual(summary.id, "session-1")
        XCTAssertEqual(summary.agent, "MockAgent")
        XCTAssertEqual(summary.name, "my-session")
        XCTAssertTrue(summary.running)
        XCTAssertEqual(summary.connectedClients, 2)
        XCTAssertFalse(summary.pinned)
    }

    func testAgentSessionSummaryReadsPinnedMetadata() {
        let summary = AgentSessionSummary(raw: .object([
            "pinned": .bool(true),
            "pinnedOrder": .number(3)
        ]))
        XCTAssertTrue(summary.pinned)
        XCTAssertEqual(summary.pinnedOrder, 3)
    }

    func testAgentSessionSummaryActivityStatusUsesServerValue() {
        for (rawValue, expected) in [("active", SessionSelectionStatus.active), ("ready", .ready), ("error", .error), ("on", .on), ("off", .off)] {
            let summary = AgentSessionSummary(raw: .object(["activityStatus": .string(rawValue)]))
            XCTAssertEqual(summary.activityStatus, expected)
            XCTAssertEqual(summary.activityStatus.label, rawValue.capitalized)
        }
    }

    func testAgentSessionSummaryFieldsAreCanonical() {
        let raw = JSONValue.object([
            "sessionId": .string("s2"),
            "runtimeId": .string("PiAgent"),
            "title": .string("untitled"),
            "startedAt": .string("2026-01-15T10:30:00Z")
        ])
        let summary = AgentSessionSummary(raw: raw)
        XCTAssertEqual(summary.id, "s2")
        XCTAssertEqual(summary.agent, "PiAgent")
        XCTAssertEqual(summary.name, "untitled")
        XCTAssertNotNil(summary.createdAt)
        XCTAssertEqual(summary.startedAtISO, "2026-01-15T10:30:00Z")
    }

    func testAgentSessionSummaryCreatedAtIso() {
        let raw = JSONValue.object([
            "sessionId": .string("s1"),
            "startedAt": .string("2026-01-15T10:30:00Z")
        ])
        let summary = AgentSessionSummary(raw: raw)
        XCTAssertNotNil(summary.createdAt)
        XCTAssertEqual(summary.startedAtISO, "2026-01-15T10:30:00Z")
    }

    func testAgentSessionSummaryUpdatedAtIso() {
        let raw = JSONValue.object([
            "sessionId": .string("s1"),
            "updatedAt": .string("2026-01-15T11:00:00Z")
        ])
        let summary = AgentSessionSummary(raw: raw)
        XCTAssertEqual(summary.updatedAtISO, "2026-01-15T11:00:00Z")
    }

    func testAgentSessionSummaryUpdatingUsesCanonicalFields() {
        let raw = JSONValue.object([
            "sessionId": .string("s1"),
            "runtimeId": .string("PiAgent"),
            "title": .string("before"),
            "updatedAt": .string("2026-01-15T11:00:00Z"),
            "running": .bool(false)
        ])
        let summary = AgentSessionSummary(raw: raw).updating(title: "after", updatedAtISO: "2026-01-15T12:00:00Z", running: true)
        XCTAssertEqual(summary.name, "after")
        XCTAssertEqual(summary.updatedAtISO, "2026-01-15T12:00:00Z")
        XCTAssertEqual(summary.running, true)
        XCTAssertNil(summary.raw["extra"])
        XCTAssertEqual(summary.raw["runtimeId"]?.stringValue, "PiAgent")
    }

    // MARK: - EnvironmentCandidate Codable

    func testEnvironmentCandidateRoundTrip() throws {
        let candidate = EnvironmentCandidate(
            environmentId: "loc:starbucks",
            displayName: "Starbucks",
            operator_: "SBUX",
            storeNumber: "1234",
            address: "123 Main St",
            latitude: 36.0,
            longitude: -86.0,
            website: "https://starbucks.com",
            distanceMeters: 50.0,
            confidence: 0.95,
            matchReasons: ["nearby"],
            hasKnownEnvironment: true,
            possibleSkills: ["order-coffee"]
        )
        let data = try JSONEncoder().encode(candidate)
        let decoded = try JSONDecoder().decode(EnvironmentCandidate.self, from: data)
        XCTAssertEqual(decoded.environmentId, "loc:starbucks")
        XCTAssertEqual(decoded.displayName, "Starbucks")
        XCTAssertEqual(decoded.operator_, "SBUX")
        XCTAssertEqual(decoded.confidence, 0.95)
        XCTAssertEqual(decoded.matchReasons, ["nearby"])
    }

    // MARK: - RepositoryReadError

    func testRepositoryReadErrorIdentifiable() {
        let err = RepositoryReadError(
            code: "E001",
            message: "not found",
            repository: "official",
            environmentId: "loc:test",
            bundleId: "b1",
            path: "/skills/test"
        )
        let decoded = try! JSONDecoder().decode(RepositoryReadError.self, from: try! JSONEncoder().encode(err))
        XCTAssertEqual(decoded.code, "E001")
    }

    // MARK: - EnvironmentArtifactPreview

    func testEnvironmentArtifactPreviewSortedPaths() {
        let preview = EnvironmentArtifactPreview(id: "a1", files: ["z.md": "z", "a.md": "a", "m.md": "m"])
        XCTAssertEqual(preview.sortedFilePaths, ["a.md", "m.md", "z.md"])
    }

    // MARK: - EnvironmentBundlePreview

    func testEnvironmentBundlePreviewAllArtifacts() {
        let skills = [EnvironmentArtifactPreview(id: "s1", files: [:])]
        let mcp = [EnvironmentArtifactPreview(id: "m1", files: [:])]
        let apps = [EnvironmentArtifactPreview(id: "a1", files: [:])]
        let bundle = EnvironmentBundlePreview(
            id: "b1", bundleId: "test-bundle", environmentId: "loc:test",
            repository: "official", valid: true, bundleHash: "abc123",
            skills: skills, mcpServers: mcp, apps: apps, errors: []
        )
        XCTAssertEqual(bundle.allArtifacts.count, 3)
    }

    func testEnvironmentBundlePreviewConvenienceAccessors() {
        let skills = [
            EnvironmentArtifactPreview(id: "s1", files: ["README.md": "hello", "SKILL.md": "world"])
        ]
        let bundle = EnvironmentBundlePreview(
            id: "b1", bundleId: "test-bundle", environmentId: "loc:test",
            repository: "official", valid: true, bundleHash: "abc123",
            skills: skills, mcpServers: [], apps: [], errors: []
        )
        XCTAssertEqual(bundle.allFilePaths, ["README.md", "SKILL.md"])
        XCTAssertEqual(bundle.content(for: "README.md"), "hello")
        XCTAssertNil(bundle.content(for: "nonexistent"))
    }

    func testEnvironmentPreviewDecodesWebBundleContent() throws {
        let json = """
        {
          "environmentId": "web:example.com",
          "bundles": [
            {
              "id": "web:example.com#site",
              "bundleId": "site",
              "environmentId": "web:example.com",
              "repository": "web",
              "valid": true,
              "bundleHash": "hash-1",
              "skills": [
                {
                  "id": "deploy",
                  "files": { "deploy/SKILL.md": "# Deploy\\nRun the deploy." },
                  "sourceUrl": "https://example.com/skills/deploy/SKILL.md"
                }
              ],
              "mcpServers": [],
              "apps": [],
              "facts": [],
              "llmsTxt": "# Example\\nllms",
              "agentsMd": "# Agents\\nBe careful.",
              "errors": [
                {
                  "code": "unreachable_url",
                  "message": "digest mismatch",
                  "repository": "web",
                  "environmentId": "web:example.com",
                  "bundleId": "site",
                  "url": "https://example.com/skills/broken/SKILL.md"
                }
              ]
            }
          ]
        }
        """
        let preview = try JSONDecoder().decode(EnvironmentPreview.self, from: Data(json.utf8))
        let bundle = try XCTUnwrap(preview.bundles.first)
        XCTAssertEqual(bundle.agentsMd, "# Agents\nBe careful.")
        XCTAssertEqual(bundle.llmsTxt, "# Example\nllms")
        XCTAssertEqual(bundle.skillMarkdown.map(\.id), ["deploy"])
        XCTAssertEqual(bundle.skillMarkdown.first?.content, "# Deploy\nRun the deploy.")
        let error = try XCTUnwrap(bundle.errors.first)
        XCTAssertEqual(error.code, "unreachable_url")
        XCTAssertEqual(error.url, "https://example.com/skills/broken/SKILL.md")
        XCTAssertNil(error.path)
        XCTAssertTrue(error.id.contains("https://example.com/skills/broken/SKILL.md"))
    }

    func testEnvironmentPreviewDecodesWithoutOptionalContentFields() throws {
        let json = """
        {
          "environmentId": "dir:/tmp/project",
          "bundles": [
            {
              "id": "dir:/tmp/project#default",
              "bundleId": "default",
              "environmentId": "dir:/tmp/project",
              "repository": "project-directory",
              "valid": true,
              "bundleHash": "hash-2",
              "skills": [
                { "id": "notes", "files": { "SKILL.md": "bare skill", "README.md": "readme" } },
                { "id": "empty", "files": {} }
              ],
              "mcpServers": [],
              "apps": [],
              "facts": [],
              "errors": [
                {
                  "code": "invalid_skill",
                  "message": "missing SKILL.md",
                  "repository": "project-directory",
                  "environmentId": "dir:/tmp/project",
                  "path": "/tmp/project/.agents/skills/bad"
                }
              ]
            }
          ]
        }
        """
        let preview = try JSONDecoder().decode(EnvironmentPreview.self, from: Data(json.utf8))
        let bundle = try XCTUnwrap(preview.bundles.first)
        XCTAssertNil(bundle.agentsMd)
        XCTAssertNil(bundle.llmsTxt)
        XCTAssertEqual(bundle.skillMarkdown.map(\.id), ["notes"])
        XCTAssertEqual(bundle.skillMarkdown.first?.content, "bare skill")
        XCTAssertNil(bundle.errors.first?.url)
        XCTAssertNil(bundle.errors.first?.bundleId)
        XCTAssertEqual(bundle.errors.first?.path, "/tmp/project/.agents/skills/bad")
    }

    func testArtifactPrimaryMarkdownFallsBackToFirstMarkdownFile() {
        let artifact = EnvironmentArtifactPreview(id: "s1", files: ["z.txt": "text", "notes.md": "notes", "guide.md": "guide"])
        XCTAssertEqual(artifact.primaryMarkdown, "guide")
        XCTAssertNil(EnvironmentArtifactPreview(id: "s2", files: ["a.txt": "x"]).primaryMarkdown)
    }

    // MARK: - IdentifyAvailableRequest

    func testIdentifyAvailableRequestEncodable() throws {
        let req = IdentifyAvailableRequest(
            latitude: 36.0, longitude: -86.0,
            horizontalAccuracy: 10.0,
            source: "gps",
            dwellSeconds: 300,
            isStationary: true,
            speedMetersPerSecond: 0.5,
            observedAt: "2026-01-15T10:00:00Z"
        )
        let data = try JSONEncoder().encode(req)
        let dict = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertEqual(dict["latitude"] as! Double, 36.0)
        XCTAssertEqual(dict["source"] as! String, "gps")
        XCTAssertEqual(dict["dwellSeconds"] as! Double, 300)
        XCTAssertEqual(dict["isStationary"] as! Bool, true)
    }

    // MARK: - EnvironmentOffer

    func testEnvironmentOfferBasic() {
        let offer = EnvironmentOffer(
            environmentId: "loc:test",
            displayName: "Test Place",
            bundleId: "bundle-1",
            bundleHash: "hash",
            skills: ["s1", "s2"],
            mcpServers: ["m1"],
            apps: ["a1"]
        )
        XCTAssertEqual(offer.environmentId, "loc:test")
        XCTAssertEqual(offer.skills, ["s1", "s2"])
        XCTAssertEqual(offer.mcpServers, ["m1"])
    }
}
