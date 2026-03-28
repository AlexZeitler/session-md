/**
 * session-md MCP Server
 *
 * Exposes session search, listing, retrieval, and import as MCP tools.
 * Shared by both stdio and HTTP transports.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SearchIndex } from "../search/index.ts";
import { loadSessionMarkdownSync } from "../import/loader.ts";
import { scanClaudeCodeSessions } from "../import/claude-code-to-md.ts";
import { scanOpencodeSessions } from "../import/opencode-to-md.ts";
import { scanMemorizerMemories } from "../import/memorizer-to-md.ts";
import { importClaudeExport } from "../import/claude-export-to-md.ts";
import { loadConfig, type Config } from "../config.ts";
import type { SessionEntry, SourceType } from "../import/types.ts";

const { version } = require("../../package.json");

export type SessionStore = {
  config: Config;
  searchIndex: SearchIndex;
  sessions: SessionEntry[];
};

/**
 * Scan all configured sources and build/update the search index.
 * Returns the populated SessionStore.
 */
export async function createSessionStore(): Promise<SessionStore> {
  const config = await loadConfig();
  const sessions: SessionEntry[] = [];

  if (config.sources.claude_code) {
    try {
      sessions.push(...scanClaudeCodeSessions(config.sources.claude_code));
    } catch {
      // skip
    }
  }

  if (config.sources.opencode) {
    try {
      sessions.push(...scanOpencodeSessions(config.sources.opencode));
    } catch {
      // skip
    }
  }

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
      sessions.push(...entries);
    }
  }

  sessions.sort(
    (a, b) =>
      new Date(b.meta.created_at).getTime() -
      new Date(a.meta.created_at).getTime(),
  );

  const searchIndex = new SearchIndex();
  searchIndex.indexSessions(sessions);

  const validIds = new Set(sessions.map((s) => s.meta.id));
  searchIndex.cleanup(validIds);

  return { config, searchIndex, sessions };
}

/**
 * Create an MCP server with all session-md tools registered.
 */
