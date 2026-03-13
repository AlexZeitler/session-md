import {
  BoxRenderable,
  TextRenderable,
  type CliRenderer,
  t,
  fg,
  bold,
} from "@opentui/core";

export type FocusArea = "sidebar" | "main";

export class StatusBar {
  readonly container: BoxRenderable;
  private statusText: TextRenderable;
  private msgText: TextRenderable;

  constructor(private ctx: CliRenderer) {
    this.container = new BoxRenderable(ctx, {
      id: "status-bar",
      height: 3,
      width: "100%" as any,
      borderStyle: "rounded",
      borderColor: "gray",
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
        ? "j/k navigate  SPACE select  c copy  / filter  q quit"
        : "j/k scroll  Esc back  q quit";

    this.statusText.content = t`${fg("#7fd88f")(selPrefix)}${fg("#808080")(`${totalCount} sessions`)} | ${fg("#808080")(hint)}`;
  }

  showError(msg: string): void {
    this.msgText.content = t`${fg("#e06c75")(msg)}`;
    setTimeout(() => {
      this.msgText.content = "";
    }, 5000);
  }

  showInfo(msg: string): void {
    this.msgText.content = t`${fg("#7fd88f")(msg)}`;
    setTimeout(() => {
      this.msgText.content = "";
    }, 3000);
  }
}
