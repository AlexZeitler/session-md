import { join } from "path";
import {
  type SessionEntry,
  slugify,
} from "./types.ts";

interface Workspace {
  id: string;
  name: string;
}

interface Project {
  id: string;
  name: string;
  workspaceName: string;
}

interface Memory {
  id: string;
  title: string;
  text: string;
  type: string;
  tags: string[];
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json() as Promise<T>;
}

async function fetchAllMemories(
  baseUrl: string,
  projectId: string,
): Promise<Memory[]> {
  const all: Memory[] = [];
  let page = 1;
  const pageSize = 100;

  while (true) {
    const url = `${baseUrl}/api/memory?projectId=${projectId}&page=${page}&pageSize=${pageSize}`;
    const res = await fetchJson<{ memories: Memory[] }>(url);
    all.push(...res.memories);
    if (res.memories.length < pageSize) break;
    page++;
  }

  return all;
}

/**
 * Fetches all memories from Memorizer API.
 * Returns SessionEntry[] with pre-generated markdown (md field set).
 */
export async function scanMemorizerMemories(
  baseUrl: string,
): Promise<SessionEntry[]> {
  const entries: SessionEntry[] = [];

  const { workspaces } = await fetchJson<{ workspaces: Workspace[] }>(
    `${baseUrl}/api/workspace`,
  );

  for (const ws of workspaces) {
    const { projects } = await fetchJson<{ projects: Project[] }>(
      `${baseUrl}/api/project?workspaceId=${ws.id}`,
    );

    for (const proj of projects) {
      const memories = await fetchAllMemories(baseUrl, proj.id);

      for (const mem of memories) {
        const tags = mem.tags.length > 0 ? `[${mem.tags.join(", ")}]` : "[]";

        const frontmatter = [
          "---",
          `title: "${mem.title.replace(/"/g, '\\"')}"`,
          `id: ${mem.id}`,
          `source: memorizer`,
          `workspace: "${ws.name.replace(/"/g, '\\"')}"`,
          `project: "${proj.name.replace(/"/g, '\\"')}"`,
          `type: ${mem.type}`,
          `tags: ${tags}`,
          `confidence: ${mem.confidence}`,
          `created_at: ${mem.createdAt}`,
          `updated_at: ${mem.updatedAt}`,
          "---",
        ].join("\n");

        const md = `${frontmatter}\n\n# ${mem.title}\n\n${mem.text}`;
        const wsSlug = slugify(ws.name);
        const projSlug = slugify(proj.name);
        const titleSlug = slugify(mem.title);

        entries.push({
          filename: join(wsSlug, projSlug, `${titleSlug}.md`),
          sourcePath: `${baseUrl}/api/memory/${mem.id}`,
          md,
          meta: {
            title: mem.title,
            id: mem.id,
            source: "memorizer",
            project: `${ws.name}/${proj.name}`,
            created_at: mem.createdAt,
            updated_at: mem.updatedAt,
          },
        });
      }
    }
  }

  return entries;
}