export async function createMcpServer(store: SessionStore): Promise<McpServer> {
  const server = new McpServer(
    { name: "session-md", version },
    {
      instructions: [
        `session-md provides access to ${store.sessions.length} AI chat sessions`,
        `from Claude Code, Claude.ai exports, OpenCode, and Memorizer.`,
        "",
        "Tools:",
        "  - search_sessions: Full-text search across all sessions",
        "  - list_sessions: List sessions, optionally filtered by source",
        "  - get_session: Retrieve full markdown content of a session by ID",
        "  - import_sessions: Re-scan all configured sources and update the index",
      ].join("\n"),
    },
  );

  // --- search_sessions ---
  server.registerTool(
    "search_sessions",
    {
      title: "Search sessions",
      description:
        "Full-text search across all indexed AI chat sessions. Returns matching sessions with snippets.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {
        query: z.string().describe("Search query (keywords, AND logic)"),
        source: z
          .enum(["claude-code", "claude-export", "opencode", "memorizer", "all"])
          .optional()
          .describe("Filter by source type (default: all)"),
        limit: z
          .number()
          .optional()
          .describe("Max results to return (default: 20)"),
      },
    },
    async ({ query, source, limit }) => {
      const results = store.searchIndex.search(
        query,
        source ?? "all",
        limit ?? 20,
      );

      if (results.length === 0) {
        return {
          content: [{ type: "text", text: `No results found for "${query}"` }],
        };
      }

      const lines = [
        `Found ${results.length} result${results.length === 1 ? "" : "s"} for "${query}":\n`,
      ];
      for (const r of results) {
        lines.push(`- **${r.title}** [${r.source}] (id: ${r.id})`);
        if (r.project) lines.push(`  Project: ${r.project}`);
        if (r.snippet) lines.push(`  ${r.snippet}`);
        lines.push("");
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  // --- list_sessions ---
  server.registerTool(
    "list_sessions",
    {
      title: "List sessions",
      description:
        "List all indexed AI chat sessions, optionally filtered by source. Returns metadata (no content).",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {
        source: z
          .enum(["claude-code", "claude-export", "opencode", "memorizer", "all"])
          .optional()
          .describe("Filter by source type (default: all)"),
        limit: z
          .number()
          .optional()
          .describe("Max results to return (default: 50)"),
        offset: z
          .number()
          .optional()
          .describe("Skip first N results (default: 0)"),
      },
    },
    async ({ source, limit, offset }) => {
      let filtered = store.sessions;
      if (source && source !== "all") {
        filtered = filtered.filter((s) => s.meta.source === source);
      }

      const start = offset ?? 0;
      const end = start + (limit ?? 50);
      const page = filtered.slice(start, end);

      const lines = [
        `${filtered.length} sessions total${source && source !== "all" ? ` (source: ${source})` : ""}, showing ${start + 1}-${Math.min(end, filtered.length)}:\n`,
      ];

      for (const s of page) {
        lines.push(
          `- **${s.meta.title}** [${s.meta.source}] ${s.meta.created_at} (id: ${s.meta.id})`,
        );
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  // --- get_session ---
  server.registerTool(
    "get_session",
    {
      title: "Get session content",
      description:
        "Retrieve the full markdown content of a session by its ID.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: {
        id: z.string().describe("Session ID (UUID or short ID from search results)"),
      },
    },
    async ({ id }) => {
      const entry = store.sessions.find((s) => s.meta.id === id);
      if (!entry) {
        return {
          content: [{ type: "text", text: `Session not found: ${id}` }],
          isError: true,
        };
      }

      try {
        const md = loadSessionMarkdownSync(entry);
        return { content: [{ type: "text", text: md }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to load session ${id}: ${err}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // --- import_sessions ---
  server.registerTool(
    "import_sessions",
    {
      title: "Import sessions",
      description:
        "Re-scan all configured sources and update the search index. Returns import statistics.",
      annotations: { readOnlyHint: false, openWorldHint: false },
      inputSchema: {},
    },
    async () => {
      const oldCount = store.sessions.length;

      // Re-scan all sources
      const newSessions: SessionEntry[] = [];

      if (store.config.sources.claude_code) {
        try {
          newSessions.push(
            ...scanClaudeCodeSessions(store.config.sources.claude_code),
          );
        } catch {
          // skip
        }
      }

      if (store.config.sources.opencode) {
        try {
          newSessions.push(
            ...scanOpencodeSessions(store.config.sources.opencode),
          );
        } catch {
          // skip
        }
      }

      const asyncLoaders: Promise<SessionEntry[]>[] = [];

      if (store.config.sources.memorizer_url) {
        asyncLoaders.push(
          scanMemorizerMemories(store.config.sources.memorizer_url).catch(
            () => [],
          ),
        );
      }

      if (store.config.sources.claude_export) {
        asyncLoaders.push(
          importClaudeExport(store.config.sources.claude_export).catch(
            () => [],
          ),
        );
      }

      if (asyncLoaders.length > 0) {
        const results = await Promise.all(asyncLoaders);
        for (const entries of results) {
          newSessions.push(...entries);
        }
      }

      newSessions.sort(
        (a, b) =>
          new Date(b.meta.created_at).getTime() -
          new Date(a.meta.created_at).getTime(),
      );

      const indexed = store.searchIndex.indexSessions(newSessions);
      const validIds = new Set(newSessions.map((s) => s.meta.id));
      const removed = store.searchIndex.cleanup(validIds);

      // Update store in-place
      store.sessions = newSessions;

      return {
        content: [
          {
            type: "text",
            text: [
              `Import complete.`,
              `Sessions: ${oldCount} -> ${newSessions.length}`,
              `Indexed: ${indexed} new/updated`,
              `Removed: ${removed} stale`,
            ].join("\n"),
          },
        ],
      };
    },
  );

  return server;
}
