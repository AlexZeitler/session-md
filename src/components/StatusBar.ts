import {
  BoxRenderable,
  TextRenderable,
  type CliRenderer,
  t,
  fg,
  bold,
} from "@opentui/core";
import type { Theme } from "../theme.ts";

export type FocusArea = "sidebar" | "main";

export class StatusBar {
  readonly container: BoxRenderable;
  private statusText: TextRenderable;
  private msgText: TextRenderable;

  constructor(private ctx: CliRenderer, private theme: Theme) {
    this.container = new BoxRenderable(ctx, {
      id: "status-bar",
      height: 3,
      width: "100%" as any,
      borderStyle: "rounded",
      borderColor: this.theme.border_inactive,
      flexDirection: "row",
      justifyContent: "space-between",
    });

    this.statusText = new TextRenderable(ctx, {
      id: "status-text",
      content: "",
      paddingLeft: 1,
    });

    this.msgText = new TextRenderable(ctx, {
      id: "msg-text",
      content: "",
      paddingRight: 1,
    });

    this.container.add(this.statusText);
    this.container.add(this.msgText);
  }

  update(selectedCount: number, totalCount: number, focus: FocusArea): void {
    const selPrefix =
      selectedCount > 0 ? `${selectedCount} selected | ` : "";

    const hint =
      focus === "sidebar"
        ? "j/k navigate  gg/G top/end  SPACE select  c copy  / filter  g grep  q quit"
        : "j/k scroll  gg/G top/end  Esc back  q quit";

    this.statusText.content = t`${fg(this.theme.success)(selPrefix)}${fg(this.theme.muted)(`${totalCount} sessions`)} | ${fg(this.theme.muted)(hint)}`;
  }

  showError(msg: string): void {
    this.msgText.content = t`${fg(this.theme.error)(msg)}`;
    setTimeout(() => {
      this.msgText.content = "";
    }, 5000);
  }

  showInfo(msg: string): void {
    this.msgText.content = t`${fg(this.theme.success)(msg)}`;
    setTimeout(() => {
      this.msgText.content = "";
    }, 3000);
  }
}
