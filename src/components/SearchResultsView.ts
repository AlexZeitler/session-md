import {
  BoxRenderable,
  InputRenderable,
  InputRenderableEvents,
  SelectRenderable,
  SelectRenderableEvents,
  TextRenderable,
  type CliRenderer,
  t,
  fg,
  bold,
} from "@opentui/core";
import type { SearchResult } from "../search/index.ts";
import type { Theme } from "../theme.ts";

export class SearchResultsView {
  readonly container: BoxRenderable;
  readonly searchInput: InputRenderable;
  readonly select: SelectRenderable;
  private statusText: TextRenderable;
  private results: SearchResult[] = [];
  private inputFocused = true;
  private onResultSelected: ((result: SearchResult) => void) | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private onSearchQuery: ((query: string) => SearchResult[]) | null = null;

  constructor(private ctx: CliRenderer, private theme: Theme) {
    this.container = new BoxRenderable(ctx, {
      id: "search-results",
      flexDirection: "column",
      flexGrow: 1,
    });

    this.searchInput = new InputRenderable(ctx, {
      id: "search-input",
      width: 40,
      placeholder: "Search content...",
    });

    this.statusText = new TextRenderable(ctx, {
      id: "search-status",
      content: "",
      paddingLeft: 1,
    });

    this.select = new SelectRenderable(ctx, {
      id: "search-select",
      flexGrow: 1,
      options: [],
      showDescription: true,
      showScrollIndicator: true,
      wrapSelection: true,
      selectedBackgroundColor: this.theme.selection_bg,
      selectedTextColor: this.theme.selection_fg,
      selectedDescriptionColor: this.theme.selection_desc,
    });

    this.container.add(this.searchInput);
    this.container.add(this.statusText);
    this.container.add(this.select);

    this.searchInput.on(InputRenderableEvents.INPUT, () => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.executeSearch();
      }, 300);
    });

    this.select.on(
      SelectRenderableEvents.SELECTION_CHANGED,
      (_index: number) => {
        // Could preview on focus change
      },
    );
  }

  setOnSearchQuery(handler: (query: string) => SearchResult[]): void {
    this.onSearchQuery = handler;
  }

  setOnResultSelected(handler: (result: SearchResult) => void): void {
    this.onResultSelected = handler;
  }

  private executeSearch(): void {
    const query = this.searchInput.value.trim();
    if (!query || !this.onSearchQuery) {
      this.results = [];
      this.select.options = [];
      this.statusText.content = t`${fg(this.theme.muted)(" Type to search...")}`;
      return;
    }

    this.results = this.onSearchQuery(query);
    this.statusText.content = t`${fg(this.theme.muted)(` ${this.results.length} result(s)`)}`;

    if (this.results.length === 0) {
      this.select.options = [{ name: "No results", description: "", value: "__none__" }];
    } else {
      this.select.options = this.results.map((r) => ({
        name: `${r.title}`,
        description: `${r.snippet}`,
        value: r.id,
      }));
    }
  }

  isInputFocused(): boolean {
    return this.inputFocused;
  }

  focusInput(): void {
    this.inputFocused = true;
    this.searchInput.focus();
  }

  focusList(): void {
    this.inputFocused = false;
    this.select.focus();
  }

  getSelectedResult(): SearchResult | undefined {
    const opt = this.select.getSelectedOption();
    if (!opt || opt.value === "__none__") return undefined;
    return this.results.find((r) => r.id === opt.value);
  }

  selectCurrentResult(): void {
    const result = this.getSelectedResult();
    if (result && this.onResultSelected) {
      this.onResultSelected(result);
    }
  }

  reset(): void {
    this.searchInput.value = "";
    this.results = [];
    this.select.options = [{ name: "", description: "", value: "__none__" }];
    this.inputFocused = true;
    this.statusText.content = t`${fg(this.theme.muted)(" Type to search...")}`;
  }

  focus(): void {
    this.focusInput();
  }
}
