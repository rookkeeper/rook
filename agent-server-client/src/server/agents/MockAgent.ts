import { BaseAgent } from "./BaseAgent.js";
import { AgentRestartMetadata, AgentSessionRecord } from "./sessionLog.js";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function streamText(
  text: string,
  onDelta: (delta: string) => void,
  intervalMs = 4
): Promise<void> {
  const words = text.split(" ");
  for (const word of words) {
    onDelta(word + " ");
    await delay(intervalMs);
  }
}

// ---------------------------------------------------------------------------
// Turn 1 content
// ---------------------------------------------------------------------------

const TURN_1_THINKING = `\
Let me think through what the user is asking. They want me to look into their notes on project planning \
and then produce a structured summary document. This is a two-step task: first I need to read the relevant \
source note to understand what's already there, then I need to write a new document that organises that \
information in a cleaner format.

Before I start writing anything I should be careful not to invent details. I'll read the source note first, \
extract the key points, and then write a well-structured output. The user probably wants headers, bullet \
points, and a short executive summary at the top — that's the typical expectation for a "structured summary."

One thing I need to watch out for: the source note might already have some structure. If it does, I should \
preserve that structure and enhance it rather than flatten it. I'll scan for any existing sections or \
categories when I read it.

For the write call, I want to produce something that is immediately useful without further editing. That \
means complete sentences in the prose sections, consistent bullet formatting, and a clear file name. I'll \
call the output file "Project Planning Summary.md" and put a YAML frontmatter block at the top with a \
creation date so the user can track when it was generated.

Alright — read first, then write. Let's go.`;

const TURN_1_PRE_TOOL_TEXT = `\
Sure, I'll get started on that. First let me pull up your project planning note so I have all the raw \
material in front of me. Once I've read it I'll write a clean structured summary to a new file — \
I'll include a brief executive summary at the top, organised sections for each major theme, and a \
frontmatter header so it fits neatly into your vault.`;

const TURN_1_READ_RESULT = `\
# Project Planning

## Q3 Goals
- Launch redesigned onboarding flow by end of July
- Reduce time-to-value from 14 days to 7 days
- Ship analytics dashboard v2

## Team capacity
- Engineering: 4 FTEs, 1 contractor until Aug
- Design: 1 FTE (part-time on two projects)
- PM: shared resource, 50% allocated

## Risks
- Contractor availability uncertain after August
- Analytics dashboard depends on data pipeline work not yet started
- Onboarding redesign requires sign-off from legal (pending)

## Next actions
- Confirm contractor extension by June 15
- Kick off data pipeline spike this sprint
- Schedule legal review for onboarding copy`;

const TURN_1_WRITE_ARGS = `{\n  "path": "Project Planning Summary.md",\n  "content": "---\\ncreated: 2026-05-07\\ntags: [summary, planning]\\n---\\n\\n# Project Planning Summary\\n\\n## Executive Summary\\n\\nThe team is targeting three major Q3 deliverables: a redesigned onboarding flow, a reduced time-to-value metric, and an analytics dashboard v2. Capacity is tight and two external dependencies need resolution before work can proceed at full speed.\\n\\n## Goals\\n\\n- **Onboarding redesign** — launch by end of July; requires legal sign-off (currently pending).\\n- **Time-to-value** — reduce from 14 days to 7 days, linked to onboarding work.\\n- **Analytics dashboard v2** — blocked on data pipeline work that has not yet started.\\n\\n## Team Capacity\\n\\n- Engineering: 4 FTEs plus one contractor whose availability ends in August.\\n- Design: 1 FTE, currently split across two projects.\\n- PM: shared resource at 50% allocation.\\n\\n## Key Risks\\n\\n1. Contractor may not be available past August — extension decision needed by June 15.\\n2. Analytics dashboard is blocked until the data pipeline spike is complete.\\n3. Legal review for onboarding copy has not been scheduled yet.\\n\\n## Immediate Next Actions\\n\\n- [ ] Confirm contractor extension — deadline June 15.\\n- [ ] Kick off data pipeline spike this sprint.\\n- [ ] Schedule legal review for onboarding copy.\\n- [ ] Align design on onboarding priority vs other project.\\n- [ ] Review analytics dashboard scope with engineering lead.\\n\\n## Notes\\n\\nThis summary was generated from the raw planning note. Review and update as decisions are made.\\n"\n}`;

const TURN_1_WRITE_RESULT = `Successfully wrote 1,043 bytes to "Project Planning Summary.md".`;

