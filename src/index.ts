#!/usr/bin/env bun

import { createCliRenderer } from "@opentui/core";
import { loadConfig } from "./config.ts";
import { App } from "./app.ts";
import { scanClaudeCodeSessions } from "./import/claude-code-to-md.ts";
import { scanOpencodeSessions } from "./import/opencode-to-md.ts";
import { scanMemorizerMemories } from "./import/memorizer-to-md.ts";
import { importClaudeExport } from "./import/claude-export-to-md.ts";
import type { SessionEntry } from "./import/types.ts";
import { SearchIndex, deleteIndex } from "./search/index.ts";
import { loadTheme } from "./theme.ts";

const { version } = require("../package.json");

if (process.argv.includes("--version")) {
  console.log(`session-md v${version}`);
  process.exit(0);
}

const command = process.argv[2];

if (command === "update") {
  const oldVersion = version;
  console.log(`Current version: v${oldVersion}`);
  console.log("Checking for updates...");

  try {
    const res = await fetch("https://registry.npmjs.org/@alexzeitler/session-md/latest");
    if (!res.ok) {
      console.error(`Failed to check for updates (HTTP ${res.status})`);
      process.exit(1);
    }
    const pkg = await res.json() as { version: string };
    const latestVersion = pkg.version;

    if (latestVersion === oldVersion) {
      console.log(`✓ session-md v${oldVersion} is already up to date`);
      process.exit(0);
    }

    console.log(`New version available: v${latestVersion}`);
    console.log("Installing...");

    const proc = Bun.spawnSync({
      cmd: ["bun", "install", "-g", "@alexzeitler/session-md@" + latestVersion],
      stdout: "inherit",
      stderr: "inherit",
    });

    if (proc.exitCode !== 0) {
      console.error("Update failed");
      process.exit(proc.exitCode ?? 1);
    }

    console.log(`✓ Updated session-md v${oldVersion} → v${latestVersion}`);
  } catch (err) {
    console.error(`Update failed: ${err}`);
    process.exit(1);
  }
  process.exit(0);
}

if (command === "reindex") {
  deleteIndex();
  console.log("✓ Search index deleted, will rebuild on next start.");
  process.exit(0);
}

// --- MCP subcommand ---
if (command === "mcp") {
  const sub = process.argv[3];
  const args = process.argv.slice(3);
  const hasFlag = (f: string) => args.includes(f);
  const getFlagValue = (f: string) => {
    const idx = args.indexOf(f);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };

  const { resolve } = await import("path");
  const { homedir } = await import("os");
  const { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, openSync, closeSync } = await import("fs");
  const { spawn: nodeSpawn } = await import("child_process");
  const { fileURLToPath } = await import("url");

  const cacheDir = process.env.XDG_CACHE_HOME
    ? resolve(process.env.XDG_CACHE_HOME, "session-md")
    : resolve(homedir(), ".cache", "session-md");
  const pidPath = resolve(cacheDir, "mcp.pid");

  if (sub === "stop") {
    if (!existsSync(pidPath)) {
      console.log("Not running (no PID file).");
      process.exit(0);
    }
    const pid = parseInt(readFileSync(pidPath, "utf-8").trim());
    try {
      process.kill(pid, 0);
      process.kill(pid, "SIGTERM");
      unlinkSync(pidPath);
      console.log(`Stopped session-md MCP server (PID ${pid}).`);
    } catch {
      unlinkSync(pidPath);
      console.log("Cleaned up stale PID file (server was not running).");
    }
    process.exit(0);
  }

  if (hasFlag("--http")) {
    const port = Number(getFlagValue("--port")) || 8282;

    if (hasFlag("--daemon")) {
      // Guard: check if already running
      if (existsSync(pidPath)) {
        const existingPid = parseInt(readFileSync(pidPath, "utf-8").trim());
        try {
          process.kill(existingPid, 0);
          console.error(`Already running (PID ${existingPid}). Run 'session-md mcp stop' first.`);
          process.exit(1);
        } catch {
          // Stale PID file — continue
        }
      }

      mkdirSync(cacheDir, { recursive: true });
      const logPath = resolve(cacheDir, "mcp.log");
      const logFd = openSync(logPath, "w");
      const selfPath = fileURLToPath(import.meta.url);
      const child = nodeSpawn(process.execPath, [selfPath, "mcp", "--http", "--port", String(port)], {
        stdio: ["ignore", logFd, logFd],
        detached: true,
      });
      child.unref();
      closeSync(logFd);

      writeFileSync(pidPath, String(child.pid));
      console.log(`Started on http://localhost:${port}/mcp (PID ${child.pid})`);
      console.log(`Logs: ${logPath}`);
      process.exit(0);
    }

    // Foreground HTTP mode
    const { startMcpHttpServer } = await import("./mcp/http.ts");
    try {
      await startMcpHttpServer(port);
    } catch (e: any) {
      if (e?.code === "EADDRINUSE") {
        console.error(`Port ${port} already in use. Try a different port with --port.`);
        process.exit(1);
      }
      throw e;
    }
  } else {
    // Default: stdio transport
    const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
    const { createMcpServer, createSessionStore } = await import("./mcp/server.ts");
    const store = await createSessionStore();
    const server = await createMcpServer(store);
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }

  // Block forever — HTTP server and stdio transport keep the process alive
  // via the event loop; this prevents falling through to the TUI code below.
  await new Promise(() => {});
}

