# session-md

A terminal UI for browsing and managing AI chat sessions from multiple sources - Claude Code, Claude.ai exports, OpenCode, and Memorizer.

Built with [Bun](https://bun.sh), [OpenTUI](https://github.com/anomalyco/opentui), and TypeScript.

## Features

- Browse sessions from 4 sources in a single TUI
- Filter sessions by source and text search
- **Full-text content search** (`g`) with SQLite FTS5 index
- Multi-select sessions and copy as Markdown to target folders
- Markdown preview with syntax highlighting
- Configurable targets for organizing exported sessions
- Incremental search index - only new/changed sessions are re-indexed on startup

## Supported Sources

| Source | Format | Location |
|--------|--------|----------|
| [**Claude Code**](https://docs.anthropic.com/en/docs/claude-code) | JSONL | `~/.claude/projects/**/*.jsonl` |
| [**Claude.ai**](https://claude.ai) Export | ZIP / `conversations.json` | Configurable path |
| [**OpenCode**](https://github.com/anomalyco/opencode) | JSON shards | `~/.local/share/opencode/storage/` |
| [**Memorizer**](https://github.com/petabridge/memorizer) | REST API | Configurable URL |

## Install

### Global (recommended)

```bash
bun install -g @alexzeitler/session-md
session-md
```

### From source

```bash
git clone https://github.com/AlexZeitler/session-md.git
cd session-md
bun install
bun src/index.ts
```

### Update

```bash
session-md update
```

### Version

```bash
session-md --version
```

## Configuration

Config file: `~/.config/session-md/config.toml`

A default config is created on first run.

```toml
default_target = "~/notes/claude-chats"

[targets]
vault   = "~/notes/claude-chats"
work    = "~/work/claude-sessions"
archive = "~/archive/claude"

[sources]
claude_code    = "~/.claude/projects"
opencode       = "~/.local/share/opencode/storage"
# claude_export = "~/Downloads/conversations.zip"
# memorizer_url = "http://localhost:5001"
```

## Keyboard Shortcuts

### Navigation

| Key | Action |
|-----|--------|
| `Tab` | Cycle focus: Sources → Sessions → Detail |
| `Shift+Tab` | Cycle focus backward |
| `j` / `k` | Navigate list / scroll detail |
| `gg` | Jump to top (list or detail) |
| `G` | Jump to bottom (list or detail) |
| `Ctrl+d` / `Ctrl+u` | Page down / up in detail |
| `Esc` | Back to sessions from detail |

### Sessions

| Key | Action |
|-----|--------|
| `Space` | Toggle selection |
| `/` | Open text filter |
| `g` | Full-text content search (grep) |
| `c` | Copy selected sessions to target |
| `q` | Quit |

### Filter (`/`)

| Key | Action |
|-----|--------|
| Type | Filter sessions by title/project |
| `Enter` | Move to filtered results (filter stays active) |
| `/` | Return to filter input |
| `Esc` | Close filter |

### Content Search (`g`)

| Key | Action |
|-----|--------|
| Type | Search within session content (FTS5) |
| `Enter` | Move to results / open selected result |
| `/` | Return to search input |
| `Esc` | Close search |

Content search uses a SQLite FTS5 index stored at `~/.config/session-md/search-index.sqlite`. The index is built incrementally on startup - only new or changed sessions are indexed.

To rebuild the index from scratch:

```bash
session-md reindex
```

## MCP Server

session-md can run as an [MCP](https://modelcontextprotocol.io/) server, exposing session search and retrieval to AI assistants like Claude Code.

### Stdio Transport

For direct integration with Claude Code:

```bash
session-md mcp
```

Add to your Claude Code MCP config:

```json
{
  "mcpServers": {
    "session-md": {
      "command": "session-md",
      "args": ["mcp"]
    }
  }
}
```

### HTTP Transport

Foreground:

```bash
session-md mcp --http              # default port 8282
session-md mcp --http --port 9000  # custom port
```

Daemon (background):

```bash
session-md mcp --http --daemon
session-md mcp stop
```

Daemon logs: `~/.cache/session-md/mcp.log`

Health check: `GET http://localhost:8282/health`

### MCP Tools

| Tool | Description |
|------|-------------|
| `search_sessions` | Full-text search across all indexed sessions |
| `list_sessions` | List sessions, optionally filtered by source |
| `get_session` | Retrieve full Markdown content of a session by ID |
| `import_sessions` | Re-scan all configured sources and update the index |

## Requirements

- [Bun](https://bun.sh) >= 1.0

## License

MIT
