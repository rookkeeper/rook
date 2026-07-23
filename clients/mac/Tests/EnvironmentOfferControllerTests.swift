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

        controller.clearOfferViewState()

        XCTAssertEqual(controller.offerBundles, [])
        XCTAssertFalse(controller.offerLoading)
        XCTAssertEqual(controller.offerError, "")
    }

    private func makeOffer(bundleHash: String) -> EnvironmentOffer {
        EnvironmentOffer(
            environmentId: "mac:md.obsidian",
            displayName: "Obsidian",
            bundleId: "default",
            bundleHash: bundleHash,
            sourceName: "Obsidian",
            canonicalSourceUrl: nil,
            skills: [],
            mcpServers: [],
            apps: []
        )
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
