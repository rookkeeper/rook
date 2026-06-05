import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEvent } from "../../shared/realtime";
import { ChatPanel } from "./ChatPanel";

const remoteAgentMock = vi.hoisted(() => {
  const defaultRunImplementation = async (message: string) => {
    remoteAgentMock.lastOnSessionEvent?.({ type: "user_message", text: message, queued: false });
    remoteAgentMock.lastOnSessionEvent?.({ type: "status_changed", status: "streaming", message: "Writing" });
    remoteAgentMock.lastOnSessionEvent?.({ type: "text_delta", delta: "Echo: " });
    remoteAgentMock.lastOnSessionEvent?.({ type: "text_delta", delta: message });
    remoteAgentMock.lastOnSessionEvent?.({ type: "assistant_message_completed", id: "assistant-1" });
    remoteAgentMock.lastOnSessionEvent?.({ type: "run_completed" });
  };

  return {
    lastOnSessionEvent: null as ((event: SessionEvent) => void) | null,
    defaultRunImplementation,
    runMock: vi.fn(defaultRunImplementation),
  };
});

vi.mock("../remoteAgent", () => ({
  RemoteAgent: class {
    constructor(options?: { onSessionEvent?: (event: SessionEvent) => void }) {
      remoteAgentMock.lastOnSessionEvent = options?.onSessionEvent ?? null;
    }

    connect = vi.fn(async () => undefined);
    close = vi.fn();
    run = remoteAgentMock.runMock;
  },
}));

