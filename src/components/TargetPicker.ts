import {
  BoxRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  TextRenderable,
  InputRenderable,
  InputRenderableEvents,
  type SelectOption,
  type CliRenderer,
  t,
  fg,
  bold,
} from "@opentui/core";
import type { Theme } from "../theme.ts";

export class TargetPicker {
  readonly container: BoxRenderable;
  readonly select: SelectRenderable;
  private headerText: TextRenderable;
  private nameInput: InputRenderable;
  private pathInput: InputRenderable;
  private inputContainer: BoxRenderable;
  private enteringNew = false;
  private inputStep: "path" | "name" = "path";

  onTargetSelected: ((targetPath: string) => void) | null = null;
  onNewTarget: ((name: string, path: string) => void) | null = null;
  onCancel: (() => void) | null = null;

  constructor(private ctx: CliRenderer, private theme?: Theme) {
    this.container = new BoxRenderable(ctx, {
      id: "target-picker",
      flexDirection: "column",
      flexGrow: 1,
      padding: 1,
      gap: 1,
    });

    this.headerText = new TextRenderable(ctx, {
      id: "target-header",
      content: "",
    });

    this.select = new SelectRenderable(ctx, {
      id: "target-select",
      flexGrow: 1,
      options: [],
      showDescription: true,
      wrapSelection: true,
      selectedBackgroundColor: this.theme?.selection_bg ?? "#264f78",
      selectedTextColor: this.theme?.selection_fg ?? "#ffffff",
      selectedDescriptionColor: this.theme?.selection_desc ?? "#a0c4e8",
    });

    this.inputContainer = new BoxRenderable(ctx, {
      id: "target-input-container",
      flexDirection: "column",
      gap: 1,
      padding: 1,
    });

    const pathLabel = new TextRenderable(ctx, {
      id: "target-path-label",
      content: t`${bold("Path:")}`,
    });

    this.pathInput = new InputRenderable(ctx, {
      id: "target-path-input",
      width: 60,
      placeholder: "~/path/to/folder",
    });

    const nameLabel = new TextRenderable(ctx, {
      id: "target-name-label",
      content: t`${bold("Name (optional):")}`,
    });

    this.nameInput = new InputRenderable(ctx, {
      id: "target-name-input",
      width: 30,
      placeholder: "short name",
    });

    this.inputContainer.add(pathLabel);
    this.inputContainer.add(this.pathInput);
    this.inputContainer.add(nameLabel);
    this.inputContainer.add(this.nameInput);

    this.container.add(this.headerText);
    this.container.add(this.select);

    this.select.on(
      SelectRenderableEvents.ITEM_SELECTED,
      (_index: number, option: SelectOption) => {
        if (option.value === "__new__") {
          this.showNewTargetInput();
        } else if (this.onTargetSelected) {
          this.onTargetSelected(option.value);
        }
      },
    );

    this.pathInput.on(InputRenderableEvents.ENTER, () => {
      this.nameInput.focus();
    });

    this.nameInput.on(InputRenderableEvents.ENTER, () => {
      const path = this.pathInput.value.trim();
      if (!path) return;
      const name = this.nameInput.value.trim();
      if (this.onNewTarget) {
        this.onNewTarget(name, path);
      }
    });
  }

  show(targets: Record<string, string>, fileCount: number): void {
    this.enteringNew = false;
    this.headerText.content = t`${bold(`Copy ${fileCount} file(s) to...`)}`;

    const options: SelectOption[] = Object.entries(targets).map(
      ([name, path]) => ({
        name,
        description: path,
        value: path,
      }),
    );
    options.push({
      name: "[+ new folder...]",
      description: "",
      value: "__new__",
    });

    this.select.options = options;
  }

  private showNewTargetInput(): void {
    this.enteringNew = true;
    this.container.remove(this.select.id);
    this.container.add(this.inputContainer);
    this.pathInput.value = "";
    this.nameInput.value = "";
    this.pathInput.focus();
  }

  hideNewTargetInput(): void {
    if (this.enteringNew) {
      this.enteringNew = false;
      this.container.remove(this.inputContainer.id);
      this.container.add(this.select);
      this.select.focus();
    }
  }

  isEnteringNew(): boolean {
    return this.enteringNew;
  }

  focus(): void {
    if (this.enteringNew) {
      this.pathInput.focus();
    } else {
      this.select.focus();
    }
  }

  reset(): void {
    this.enteringNew = false;
    this.pathInput.value = "";
    this.nameInput.value = "";
    this.headerText.content = "";
    this.select.options = [];
  }
}
