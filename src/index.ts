#!/usr/bin/env bun

import { createCliRenderer } from "@opentui/core";
import { loadConfig } from "./config.ts";
import { App } from "./app.ts";
import { scanClaudeCodeSessions } from "./import/claude-code-to-md.ts";
import { scanOpencodeSessions } from "./import/opencode-to-md.ts";
import { scanMemorizerMemories } from "./import/memorizer-to-md.ts";
import { importClaudeExport } from "./import/claude-export-to-md.ts";
import type { SessionEntry } from "./import/types.ts";

const config = await loadConfig();

let renderer: Awaited<ReturnType<typeof createCliRenderer>> | null = null;

try {
  renderer = await createCliRenderer({
    exitOnCtrlC: true,
  });

  const app = new App(renderer, config);
  await app.start();

  // Fast scan: collect metadata only (no JSONL parsing)
  const allSessions: SessionEntry[] = [];

  if (config.sources.claude_code) {
    try {
      const entries = scanClaudeCodeSessions(config.sources.claude_code);
      allSessions.push(...entries);
    } catch {
      // Silently skip
    }
  }

  if (config.sources.opencode) {
    try {
      const entries = scanOpencodeSessions(config.sources.opencode);
      allSessions.push(...entries);
    } catch {
      // Silently skip
    }
  }

  // Load sessions into UI immediately (fast sources first)
  allSessions.sort(
    (a, b) =>
      new Date(b.meta.created_at).getTime() -
      new Date(a.meta.created_at).getTime(),
  );
  app.loadSessions(allSessions);

  // Then load async sources (may be slow: network, ZIP extraction)
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
    const results = await Promise.all(asyncLoaders);
    for (const entries of results) {
      allSessions.push(...entries);
    }
    allSessions.sort(
      (a, b) =>
        new Date(b.meta.created_at).getTime() -
        new Date(a.meta.created_at).getTime(),
    );
    app.loadSessions(allSessions);
  }
} catch (err) {
  if (renderer) {
    renderer.destroy();
  }
  console.error("Failed to start session-md:", err);
  process.exit(1);
}
