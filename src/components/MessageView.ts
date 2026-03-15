import {
  BoxRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  MarkdownRenderable,
  SyntaxStyle,
  parseColor,
  type CliRenderer,
  t,
  bold,
  fg,
} from "@opentui/core";
import type { SessionEntry } from "../import/types.ts";
import type { Theme } from "../theme.ts";
import { loadSessionMarkdownAsync } from "../import/loader.ts";

const SPINNER_FRAMES = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"];
const PREVIEW_LIMIT = 1500;

export class MessageView {
  readonly outerBox: BoxRenderable;
  private titleBar: TextRenderable;
  private scrollBox: ScrollBoxRenderable;
  private contentMarkdown: MarkdownRenderable;
  private syntaxStyle: SyntaxStyle;
  private currentEntry: SessionEntry | null = null;
  private loadGen = 0;
  private fullContent: string = "";
  private isPreview = false;
  private spinnerTimer: ReturnType<typeof setInterval> | null = null;
  private spinnerFrame = 0;
  private loadFull = false;

  constructor(private ctx: CliRenderer, private mainBox: BoxRenderable, private theme: Theme) {
    this.syntaxStyle = SyntaxStyle.fromStyles({
      default: { fg: parseColor(theme.foreground) },
      "markup.heading": { fg: parseColor(theme.heading), bold: true },
      "markup.heading.1": { fg: parseColor(theme.heading), bold: true },
      "markup.heading.2": { fg: parseColor(theme.heading), bold: true },
      "markup.heading.3": { fg: parseColor(theme.heading), bold: true },
      "markup.strong": { fg: parseColor(theme.strong), bold: true },
      "markup.italic": { fg: parseColor(theme.italic), italic: true },
      "markup.raw": { fg: parseColor(theme.code) },
      "markup.strikethrough": { dim: true },
      "markup.link.label": { fg: parseColor(theme.link), underline: true },
      "markup.link.url": { fg: parseColor(theme.link_url) },
      "markup.link": { fg: parseColor(theme.muted) },
      "markup.list": { fg: parseColor(theme.list) },
      "punctuation.special": { fg: parseColor(theme.muted) },
      conceal: { fg: parseColor(theme.muted) },
    });

    this.outerBox = new BoxRenderable(ctx, {
      id: "message-outer",
      flexDirection: "column",
      flexGrow: 1,
    });

    // Title bar as a TextRenderable inside the box — no border title issues
    this.titleBar = new TextRenderable(ctx, {
      id: "message-title",
      content: "",
      paddingLeft: 1,
      height: 1,
    });

    this.scrollBox = new ScrollBoxRenderable(ctx, {
      id: "message-scroll",
      rootOptions: {
        flexGrow: 1,
      },
      contentOptions: {
        flexDirection: "column",
        padding: 1,
      },
      viewportCulling: true,
    });

    this.contentMarkdown = new MarkdownRenderable(ctx, {
      id: "message-content",
      content: "",
      syntaxStyle: this.syntaxStyle,
      conceal: true,
    });

    this.scrollBox.add(this.contentMarkdown);
    this.outerBox.add(this.titleBar);
    this.outerBox.add(this.scrollBox);
  }

