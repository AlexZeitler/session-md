import {
  BoxRenderable,
  TextRenderable,
  type CliRenderer,
  type KeyEvent,
  t,
  fg,
  bold,
} from "@opentui/core";
import type { Config } from "./config.ts";
import { addTarget } from "./config.ts";
import type { SessionEntry, SourceType } from "./import/types.ts";
import { SourcePicker } from "./components/SourcePicker.ts";
import { ConversationList } from "./components/ConversationList.ts";
import { MessageView } from "./components/MessageView.ts";
import { StatusBar, type FocusArea } from "./components/StatusBar.ts";
import { TargetPicker } from "./components/TargetPicker.ts";
import { SearchResultsView } from "./components/SearchResultsView.ts";
import { copySessionsToTarget } from "./file-ops.ts";
import type { SearchIndex } from "./search/index.ts";

type AppState = "browse" | "target-picker" | "content-search";
type LeftFocus = "sources" | "sessions";

export class App {
  private root!: BoxRenderable;
  private body!: BoxRenderable;
  private sidebarColumn!: BoxRenderable;
  private sourcesBox!: BoxRenderable;
  private sessionsBox!: BoxRenderable;
  private mainBox!: BoxRenderable;

  private sourcePicker!: SourcePicker;
  private conversationList!: ConversationList;
  private messageView!: MessageView;
  private statusBar!: StatusBar;
  private targetPicker!: TargetPicker;
  private searchResultsView!: SearchResultsView;

