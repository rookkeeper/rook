import XCTest
@testable import Rook
import RookKit

@MainActor
final class EnvironmentOfferControllerTests: XCTestCase {
    func testHandleEnvironmentOfferedDeduplicatesByBundleHash() {
        let controller = EnvironmentOfferController()
        let offer = makeOffer(bundleHash: "hash-1")

        controller.handleEnvironmentOffered(offer)
        controller.handleEnvironmentOffered(offer)

        XCTAssertEqual(controller.pendingOffers, [offer])
    }

    func testFirstOfferRequestsOfferViewButSecondDoesNot() {
        let controller = EnvironmentOfferController()
        var wantsCount = 0
        controller.onWantsOfferView = { wantsCount += 1 }

        controller.handleEnvironmentOffered(makeOffer(bundleHash: "hash-1"))
        controller.handleEnvironmentOffered(makeOffer(bundleHash: "hash-2"))

        XCTAssertEqual(wantsCount, 1)
        XCTAssertEqual(controller.pendingOffers.map(\.bundleHash), ["hash-1", "hash-2"])
    }

    func testResolvingHeadOfferAdvancesQueueAndDismissesWhenEmpty() {
        let controller = EnvironmentOfferController()
        var dismissCount = 0
        controller.onDismissOfferView = { dismissCount += 1 }
        controller.handleEnvironmentOffered(makeOffer(bundleHash: "hash-1"))
        controller.handleEnvironmentOffered(makeOffer(bundleHash: "hash-2"))

        controller.handleEnvironmentOfferResolved(bundleHash: "hash-1")
        XCTAssertEqual(controller.pendingOffers.map(\.bundleHash), ["hash-2"])
        XCTAssertEqual(dismissCount, 0)

        controller.handleEnvironmentOfferResolved(bundleHash: "hash-2")
        XCTAssertTrue(controller.pendingOffers.isEmpty)
        XCTAssertEqual(dismissCount, 1)
    }

    func testResolvingNonHeadOfferRemovesItWithoutDismissing() {
        let controller = EnvironmentOfferController()
        var dismissCount = 0
        controller.onDismissOfferView = { dismissCount += 1 }
        controller.handleEnvironmentOffered(makeOffer(bundleHash: "hash-1"))
        controller.handleEnvironmentOffered(makeOffer(bundleHash: "hash-2"))

        controller.handleEnvironmentOfferResolved(bundleHash: "hash-2")

        XCTAssertEqual(controller.pendingOffers.map(\.bundleHash), ["hash-1"])
        XCTAssertEqual(dismissCount, 0)
    }

    func testDecideEnvironmentAcceptResolvesOfferAndAppendsSystemMessage() async {
        let controller = EnvironmentOfferController()
        var resolved: (String, String, String)?
        var messages: [String] = []
        controller.resolveOffer = { environmentId, bundleHash, decision in
            resolved = (environmentId, bundleHash, decision)
        }
        controller.appendSystemMessage = { messages.append($0) }
        controller.handleEnvironmentOffered(makeOffer(bundleHash: "hash-1"))

        controller.decideEnvironment("accept")
        await waitForCondition { resolved != nil && controller.pendingOffers.isEmpty }

        XCTAssertEqual(resolved?.0, "mac:md.obsidian")
        XCTAssertEqual(resolved?.1, "hash-1")
        XCTAssertEqual(resolved?.2, "accept")
        XCTAssertEqual(messages, ["Bundle default allowed for mac:md.obsidian."])
    }

    func testDecideEnvironmentRejectResolvesOfferWithoutSystemMessage() async {
        let controller = EnvironmentOfferController()
        var resolved: (String, String, String)?
        var messages: [String] = []
        controller.resolveOffer = { environmentId, bundleHash, decision in
            resolved = (environmentId, bundleHash, decision)
        }
        controller.appendSystemMessage = { messages.append($0) }
        controller.handleEnvironmentOffered(makeOffer(bundleHash: "hash-1"))

        controller.decideEnvironment("reject")
        await waitForCondition { resolved != nil && controller.pendingOffers.isEmpty }

        XCTAssertEqual(resolved?.2, "reject")
        XCTAssertEqual(messages, [])
    }

    func testClearOfferViewStateResetsTransientState() {
        let controller = EnvironmentOfferController()
        controller.handleEnvironmentOffered(makeOffer(bundleHash: "hash-1"))
        controller.setOfferSection("agents-md", expanded: false)

        controller.clearOfferViewState()

        XCTAssertEqual(controller.offerBundles, [])
        XCTAssertFalse(controller.offerLoading)
        XCTAssertEqual(controller.offerError, "")
        XCTAssertEqual(controller.offerPreviewError, "")
        XCTAssertEqual(controller.offerSectionExpansion, [:])
    }

