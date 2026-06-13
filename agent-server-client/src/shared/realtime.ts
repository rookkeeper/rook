import type { AcpSessionUpdateNotification } from "./acp.js";

export type EnvironmentEventPayload = {
  kind: string;
  payload?: unknown;
};

export type AcpUpdateMessage = {
  type: "acp_update";
  notification: AcpSessionUpdateNotification;
};
