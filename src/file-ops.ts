import { join, dirname } from "path";
import { mkdirSync, existsSync } from "fs";
import type { SessionEntry } from "./import/types.ts";
import { loadSessionMarkdownSync } from "./import/loader.ts";

export async function copySessionsToTarget(
  sessions: SessionEntry[],
  targetPath: string,
): Promise<void> {
  mkdirSync(targetPath, { recursive: true });

  for (const session of sessions) {
    const md = loadSessionMarkdownSync(session);
    const dest = join(targetPath, session.filename);
    const destDir = dirname(dest);

    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }

    await Bun.write(dest, md);
  }
}
