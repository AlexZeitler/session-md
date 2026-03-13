export type SourceType = "claude-code" | "claude-export" | "opencode" | "memorizer";

export interface SessionEntry {
  /** Display filename (e.g. 2026-03-13-abc12345.md) */
  filename: string;
  /** Session metadata (collected without reading file content) */
  meta: SessionMeta;
  /** Absolute path to the original source file (for lazy loading) */
  sourcePath: string;
  /** Pre-generated markdown (only set for memorizer/claude-export, null for lazy sources) */
  md?: string;
}

export interface SessionMeta {
  title: string;
  id: string;
  source: SourceType;
  project?: string;
  created_at: string;
  updated_at: string;
}

export function buildFrontmatter(meta: SessionMeta): string {
  const lines = [
    "---",
    `title: "${meta.title.replace(/"/g, '\\"')}"`,
    `id: ${meta.id}`,
    `source: ${meta.source}`,
  ];
  if (meta.project) {
    lines.push(`project: "${meta.project.replace(/"/g, '\\"')}"`);
  }
  lines.push(`created_at: ${meta.created_at}`);
  lines.push(`updated_at: ${meta.updated_at}`);
  lines.push("---");
  return lines.join("\n");
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export function formatDate(date: Date): string {
  return date.toISOString().split("T")[0]!;
}

export function truncateTitle(text: string, maxLen = 80): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + "…";
}
