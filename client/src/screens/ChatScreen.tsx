import type { AgentBackend, AgentSessionSummary } from "../lib/agent";
import type { EnvironmentOfferAvailablePayload, EnvironmentOfferResolvedPayload } from "../lib/environment";
import { ChatPanel } from "../components/ChatPanel";

interface Props {
  agentId: AgentBackend;
  session: AgentSessionSummary;
  showSettings?: boolean;
  onEnvironmentOfferAvailable?: (payload: EnvironmentOfferAvailablePayload) => void;
  onEnvironmentOfferResolved?: (payload: EnvironmentOfferResolvedPayload) => void;
}

export function ChatScreen({
  agentId, session, showSettings, onEnvironmentOfferAvailable, onEnvironmentOfferResolved,
}: Props) {
  return (
    <ChatPanel
      agentBackend={agentId}
      initialSession={session}
      showSettings={showSettings}
      onEnvironmentOfferAvailable={onEnvironmentOfferAvailable}
      onEnvironmentOfferResolved={onEnvironmentOfferResolved}
    />
  );
}