describe("ChatPanel", () => {
  beforeEach(() => {
    remoteAgentMock.lastOnSessionEvent = null;
    remoteAgentMock.runMock.mockReset();
    remoteAgentMock.runMock.mockImplementation(remoteAgentMock.defaultRunImplementation);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("submits a message through RemoteAgent and renders the streamed response", async () => {
    render(<ChatPanel agentBackend="MockAgent" initialSession={{ id: "s1", agent: "MockAgent", createdAt: "now", restart: {} }} />);

    expect(screen.getByText("No messages yet.")).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText("Type a message..."), "Hello");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(remoteAgentMock.runMock).toHaveBeenCalledWith("Hello"));
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(screen.getByText("Echo: Hello")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });

  it("does not submit messages while disabled", async () => {
    render(<ChatPanel agentBackend="MockAgent" initialSession={{ id: "s1", agent: "MockAgent", createdAt: "now", restart: {} }} disabled />);

    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByPlaceholderText("Type a message...")).toBeDisabled();
    expect(remoteAgentMock.runMock).not.toHaveBeenCalled();
  });

  it("relays message_parent tool calls to the parent message target", async () => {
    const postMessage = vi.fn();
    remoteAgentMock.runMock.mockImplementationOnce(async () => {
      remoteAgentMock.lastOnSessionEvent?.({ type: "tool_call_started", toolCallId: "tool-1", toolName: "message_parent", rawInput: "{\"message\":" });
      remoteAgentMock.lastOnSessionEvent?.({ type: "tool_input_delta", toolCallId: "tool-1", toolName: "message_parent", delta: "{\"kind\":\"ready\"}}" });
      remoteAgentMock.lastOnSessionEvent?.({ type: "tool_call_ready", toolCallId: "tool-1", toolName: "message_parent" });
      remoteAgentMock.lastOnSessionEvent?.({ type: "tool_completed", toolCallId: "tool-1", toolName: "message_parent", output: "message sent" });
      remoteAgentMock.lastOnSessionEvent?.({ type: "run_completed" });
    });

    render(
      <ChatPanel
        agentBackend="MockAgent"
        initialSession={{ id: "s1", agent: "MockAgent", createdAt: "now", restart: {} }}
        onParentMessage={(message) => postMessage(message, "https://parent.example")}
      />,
    );

    await userEvent.type(screen.getByPlaceholderText("Type a message..."), "notify");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(postMessage).toHaveBeenCalledWith({ kind: "ready" }, "https://parent.example"));
  });

  it("rebuilds prior conversation from replayed session events", () => {
    render(
      <ChatPanel
        agentBackend="MockAgent"
        initialSession={{ id: "s1", agent: "MockAgent", createdAt: "now", restart: {} }}
        replayEvents={[
          { type: "user_message", text: "Earlier question", queued: false },
          { type: "text_delta", delta: "Earlier answer" },
          { type: "assistant_message_completed", id: "assistant-1" },
          { type: "run_completed" },
        ]}
      />,
    );

    expect(screen.getByText("Earlier question")).toBeInTheDocument();
    expect(screen.getByText("Earlier answer")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });

  it("rebuilds prior tool activity from replayed session events", () => {
    render(
      <ChatPanel
        agentBackend="MockAgent"
        initialSession={{ id: "s1", agent: "MockAgent", createdAt: "now", restart: {} }}
        replayEvents={[
          { type: "tool_call_started", toolCallId: "tool-1", toolName: "search_docs", rawInput: "{\"q\":\"agent\"}" },
          { type: "tool_completed", toolCallId: "tool-1", toolName: "search_docs", output: "Found docs" },
          { type: "run_completed" },
        ]}
      />,
    );

    expect(screen.getByText("search_docs")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });

  it("ignores replayed environment session events without breaking chat replay", () => {
    render(
      <ChatPanel
        agentBackend="MockAgent"
        initialSession={{ id: "s1", agent: "MockAgent", createdAt: "now", restart: {} }}
        replayEvents={[
          { type: "environment_event", kind: "environment_entered", payload: { environmentId: "browser" } },
          { type: "user_message", text: "Earlier question", queued: false },
          { type: "text_delta", delta: "Earlier answer" },
          { type: "run_completed" },
        ]}
      />,
    );

    expect(screen.getByText("Earlier question")).toBeInTheDocument();
    expect(screen.getByText("Earlier answer")).toBeInTheDocument();
  });

  it("notifies when an environment offer is resolved on the session websocket", async () => {
    const onEnvironmentOfferResolved = vi.fn();
    render(
      <ChatPanel
        agentBackend="MockAgent"
        initialSession={{ id: "s1", agent: "MockAgent", createdAt: "now", restart: {} }}
        onEnvironmentOfferResolved={onEnvironmentOfferResolved}
      />,
    );

    await waitFor(() => expect(remoteAgentMock.lastOnSessionEvent).not.toBeNull());

    remoteAgentMock.lastOnSessionEvent?.({
      type: "environment_event",
      kind: "environment_offer_resolved",
      payload: { environmentId: "web:wikipedia", decision: "dismissed" },
    });

    expect(onEnvironmentOfferResolved).toHaveBeenCalledWith({
      environmentId: "web:wikipedia",
      decision: "dismissed",
    });
  });

  it("notifies when an environment offer becomes available on the session websocket", async () => {
    const onEnvironmentOfferAvailable = vi.fn();
    render(
      <ChatPanel
        agentBackend="MockAgent"
        initialSession={{ id: "s1", agent: "MockAgent", createdAt: "now", restart: {} }}
        onEnvironmentOfferAvailable={onEnvironmentOfferAvailable}
      />,
    );

    await waitFor(() => expect(remoteAgentMock.lastOnSessionEvent).not.toBeNull());

    remoteAgentMock.lastOnSessionEvent?.({
      type: "environment_event",
      kind: "environment_offer_available",
      payload: { environmentId: "web:wikipedia" },
    });

    expect(onEnvironmentOfferAvailable).toHaveBeenCalledWith({ environmentId: "web:wikipedia" });
  });

  it("renders run failures as error blocks", async () => {
    remoteAgentMock.runMock.mockImplementationOnce(async (message: string) => {
      remoteAgentMock.lastOnSessionEvent?.({ type: "user_message", text: message, queued: false });
      remoteAgentMock.lastOnSessionEvent?.({ type: "run_failed", error: "Network down" });
    });
    render(<ChatPanel agentBackend="MockAgent" initialSession={{ id: "s1", agent: "MockAgent", createdAt: "now", restart: {} }} />);

    await userEvent.type(screen.getByPlaceholderText("Type a message..."), "Hello");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("run error")).toBeInTheDocument();
    expect(screen.getAllByText("Network down")).toHaveLength(2);
  });
});
