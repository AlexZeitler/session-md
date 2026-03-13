/// Worker thread: parses session files off the main thread.

import { claudeCodeSessionToMd } from "./claude-code-to-md.ts";
import { opencodeSessionToMd } from "./opencode-to-md.ts";
import { dirname } from "path";

declare var self: Worker;

self.onmessage = (event: MessageEvent) => {
  const { id, source, sourcePath, sessionId } = event.data;

  try {
    let md: string;

    if (source === "claude-code") {
      md = claudeCodeSessionToMd(sourcePath);
    } else if (source === "opencode") {
      const storagePath = dirname(dirname(dirname(sourcePath)));
      md = opencodeSessionToMd(storagePath, sessionId);
    } else {
      md = `# Untitled\n\n*Content not available*`;
    }

    self.postMessage({ id, md, error: null });
  } catch (err) {
    self.postMessage({ id, md: null, error: String(err) });
  }
};
