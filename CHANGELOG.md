# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [0.3.0] - 2026-03-15

### Added

- `gg`/`G` vim-style navigation: jump to top/bottom in sessions list and detail view
- `session-md update` command to install latest release from GitHub
- `session-md --version` flag
- Release script (`scripts/release.sh`)
- CHANGELOG.md

### Changed

- `session-md reindex` is now a subcommand instead of `--reindex` flag

## [0.2.0] - 2026-03-15

### Added

- Full-text content search (`g`) using SQLite FTS5 index
- Incremental search indexing on startup with CLI spinner
- Search results view with context snippets
- `session-md reindex` to rebuild the search index from scratch
- `session-md update` to install the latest release from GitHub
- `session-md --version` to display the current version
- Release script (`scripts/release.sh`)

## [0.1.0] - 2026-03-13

### Added

- Terminal UI for browsing AI chat sessions with OpenTUI
- Support for 4 data sources: Claude Code, Claude.ai Export, OpenCode, Memorizer
- Source picker to filter sessions by source
- Text filter (`/`) with substring matching on title and project
- Multi-select sessions with `Space` and copy to target folders
- Markdown preview with syntax highlighting and dimming/spinner during load
- Preview mode (1500 chars) during sidebar navigation, full content on Tab
- Worker-based async JSONL parsing for Claude Code and OpenCode sessions
- Configurable targets in `~/.config/session-md/config.toml`
- Keyboard-driven navigation: `j`/`k`, `Ctrl+d`/`Ctrl+u`, `Tab`/`Shift+Tab`