const SPINNER_FRAMES = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"];

function printSpinner(frame: number, msg: string): void {
  process.stdout.write(`\r${SPINNER_FRAMES[frame % SPINNER_FRAMES.length]} ${msg}`);
}

function clearLine(): void {
  process.stdout.write("\r\x1b[K");
}

const config = await loadConfig();

// Phase 1: Collect all sessions (CLI, before TUI)
const allSessions: SessionEntry[] = [];
let spinnerFrame = 0;

printSpinner(spinnerFrame++, "Scanning sources...");

if (config.sources.claude_code) {
  try {
    const entries = scanClaudeCodeSessions(config.sources.claude_code);
    allSessions.push(...entries);
    printSpinner(spinnerFrame++, `Scanned claude-code: ${entries.length} sessions`);
  } catch {
    // Silently skip
  }
}

if (config.sources.opencode) {
  try {
    const entries = scanOpencodeSessions(config.sources.opencode);
    allSessions.push(...entries);
    printSpinner(spinnerFrame++, `Scanned opencode: ${entries.length} sessions`);
  } catch {
    // Silently skip
  }
}

// Async sources
const asyncLoaders: Promise<SessionEntry[]>[] = [];

if (config.sources.memorizer_url) {
  asyncLoaders.push(
    scanMemorizerMemories(config.sources.memorizer_url).catch(() => []),
  );
}

if (config.sources.claude_export) {
  asyncLoaders.push(
    importClaudeExport(config.sources.claude_export).catch(() => []),
  );
}

if (asyncLoaders.length > 0) {
  printSpinner(spinnerFrame++, "Loading async sources...");
  const results = await Promise.all(asyncLoaders);
  for (const entries of results) {
    allSessions.push(...entries);
  }
}

allSessions.sort(
  (a, b) =>
    new Date(b.meta.created_at).getTime() -
    new Date(a.meta.created_at).getTime(),
);

printSpinner(spinnerFrame++, `${allSessions.length} sessions total. Indexing...`);

// Phase 2: Build/update search index
const searchIndex = new SearchIndex();

const spinnerInterval = setInterval(() => {
  // Keep spinner animation alive during indexing
  spinnerFrame++;
}, 80);

const indexed = searchIndex.indexSessions(allSessions, (current, total) => {
  printSpinner(spinnerFrame++, `Indexing ${current}/${total}...`);
});

// Cleanup stale entries
const validIds = new Set(allSessions.map((s) => s.meta.id));
const removed = searchIndex.cleanup(validIds);

clearInterval(spinnerInterval);

if (indexed > 0 || removed > 0) {
  clearLine();
  console.log(`✓ Indexed ${indexed} new/updated, removed ${removed} stale entries`);
} else {
  clearLine();
  console.log(`✓ Search index up to date (${allSessions.length} sessions)`);
}

// Phase 3: Start TUI
let renderer: Awaited<ReturnType<typeof createCliRenderer>> | null = null;

try {
  renderer = await createCliRenderer({
    exitOnCtrlC: true,
  });

  const theme = loadTheme(config.theme);
  const app = new App(renderer, config, searchIndex, theme);
  await app.start();
  app.loadSessions(allSessions);
} catch (err) {
  if (renderer) {
    renderer.destroy();
  }
  searchIndex.close();
  console.error("Failed to start session-md:", err);
  process.exit(1);
}
