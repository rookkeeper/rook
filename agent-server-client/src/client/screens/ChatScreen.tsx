import type { AgentBackend, AgentSessionSummary } from "../agent";
import type { EnvironmentOfferAvailablePayload, EnvironmentOfferResolvedPayload } from "../../shared/environment";
import type { ParentMessagePoster } from "../parentMessageTool";
import { ChatPanel } from "../components/ChatPanel";

export interface ChatScreenProps {
  agentId: AgentBackend;
  session: AgentSessionSummary;
  onParentMessage?: ParentMessagePoster | null;
  onEnvironmentOfferAvailable?: (payload: EnvironmentOfferAvailablePayload) => void;
  onEnvironmentOfferResolved?: (payload: EnvironmentOfferResolvedPayload) => void;
}

export function ChatScreen({
  agentId,
  session,
  onParentMessage,
  onEnvironmentOfferAvailable,
  onEnvironmentOfferResolved,
}: ChatScreenProps) {
  return (
    <ChatPanel
      agentBackend={agentId}
      initialSession={session}
      onParentMessage={onParentMessage}
      onEnvironmentOfferAvailable={onEnvironmentOfferAvailable}
      onEnvironmentOfferResolved={onEnvironmentOfferResolved}
    />
  );
}
