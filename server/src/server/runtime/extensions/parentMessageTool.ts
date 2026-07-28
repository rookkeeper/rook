// @ts-nocheck
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

const TOOL_NAME = "message_parent";

export default function parentMessageToolExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: TOOL_NAME,
    label: "Message parent page",
    description: "Send a JSON message to the parent application hosting the active environment.",
    parameters: Type.Object({
      message: Type.Any({ description: "JSON-serializable message payload to send to the parent page." }),
    }),
    promptSnippet: `${TOOL_NAME}: send a JSON message to the parent application hosting the active environment.`,
    promptGuidelines: [
      "Use message_parent only when environment instructions require notifying or requesting data from the parent application.",
      "Pass the complete JSON payload in the `message` field.",
    ],
    async execute() {
      // Placeholder strategy:
      // This micro extension intentionally does not deliver the message itself. The
      // Rook browser client watches the pi tool-call stream for this exact
      // tool name, extracts the JSON blob from the tool arguments, and relays it to
      // the embedding/injecting page with postMessage. The tool always reports
      // success so the model can continue without depending on browser-side relay
      // timing or availability.
      //
      // This is only a bridge for environment-hosted skills. Real applications should
      // give the agent a durable integration point instead, such as an authenticated
      // HTTP endpoint, webhook, database/API tool, or first-class extension that can
      // connect directly to the app/service it needs to operate.
      return {
        content: [{ type: "text", text: "message sent" }],
        details: {},
      };
    },
  });
}
