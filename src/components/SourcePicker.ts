import {
  SelectRenderable,
  SelectRenderableEvents,
  type SelectOption,
  type CliRenderer,
} from "@opentui/core";
import type { SourceType } from "../import/types.ts";

export type SourceChangedHandler = (source: SourceType | "all") => void;

const SOURCE_LABELS: Record<string, string> = {
  all: "All Sources",
  "claude-code": "Claude Code",
  opencode: "OpenCode",
  "claude-export": "Claude.ai Export",
  memorizer: "Memorizer",
};

export class SourcePicker {
  readonly select: SelectRenderable;
  private onSourceChanged: SourceChangedHandler | null = null;
  private currentSource: SourceType | "all" = "all";

  constructor(ctx: CliRenderer) {
    this.select = new SelectRenderable(ctx, {
      id: "source-picker",
      width: "100%" as any,
      height: 6,
      options: [
        { name: "All Sources (loading…)", description: "", value: "all" },
      ],
      showDescription: false,
      wrapSelection: true,
      selectedBackgroundColor: "#264f78",
      selectedTextColor: "#ffffff",
    });

    this.select.on(
      SelectRenderableEvents.SELECTION_CHANGED,
      (_index: number, option: SelectOption) => {
        this.currentSource = option.value as SourceType | "all";
        if (this.onSourceChanged) {
          this.onSourceChanged(this.currentSource);
        }
      },
    );
  }

  setOnSourceChanged(handler: SourceChangedHandler): void {
    this.onSourceChanged = handler;
  }

  getCurrentSource(): SourceType | "all" {
    return this.currentSource;
  }

  update(sourceCounts: Map<string, number>): void {
    const options: SelectOption[] = [];

    let total = 0;
    for (const count of sourceCounts.values()) total += count;

    options.push({
      name: `${SOURCE_LABELS["all"]} (${total})`,
      description: "",
      value: "all",
    });

    for (const [src, label] of Object.entries(SOURCE_LABELS)) {
      if (src === "all") continue;
      const count = sourceCounts.get(src) ?? 0;
      if (count === 0) continue;
      options.push({
        name: `${label} (${count})`,
        description: "",
        value: src,
      });
    }

    this.select.options = options;
  }

  focus(): void {
    this.select.focus();
  }
}
