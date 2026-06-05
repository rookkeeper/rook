import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { AgentSessionSummary } from "./agent";
import type { EnvironmentPreview } from "../shared/environment";

const remoteAgentMock = vi.hoisted(() => ({
  startMock: vi.fn(async (options?: { backend?: string; session?: AgentSessionSummary; sessionName?: string; restartExisting?: boolean; includeReplayEvents?: boolean }) => ({
    ok: true,
    agent: options?.backend ?? "MockAgent",
    session: options?.session ?? { id: "s-start", agent: options?.backend ?? "MockAgent", name: options?.sessionName ?? "default", createdAt: "now", restart: {} },
    replayEvents: options?.restartExisting ? [{ type: "run_completed" }] : undefined,
  })),
  fetchEnvironmentPreviewMock: vi.fn(async (): Promise<EnvironmentPreview> => ({
    environmentId: "web:wikipedia",
    skills: [{ id: "demo", name: "demo", files: { "demo/SKILL.md": "# Title\n\nbody", "demo/refs/note.md": "note" } }],
  })),
  decideEnvironmentMock: vi.fn(async () => undefined),
  fetchAgentDefinitionsMock: vi.fn(async () => [
    { id: "MockAgent", parentId: null },
    { id: "PiAgent", parentId: null },
    { id: "MyPiAgent", parentId: "PiAgent" },
  ]),
  fetchAgentSessionsMock: vi.fn(async () => [
    { id: "s1", agent: "MyPiAgent", name: "Planning", createdAt: "2026-01-01T00:00:00.000Z", restart: { sessionId: "abc" } },
  ]),
  fetchMostRecentSessionMock: vi.fn(async () => null),
}));

vi.mock("./remoteAgent", () => ({
  fetchAgentDefinitions: remoteAgentMock.fetchAgentDefinitionsMock,
  fetchAgentSessions: remoteAgentMock.fetchAgentSessionsMock,
  fetchMostRecentSession: remoteAgentMock.fetchMostRecentSessionMock,
  fetchEnvironmentPreview: remoteAgentMock.fetchEnvironmentPreviewMock,
  decideEnvironment: remoteAgentMock.decideEnvironmentMock,
  RemoteAgent: class {
    constructor(private options: { backend?: string; session?: AgentSessionSummary; sessionName?: string; restartExisting?: boolean; includeReplayEvents?: boolean }) {}

    start() {
      return remoteAgentMock.startMock(this.options);
    }
  },
}));

let chatPanelMountCount = 0;
// Captures the latest ChatPanel props so tests can drive the websocket-pushed
// environment offer/resolution hooks the App passes down.
type ChatPanelTestProps = {
  agentBackend: string;
  replayEvents?: unknown[];
  onEnvironmentOfferAvailable?: (payload: { environmentId: string; sourceName?: string }) => void;
  onEnvironmentOfferResolved?: (payload: { environmentId: string; decision: string }) => void;
};
const chatPanel = vi.hoisted(() => ({ props: null as null | ChatPanelTestProps }));

vi.mock("./components/ChatPanel", () => ({
  ChatPanel: (props: ChatPanelTestProps) => {
    chatPanel.props = props;
    const mountId = useRef(++chatPanelMountCount);
    return (
      <div>
        <div>Chat for {props.agentBackend}</div>
        <div>Chat mount {mountId.current}</div>
        <div>Replay count {props.replayEvents?.length ?? 0}</div>
        <button type="button">Mock send</button>
      </div>
    );
  },
}));

async function startNewAgent(agentName: string, sessionName = "default") {
  const row = (await screen.findByText(agentName)).closest(".cwa-agent-row");
  await userEvent.click(row!.querySelector("button")!);
  const input = await screen.findByLabelText("Session name");
  if (sessionName !== "default") {
    await userEvent.clear(input);
    await userEvent.type(input, sessionName);
  }
  await userEvent.click(screen.getByRole("button", { name: "Create agent" }));
}