  load(entry: SessionEntry): void {
    this.currentEntry = entry;
    const gen = ++this.loadGen;

    // Dim content + start animated spinner in title bar
    this.scrollBox.opacity = 0.3;
    this.startSpinner(entry);

    loadSessionMarkdownAsync(entry)
      .then((md) => {
        if (this.loadGen !== gen) return;
        // Let spinner animate visibly before we block the main thread
        return new Promise<string>((resolve) =>
          setTimeout(() => resolve(md), 300),
        );
      })
      .then((md) => {
        if (!md || this.loadGen !== gen) return;

        let content = md;
        const fmEnd = content.indexOf("---", content.indexOf("---") + 3);
        if (fmEnd !== -1) {
          content = content.slice(fmEnd + 3).trimStart();
        }

        this.fullContent = content;

        // Only render a preview to keep sidebar navigation smooth (unless full requested)
        if (!this.loadFull && content.length > PREVIEW_LIMIT) {
          const cutoff = content.lastIndexOf("\n", PREVIEW_LIMIT);
          const preview = content.slice(0, cutoff > 0 ? cutoff : PREVIEW_LIMIT);
          this.contentMarkdown.content = preview + "\n\n---\n*Press Tab to view full content…*";
          this.isPreview = true;
        } else {
          this.contentMarkdown.content = content;
          this.isPreview = false;
        }

        // Stop spinner + un-dim AFTER content is set
        this.stopSpinner();
        this.scrollBox.opacity = 1;
        this.loadFull = false;
        this.setTitle(entry.meta.title, entry.meta.source);
        this.scrollBox.scrollTo(0);
      })
      .catch((err) => {
        if (this.loadGen !== gen) return;
        this.stopSpinner();
        this.scrollBox.opacity = 1;
        if (String(err) !== "Error: cancelled") {
          this.contentMarkdown.content = `**Error:** ${err}`;
          this.setTitle(entry.meta.title);
        }
      });
  }

  private setTitle(title: string, source?: string): void {
    if (source) {
      this.titleBar.content = t`${bold(fg(this.theme.title)(` ${title}`))} ${fg(this.theme.muted)(`(${source})`)}`;
    } else {
      this.titleBar.content = t`${bold(fg(this.theme.title)(` ${title}`))}`;
    }
  }

  private startSpinner(entry: SessionEntry): void {
    this.stopSpinner();
    this.spinnerFrame = 0;
    this.titleBar.content = t`${fg(this.theme.spinner)(` ${SPINNER_FRAMES[0]}`)} ${fg(this.theme.muted)(entry.meta.title)}`;
    this.spinnerTimer = setInterval(() => {
      this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER_FRAMES.length;
      if (this.currentEntry) {
        this.titleBar.content = t`${fg(this.theme.spinner)(` ${SPINNER_FRAMES[this.spinnerFrame]}`)} ${fg(this.theme.muted)(this.currentEntry.meta.title)}`;
      }
    }, 80);
  }

  private stopSpinner(): void {
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
    }
  }

  clear(): void {
    this.currentEntry = null;
    this.loadGen++;
    this.stopSpinner();
    this.titleBar.content = "";
    this.mainBox.title = "";
    this.contentMarkdown.content = "";
    this.scrollBox.opacity = 1;
    this.scrollBox.scrollTo(0);
  }

  getCurrentEntry(): SessionEntry | null {
    return this.currentEntry;
  }

  /** Expand truncated preview to full content (called when user focuses main panel) */
  expandFull(): void {
    if (this.isPreview && this.fullContent) {
      this.scrollBox.opacity = 0.3;
      if (this.currentEntry) {
        this.startSpinner(this.currentEntry);
      }
      // Let spinner animate visibly, then set full content
      setTimeout(() => {
        this.contentMarkdown.content = this.fullContent;
        this.isPreview = false;
        this.stopSpinner();
        this.scrollBox.opacity = 1;
        if (this.currentEntry) {
          this.setTitle(this.currentEntry.meta.title, this.currentEntry.meta.source);
        }
      }, 300);
    }
  }

  /** Next load() will render full content instead of preview */
  setLoadFull(full: boolean): void {
    this.loadFull = full;
  }

  get container(): ScrollBoxRenderable {
    return this.scrollBox;
  }

  scrollDown(): void {
    this.scrollBox.scrollBy(1);
  }

  scrollUp(): void {
    this.scrollBox.scrollBy(-1);
  }

  pageDown(): void {
    this.scrollBox.scrollBy(10);
  }

  pageUp(): void {
    this.scrollBox.scrollBy(-10);
  }

  scrollToTop(): void {
    this.scrollBox.scrollTo(0);
  }

  scrollToBottom(): void {
    this.scrollBox.scrollTo(999999);
  }
}