  private state: AppState = "browse";
  private focusArea: FocusArea = "sidebar";
  private leftFocus: LeftFocus = "sources";
  private sessions: SessionEntry[] = [];
  private pendingG = false;
  private pendingGTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private renderer: CliRenderer,
    private config: Config,
    private searchIndex: SearchIndex,
  ) {}

  async start(): Promise<void> {
    this.buildLayout();
    this.setupKeyboard();
    this.updateStatusBar();
  }

  loadSessions(sessions: SessionEntry[]): void {
    this.sessions = sessions;

    // Compute source counts
    const counts = new Map<string, number>();
    for (const s of sessions) {
      counts.set(s.meta.source, (counts.get(s.meta.source) ?? 0) + 1);
    }
    this.sourcePicker.update(counts);
    this.conversationList.update(sessions);
    this.updateStatusBar();
  }

  private buildLayout(): void {
    const r = this.renderer;

    this.root = new BoxRenderable(r, {
      id: "root",
      flexDirection: "column",
      width: "100%" as any,
      height: "100%" as any,
    });
    r.root.add(this.root);

    const titleBar = new TextRenderable(r, {
      id: "title-bar",
      content: t`${bold(fg("#fab283")(" session-md"))} ${fg("#808080")(`v${require("../package.json").version}`)}`,
    });

    this.body = new BoxRenderable(r, {
      id: "body",
      flexDirection: "row",
      flexGrow: 1,
      width: "100%" as any,
    });

    // Sidebar column (no border, just a container)
    this.sidebarColumn = new BoxRenderable(r, {
      id: "sidebar-column",
      width: 55,
      flexDirection: "column",
    });

    // Sources box (top, fixed height)
    this.sourcesBox = new BoxRenderable(r, {
      id: "sources-box",
      height: 8,
      border: true,
      borderStyle: "rounded",
      borderColor: "cyan",
      title: "Sources",
      titleAlignment: "left",
      flexDirection: "column",
    });

    // Sessions box (bottom, grows)
    this.sessionsBox = new BoxRenderable(r, {
      id: "sessions-box",
      flexGrow: 1,
      border: true,
      borderStyle: "rounded",
      borderColor: "gray",
      title: "Sessions",
      titleAlignment: "left",
      flexDirection: "column",
    });

    this.mainBox = new BoxRenderable(r, {
      id: "main-box",
      flexGrow: 1,
      border: true,
      borderStyle: "rounded",
      borderColor: "gray",
      flexDirection: "column",
    });

    // Create components
    this.sourcePicker = new SourcePicker(r);
    this.conversationList = new ConversationList(r);
    this.messageView = new MessageView(r, this.mainBox);
    this.statusBar = new StatusBar(r);
    this.targetPicker = new TargetPicker(r);
    this.searchResultsView = new SearchResultsView(r);

    // Wire up search
    this.searchResultsView.setOnSearchQuery((query) => {
      const source = this.conversationList.getSourceFilter();
      return this.searchIndex.search(query, source);
    });

    this.searchResultsView.setOnResultSelected((result) => {
      const session = this.sessions.find((s) => s.meta.id === result.id);
      if (session) {
        this.exitContentSearch(true);
        this.messageView.setLoadFull(true);
        this.messageView.load(session);
        this.conversationList.selectById(result.id);
      }
    });

    // Wire up callbacks
    this.sourcePicker.setOnSourceChanged((source) => {
      this.conversationList.setSourceFilter(source);
    });

    this.conversationList.setOnSessionFocused((session) => {
      this.messageView.load(session);
    });

    this.targetPicker.onTargetSelected = (targetPath) => {
      this.handleCopyToTarget(targetPath);
    };

    this.targetPicker.onNewTarget = (name, path) => {
      this.handleNewTarget(name, path);
    };

    this.targetPicker.onCancel = () => {
      this.exitTargetPicker();
    };

    // Assemble: sources box + sessions box in sidebar column
    this.sourcesBox.add(this.sourcePicker.select);
    this.sessionsBox.add(this.conversationList.container);

    this.sidebarColumn.add(this.sourcesBox);
    this.sidebarColumn.add(this.sessionsBox);

    // Main panel
    this.mainBox.add(this.messageView.outerBox);

    this.body.add(this.sidebarColumn);
    this.body.add(this.mainBox);

    this.root.add(titleBar);
    this.root.add(this.body);
    this.root.add(this.statusBar.container);

    this.setLeftFocus("sources");
  }

  private setupKeyboard(): void {
    this.renderer.keyInput.on("keypress", (key: KeyEvent) => {
      // Filter input is focused — intercept escape/return, let typing through
      if (this.conversationList.isFilterInputFocused()) {
        if (key.name === "escape") {
          key.preventDefault();
          this.conversationList.hideFilter();
          this.updateStatusBar();
        } else if (key.name === "return") {
          key.preventDefault();
          this.conversationList.focusListFromFilter();
          this.updateStatusBar();
        }
        return;
      }

      // Filter active but list focused — Escape clears filter, / returns to input
      if (this.conversationList.isFiltering()) {
        if (key.name === "escape") {
          key.preventDefault();
          this.conversationList.hideFilter();
          this.updateStatusBar();
          return;
        }
        if (key.name === "slash" || key.name === "/" || (key.shift && key.name === "7")) {
          key.preventDefault();
          this.conversationList.focusFilterInput();
          return;
        }
        // Fall through to normal session key handling (j/k, SPACE, c, etc.)
      }

      // Content search state
      if (this.state === "content-search") {
        if (this.searchResultsView.isInputFocused()) {
          if (key.name === "escape") {
            key.preventDefault();
            this.exitContentSearch();
          } else if (key.name === "return") {
            key.preventDefault();
            this.searchResultsView.focusList();
          }
          return;
        }
        // List is focused
        if (key.name === "escape") {
          key.preventDefault();
          this.exitContentSearch();
          return;
        }
        if (key.name === "slash" || key.name === "/" || (key.shift && key.name === "7")) {
          key.preventDefault();
          this.searchResultsView.focusInput();
          return;
        }
        if (key.name === "return") {
          key.preventDefault();
          this.searchResultsView.selectCurrentResult();
          return;
        }
        // Let SelectRenderable handle j/k
        return;
      }

      // Target picker state
      if (this.state === "target-picker") {
        if (key.name === "escape") {
          key.preventDefault();
          if (this.targetPicker.isEnteringNew()) {
            this.targetPicker.hideNewTargetInput();
          } else {
            this.exitTargetPicker();
          }
        }
        return;
      }

      // Global shortcuts
      if (key.name === "q" && !key.ctrl) {
        key.preventDefault();
        this.renderer.destroy();
        process.exit(0);
      }

      if (key.name === "tab") {
        key.preventDefault();
        if (key.shift) {
          this.cycleFocusBack();
        } else {
          this.cycleeFocus();
        }
        return;
      }

      // Sidebar: sources panel focused
      if (this.focusArea === "sidebar" && this.leftFocus === "sources") {
        if (key.name === "return") {
          key.preventDefault();
          this.setLeftFocus("sessions");
          return;
        }
        if (key.name === "g" && !key.shift && !key.ctrl) {
          key.preventDefault();
          if (this.pendingG) {
            this.clearPendingG();
          } else {
            this.startPendingG(() => {
              this.enterContentSearch();
            });
          }
          return;
        }
        // Let SelectRenderable handle j/k
        return;
      }

      // Sidebar: sessions panel focused
      if (this.focusArea === "sidebar" && this.leftFocus === "sessions") {
        if (key.name === "d" && key.ctrl) {
          key.preventDefault();
          this.messageView.pageDown();
          return;
        }

        if (key.name === "u" && key.ctrl) {
          key.preventDefault();
          this.messageView.pageUp();
          return;
        }

        if (key.name === "slash" || key.name === "/" || (key.shift && key.name === "7")) {
          key.preventDefault();
          this.conversationList.showFilter();
          this.updateStatusBar();
          return;
        }

        if (key.name === "space") {
          key.preventDefault();
          this.conversationList.toggleSelection();
          this.updateStatusBar();
          return;
        }

        if (key.name === "c") {
          key.preventDefault();
          this.enterTargetPicker();
          return;
        }

        if (key.name === "g" && key.shift) {
          key.preventDefault();
          this.conversationList.selectLast();
          return;
        }

        if (key.name === "g" && !key.shift && !key.ctrl) {
          key.preventDefault();
          if (this.pendingG) {
            this.clearPendingG();
            this.conversationList.selectFirst();
          } else {
            this.startPendingG(() => {
              this.enterContentSearch();
            });
          }
          return;
        }

        // Let SelectRenderable handle j/k/Enter
        return;
      }

      // Main panel focused
      if (this.focusArea === "main") {
        if (key.name === "escape") {
          key.preventDefault();
          this.focusArea = "sidebar";
          this.setLeftFocus("sessions");
          return;
        }

        if (key.name === "j") {
          key.preventDefault();
          this.messageView.scrollDown();
          return;
        }

        if (key.name === "k") {
          key.preventDefault();
          this.messageView.scrollUp();
          return;
        }

        if (key.name === "d" && key.ctrl) {
          key.preventDefault();
          this.messageView.pageDown();
          return;
        }

        if (key.name === "u" && key.ctrl) {
          key.preventDefault();
          this.messageView.pageUp();
          return;
        }

        if (key.name === "g" && key.shift) {
          key.preventDefault();
          this.messageView.scrollToBottom();
          return;
        }

        if (key.name === "g" && !key.shift && !key.ctrl) {
          key.preventDefault();
          if (this.pendingG) {
            this.clearPendingG();
            this.messageView.scrollToTop();
          } else {
            this.startPendingG();
          }
          return;
        }
      }
    });
  }

  private startPendingG(onTimeout?: () => void): void {
    this.pendingG = true;
    this.pendingGTimer = setTimeout(() => {
      this.pendingG = false;
      this.pendingGTimer = null;
      onTimeout?.();
    }, 300);
  }

  private clearPendingG(): void {
    this.pendingG = false;
    if (this.pendingGTimer) {
      clearTimeout(this.pendingGTimer);
      this.pendingGTimer = null;
    }
  }

  private cycleeFocus(): void {
    // Cycle forward: sources → sessions → main → sources
    if (this.focusArea === "sidebar" && this.leftFocus === "sources") {
      this.setLeftFocus("sessions");
    } else if (this.focusArea === "sidebar" && this.leftFocus === "sessions") {
      this.focusArea = "main";
      this.sourcesBox.borderColor = "gray";
      this.sessionsBox.borderColor = "gray";
      this.mainBox.borderColor = "cyan";
      this.messageView.expandFull();
      this.messageView.container.focus();
      this.updateStatusBar();
    } else {
      this.focusArea = "sidebar";
      this.setLeftFocus("sources");
    }
  }

  private cycleFocusBack(): void {
    // Cycle backward: sources → main → sessions → sources
    if (this.focusArea === "sidebar" && this.leftFocus === "sources") {
      this.focusArea = "main";
      this.sourcesBox.borderColor = "gray";
      this.sessionsBox.borderColor = "gray";
      this.mainBox.borderColor = "cyan";
      this.messageView.expandFull();
      this.messageView.container.focus();
      this.updateStatusBar();
    } else if (this.focusArea === "sidebar" && this.leftFocus === "sessions") {
      this.setLeftFocus("sources");
    } else {
      this.focusArea = "sidebar";
      this.setLeftFocus("sessions");
    }
  }

  private setLeftFocus(area: LeftFocus): void {
    this.focusArea = "sidebar";
    this.leftFocus = area;
    this.mainBox.borderColor = "gray";

    if (area === "sources") {
      this.sourcesBox.borderColor = "cyan";
      this.sessionsBox.borderColor = "gray";
      this.sourcePicker.focus();
    } else {
      this.sourcesBox.borderColor = "gray";
      this.sessionsBox.borderColor = "cyan";
      this.conversationList.focus();
    }
    this.updateStatusBar();
  }

  private updateStatusBar(): void {
    this.statusBar.update(
      this.conversationList.getSelectedCount(),
      this.sessions.length,
      this.focusArea,
    );
  }

  private enterTargetPicker(): void {
    const selected = this.conversationList.getSelectedSessions();
    if (selected.length === 0) {
      this.statusBar.showError("No sessions selected (use SPACE to select)");
      return;
    }

    this.state = "target-picker";

    for (const child of this.mainBox.getChildren()) {
      this.mainBox.remove(child.id);
    }
    this.mainBox.add(this.targetPicker.container);
    this.targetPicker.show(this.config.targets, selected.length);
    this.targetPicker.focus();
    this.mainBox.borderColor = "cyan";
    this.sourcesBox.borderColor = "gray";
    this.sessionsBox.borderColor = "gray";
  }

  private exitTargetPicker(): void {
    this.state = "browse";
    this.targetPicker.reset();

    for (const child of this.mainBox.getChildren()) {
      this.mainBox.remove(child.id);
    }
    this.mainBox.add(this.messageView.outerBox);
    this.setLeftFocus("sessions");
  }

  private async handleCopyToTarget(targetPath: string): Promise<void> {
    const selected = this.conversationList.getSelectedSessions();
    try {
      await copySessionsToTarget(selected, targetPath);
      this.statusBar.showInfo(`Copied ${selected.length} file(s) to ${targetPath}`);
    } catch (err) {
      this.statusBar.showError(`Copy failed: ${err}`);
    }
    this.exitTargetPicker();
  }

  private enterContentSearch(): void {
    this.state = "content-search";

    for (const child of this.mainBox.getChildren()) {
      this.mainBox.remove(child.id);
    }
    this.mainBox.add(this.searchResultsView.container);
    this.searchResultsView.reset();
    this.searchResultsView.focus();
    this.mainBox.borderColor = "cyan";
    this.mainBox.title = "Content Search (g)";
    this.sourcesBox.borderColor = "gray";
    this.sessionsBox.borderColor = "gray";
  }

  private exitContentSearch(focusMain = false): void {
    this.state = "browse";
    this.searchResultsView.reset();

    for (const child of this.mainBox.getChildren()) {
      this.mainBox.remove(child.id);
    }
    this.mainBox.add(this.messageView.outerBox);
    this.mainBox.title = "";

    if (focusMain) {
      this.focusArea = "main";
      this.sourcesBox.borderColor = "gray";
      this.sessionsBox.borderColor = "gray";
      this.mainBox.borderColor = "cyan";
      this.messageView.expandFull();
      this.messageView.container.focus();
      this.updateStatusBar();
    } else {
      this.setLeftFocus("sessions");
    }
  }

  private async handleNewTarget(name: string, path: string): Promise<void> {
    const expandedPath = path.startsWith("~/")
      ? path.replace("~", require("os").homedir())
      : path;

    if (name) {
      try {
        await addTarget(name, path);
        this.config.targets[name] = expandedPath;
      } catch (err) {
        this.statusBar.showError(`Failed to save target: ${err}`);
      }
    }

    await this.handleCopyToTarget(expandedPath);
  }

}
