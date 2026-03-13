import { existsSync } from "fs";
import {
  type SessionEntry,
  type SessionMeta,
  buildFrontmatter,
  formatDate,
  slugify,
  truncateTitle,
} from "./types.ts";

interface ClaudeConversation {
  uuid: string;
  name: string;
  created_at: string;
  updated_at: string;
  chat_messages: ChatMessage[];
}

interface ChatMessage {
  uuid: string;
  sender: string;
  text: string;
  created_at: string;
  content?: ContentBlock[];
}

interface ContentBlock {
  type: string;
  text?: string;
}

function extractText(msg: ChatMessage): string {
  if (msg.text) return msg.text;
  if (msg.content) {
    return msg.content
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text!)
      .join("\n\n");
  }
  return "";
}

function conversationToMd(conv: ClaudeConversation): string {
  const title = conv.name || truncateTitle(conv.chat_messages[0]?.text ?? "Untitled");

  const meta: SessionMeta = {
    title,
    id: conv.uuid,
    source: "claude-export",
    created_at: conv.created_at,
    updated_at: conv.updated_at,
  };

  const messages: string[] = [];
  for (const msg of conv.chat_messages) {
    const text = extractText(msg);
    if (!text) continue;

    const role = msg.sender === "human" ? "Human" : "Claude";
    messages.push(`## ${role}\n\n${text}`);
  }

  const frontmatter = buildFrontmatter(meta);
  return `${frontmatter}\n\n# ${title}\n\n${messages.join("\n\n")}`;
}

/**
 * Import Claude.ai export (ZIP or conversations.json).
 * Returns SessionEntry[] with pre-generated markdown.
 */
export async function importClaudeExport(
  filePath: string,
): Promise<SessionEntry[]> {
  if (!existsSync(filePath)) return [];

  let conversations: ClaudeConversation[];

  if (filePath.endsWith(".zip")) {
    const proc = Bun.spawnSync({
      cmd: ["unzip", "-p", filePath, "conversations.json"],
      stdout: "pipe",
    });

    if (proc.exitCode !== 0) {
      throw new Error("Failed to extract conversations.json from ZIP");
    }

    conversations = JSON.parse(new TextDecoder().decode(proc.stdout));
  } else {
    const raw = await Bun.file(filePath).text();
    conversations = JSON.parse(raw);
  }

  if (!Array.isArray(conversations)) return [];

  const entries: SessionEntry[] = [];
  for (const conv of conversations) {
    if (!conv.chat_messages || conv.chat_messages.length === 0) continue;

    const md = conversationToMd(conv);
    const date = formatDate(new Date(conv.created_at));
    const slug = slugify(conv.name || "untitled");

    entries.push({
      filename: `${date}-${slug}.md`,
      sourcePath: filePath,
      md,
      meta: {
        title: conv.name || "Untitled",
        id: conv.uuid,
        source: "claude-export",
        created_at: conv.created_at,
        updated_at: conv.updated_at,
      },
    });
  }

  return entries;
}

