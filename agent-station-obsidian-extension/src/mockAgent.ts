import { Agent, AgentCallbacks } from "./agent";

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
// MockAgent
// ---------------------------------------------------------------------------

export class MockAgent extends Agent {
  private static turnIndex = 0;

  constructor(callbacks: AgentCallbacks) {
    super(callbacks);
  }

  async run(_userMessage: string): Promise<void> {
    const turn = MockAgent.turnIndex % 2;
    MockAgent.turnIndex++;

    const { onAgentStart, onAgentEnd, onMessageStart, onMessageUpdate, onMessageEnd, onToolExecution } =
      this.callbacks;

    onAgentStart();

    if (turn === 0) {
      await this.runTurn1({ onMessageStart, onMessageUpdate, onMessageEnd, onToolExecution });
    } else {
      await this.runTurn2({ onMessageStart, onMessageUpdate, onMessageEnd, onToolExecution });
    }

    onAgentEnd();
  }

  private async runTurn1({
    onMessageStart, onMessageUpdate, onMessageEnd, onToolExecution,
  }: Pick<AgentCallbacks, "onMessageStart" | "onMessageUpdate" | "onMessageEnd" | "onToolExecution">) {
    onMessageStart();
    await streamText(TURN_1_THINKING, (delta) => onMessageUpdate({ type: "thinking", delta }));
    onMessageEnd();

    onMessageStart();
    await streamText(TURN_1_PRE_TOOL_TEXT, (delta) => onMessageUpdate({ type: "text", delta }));
    onMessageEnd();

    const readId = "call_read_abc123";
    onMessageStart();
    for (const ch of `{"path": "Project Planning.md"}`) {
      onMessageUpdate({ type: "toolCall", id: readId, name: "read_note", argumentsDelta: ch });
      await delay(2);
    }
    onMessageEnd();
    await delay(50);
    onToolExecution({ toolCallId: readId, toolName: "read_note", content: TURN_1_READ_RESULT, isError: false });

    const writeId = "call_write_def456";
    onMessageStart();
    const chunkSize = 20;
    for (let i = 0; i < TURN_1_WRITE_ARGS.length; i += chunkSize) {
      onMessageUpdate({ type: "toolCall", id: writeId, name: "write", argumentsDelta: TURN_1_WRITE_ARGS.slice(i, i + chunkSize) });
      await delay(1);
    }
    onMessageEnd();
    await delay(50);
    onToolExecution({ toolCallId: writeId, toolName: "write", content: TURN_1_WRITE_RESULT, isError: false });

    onMessageStart();
    await streamText(TURN_1_FINAL_TEXT, (delta) => onMessageUpdate({ type: "text", delta }));
    onMessageEnd();
  }

  private async runTurn2({
    onMessageStart, onMessageUpdate, onMessageEnd, onToolExecution,
  }: Pick<AgentCallbacks, "onMessageStart" | "onMessageUpdate" | "onMessageEnd" | "onToolExecution">) {
    onMessageStart();
    await streamText(TURN_2_THINKING, (delta) => onMessageUpdate({ type: "thinking", delta }));
    onMessageEnd();

    onMessageStart();
    await streamText(TURN_2_PRE_TOOL_TEXT, (delta) => onMessageUpdate({ type: "text", delta }));
    onMessageEnd();

    const readSummaryId = "call_read_ghi789";
    onMessageStart();
    for (const ch of TURN_2_READ_SUMMARY_ARGS) {
      onMessageUpdate({ type: "toolCall", id: readSummaryId, name: "read_note", argumentsDelta: ch });
      await delay(2);
    }
    onMessageEnd();
    await delay(50);
    onToolExecution({ toolCallId: readSummaryId, toolName: "read_note", content: TURN_2_READ_SUMMARY_RESULT, isError: false });

    const readLegalId = "call_read_jkl012";
    onMessageStart();
    for (const ch of TURN_2_READ_LEGAL_ARGS) {
      onMessageUpdate({ type: "toolCall", id: readLegalId, name: "read_note", argumentsDelta: ch });
      await delay(2);
    }
    onMessageEnd();
    await delay(50);
    onToolExecution({ toolCallId: readLegalId, toolName: "read_note", content: TURN_2_READ_LEGAL_RESULT, isError: false });

    onMessageStart();
    await streamText(TURN_2_TEXT, (delta) => onMessageUpdate({ type: "text", delta }));
    onMessageEnd();
  }
}
