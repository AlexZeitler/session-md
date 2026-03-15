#!/usr/bin/env bun

import { createCliRenderer } from "@opentui/core";
import { loadConfig } from "./config.ts";
import { App } from "./app.ts";
import { scanClaudeCodeSessions } from "./import/claude-code-to-md.ts";
import { scanOpencodeSessions } from "./import/opencode-to-md.ts";
import { scanMemorizerMemories } from "./import/memorizer-to-md.ts";
import { importClaudeExport } from "./import/claude-export-to-md.ts";
import type { SessionEntry } from "./import/types.ts";
import { SearchIndex } from "./search/index.ts";

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

  const app = new App(renderer, config, searchIndex);
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