    func testFirstOfferLoadsPreviewAndMatchesBundleByHash() async {
        let controller = EnvironmentOfferController()
        var requested: [String] = []
        controller.loadPreview = { environmentId in
            requested.append(environmentId)
            return EnvironmentPreview(environmentId: environmentId, bundles: [
                self.makeBundle(bundleId: "other", bundleHash: "hash-other"),
                self.makeBundle(bundleId: "default", bundleHash: "hash-1", agentsMd: "# Rules"),
            ])
        }

        controller.handleEnvironmentOffered(makeOffer(bundleHash: "hash-1"))
        XCTAssertTrue(controller.offerLoading)
        await waitForCondition { !controller.offerLoading }

        XCTAssertEqual(requested, ["mac:md.obsidian"])
        XCTAssertEqual(controller.offerBundles.count, 2)
        XCTAssertEqual(controller.offerPreviewBundle?.bundleHash, "hash-1")
        XCTAssertEqual(controller.offerPreviewBundle?.agentsMd, "# Rules")
        XCTAssertEqual(controller.offerPreviewError, "")
    }

    func testPreviewFallsBackToBundleIdWhenHashDoesNotMatch() async {
        let controller = EnvironmentOfferController()
        controller.loadPreview = { environmentId in
            EnvironmentPreview(environmentId: environmentId, bundles: [
                self.makeBundle(bundleId: "default", bundleHash: "hash-newer"),
            ])
        }

        controller.handleEnvironmentOffered(makeOffer(bundleHash: "hash-1"))
        await waitForCondition { !controller.offerLoading }

        XCTAssertEqual(controller.offerPreviewBundle?.bundleHash, "hash-newer")
    }

    func testPreviewFailureRecordsErrorAndReloadRetries() async {
        let controller = EnvironmentOfferController()
        var attempts = 0
        controller.loadPreview = { environmentId in
            attempts += 1
            if attempts == 1 { throw URLError(.notConnectedToInternet) }
            return EnvironmentPreview(environmentId: environmentId, bundles: [
                self.makeBundle(bundleId: "default", bundleHash: "hash-1"),
            ])
        }

        controller.handleEnvironmentOffered(makeOffer(bundleHash: "hash-1"))
        await waitForCondition { !controller.offerLoading }
        XCTAssertFalse(controller.offerPreviewError.isEmpty)
        XCTAssertNil(controller.offerPreviewBundle)

        controller.reloadOfferPreview()
        XCTAssertEqual(controller.offerPreviewError, "")
        await waitForCondition { !controller.offerLoading }

        XCTAssertEqual(attempts, 2)
        XCTAssertEqual(controller.offerPreviewBundle?.bundleHash, "hash-1")
    }

    func testResolvingHeadOfferLoadsPreviewForNextOffer() async {
        let controller = EnvironmentOfferController()
        var requested: [String] = []
        controller.loadPreview = { environmentId in
            requested.append(environmentId)
            return EnvironmentPreview(environmentId: environmentId, bundles: [])
        }
        controller.handleEnvironmentOffered(makeOffer(bundleHash: "hash-1"))
        controller.handleEnvironmentOffered(makeOffer(bundleHash: "hash-2"))
        await waitForCondition { !controller.offerLoading }

        controller.handleEnvironmentOfferResolved(bundleHash: "hash-1")
        await waitForCondition { !controller.offerLoading }

        XCTAssertEqual(requested.count, 2)
        XCTAssertNil(controller.offerPreviewBundle)
    }

    func testEnsureOfferPreviewLoadedOnlyLoadsWhenEmpty() async {
        let controller = EnvironmentOfferController()
        var attempts = 0
        controller.loadPreview = { environmentId in
            attempts += 1
            return EnvironmentPreview(environmentId: environmentId, bundles: [
                self.makeBundle(bundleId: "default", bundleHash: "hash-1"),
            ])
        }
        controller.handleEnvironmentOffered(makeOffer(bundleHash: "hash-1"))
        await waitForCondition { !controller.offerLoading }

        controller.ensureOfferPreviewLoaded()
        XCTAssertEqual(attempts, 1)

        controller.clearOfferViewState()
        controller.ensureOfferPreviewLoaded()
        await waitForCondition { !controller.offerLoading }
        XCTAssertEqual(attempts, 2)
        XCTAssertEqual(controller.offerPreviewBundle?.bundleHash, "hash-1")
    }

