import { join } from "path";
import type { SessionEntry } from "./types.ts";

const cache = new Map<string, string>();
let worker: Worker | null = null;
let pendingCallbacks = new Map<
  string,
  { resolve: (md: string) => void; reject: (err: Error) => void }
>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(join(import.meta.dir, "parse-worker.ts"));
    worker.onmessage = (event: MessageEvent) => {
      const { id, md, error } = event.data;
      const cb = pendingCallbacks.get(id);
      if (!cb) return;
      pendingCallbacks.delete(id);

      if (error) {
        cb.reject(new Error(error));
      } else {
        cache.set(id, md);
        cb.resolve(md);
      }
    };
  }
  return worker;
}

/**
 * Loads markdown for a session entry asynchronously.
 * Cached results return immediately. Heavy parsing runs in a worker thread.
 */
export function loadSessionMarkdownAsync(
  entry: SessionEntry,
): Promise<string> {
  // Pre-generated (memorizer, claude-export)
  if (entry.md) return Promise.resolve(entry.md);

  // Cached
  const cached = cache.get(entry.meta.id);
  if (cached) return Promise.resolve(cached);

  // Cancel any pending load for the same id
  const existing = pendingCallbacks.get(entry.meta.id);
  if (existing) {
    existing.reject(new Error("cancelled"));
    pendingCallbacks.delete(entry.meta.id);
  }

  return new Promise((resolve, reject) => {
    pendingCallbacks.set(entry.meta.id, { resolve, reject });
    getWorker().postMessage({
      id: entry.meta.id,
      source: entry.meta.source,
      sourcePath: entry.sourcePath,
      sessionId: entry.meta.id,
    });
  });
}

/** Synchronous cache-only check (for copy-to-target) */
export function loadSessionMarkdownSync(entry: SessionEntry): string {
  if (entry.md) return entry.md;
  const cached = cache.get(entry.meta.id);
  if (cached) return cached;

  // Fallback: import synchronously (for copy operations)
  if (entry.meta.source === "claude-code") {
    const { claudeCodeSessionToMd } = require("./claude-code-to-md.ts");
    const md = claudeCodeSessionToMd(entry.sourcePath);
    cache.set(entry.meta.id, md);
    return md;
  }
  if (entry.meta.source === "opencode") {
    const { dirname } = require("path");
    const { opencodeSessionToMd } = require("./opencode-to-md.ts");
    const storagePath = dirname(dirname(dirname(entry.sourcePath)));
    const md = opencodeSessionToMd(storagePath, entry.meta.id);
    cache.set(entry.meta.id, md);
    return md;
  }

  return `# ${entry.meta.title}\n\n*Content not available*`;
}
