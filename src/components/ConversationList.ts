import {
  BoxRenderable,
  InputRenderable,
  InputRenderableEvents,
  SelectRenderable,
  SelectRenderableEvents,
  TextRenderable,
  type SelectOption,
  type CliRenderer,
  t,
  fg,
  bold,
} from "@opentui/core";
import type { SessionEntry, SourceType } from "../import/types.ts";
import type { Theme } from "../theme.ts";

export type SessionFocusedHandler = (session: SessionEntry) => void;

function matchQuery(query: string, text: string): boolean {
  return text.toLowerCase().includes(query.toLowerCase());
}

export class ConversationList {
  readonly container: BoxRenderable;
  readonly filterInput: InputRenderable;
  readonly select: SelectRenderable;
  private statusText: TextRenderable;
  private allSessions: SessionEntry[] = [];
  private visibleSessions: SessionEntry[] = [];
  private selected: Set<string> = new Set();
  private onSessionFocused: SessionFocusedHandler | null = null;
  private filtering = false;
  private filterInputFocused = false;
  private sourceFilter: SourceType | "all" = "all";
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private suppressNextSelection = false;

  constructor(private ctx: CliRenderer, private theme: Theme) {
    this.container = new BoxRenderable(ctx, {
      id: "conversation-list",
      flexDirection: "column",
      flexGrow: 1,
    });

    this.statusText = new TextRenderable(ctx, {
      id: "conv-status",
      content: "",
      paddingLeft: 1,
    });

    this.filterInput = new InputRenderable(ctx, {
      id: "conv-filter",
      width: 28,
      placeholder: "Filter...",
    });
    this.filterInput.on(InputRenderableEvents.INPUT, () => {
      this.rebuildOptions();
    });

    this.select = new SelectRenderable(ctx, {
      id: "conv-select",
      flexGrow: 1,
      options: [],
      showDescription: true,
      showScrollIndicator: true,
      wrapSelection: true,
      selectedBackgroundColor: this.theme.selection_bg,
      selectedTextColor: this.theme.selection_fg,
      selectedDescriptionColor: this.theme.selection_desc,
    });

    this.container.add(this.statusText);
    this.container.add(this.select);

    this.select.on(
      SelectRenderableEvents.SELECTION_CHANGED,
      (_index: number, option: SelectOption) => {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        if (this.suppressNextSelection) {
          this.suppressNextSelection = false;
          return;
        }
        this.debounceTimer = setTimeout(() => {
          const session = this.visibleSessions.find(
            (s) => s.meta.id === option.value,
          );
          if (session && this.onSessionFocused) {
            this.onSessionFocused(session);
          }
        }, 400);
      },
    );
  }

  setOnSessionFocused(handler: SessionFocusedHandler): void {
    this.onSessionFocused = handler;
  }

  setSourceFilter(source: SourceType | "all"): void {
    this.sourceFilter = source;
    this.rebuildOptions();
    this.select.setSelectedIndex(0);
  }

  showFilter(): void {
    if (!this.filtering) {
      this.filtering = true;
      this.filterInputFocused = true;
      this.container.add(this.filterInput, 0);
      this.filterInput.focus();
    }
  }

  hideFilter(): void {
    if (this.filtering) {
      this.filtering = false;
      this.filterInputFocused = false;
      this.filterInput.value = "";
      this.container.remove(this.filterInput.id);
      this.rebuildOptions();
      this.select.focus();
    }
  }

  /** Is the filter input actively receiving keystrokes? */
  isFilterInputFocused(): boolean {
    return this.filtering && this.filterInputFocused;
  }

  /** Is a filter active (results are filtered)? */
  isFiltering(): boolean {
    return this.filtering;
  }

  /** Move focus from filter input to the filtered list (filter stays active) */
  focusListFromFilter(): void {
    this.filterInputFocused = false;
    this.select.focus();
  }

  /** Move focus back to filter input */
  focusFilterInput(): void {
    this.filterInputFocused = true;
    this.filterInput.focus();
  }

  toggleSelection(): void {
    const opt = this.select.getSelectedOption();
    if (!opt) return;

    const id = opt.value;
    if (this.selected.has(id)) {
      this.selected.delete(id);
    } else {
      this.selected.add(id);
    }
    this.rebuildOptions();
  }

  getSelectedSessions(): SessionEntry[] {
    return this.allSessions.filter((s) => this.selected.has(s.meta.id));
  }

  getSelectedCount(): number {
    return this.selected.size;
  }

  getFocusedSession(): SessionEntry | undefined {
    const opt = this.select.getSelectedOption();
    if (!opt) return undefined;
    return this.visibleSessions.find((s) => s.meta.id === opt.value);
  }

  update(sessions: SessionEntry[]): void {
    this.allSessions = sessions;
    this.selected.clear();
    this.rebuildOptions();
  }

  private rebuildOptions(): void {
    const query = this.filterInput.value.trim();

    // Source filter
    let filtered =
      this.sourceFilter === "all"
        ? this.allSessions
        : this.allSessions.filter((s) => s.meta.source === this.sourceFilter);

    // Substring filter (matches title and project)
    if (query) {
      filtered = filtered.filter(
        (s) =>
          matchQuery(query, s.meta.title) ||
          (s.meta.project && matchQuery(query, s.meta.project)),
      );
    }

    this.visibleSessions = filtered;

    const filterInfo = query ? ` filter="${query}"` : "";
    this.statusText.content =
      t`${fg(this.theme.muted)(` ${filtered.length} sessions${filterInfo}`)}`;

    this.select.options = filtered.map((s) => {
      const check = this.selected.has(s.meta.id) ? "[x]" : "[ ]";
      const date = s.meta.created_at.split("T")[0] ?? "";
      const project = s.meta.project ? ` ${s.meta.project}` : "";
      return {
        name: `${check} ${s.meta.title}`,
        description: `${date}${project}`,
        value: s.meta.id,
      };
    });
  }

  getSourceFilter(): SourceType | "all" {
    return this.sourceFilter;
  }

  selectById(id: string): void {
    const index = this.visibleSessions.findIndex((s) => s.meta.id === id);
    if (index >= 0) {
      // Suppress debounce callback — caller handles the load
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.suppressNextSelection = true;
      this.select.setSelectedIndex(index);
    }
  }

  selectFirst(): void {
    this.select.setSelectedIndex(0);
  }

  selectLast(): void {
    if (this.visibleSessions.length > 0) {
      this.select.setSelectedIndex(this.visibleSessions.length - 1);
    }
  }

  focus(): void {
    this.select.focus();
  }
}
