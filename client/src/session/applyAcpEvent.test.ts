import { describe, expect, it, vi } from "vitest";
import { applyAcpEvent } from "./applyAcpEvent";
import type { ChatSessionAction } from "./chatSessionState";
import type { EnvironmentOfferAvailablePayload, EnvironmentOfferResolvedPayload } from "../lib/environment";

function createHandlers() {
  const actions: ChatSessionAction[] = [];
  const completions: string[] = [];
  const failures: Array<{ error: string; source: "run" | "connection" }> = [];
  const permissions: unknown[] = [];
  const offers: EnvironmentOfferAvailablePayload[] = [];
  const resolutions: EnvironmentOfferResolvedPayload[] = [];

  return {
    actions,
    completions,
    failures,
    permissions,
    offers,
    resolutions,
    handlers: {
      dispatch: (action: ChatSessionAction) => { actions.push(action); },
      onRunCompleted: (stopReason: string) => { completions.push(stopReason); },
      onRunFailed: (error: string, source: "run" | "connection") => { failures.push({ error, source }); },
      onPermissionStateChange: (permission: unknown) => { permissions.push(permission); },
      onEnvironmentOfferAvailable: vi.fn((payload: EnvironmentOfferAvailablePayload) => { offers.push(payload); }),
      onEnvironmentOfferResolved: vi.fn((payload: EnvironmentOfferResolvedPayload) => { resolutions.push(payload); }),
    },
  };
}

describe("applyAcpEvent", () => {
  it("maps tool call update progress with output to TOOL_OUTPUT_DELTA", () => {
    const { actions, handlers } = createHandlers();

    applyAcpEvent({
      type: "acp_tool_call_update",
      toolCallId: "tool-1",
      status: "in_progress",
      toolName: "Read File",
      output: "partial output",
    }, handlers);

    expect(actions).toEqual([
      { type: "TOOL_OUTPUT_DELTA", toolCallId: "tool-1", toolName: "Read File", delta: "partial output" },
    ]);
  });

  it("maps permission requests to reducer action and permission side state", () => {
    const { actions, permissions, handlers } = createHandlers();

    applyAcpEvent({
      type: "acp_permission_request",
      requestId: "perm-1",
      toolCall: { toolCallId: "tool-1", title: "Write file", kind: "edit", status: "pending" },
      options: [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }],
    }, handlers);

    expect(actions).toEqual([
      {
        type: "PERMISSION_REQUESTED",
        requestId: "perm-1",
        toolCall: { toolCallId: "tool-1", title: "Write file", kind: "edit", status: "pending" },
        options: [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }],
      },
    ]);
    expect(permissions).toEqual([
      {
        requestId: "perm-1",
        toolCall: { toolCallId: "tool-1", title: "Write file", kind: "edit", status: "pending" },
        options: [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }],
      },
    ]);
  });

  it("routes run completion and failures to side-effect handlers", () => {
    const { completions, failures, handlers } = createHandlers();

    applyAcpEvent({ type: "acp_run_completed", stopReason: "cancelled" }, handlers);
    applyAcpEvent({ type: "acp_connection_error", error: "socket closed" }, handlers);

    expect(completions).toEqual(["cancelled"]);
    expect(failures).toEqual([{ error: "socket closed", source: "connection" }]);
  });

  it("parses environment offer available payloads", () => {
    const { offers, handlers } = createHandlers();

    applyAcpEvent({
      type: "acp_environment_event",
      kind: "environment_offer_available",
      payload: { environmentId: "web:wikipedia", sourceName: "Wikipedia", canonicalSourceUrl: "https://wikipedia.org" },
    }, handlers);

    expect(offers).toEqual([
      { environmentId: "web:wikipedia", sourceName: "Wikipedia", canonicalSourceUrl: "https://wikipedia.org" },
    ]);
  });

  it("ignores malformed environment resolved payloads and accepts valid ones", () => {
    const { resolutions, handlers } = createHandlers();

    applyAcpEvent({
      type: "acp_environment_event",
      kind: "environment_offer_resolved",
      payload: { environmentId: "web:wikipedia", decision: "weird" },
    }, handlers);
    applyAcpEvent({
      type: "acp_environment_event",
      kind: "environment_offer_resolved",
      payload: { environmentId: "web:wikipedia", decision: "approved" },
    }, handlers);

    expect(resolutions).toEqual([
      { environmentId: "web:wikipedia", decision: "approved" },
    ]);
  });
});
