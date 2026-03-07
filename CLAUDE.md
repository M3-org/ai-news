# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI News Aggregator is a modular TypeScript system that collects, enriches, and analyzes AI-related content from multiple sources using a plugin architecture. Each Discord server gets its own config file, SQLite database, and output directories.

## Common Commands

```bash
# Build (pre-existing type errors in DiscordRawDataSource.ts are expected)
npm run build

# Run with default config (config/sources.json)
npm start

# Run with specific server config
npm start -- --source=elizaos.json

# Development mode
npm run dev

# Historical data for a date range
npm run historical -- --source=elizaos.json --after=2024-01-10 --before=2024-01-16

# Modes: --onlyFetch (skip AI), --onlyGenerate (process existing data)
npm run historical -- --source=elizaos.json --onlyFetch

# Channel management CLI
npm run channels -- discover
npm run channels -- analyze
npm run channels -- propose
npm run channels -- list [--tracked|--active|--muted]
npm run channels -- stats
npm run channels -- reset-unavailable

# User management CLI
npm run users -- index                          # Build user index from raw logs
npm run users -- fetch-avatars --skip-existing  # Fetch avatars from Discord API
npm run users -- download-avatars               # Download avatar images locally
npm run users -- build-registry                 # Build discord_users table
npm run users -- enrich --all                   # Enrich daily JSONs with nickname maps

# Nickname enrichment (legacy script, file may not exist)
npm run enrich-nicknames -- --all --use-index

# Server onboarding wizard
npm run setup

# Media operations
npm run download-media -- --date=2024-01-15
npm run upload-cdn -- --dir ./media/ --remote elizaos-media/
```

Both `channels` and `users` CLIs support `--source=<config>.json` to target a specific server.

## Architecture

### Plugin System

Five plugin types in `src/plugins/`, dynamically loaded via `src/helpers/configHelper.ts`:

| Type | Directory | Interface | Purpose |
|------|-----------|-----------|---------|
| Sources | `sources/` | `SourcePlugin` | Data collection (Discord, GitHub, APIs) |
| AI | `ai/` | `AiProvider` | OpenAI/OpenRouter wrappers, injected into other plugins |
| Enrichers | `enrichers/` | `EnricherPlugin` | Content enhancement (topics, images, memes) |
| Generators | `generators/` | Generator | Summary generation (daily, Discord channel) |
| Storage | `storage/` | `StoragePlugin` | SQLite persistence with optional encryption |

### Core Flow

1. `src/index.ts` — Main entry: loads config, initializes plugins, schedules fetch/generate cycles
2. `ContentAggregator` — Orchestrates: source → enricher → storage → generator pipeline
3. `HistoricalAggregator` — Same pipeline but for past dates/ranges
4. All types defined in `src/types.ts`

### Path Aliases (tsconfig)

```
@helpers/*  → src/helpers/*
@types      → src/types
@plugins/*  → src/plugins/*
@aggregator/* → src/aggregator/*
```

Scripts use `ts-node -r tsconfig-paths/register --transpile-only` to resolve these.

### Configuration

JSON config files in `config/` define the full pipeline per server:

- `sources.json` — Default
- `elizaos.json` — ElizaOS Discord + GitHub + Codex analytics (`DISCORD_TOKEN` / `DISCORD_GUILD_ID`)
- `hyperfy-discord.json` — Hyperfy Discord (`HYPERFY_DISCORD_TOKEN` / `HYPERFY_DISCORD_GUILD_ID`)
- `m3org.json` — M3 org (`DISCORD_TOKEN` / `M3ORG_DISCORD_GUILD_ID`)

Each config contains: `settings`, `sources`, `ai`, `enrichers`, `storage`, `generators` arrays. Bot tokens and guild IDs are referenced as `process.env.*` strings in JSON and resolved at runtime.

No hardcoded config lists — scripts scan all `config/*.json` files dynamically.

### Environment Variables

Required in `.env`: `DISCORD_TOKEN`, `DISCORD_GUILD_ID`, `OPENAI_API_KEY`, `USE_OPENROUTER`

Optional: `CODEX_API_KEY`, `HYPERFY_DISCORD_TOKEN`, `HYPERFY_DISCORD_GUILD_ID`, `M3ORG_DISCORD_GUILD_ID`, `BUNNY_STORAGE_ZONE`, `BUNNY_STORAGE_PASSWORD`, `BUNNY_CDN_URL`, `OPENAI_DIRECT_KEY` (for image gen when using OpenRouter), `CHANNEL_CONCURRENCY` (default: 2, concurrent channel fetches), `FORCE_OVERWRITE` (refetch existing data if `true`)

### GitHub Actions Workflows

- `elizaos.yml` / `hyperfy.yml` — Daily data collection and summary generation
- `channel-update.yml` — Monthly channel analysis, creates draft PRs
- `deploy-media-collection.yml` — Webhook-triggered media collection on VPS
- `media-cdn.yml` — Daily CDN upload of media files
- `jsdoc-automation.yml` — Documentation generation

### Data Sources

- Discord: `DiscordRawDataSource`, `DiscordChannelSource`, `DiscordAnnouncementSource`
- GitHub: `GitHubStatsDataSource`, `GitHubDataSource`, `GitHubSummaryDataSource`
- Crypto: `CodexAnalyticsSource`, `CoinGeckoAnalyticsSource`, `SolanaAnalyticsSource`
- Generic: `ApiSource`

### User Identity System

The `scripts/users.ts` CLI manages Discord user identity across servers:
- Builds a `discord_users` table from raw Discord logs via `DiscordUserRegistry`
- Tracks nickname history with temporal correctness (date ranges per nickname)
- Enriches daily summary JSONs with `nicknameMap` for data visualization
- Resolves nickname conflicts using role hierarchy and message count
- Generates avatar URLs (default Discord avatars calculated from user ID)

### Storage Layer

`SQLiteStorage` handles content and summaries. `DiscordChannelRegistry` tracks channel metadata (name/topic changes, activity, AI recommendations, muted state). `DiscordUserRegistry` tracks user profiles and nickname history.
