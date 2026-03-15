import { Database } from "bun:sqlite";
import { join } from "path";
import { homedir } from "os";
import { mkdirSync, existsSync, unlinkSync } from "fs";
import { stripMarkdown } from "./plaintext.ts";
import type { SessionEntry, SourceType } from "../import/types.ts";
import { loadSessionMarkdownSync } from "../import/loader.ts";

const CONFIG_DIR = join(homedir(), ".config", "session-md");
const DB_PATH = join(CONFIG_DIR, "search-index.sqlite");

export function deleteIndex(): boolean {
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = DB_PATH + suffix;
    if (existsSync(p)) unlinkSync(p);
  }
  return true;
}

export interface SearchResult {
  id: string;
  title: string;
  source: SourceType;
  project: string | null;
  snippet: string;
}

export class SearchIndex {
  private db: Database;

  constructor() {
    mkdirSync(CONFIG_DIR, { recursive: true });
    this.db = new Database(DB_PATH);
    this.db.exec("PRAGMA journal_mode=WAL");
    this.setupSchema();
  }

  private setupSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        title TEXT,
        project TEXT,
        content TEXT,
        content_hash TEXT NOT NULL
      )
    `);

    // Check if FTS table exists
    const ftsExists = this.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='sessions_fts'",
      )
      .get();

    if (!ftsExists) {
      this.db.exec(`
        CREATE VIRTUAL TABLE sessions_fts USING fts5(
          title, project, content,
          content='sessions',
          content_rowid='rowid'
        )
      `);

      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS sessions_ai AFTER INSERT ON sessions BEGIN
          INSERT INTO sessions_fts(rowid, title, project, content)
          VALUES (new.rowid, new.title, new.project, new.content);
        END
      `);

      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS sessions_ad AFTER DELETE ON sessions BEGIN
          INSERT INTO sessions_fts(sessions_fts, rowid, title, project, content)
          VALUES ('delete', old.rowid, old.title, old.project, old.content);
        END
      `);

      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS sessions_au AFTER UPDATE ON sessions BEGIN
          INSERT INTO sessions_fts(sessions_fts, rowid, title, project, content)
          VALUES ('delete', old.rowid, old.title, old.project, old.content);
          INSERT INTO sessions_fts(rowid, title, project, content)
          VALUES (new.rowid, new.title, new.project, new.content);
        END
      `);
    }
  }

  /**
   * Index sessions incrementally. Returns count of newly indexed/updated sessions.
   */
  indexSessions(
    sessions: SessionEntry[],
    onProgress?: (current: number, total: number) => void,
  ): number {
    const checkStmt = this.db.prepare(
      "SELECT content_hash FROM sessions WHERE id = ?",
    );
    const upsertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO sessions (id, source, title, project, content, content_hash)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    let indexed = 0;
    const toIndex: SessionEntry[] = [];

    // First pass: determine what needs indexing
    for (const entry of sessions) {
      const existing = checkStmt.get(entry.meta.id) as
        | { content_hash: string }
        | null;
      if (!existing || existing.content_hash !== entry.contentHash) {
        toIndex.push(entry);
      }
    }

    if (toIndex.length === 0) {
      onProgress?.(sessions.length, sessions.length);
      return 0;
    }

    // Second pass: index in a transaction
    const indexBatch = this.db.transaction(() => {
      for (const entry of toIndex) {
        try {
          let md: string;
          if (entry.md) {
            md = entry.md;
          } else {
            md = loadSessionMarkdownSync(entry);
          }

          const plaintext = stripMarkdown(md);

          upsertStmt.run(
            entry.meta.id,
            entry.meta.source,
            entry.meta.title,
            entry.meta.project ?? null,
            plaintext,
            entry.contentHash,
          );
          indexed++;
        } catch {
          // Skip sessions that fail to load
        }

        onProgress?.(indexed, toIndex.length);
      }
    });

    indexBatch();
    return indexed;
  }

  /**
   * Remove index entries for sessions that no longer exist.
   */
  cleanup(validIds: Set<string>): number {
    const allIds = this.db
      .prepare("SELECT id FROM sessions")
      .all() as { id: string }[];

    let removed = 0;
    const deleteStmt = this.db.prepare("DELETE FROM sessions WHERE id = ?");

    const cleanupBatch = this.db.transaction(() => {
      for (const row of allIds) {
        if (!validIds.has(row.id)) {
          deleteStmt.run(row.id);
          removed++;
        }
      }
    });

    cleanupBatch();
    return removed;
  }

  /**
   * Full-text search within a specific source (or all sources).
   */
  search(query: string, source?: SourceType | "all", limit = 100): SearchResult[] {
    // Escape FTS5 special characters and build query
    const ftsQuery = query
      .replace(/["(){}[\]:^~!@#$%&*+=|\\<>,./;?]/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((term) => `"${term}"`)
      .join(" AND ");

    if (!ftsQuery) return [];

    let sql: string;
    let params: any[];

    if (source && source !== "all") {
      sql = `
        SELECT s.id, s.title, s.source, s.project,
               snippet(sessions_fts, 2, '»', '«', '…', 32) as snippet
        FROM sessions_fts
        JOIN sessions s ON s.rowid = sessions_fts.rowid
        WHERE sessions_fts MATCH ?
          AND s.source = ?
        ORDER BY rank
        LIMIT ?
      `;
      params = [ftsQuery, source, limit];
    } else {
      sql = `
        SELECT s.id, s.title, s.source, s.project,
               snippet(sessions_fts, 2, '»', '«', '…', 32) as snippet
        FROM sessions_fts
        JOIN sessions s ON s.rowid = sessions_fts.rowid
        WHERE sessions_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `;
      params = [ftsQuery, limit];
    }

    try {
      return this.db.prepare(sql).all(...params) as SearchResult[];
    } catch {
      return [];
    }
  }

  close(): void {
    this.db.close();
  }
}