const TURN_1_FINAL_TEXT = `\
Done. Here's a full breakdown of what I found and what I wrote.

## What I Read

Your planning note covered three broad areas: **Q3 goals**, **team capacity**, and **risks**. The goals are well-defined but two of them have external blockers that aren't resolved yet.

## What I Wrote

I created **Project Planning Summary.md** with the following structure:

| Section | Contents |
|---|---|
| Executive Summary | 2-sentence overview of the quarter |
| Goals | One bullet per goal with blocker noted inline |
| Team Capacity | FTE breakdown by function |
| Key Risks | Numbered by severity |
| Next Actions | Checkbox list, ready to use |

## Risk Assessment

Here's how I'd rank the three open risks:

1. **Legal review for onboarding copy** — external dependency, unpredictable timeline, blocks the highest-priority goal
2. **Contractor extension** — hard deadline of June 15, affects August capacity if missed
3. **Data pipeline spike** — internal but not yet started; analytics dashboard cannot ship without it

## Recommended Next Steps

- [ ] Schedule legal review call — do this today
- [ ] Confirm contractor extension before June 15
- [ ] Add data pipeline spike to this sprint's backlog
- [ ] Sync with design on onboarding priority vs. their other project

The summary file is ready to use as a living document — update the checkboxes as items are resolved.`;

// ---------------------------------------------------------------------------
// Turn 2 content
// ---------------------------------------------------------------------------

const TURN_2_THINKING = `The user wants a follow-up on priorities. I should check the current summary file and the legal notes before answering so I'm working from the actual content rather than guessing.`;

const TURN_2_PRE_TOOL_TEXT = `Let me pull up the relevant files before I answer.`;

const TURN_2_READ_SUMMARY_ARGS = `{"path": "Project Planning Summary.md"}`;
const TURN_2_READ_SUMMARY_RESULT = `# Project Planning Summary\n\n## Executive Summary\nThree Q3 deliverables with two unresolved external blockers.\n\n## Key Risks\n1. Legal review — unscheduled\n2. Contractor extension — due June 15\n3. Data pipeline spike — not started`;

const TURN_2_READ_LEGAL_ARGS = `{"path": "Legal Review Notes.md"}`;
const TURN_2_READ_LEGAL_RESULT = `# Legal Review Notes\n\nContact: Sarah Chen (legal@company.com)\nLast updated: 2026-04-12\n\n- Onboarding copy submitted for pre-review on April 10\n- No response received yet\n- Estimated turnaround: 2–3 weeks once review is formally scheduled`;

const TURN_2_TEXT = `\
The legal review is the highest-risk item. Here's a quick comparison:

| Item | Deadline | Owner | Status |
|---|---|---|---|
| Legal review | Unscheduled | PM | Blocked |
| Contractor extension | June 15 | Engineering lead | Pending |
| Data pipeline spike | This sprint | Engineering | Not started |

**My recommendation:** schedule the legal call today — it's the only item where the timeline is entirely outside your control. Based on the legal notes, Sarah Chen is the contact and the turnaround is 2–3 weeks once formally scheduled, so every day of delay pushes the onboarding launch further out.`;

// ---------------------------------------------------------------------------
// Turn 3 content — intentionally exercises failed tool + error block UI
// ---------------------------------------------------------------------------

const TURN_3_THINKING = `The user is asking for something that requires reading a missing file. I'll try the read, surface the tool failure, and then simulate a terminal provider error so the dedicated error block UI is visible.`;

const TURN_3_PRE_TOOL_TEXT = `I'll try to read the requested file. This mock turn intentionally demonstrates the failed-tool and run-error states.`;

const TURN_3_MISSING_ARGS = `{"path": "Missing Planning Appendix.md"}`;
const TURN_3_MISSING_ERROR = `File not found: Missing Planning Appendix.md`;

// ---------------------------------------------------------------------------
// MockAgent
// ---------------------------------------------------------------------------

export class MockAgent extends BaseAgent {
  private static turnIndex = 0;
  private static messageIndex = 0;

  constructor(restartMetadata?: AgentRestartMetadata) {
    super(restartMetadata);
  }

  protected async start(): Promise<void> {
    this.emitSessionEvent({ type: "status_changed", status: "idle", message: "Mock agent ready" });
  }

  protected async restart(_metadata: AgentRestartMetadata): Promise<void> {
    this.emitSessionEvent({ type: "status_changed", status: "idle", message: "Mock agent ready" });
  }

  protected async registerSession(): Promise<AgentSessionRecord> {
    return this.createSessionRecord({});
  }

  protected async stopImpl(): Promise<void> {
    // No external resources to release.
  }

