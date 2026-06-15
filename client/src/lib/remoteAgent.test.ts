import { RemoteAgent } from "./remoteAgent";

describe("RemoteAgent.sendSteeringMessage", () => {
  it("does not optimistically emit a user message event", async () => {
    const events: unknown[] = [];
    const agent = new RemoteAgent({ onAcpEvent: (event) => events.push(event) });
    (agent as unknown as { sendSocketRequest: (method: string, params: Record<string, unknown>) => Promise<unknown> }).sendSocketRequest = vi.fn(async () => ({}));
    await agent.sendSteeringMessage("hello");
    expect(events).toEqual([]);
    expect((agent as unknown as { sendSocketRequest: ReturnType<typeof vi.fn> }).sendSocketRequest).toHaveBeenCalledWith("_rookery/steering_prompt", { sessionId: undefined, text: "hello" });
  });
});
