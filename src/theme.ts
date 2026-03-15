import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";
import { parse } from "smol-toml";

export interface Theme {
  accent: string;
  foreground: string;
  background: string;
  muted: string;
  error: string;
  success: string;
  title: string;
  selection_bg: string;
  selection_fg: string;
  selection_desc: string;
  border_active: string;
  border_inactive: string;
  spinner: string;
  // Markdown syntax
  heading: string;
  strong: string;
  italic: string;
  code: string;
  link: string;
  link_url: string;
  list: string;
}

const DEFAULT_THEME: Theme = {
  accent: "#fab283",
  foreground: "#eeeeee",
  background: "#1a1a1a",
  muted: "#808080",
  error: "#e06c75",
  success: "#7fd88f",
  title: "#fab283",
  selection_bg: "#264f78",
  selection_fg: "#ffffff",
  selection_desc: "#a0c4e8",
  border_active: "cyan",
  border_inactive: "gray",
  spinner: "#00cccc",
  heading: "#9d7cd8",
  strong: "#f5a742",
  italic: "#e5c07b",
  code: "#7fd88f",
  link: "#56b6c2",
  link_url: "#fab283",
  list: "#fab283",
};

function loadOmarchyColors(): Partial<Theme> | null {
  const colorsPath = join(
    homedir(),
    ".config",
    "omarchy",
    "current",
    "theme",
    "colors.toml",
  );
  if (!existsSync(colorsPath)) return null;

  try {
    const raw = require("fs").readFileSync(colorsPath, "utf-8");
    const colors = parse(raw) as Record<string, string>;

    return {
      accent: colors.accent,
      foreground: colors.foreground,
      background: colors.background,
      muted: colors.color7,
      error: colors.color1,
      success: colors.color2,
      title: colors.accent,
      selection_bg: colors.selection_background,
      selection_fg: colors.selection_foreground,
      selection_desc: colors.color7,
      border_active: colors.accent,
      border_inactive: colors.color7,
      spinner: colors.color6,
      heading: colors.color5,
      strong: colors.color3,
      italic: colors.color3,
      code: colors.color2,
      link: colors.color6,
      link_url: colors.accent,
      list: colors.accent,
    };
  } catch {
    return null;
  }
}

function loadConfigTheme(
  configSources: Record<string, string> | undefined,
): Partial<Theme> | null {
  if (!configSources || Object.keys(configSources).length === 0) return null;
  return configSources as unknown as Partial<Theme>;
}

export function loadTheme(configTheme?: Record<string, string>): Theme {
  const omarchy = loadOmarchyColors();
  const config = loadConfigTheme(configTheme);

  return {
    ...DEFAULT_THEME,
    ...(omarchy ?? {}),
    ...(config ?? {}),
  };
}