describe("App", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    chatPanelMountCount = 0;
    remoteAgentMock.startMock.mockClear();
    remoteAgentMock.fetchAgentDefinitionsMock.mockClear();
    remoteAgentMock.fetchAgentSessionsMock.mockClear();
    remoteAgentMock.fetchMostRecentSessionMock.mockClear();
    remoteAgentMock.fetchEnvironmentPreviewMock.mockClear();
    remoteAgentMock.decideEnvironmentMock.mockClear();
    chatPanel.props = null;
  });

  it("auto-opens the most recent saved session on startup", async () => {
    remoteAgentMock.fetchMostRecentSessionMock.mockResolvedValueOnce({
      id: "s-recent",
      agent: "MyPiAgent",
      name: "Recent",
      createdAt: "2026-01-02T00:00:00.000Z",
      restart: { sessionId: "resume-me" },
    } as never);

    render(<App />);

    await waitFor(() => expect(remoteAgentMock.startMock).toHaveBeenCalledWith(expect.objectContaining({
      backend: "MyPiAgent",
      session: expect.objectContaining({ id: "s-recent" }),
    })));
    expect(await screen.findByText("Chat for MyPiAgent")).toBeInTheDocument();
    expect(screen.getByText("MyPiAgent · Recent")).toBeInTheDocument();
    expect(screen.getByText("Chat mount 1")).toBeInTheDocument();
    expect(screen.getByText("Replay count 0")).toBeInTheDocument();
  });

  it("shows nested agent choices before chat starts", async () => {
    render(<App />);

    expect(await screen.findByText("MockAgent")).toBeInTheDocument();
    expect(screen.getByText("PiAgent")).toBeInTheDocument();
    expect(screen.getByText("MyPiAgent")).toBeInTheDocument();
    expect(screen.getByText("Choose agent")).toBeInTheDocument();
  });

  it("asks for a session name before starting a new selected agent", async () => {
    render(<App />);

    await startNewAgent("MockAgent", "Planning");

    await waitFor(() => expect(remoteAgentMock.startMock).toHaveBeenCalledWith(expect.objectContaining({ sessionName: "Planning" })));
    expect(await screen.findByText("Chat for MockAgent")).toBeInTheDocument();
    expect(screen.getByText("MockAgent · Planning")).toBeInTheDocument();
  });

  it("uses the default session name when creating with return", async () => {
    render(<App />);

    const row = (await screen.findByText("MockAgent")).closest(".cwa-agent-row");
    await userEvent.click(row!.querySelector("button")!);
    await userEvent.keyboard("{Enter}");

    await waitFor(() => expect(remoteAgentMock.startMock).toHaveBeenCalledWith(expect.objectContaining({ sessionName: "default" })));
  });

  it("allows the base PiAgent to be started", async () => {
    render(<App />);

    await startNewAgent("PiAgent");

    await waitFor(() => expect(remoteAgentMock.startMock).toHaveBeenCalled());
    expect(await screen.findByText("Chat for PiAgent")).toBeInTheDocument();
  });

  it("lists sessions before continuing an agent", async () => {
    render(<App />);

    const myPiRow = await screen.findByText("MyPiAgent");
    const continueButton = myPiRow.closest(".cwa-agent-row")?.querySelectorAll("button")[1] as HTMLButtonElement;
    await userEvent.click(continueButton);

    expect(await screen.findByText("Continue MyPiAgent")).toBeInTheDocument();
    expect(remoteAgentMock.fetchAgentSessionsMock).toHaveBeenCalledWith("MyPiAgent");
    const stoppedRow = await screen.findByRole("button", { name: /Planning/ });
    expect(stoppedRow).toHaveTextContent("Stopped");
    await userEvent.click(stoppedRow);
    expect(remoteAgentMock.startMock).toHaveBeenCalled();
  });

  it("does not pass start replay events into reopened chat views", async () => {
    remoteAgentMock.fetchMostRecentSessionMock.mockResolvedValueOnce({
      id: "s-recent",
      agent: "MyPiAgent",
      name: "Recent",
      createdAt: "2026-01-02T00:00:00.000Z",
      restart: { sessionId: "resume-me" },
    } as never);

    render(<App />);

    expect(await screen.findByText("Replay count 0")).toBeInTheDocument();
  });

  it("lets you join a live session directly", async () => {
    const runningSessions: AgentSessionSummary[] = [
      { id: "s-running", agent: "MyPiAgent", name: "Running session", createdAt: "2026-01-01T00:00:00.000Z", restart: { sessionId: "abc" }, running: true, connectedClients: 2 },
    ];
    remoteAgentMock.fetchAgentSessionsMock.mockResolvedValueOnce(runningSessions as never);
    render(<App />);

    const myPiRow = await screen.findByText("MyPiAgent");
    const continueButton = myPiRow.closest(".cwa-agent-row")?.querySelectorAll("button")[1] as HTMLButtonElement;
    await userEvent.click(continueButton);

    const runningSessionRow = await screen.findByRole("button", { name: /Running session/ });
    expect(runningSessionRow).toHaveClass("cwa-session-row--running");
    expect(runningSessionRow).toHaveTextContent("2 connected");

    await userEvent.click(runningSessionRow);
    expect(remoteAgentMock.startMock).toHaveBeenCalledWith(expect.objectContaining({
      session: expect.objectContaining({ id: "s-running" }),
    }));
  });

  it("returns from chat to agent selection via the sessions button", async () => {
    render(<App />);

    await startNewAgent("MockAgent");
    await screen.findByText("Chat for MockAgent");

    await userEvent.click(screen.getByRole("button", { name: "Sessions" }));

    expect(await screen.findByText("MockAgent")).toBeInTheDocument();
    expect(screen.getByText("Choose agent")).toBeInTheDocument();
    expect(screen.queryByText("Chat for MockAgent")).not.toBeInTheDocument();
  });

  it("shows connected client counts for live sessions in the session list", async () => {
    const runningSessions: AgentSessionSummary[] = [
      { id: "s-running", agent: "MyPiAgent", name: "Collaborative", createdAt: "2026-01-01T00:00:00.000Z", restart: { sessionId: "abc" }, running: true, connectedClients: 3 },
    ];
    remoteAgentMock.fetchAgentSessionsMock.mockResolvedValueOnce(runningSessions as never);
    render(<App />);

    const myPiRow = await screen.findByText("MyPiAgent");
    const continueButton = myPiRow.closest(".cwa-agent-row")?.querySelectorAll("button")[1] as HTMLButtonElement;
    await userEvent.click(continueButton);

    expect(await screen.findByRole("button", { name: /Collaborative/ })).toHaveTextContent("3 connected");
  });

  it("surfaces startup failures", async () => {
    remoteAgentMock.startMock.mockRejectedValueOnce(new Error("Could not start"));
    render(<App />);

    await startNewAgent("MockAgent");

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not start");
  });

  it("shows the approval modal when the server pushes an offer over the websocket", async () => {
    remoteAgentMock.fetchEnvironmentPreviewMock.mockResolvedValueOnce({
      environmentId: "web:wikipedia",
      skills: [{ id: "wikipedia-discovery", name: "wikipedia-discovery", files: { "wikipedia-discovery/SKILL.md": "# Wikipedia" } }],
    });
    render(<App />);
    await startNewAgent("MockAgent");
    await screen.findByText("Chat for MockAgent");

    await act(async () => {
      chatPanel.props?.onEnvironmentOfferAvailable?.({ environmentId: "web:wikipedia", sourceName: "Wikipedia skills" });
    });

    expect(await screen.findByRole("dialog", { name: /Environment Available/i })).toBeInTheDocument();
    expect(screen.getByText("Wikipedia skills")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/# Wikipedia/)).toBeInTheDocument());
  });

  it("records a decision and closes the modal on the resolved event", async () => {
    render(<App />);
    await startNewAgent("MockAgent");
    await screen.findByText("Chat for MockAgent");

    await act(async () => {
      chatPanel.props?.onEnvironmentOfferAvailable?.({ environmentId: "web:wikipedia", sourceName: "Wikipedia skills" });
    });

    expect(await screen.findByRole("dialog", { name: /Environment Available/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Allow this visit" }));

    await waitFor(() => expect(remoteAgentMock.decideEnvironmentMock).toHaveBeenCalledWith("web:wikipedia", "accept"));
    expect(screen.queryByRole("dialog", { name: /Environment Available/i })).not.toBeInTheDocument();
  });

  it("closes the modal when another client resolves the offer", async () => {
    render(<App />);
    await startNewAgent("MockAgent");
    await screen.findByText("Chat for MockAgent");

    await act(async () => {
      chatPanel.props?.onEnvironmentOfferAvailable?.({ environmentId: "web:wikipedia", sourceName: "Wikipedia skills" });
    });
    expect(await screen.findByRole("dialog", { name: /Environment Available/i })).toBeInTheDocument();

    await act(async () => {
      chatPanel.props?.onEnvironmentOfferResolved?.({ environmentId: "web:wikipedia", decision: "dismissed" });
    });

    expect(screen.queryByRole("dialog", { name: /Environment Available/i })).not.toBeInTheDocument();
    expect(remoteAgentMock.decideEnvironmentMock).not.toHaveBeenCalled();
  });
});
