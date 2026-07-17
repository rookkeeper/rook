// Runnable check for RookViewModel's reducer (handleSocketEvent) and send()'s
// queue-vs-deliver decision, ported from clients/iphone/Sources/RookModel.swift. Drives
// handleSocketEvent directly with synthetic AcpClientEvents — no real socket/network, no
// dispatcher needed since the reducer is a plain synchronous function.
//
// ponytail: the full "queue while disconnected, drain on reconnect" round-trip needs a
// fake AcpSocket to flip isConnected to true, which AcpSocket doesn't support (it's not
// `open`). Only the "queues instead of delivering while disconnected" half is covered
// here; the drain half is covered by the plan's manual verification step (toggle airplane
// mode against a real server).
package com.rookery.rook

import com.rookery.rook.model.AcpClientEvent
import com.rookery.rook.model.AgentSessionSummary
import com.rookery.rook.model.ChatBlockKind
import com.rookery.rook.model.EnvironmentOffer
import com.rookery.rook.model.ToolBlockStatus
import com.rookery.rook.net.RookApi
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class RookViewModelReduceTest {

    @Test
    fun agentMessageChunksMergeThenFinalizeStopsStreaming() {
        val viewModel = RookViewModel()

        viewModel.handleSocketEvent(AcpClientEvent.AgentMessageChunk("a"))
        viewModel.handleSocketEvent(AcpClientEvent.AgentMessageChunk("b"))

        val merged = viewModel.blocks.value.single().kind as ChatBlockKind.AssistantText
        assertEquals("ab", merged.text)
        assertTrue(merged.streaming)

        viewModel.handleSocketEvent(AcpClientEvent.RunCompleted("end_turn"))

        val finalized = viewModel.blocks.value.single().kind as ChatBlockKind.AssistantText
        assertEquals("ab", finalized.text)
        assertTrue(!finalized.streaming)
    }

    @Test
    fun runCompletedWithNoContentShowsErrorInsteadOfSilentSuccess() {
        // Mirrors a real upstream failure (e.g. a provider billing rejection): the server
        // reports a normal end_turn with zero content instead of RunFailed.
        val viewModel = RookViewModel()

        viewModel.handleSocketEvent(AcpClientEvent.RunCompleted("end_turn"))

        val error = viewModel.blocks.value.single().kind as ChatBlockKind.Error
        assertEquals("run", error.source)
    }

    @Test
    fun runCompletedWithContentStaysSilent() {
        val viewModel = RookViewModel()

        viewModel.handleSocketEvent(AcpClientEvent.AgentMessageChunk("hi"))
        viewModel.handleSocketEvent(AcpClientEvent.RunCompleted("end_turn"))

        assertTrue(viewModel.blocks.value.none { it.kind is ChatBlockKind.Error })
    }

    @Test
    fun toolCallUpdateForUnknownIdSynthesizesFallbackBlock() {
        val viewModel = RookViewModel()

        viewModel.handleSocketEvent(AcpClientEvent.ToolCallUpdate("t1", "completed", null, "result"))

        val tool = viewModel.blocks.value.single().kind as ChatBlockKind.Tool
        assertEquals("Tool", tool.state.title)
        assertEquals(ToolBlockStatus.COMPLETED, tool.state.status)
        assertEquals("result", tool.state.output)
    }

    @Test
    fun toolCallUpdateForKnownIdMutatesInPlace() {
        val viewModel = RookViewModel()

        viewModel.handleSocketEvent(
            AcpClientEvent.ToolCallStarted("t1", "Read file", "read", "pending", null)
        )
        viewModel.handleSocketEvent(AcpClientEvent.ToolCallUpdate("t1", "completed", null, "done"))

        assertEquals(1, viewModel.blocks.value.size)
        val tool = viewModel.blocks.value.single().kind as ChatBlockKind.Tool
        assertEquals(ToolBlockStatus.COMPLETED, tool.state.status)
        assertEquals("done", tool.state.output)
    }

    @Test
    fun repeatedIdenticalErrorsAreDeduped() {
        val viewModel = RookViewModel()

        viewModel.handleSocketEvent(AcpClientEvent.ProtocolError("boom"))
        viewModel.handleSocketEvent(AcpClientEvent.ProtocolError("boom"))

        assertEquals(1, viewModel.blocks.value.size)

        viewModel.handleSocketEvent(AcpClientEvent.ConnectionError("different"))

        assertEquals(2, viewModel.blocks.value.size)
    }

    @Test
    fun sendWhileDisconnectedQueuesInsteadOfDelivering() {
        // Unreachable port so send()'s scheduleReconnect(0) health-check fails fast and
        // deterministically, regardless of any real dev server running on 3000. A private
        // TestScope (own virtual scheduler, never advanced) keeps the resulting reconnect
        // retry loop from spinning on real wall-clock delays in the background.
        val viewModel = RookViewModel(
            api = RookApi(baseUrl = "http://127.0.0.1:1"),
            scope = TestScope(UnconfinedTestDispatcher())
        )
        val session = AgentSessionSummary(
            buildJsonObject {
                put("id", "s1")
                put("agent", "default")
            }
        )
        viewModel.setCurrentSessionForTest(session)

        viewModel.send("hi")

        assertEquals(listOf("hi"), viewModel.queuedMessages.value)
        assertTrue(viewModel.blocks.value.isEmpty())
    }

    // MARK: - Environment reducer branches (location/skills phase)

    private fun offer(envId: String, bundleId: String = "b1", hash: String = "hash1") =
        EnvironmentOffer(envId, "Store", bundleId, hash, "Store", null, emptyList(), emptyList(), emptyList())

    @Test
    fun environmentOfferedSetsPendingOfferAndIgnoresDuplicate() {
        val viewModel = RookViewModel()

        viewModel.handleSocketEvent(AcpClientEvent.EnvironmentOffered(offer("location:x", bundleId = "b1")))
        assertEquals("location:x", viewModel.pendingOffer.value?.environmentId)

        // A re-offer of the same environment id is ignored (keeps the first).
        viewModel.handleSocketEvent(AcpClientEvent.EnvironmentOffered(offer("location:x", bundleId = "b2")))
        assertEquals("b1", viewModel.pendingOffer.value?.bundleId)
    }

    @Test
    fun environmentOfferResolvedClearsOnlyOnMatchingHash() {
        val viewModel = RookViewModel()
        viewModel.handleSocketEvent(AcpClientEvent.EnvironmentOffered(offer("location:x", hash = "hash1")))

        viewModel.handleSocketEvent(AcpClientEvent.EnvironmentOfferResolved("location:x", "wrong"))
        assertEquals("location:x", viewModel.pendingOffer.value?.environmentId)

        viewModel.handleSocketEvent(AcpClientEvent.EnvironmentOfferResolved("location:x", "hash1"))
        assertEquals(null, viewModel.pendingOffer.value)
    }

    @Test
    fun environmentEnteredAppendsBannerOnceThenDedups() {
        val viewModel = RookViewModel()

        viewModel.handleSocketEvent(AcpClientEvent.EnvironmentEntered("location:x"))
        viewModel.handleSocketEvent(AcpClientEvent.EnvironmentEntered("location:x"))

        assertEquals(1, viewModel.blocks.value.count { it.kind is ChatBlockKind.Environment })
    }

    @Test
    fun environmentExitedAppendsSystemBlockWithError() {
        val viewModel = RookViewModel()

        viewModel.handleSocketEvent(AcpClientEvent.EnvironmentExited("location:x", "boom"))

        val system = viewModel.blocks.value.last().kind as ChatBlockKind.System
        assertTrue(system.text.contains("boom"))
    }
}
