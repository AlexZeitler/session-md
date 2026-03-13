import { join } from "path";
import { readdirSync, existsSync, readFileSync } from "fs";
import {
  type SessionEntry,
  type SessionMeta,
  buildFrontmatter,
  formatDate,
  truncateTitle,
} from "./types.ts";

interface OcSession {
  id: string;
  version: string;
  title: string;
  time: { created: number; updated: number };
}

interface OcMessage {
  id: string;
  sessionID: string;
  role: string;
  time: { created: number; completed?: number };
  parentID?: string;
  modelID?: string;
}

interface OcPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: string;
  text?: string;
  tool?: string;
  state?: {
    status: string;
    input?: Record<string, unknown>;
    output?: string;
    title?: string;
  };
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Fast scan: only reads session metadata files, no message/part parsing.
 */
export function scanOpencodeSessions(
  storagePath: string,
): SessionEntry[] {
  if (!existsSync(storagePath)) return [];

  const sessionDir = join(storagePath, "session");
  if (!existsSync(sessionDir)) return [];

  const entries: SessionEntry[] = [];

  for (const projHash of readdirSync(sessionDir)) {
    const projDir = join(sessionDir, projHash);
    let files: string[];
    try {
      files = readdirSync(projDir).filter((f) => f.endsWith(".json"));
    } catch {
      continue;
    }

    for (const file of files) {
      const ses = readJson<OcSession>(join(projDir, file));
      if (!ses) continue;

      const date = formatDate(new Date(ses.time.created));
      const shortId = ses.id.replace(/^ses_/, "").slice(0, 8);

      entries.push({
        filename: `${date}-${shortId}.md`,
        sourcePath: join(projDir, file),
        meta: {
          title: ses.title || `Session ${shortId}`,
          id: ses.id,
          source: "opencode",
          created_at: new Date(ses.time.created).toISOString(),
          updated_at: new Date(ses.time.updated).toISOString(),
        },
      });
    }
  }

  return entries;
}

/**
 * Full parse: reads session + all messages + parts and generates markdown.
 */
export function opencodeSessionToMd(
  storagePath: string,
  sessionId: string,
): string {
  const sessionDir = join(storagePath, "session");
  if (!existsSync(sessionDir)) return "";

  let session: OcSession | null = null;
  for (const projHash of readdirSync(sessionDir)) {
    const sesPath = join(sessionDir, projHash, `${sessionId}.json`);
    if (existsSync(sesPath)) {
      session = readJson<OcSession>(sesPath);
      break;
    }
  }
  if (!session) return "";

  const msgDir = join(storagePath, "message", sessionId);
  if (!existsSync(msgDir)) return "";

  const msgFiles = readdirSync(msgDir).filter((f) => f.endsWith(".json")).sort();
  const messages: OcMessage[] = [];
  for (const f of msgFiles) {
    const msg = readJson<OcMessage>(join(msgDir, f));
    if (msg) messages.push(msg);
  }

  messages.sort((a, b) => a.time.created - b.time.created);

  const mdSections: string[] = [];
  for (const msg of messages) {
    const partDir = join(storagePath, "part", msg.id);
    if (!existsSync(partDir)) continue;

    const partFiles = readdirSync(partDir).filter((f) => f.endsWith(".json")).sort();
    const parts: OcPart[] = [];
    for (const f of partFiles) {
      const part = readJson<OcPart>(join(partDir, f));
      if (part) parts.push(part);
    }

    const textParts: string[] = [];
    for (const part of parts) {
      if (part.type === "text" && part.text) {
        textParts.push(part.text);
      } else if (part.type === "tool" && part.tool && part.state) {
        const inputStr = part.state.input
          ? JSON.stringify(part.state.input, null, 2)
          : "";
        textParts.push(
          `> **Tool**: ${part.tool}\n> \`\`\`\n> ${inputStr}\n> \`\`\``,
        );
      }
    }

    if (textParts.length === 0) continue;
    const role = msg.role === "user" ? "Human" : "Claude";
    mdSections.push(`## ${role}\n\n${textParts.join("\n\n")}`);
  }

  const title = session.title || `Session ${sessionId.slice(0, 8)}`;
  const created = new Date(session.time.created);
  const updated = new Date(session.time.updated);

  const meta: SessionMeta = {
    title: truncateTitle(title),
    id: sessionId,
    source: "opencode",
    created_at: created.toISOString(),
    updated_at: updated.toISOString(),
  };

  const frontmatter = buildFrontmatter(meta);
  return `${frontmatter}\n\n# ${meta.title}\n\n${mdSections.join("\n\n")}`;
}
