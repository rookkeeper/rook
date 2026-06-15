import type { AcpPermissionRequest, AcpSessionUpdateNotification } from "./acp.js";

export type EnvironmentEventPayload = {
  kind: string;
  payload?: unknown;
};

export type AcpOutboundMessage = {
  type: "acp_message";
  message: AcpSessionUpdateNotification | AcpPermissionRequest;
};
