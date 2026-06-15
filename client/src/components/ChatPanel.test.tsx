import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ChatPanel } from "./ChatPanel";
import type { AgentSessionSummary } from "../lib/agent";
import type { AcpClientEvent } from "../lib/acpClientTypes";

const session: AgentSessionSummary = { id: "s1", agent: "PiAgent", createdAt: "now", restart: {} };

const remoteAgentMock = vi.hoisted(() => {
  class MockRemoteAgent {
    static instances: MockRemoteAgent[] = [];
    run = vi.fn();
    cancel = vi.fn();
    connect = vi.fn(async () => undefined);
    close = vi.fn();
    sendSteeringMessage = vi.fn(async () => undefined);
    setMode = vi.fn(async () => undefined);
    setConfigOption = vi.fn(async () => undefined);
    respondToPermissionRequest = vi.fn(async () => undefined);
    onAcpEvent?: (event: AcpClientEvent) => void;

    constructor(options: { onAcpEvent?: (event: AcpClientEvent) => void }) {
      this.onAcpEvent = options.onAcpEvent;
      MockRemoteAgent.instances.push(this);
    }

    emit(event: AcpClientEvent) {
      this.onAcpEvent?.(event);
    }
  }

  return { MockRemoteAgent };
});

vi.mock("../lib/remoteAgent", () => ({
  RemoteAgent: remoteAgentMock.MockRemoteAgent,
}));

function latestAgent() {
  const agent = remoteAgentMock.MockRemoteAgent.instances.at(-1);
  if (!agent) throw new Error("No mock remote agent instance created.");
  return agent;
}

describe("ChatPanel", () => {
  beforeEach(() => {
    remoteAgentMock.MockRemoteAgent.instances.length = 0;
  });

  it("queues a second submit while processing and send-now uses steering prompt", async () => {
    render(<ChatPanel agentBackend="PiAgent" initialSession={session} />);

    const input = screen.getByPlaceholderText("Message your agent");

    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.click(screen.getByText("Send"));

    expect(latestAgent().run).toHaveBeenCalledWith("hello");

    fireEvent.change(input, { target: { value: "follow up" } });
    fireEvent.click(screen.getByText("Send"));

    expect(await screen.findByText("Queued")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Send now"));

    await waitFor(() => expect(latestAgent().sendSteeringMessage).toHaveBeenCalledWith("follow up"));
  });

  it("shows permission prompt and sends permission responses", async () => {
    render(<ChatPanel agentBackend="PiAgent" initialSession={session} />);

    latestAgent().emit({
      type: "acp_permission_request",
      requestId: "perm-1",
      toolCall: { toolCallId: "tool-1", title: "Write file", kind: "edit", status: "pending" },
      options: [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }],
    });

    expect(await screen.findByText("Permission requested")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Allow once"));

    await waitFor(() => expect(latestAgent().respondToPermissionRequest).toHaveBeenCalledWith("perm-1", { outcome: "selected", optionId: "allow-once" }));
  });

  it("renders ACP settings and forwards mode/config changes", async () => {
    render(<ChatPanel agentBackend="PiAgent" initialSession={session} showSettings />);

    latestAgent().emit({
      type: "acp_modes_state",
      currentModeId: "chat",
      availableModes: [
        { id: "chat", name: "Chat" },
        { id: "code", name: "Code" },
      ],
    });
    latestAgent().emit({
      type: "acp_config_option_update",
      configOptions: [{
        id: "model",
        name: "Model",
        type: "select",
        currentValue: "smart",
        options: [
          { value: "smart", name: "Smart" },
          { value: "fast", name: "Fast" },
        ],
      }],
    });

    const modeSelect = await screen.findByLabelText("Mode");
    fireEvent.change(modeSelect, { target: { value: "code" } });

    const modelSelect = await screen.findByLabelText("Model");
    fireEvent.change(modelSelect, { target: { value: "fast" } });

    await waitFor(() => expect(latestAgent().setMode).toHaveBeenCalledWith("code"));
    await waitFor(() => expect(latestAgent().setConfigOption).toHaveBeenCalledWith("model", "fast"));
  });

  it("forwards environment events to callbacks", async () => {
    const onAvailable = vi.fn();
    const onResolved = vi.fn();
    render(
      <ChatPanel
        agentBackend="PiAgent"
        initialSession={session}
        onEnvironmentOfferAvailable={onAvailable}
        onEnvironmentOfferResolved={onResolved}
      />,
    );

    latestAgent().emit({
      type: "acp_environment_event",
      kind: "environment_offer_available",
      payload: { environmentId: "web:wikipedia", sourceName: "Wikipedia" },
    });
    latestAgent().emit({
      type: "acp_environment_event",
      kind: "environment_offer_resolved",
      payload: { environmentId: "web:wikipedia", decision: "approved" },
    });

    await waitFor(() => expect(onAvailable).toHaveBeenCalledWith({ environmentId: "web:wikipedia", sourceName: "Wikipedia" }));
    await waitFor(() => expect(onResolved).toHaveBeenCalledWith({ environmentId: "web:wikipedia", decision: "approved" }));
  });

  it("completes a tool lifecycle: started → in_progress → completed", async () => {
    render(<ChatPanel agentBackend="PiAgent" initialSession={session} />);

    latestAgent().emit({
      type: "acp_tool_call_started",
      toolCallId: "tool-1",
      title: "Read File",
      kind: "read",
      status: "pending",
      rawInput: JSON.stringify({ path: "README.md" }),
    });

    expect(await screen.findByText("Read File")).toBeInTheDocument();

    latestAgent().emit({
      type: "acp_tool_call_update",
      toolCallId: "tool-1",
      status: "in_progress",
    });
    latestAgent().emit({
      type: "acp_tool_call_update",
      toolCallId: "tool-1",
      status: "completed",
      toolName: "Read File",
      output: "# Title",
    });

    await waitFor(() => expect(screen.getByText("Completed")).toBeInTheDocument());
  });

  it("shows plan entries and usage updates in status line", async () => {
    render(<ChatPanel agentBackend="PiAgent" initialSession={session} />);

    latestAgent().emit({
      type: "acp_plan_update",
      entries: [{ content: "Read file", priority: "high", status: "in_progress" }],
    });
    latestAgent().emit({
      type: "acp_usage_update",
      used: 150,
      size: 1000,
    });

    expect(await screen.findByText("Read file")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/150 .+ 1,000 tokens/)).toBeInTheDocument());
  });

  it("shows an error block on connection failure", async () => {
    render(<ChatPanel agentBackend="PiAgent" initialSession={session} />);

    latestAgent().emit({
      type: "acp_connection_error",
      error: "Socket closed unexpectedly",
    });

    expect(await screen.findAllByText("Socket closed unexpectedly")).toHaveLength(2);
  });
});