  protected async runImpl(userMessage: string): Promise<void> {
    const turn = MockAgent.turnIndex % 3;
    MockAgent.turnIndex++;

    this.emitSessionEvent({
      type: "user_message",
      id: `user-${MockAgent.turnIndex}`,
      text: userMessage,
      queued: false,
    });

    this.emitSessionEvent({ type: "status_changed", status: "busy", message: "Agent is working" });

    try {
      if (turn === 0) {
        await this.runTurn1();
      } else if (turn === 1) {
        await this.runTurn2();
      } else {
        await this.runTurn3();
      }

      this.emitSessionEvent({ type: "run_completed" });
      this.emitSessionEvent({ type: "status_changed", status: "idle", message: "Ready" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitSessionEvent({ type: "run_failed", error: message });
      this.emitSessionEvent({ type: "status_changed", status: "error", message });
    }
  }

  private nextAssistantMessageId(): string {
    MockAgent.messageIndex++;
    return `assistant-${MockAgent.messageIndex}`;
  }

  private async streamThinking(text: string): Promise<void> {
    const id = this.nextAssistantMessageId();
    this.emitSessionEvent({ type: "assistant_message_started", id });
    this.emitSessionEvent({ type: "status_changed", status: "thinking", message: "Thinking" });
    await streamText(text, (delta) => this.emitSessionEvent({ type: "thinking_delta", delta }));
    this.emitSessionEvent({ type: "assistant_message_completed", id });
  }

  private async streamAssistantText(text: string): Promise<void> {
    const id = this.nextAssistantMessageId();
    this.emitSessionEvent({ type: "assistant_message_started", id });
    this.emitSessionEvent({ type: "status_changed", status: "streaming", message: "Writing response" });
    await streamText(text, (delta) => this.emitSessionEvent({ type: "text_delta", delta }));
    this.emitSessionEvent({ type: "assistant_message_completed", id });
  }

  private async streamToolCall(toolCallId: string, toolName: string, input: string): Promise<void> {
    const id = this.nextAssistantMessageId();
    this.emitSessionEvent({ type: "assistant_message_started", id });
    this.emitSessionEvent({ type: "tool_call_started", toolCallId, toolName, rawInput: "" });

    for (const ch of input) {
      this.emitSessionEvent({ type: "tool_input_delta", toolCallId, toolName, delta: ch });
      await delay(2);
    }

    this.emitSessionEvent({ type: "tool_call_ready", toolCallId });
    this.emitSessionEvent({ type: "assistant_message_completed", id });
  }

  private async completeTool(toolCallId: string, toolName: string, output: string): Promise<void> {
    this.emitSessionEvent({ type: "status_changed", status: "using_tool", message: `Using ${toolName}` });
    this.emitSessionEvent({ type: "tool_running", toolCallId });
    await delay(50);
    this.emitSessionEvent({ type: "tool_completed", toolCallId, toolName, output });
  }

  private async failTool(toolCallId: string, toolName: string, error: string): Promise<void> {
    this.emitSessionEvent({ type: "status_changed", status: "using_tool", message: `Using ${toolName}` });
    this.emitSessionEvent({ type: "tool_running", toolCallId });
    await delay(50);
    this.emitSessionEvent({ type: "tool_error", toolCallId, toolName, error });
  }

  private async runTurn1(): Promise<void> {
    await this.streamThinking(TURN_1_THINKING);
    await this.streamAssistantText(TURN_1_PRE_TOOL_TEXT);

    const readId = "call_read_abc123";
    await this.streamToolCall(readId, "read_note", `{"path": "Project Planning.md"}`);
    await this.completeTool(readId, "read_note", TURN_1_READ_RESULT);

    const writeId = "call_write_def456";
    const chunkSize = 20;
    const id = this.nextAssistantMessageId();
    this.emitSessionEvent({ type: "assistant_message_started", id });
    this.emitSessionEvent({ type: "tool_call_started", toolCallId: writeId, toolName: "write", rawInput: "" });
    for (let i = 0; i < TURN_1_WRITE_ARGS.length; i += chunkSize) {
      this.emitSessionEvent({
        type: "tool_input_delta",
        toolCallId: writeId,
        toolName: "write",
        delta: TURN_1_WRITE_ARGS.slice(i, i + chunkSize),
      });
      await delay(1);
    }
    this.emitSessionEvent({ type: "tool_call_ready", toolCallId: writeId });
    this.emitSessionEvent({ type: "assistant_message_completed", id });
    await this.completeTool(writeId, "write", TURN_1_WRITE_RESULT);

    await this.streamAssistantText(TURN_1_FINAL_TEXT);
  }

  private async runTurn2(): Promise<void> {
    await this.streamThinking(TURN_2_THINKING);
    await this.streamAssistantText(TURN_2_PRE_TOOL_TEXT);

    const readSummaryId = "call_read_ghi789";
    await this.streamToolCall(readSummaryId, "read_note", TURN_2_READ_SUMMARY_ARGS);
    await this.completeTool(readSummaryId, "read_note", TURN_2_READ_SUMMARY_RESULT);

    const readLegalId = "call_read_jkl012";
    await this.streamToolCall(readLegalId, "read_note", TURN_2_READ_LEGAL_ARGS);
    await this.completeTool(readLegalId, "read_note", TURN_2_READ_LEGAL_RESULT);

    await this.streamAssistantText(TURN_2_TEXT);
  }

  private async runTurn3(): Promise<void> {
    await this.streamThinking(TURN_3_THINKING);
    await this.streamAssistantText(TURN_3_PRE_TOOL_TEXT);

    const missingReadId = "call_read_missing_345";
    await this.streamToolCall(missingReadId, "read_note", TURN_3_MISSING_ARGS);
    await this.failTool(missingReadId, "read_note", TURN_3_MISSING_ERROR);

    throw new Error("Mock provider stopped after the missing-file tool failure.");
  }
}
