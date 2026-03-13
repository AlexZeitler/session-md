import { join, basename, dirname } from "path";
import { readdirSync, existsSync, statSync, readFileSync } from "fs";
import {
  type SessionEntry,
  type SessionMeta,
  buildFrontmatter,
  formatDate,
  truncateTitle,
} from "./types.ts";

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: ContentBlock[];
}

function extractTextFromContent(
  content: string | ContentBlock[],
): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const block of content) {
    if (block.type === "text" && block.text) {
      parts.push(block.text);
    } else if (block.type === "tool_use" && block.name) {
      const inputStr = block.input
        ? JSON.stringify(block.input, null, 2)
        : "";
      parts.push(`> **Tool**: ${block.name}\n> \`\`\`\n> ${inputStr}\n> \`\`\``);
    }
  }
  return parts.join("\n\n");
}

/**
 * Fast scan: only reads first few lines to extract title, no full parse.
 */
export function scanClaudeCodeSessions(
  sourcePath: string,
): SessionEntry[] {
  if (!existsSync(sourcePath)) return [];

  const entries: SessionEntry[] = [];

  const projectDirs = readdirSync(sourcePath, { withFileTypes: true })
    .filter((d) => d.isDirectory());

  for (const projDir of projectDirs) {
    const projPath = join(sourcePath, projDir.name);
    let jsonlFiles: string[];
    try {
      jsonlFiles = readdirSync(projPath).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }

    for (const file of jsonlFiles) {
      const filePath = join(projPath, file);
      const sessionId = basename(file, ".jsonl");

      try {
        const stat = statSync(filePath);
        if (stat.size === 0) continue;

        // Quick title extraction: read first ~4KB, find first user message
        const fd = require("fs").openSync(filePath, "r");
        const buf = Buffer.alloc(Math.min(stat.size, 4096));
        require("fs").readSync(fd, buf, 0, buf.length, 0);
        require("fs").closeSync(fd);

        let title = `Session ${sessionId.slice(0, 8)}`;
        const chunk = buf.toString("utf-8");
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.type === "user" && parsed.message?.content) {
              const text =
                typeof parsed.message.content === "string"
                  ? parsed.message.content
                  : "";
              if (text) {
                title = truncateTitle(text.split("\n")[0] ?? text);
                break;
              }
            }
          } catch {
            // Incomplete JSON line at buffer boundary — skip
          }
        }

        const date = formatDate(new Date(stat.mtime));
        const shortId = sessionId.slice(0, 8);

        entries.push({
          filename: `${date}-${shortId}.md`,
          sourcePath: filePath,
          meta: {
            title,
            id: sessionId,
            source: "claude-code",
            project: projDir.name,
            created_at: stat.mtime.toISOString(),
            updated_at: stat.mtime.toISOString(),
          },
        });
      } catch {
        // Skip corrupt files
      }
    }
  }

  return entries;
}

/**
 * Full parse: reads entire JSONL file and generates markdown.
 */
export function claudeCodeSessionToMd(jsonlPath: string): string {
  const text = readFileSync(jsonlPath, "utf-8");
  const lines = text.split("\n").filter((l: string) => l.trim());

  let title = "";
  let firstTimestamp = "";
  let lastTimestamp = "";
  let sessionId = "";
  const messages: string[] = [];

  for (const line of lines) {
    let parsed: any;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (!sessionId && parsed.sessionId) sessionId = parsed.sessionId;
    if (!firstTimestamp && parsed.timestamp) firstTimestamp = parsed.timestamp;
    if (parsed.timestamp) lastTimestamp = parsed.timestamp;

    if (parsed.type === "user" && parsed.message) {
      const text = extractTextFromContent(parsed.message.content);
      if (!text) continue;

      if (Array.isArray(parsed.message.content)) {
        const hasToolResult = parsed.message.content.some(
          (b: ContentBlock) => b.type === "tool_result",
        );
        if (hasToolResult) continue;
      }

      if (!title) title = truncateTitle(text.split("\n")[0] ?? text);
      messages.push(`## Human\n\n${text}`);
    } else if (parsed.type === "assistant" && parsed.message) {
      const text = extractTextFromContent(parsed.message.content);
      if (text) {
        messages.push(`## Claude\n\n${text}`);
      }
    }
  }

  if (!title) title = `Session ${sessionId.slice(0, 8)}`;

  const projectDir = basename(dirname(jsonlPath));
  const meta: SessionMeta = {
    title,
    id: sessionId,
    source: "claude-code",
    project: projectDir,
    created_at: firstTimestamp || new Date().toISOString(),
    updated_at: lastTimestamp || new Date().toISOString(),
  };

  const frontmatter = buildFrontmatter(meta);
  return `${frontmatter}\n\n# ${title}\n\n${messages.join("\n\n")}`;
}
