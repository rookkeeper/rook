import { useState } from "react";
import { View, StyleSheet } from "react-native";
import type { AgentBackend, AgentSessionSummary } from "../lib/agent";
import type { EnvironmentOfferAvailablePayload, EnvironmentOfferResolvedPayload } from "../lib/environment";
import type { Block } from "../lib/types";
import { tokens } from "../theme";
import { useChatSession } from "../session/useChatSession";
import { MessageThread } from "./MessageThread";
import { ComposeBox } from "./ComposeBox";
import { QueueDisplay } from "./QueueDisplay";
import { StatusLine } from "./StatusLine";
import { PlanDisplay } from "./PlanDisplay";
import { PermissionPrompt } from "./PermissionPrompt";
import { BlockModal } from "./BlockModal";
import { AcpSettingsPanel } from "./AcpSettingsPanel";

interface ChatPanelProps {
  agentBackend: AgentBackend;
  initialSession: AgentSessionSummary;
  onEnvironmentOfferAvailable?: (payload: EnvironmentOfferAvailablePayload) => void;
  onEnvironmentOfferResolved?: (payload: EnvironmentOfferResolvedPayload) => void;
  showSettings?: boolean;
}

export function ChatPanel({
  agentBackend, initialSession, onEnvironmentOfferAvailable, onEnvironmentOfferResolved, showSettings = false,
}: ChatPanelProps) {
  const [selectedBlock, setSelectedBlock] = useState<Block | null>(null);
  const {
    state,
    usageLabel,
    handleSubmit,
    handleStop,
    handleModeChange,
    handleConfigOptionChange,
    handlePermissionDecision,
    handleQueueSendNow,
    handleQueueDelete,
    handleQueueEditStart,
    handleQueueEditChange,
    handleQueueEditCancel,
    handleQueueSaveEdit,
  } = useChatSession({
    agentBackend,
    initialSession,
    onEnvironmentOfferAvailable,
    onEnvironmentOfferResolved,
  });

  return (
    <View style={styles.panel}>
      {showSettings && (
        <AcpSettingsPanel
          currentModeId={state.modes?.currentModeId}
          availableModes={state.modes?.availableModes}
          configOptions={state.configOptions}
          onModeChange={handleModeChange}
          onConfigOptionChange={handleConfigOptionChange}
        />
      )}
      <PlanDisplay entries={state.planEntries} />
      <MessageThread
        blocks={state.blocks}
        isStreaming={state.isAgentProcessing}
        onOpenBlock={setSelectedBlock}
      />
      <View style={styles.bottomRail}>
        <QueueDisplay
          messages={state.queuedMessages}
          onEditStart={handleQueueEditStart}
          onEditChange={handleQueueEditChange}
          onEditCancel={handleQueueEditCancel}
          onEditSave={handleQueueSaveEdit}
          onSendNow={handleQueueSendNow}
          onDelete={handleQueueDelete}
        />
        {state.pendingPermission && (
          <PermissionPrompt
            toolCall={state.pendingPermission.toolCall}
            options={state.pendingPermission.options}
            onDecide={handlePermissionDecision}
          />
        )}
        <StatusLine status={state.status.status} message={state.status.message} usageLabel={usageLabel} />
        <ComposeBox
          isAgentProcessing={state.isAgentProcessing}
          onSubmit={handleSubmit}
          onStop={handleStop}
        />
      </View>
      <BlockModal block={selectedBlock} onClose={() => setSelectedBlock(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    flex: 1,
    overflow: "hidden",
    backgroundColor: tokens.colors.backgroundSecondary,
  },
  bottomRail: {
    backgroundColor: tokens.colors.backgroundSecondary,
  },
});
