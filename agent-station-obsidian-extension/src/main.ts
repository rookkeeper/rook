import { ItemView, Plugin, WorkspaceLeaf } from "obsidian";

const VIEW_TYPE_CHAT = "agent-station-obsidian-extension";
const APP_URL = "http://localhost:3000";

class ChatView extends ItemView {
  getViewType(): string {
    return VIEW_TYPE_CHAT;
  }

  getDisplayText(): string {
    return "Agent Station Obsidian Extension";
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("cwa-container");

    const iframe = container.createEl("iframe", {
      cls: "cwa-iframe",
      attr: {
        src: APP_URL,
        title: "Agent Station Obsidian Extension",
      },
    });

    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "0";
  }

  async onClose(): Promise<void> {
    this.containerEl.children[1]?.empty();
  }
}

export default class ChatWithAgentPlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerView(VIEW_TYPE_CHAT, (leaf) => new ChatView(leaf));

    this.addRibbonIcon("message-square", "Agent Station Obsidian Extension", () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-agent-station-obsidian-extension",
      name: "Agent Station Obsidian Extension",
      callback: () => this.activateView(),
    });
  }

  async onunload(): Promise<void> {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_CHAT);
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_CHAT);

    if (existing.length > 0) {
      leaf = existing[0] ?? null;
    } else {
      leaf = workspace.getRightLeaf(false);
      await leaf?.setViewState({ type: VIEW_TYPE_CHAT, active: true });
    }

    if (leaf) workspace.revealLeaf(leaf);
  }
}
