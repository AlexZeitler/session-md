# session-md

A terminal UI for browsing and managing AI chat sessions from multiple sources — Claude Code, Claude.ai exports, OpenCode, and Memorizer.

Built with [Bun](https://bun.sh), [OpenTUI](https://github.com/anomalyco/opentui), and TypeScript.

## Features

- Browse sessions from 4 sources in a single TUI
- Filter sessions by source and text search
- **Full-text content search** (`g`) with SQLite FTS5 index
- Multi-select sessions and copy as Markdown to target folders
- Markdown preview with syntax highlighting
- Configurable targets for organizing exported sessions
- Incremental search index — only new/changed sessions are re-indexed on startup

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
bun install -g github:AlexZeitler/session-md
session-md
```

### From source

```bash
git clone https://github.com/AlexZeitler/session-md.git
cd session-md
bun install
bun src/index.ts
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

Content search uses a SQLite FTS5 index stored at `~/.config/session-md/search-index.sqlite`. The index is built incrementally on startup — only new or changed sessions are indexed.

To rebuild the index from scratch:

```bash
session-md reindex
```

## Requirements

- [Bun](https://bun.sh) >= 1.0

## License

MIT
