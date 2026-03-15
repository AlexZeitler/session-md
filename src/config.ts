import { parse, stringify } from "smol-toml";
import { homedir } from "os";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";

const CONFIG_DIR = join(homedir(), ".config", "session-md");
const CONFIG_PATH = join(CONFIG_DIR, "config.toml");

export interface Config {
  default_target: string;
  targets: Record<string, string>;
  sources: {
    claude_code?: string;
    opencode?: string;
    claude_export?: string;
    memorizer_url?: string;
    memorizer_output?: string;
  };
  theme?: Record<string, string>;
}

const DEFAULT_CONFIG: Config = {
  default_target: join(homedir(), "notes", "claude-chats"),
  targets: {
    vault: join(homedir(), "notes", "claude-chats"),
  },
  sources: {
    claude_code: join(homedir(), ".claude", "projects"),
    opencode: join(homedir(), ".local", "share", "opencode", "storage"),
  },
};

function expandTilde(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return join(homedir(), p.slice(1));
  }
  return p;
}

function expandPaths(config: Config): Config {
  config.default_target = expandTilde(config.default_target);

  for (const [key, val] of Object.entries(config.targets)) {
    config.targets[key] = expandTilde(val);
  }

  const sources = config.sources;
  if (sources.claude_code) sources.claude_code = expandTilde(sources.claude_code);
  if (sources.opencode) sources.opencode = expandTilde(sources.opencode);
  if (sources.claude_export) sources.claude_export = expandTilde(sources.claude_export);
  if (sources.memorizer_output)
    sources.memorizer_output = expandTilde(sources.memorizer_output);

  return config;
}

export async function loadConfig(): Promise<Config> {
  if (!existsSync(CONFIG_PATH)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
    await Bun.write(CONFIG_PATH, stringify(DEFAULT_CONFIG as any));
    return expandPaths({ ...DEFAULT_CONFIG });
  }

  const raw = await Bun.file(CONFIG_PATH).text();
  const parsed = parse(raw) as unknown as Config;

  const config: Config = {
    default_target: parsed.default_target ?? DEFAULT_CONFIG.default_target,
    targets: parsed.targets ?? DEFAULT_CONFIG.targets,
    sources: { ...DEFAULT_CONFIG.sources, ...parsed.sources },
    theme: (parsed as any).theme ?? undefined,
  };

  return expandPaths(config);
}

export async function addTarget(name: string, path: string): Promise<void> {
  const raw = await Bun.file(CONFIG_PATH).text();
  const parsed = parse(raw) as any;

  if (!parsed.targets) parsed.targets = {};
  parsed.targets[name] = path;

  await Bun.write(CONFIG_PATH, stringify(parsed));
}