    func testStalePreviewResponseIsIgnoredAfterQueueAdvances() async {
        let controller = EnvironmentOfferController()
        var pending: [CheckedContinuation<EnvironmentPreview, Error>] = []
        controller.loadPreview = { _ in
            try await withCheckedThrowingContinuation { pending.append($0) }
        }
        controller.handleEnvironmentOffered(makeOffer(bundleHash: "hash-1"))
        controller.handleEnvironmentOffered(makeOffer(bundleHash: "hash-2"))
        await waitForCondition { pending.count == 1 }
        XCTAssertTrue(controller.offerLoading)

        // hash-1 resolves while its preview is still in flight; hash-2 becomes
        // the head offer and starts its own load.
        controller.handleEnvironmentOfferResolved(bundleHash: "hash-1")
        await waitForCondition { pending.count == 2 }
        XCTAssertEqual(controller.pendingOffer?.bundleHash, "hash-2")
        XCTAssertTrue(controller.offerLoading)

        // The stale hash-1 response lands: it must not populate the view.
        let staleBundle = makeBundle(bundleId: "default", bundleHash: "hash-1", agentsMd: "# Stale")
        pending[0].resume(returning: EnvironmentPreview(environmentId: "mac:md.obsidian", bundles: [staleBundle]))
        await settle()
        XCTAssertEqual(controller.offerBundles, [])
        XCTAssertTrue(controller.offerLoading)

        let freshBundle = makeBundle(bundleId: "default", bundleHash: "hash-2", agentsMd: "# Fresh")
        pending[1].resume(returning: EnvironmentPreview(environmentId: "mac:md.obsidian", bundles: [freshBundle]))
        await waitForCondition { !controller.offerLoading }
        XCTAssertEqual(controller.offerBundles, [freshBundle])
        XCTAssertEqual(controller.offerPreviewBundle?.agentsMd, "# Fresh")
    }

    func testPreviewCompletingAfterDismissLeavesStateCleared() async {
        let controller = EnvironmentOfferController()
        var pending: [CheckedContinuation<EnvironmentPreview, Error>] = []
        controller.loadPreview = { _ in
            try await withCheckedThrowingContinuation { pending.append($0) }
        }
        controller.handleEnvironmentOffered(makeOffer(bundleHash: "hash-1"))
        await waitForCondition { pending.count == 1 }
        XCTAssertTrue(controller.offerLoading)

        controller.clearOfferViewState()
        XCTAssertFalse(controller.offerLoading)

        // The offer is still pending (dismiss only hides the view), so only the
        // cancelled task keeps this late response out of the cleared state.
        let bundle = makeBundle(bundleId: "default", bundleHash: "hash-1", agentsMd: "# Late")
        pending[0].resume(returning: EnvironmentPreview(environmentId: "mac:md.obsidian", bundles: [bundle]))
        await settle()
        XCTAssertEqual(controller.pendingOffer?.bundleHash, "hash-1")
        XCTAssertEqual(controller.offerBundles, [])
        XCTAssertFalse(controller.offerLoading)
        XCTAssertEqual(controller.offerPreviewError, "")
    }

    private func makeBundle(bundleId: String, bundleHash: String, agentsMd: String? = nil) -> EnvironmentBundlePreview {
        EnvironmentBundlePreview(
            id: "mac:md.obsidian#\(bundleId)",
            bundleId: bundleId,
            environmentId: "mac:md.obsidian",
            repository: "official",
            valid: true,
            bundleHash: bundleHash,
            skills: [],
            mcpServers: [],
            apps: [],
            errors: [],
            agentsMd: agentsMd
        )
    }

    private func makeOffer(bundleHash: String) -> EnvironmentOffer {
        EnvironmentOffer(
            environmentId: "mac:md.obsidian",
            displayName: "Obsidian",
            bundleId: "default",
            bundleHash: bundleHash,
            skills: [],
            mcpServers: [],
            apps: []
        )
    }

    /// Gives already-resumed tasks on the main actor a chance to run.
    private func settle() async {
        for _ in 0..<20 { await Task.yield() }
    }

    private func waitForCondition(
        timeoutNanoseconds: UInt64 = 1_000_000_000,
        condition: @escaping @MainActor () -> Bool
    ) async {
        let start = ContinuousClock.now
        while !condition() {
            if ContinuousClock.now - start > .nanoseconds(Int64(timeoutNanoseconds)) {
                XCTFail("Timed out waiting for condition")
                return
            }
            await Task.yield()
        }
    }
}
