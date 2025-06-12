# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI News Aggregator is a modular TypeScript system that collects, enriches, and analyzes AI-related content from multiple sources using a plugin architecture.

## Common Commands

### Main Application
```bash
# Build and run production
npm run build && npm start

# Development mode
npm run dev

# Historical data collection
npm run historical

# Run with specific configuration
npm start -- --source=discord-raw.json --output=./custom-output

# Historical data for date range
npm run historical -- --source=elizaos.json --after=2024-01-10 --before=2024-01-16
```

### HTML Frontend (in html/ directory)
```bash
# Development server
npm run dev

# Build for production
npm run build

# Type checking
npm run check

# Database operations
npm run db:push
```

### AutoDoc (in autodoc/ directory)
```bash
# Generate documentation
npm run autodoc

# Development mode
npm run autodoc:dev

# Formatting
npm run lint && npm run format
```

## Architecture

### Plugin System
The system uses five plugin types:
- **Sources** (`src/plugins/sources/`) - Data collection (Discord, GitHub, APIs)
- **AI Providers** (`src/plugins/ai/`) - OpenAI/OpenRouter integration
- **Enrichers** (`src/plugins/enrichers/`) - Content enhancement (topics, images)
- **Generators** (`src/plugins/generators/`) - Summary generation
- **Storage** (`src/plugins/storage/`) - SQLite with encryption

### Core Components
- **ContentAggregator** (`src/aggregator/ContentAggregator.ts`) - Main orchestration engine
- **HistoricalAggregator** (`src/aggregator/HistoricalAggregator.ts`) - Historical data processing
- **Types** (`src/types.ts`) - Comprehensive type definitions including plugin interfaces

### Configuration
JSON configuration files in `config/` directory:
- `sources.json` - Default configuration
- `discord-raw.json`, `elizaos.json`, etc. - Specialized configurations

Each config contains: `settings`, `sources`, `ai`, `enrichers`, `storage`, `generators` arrays.

### Environment Variables
Required in `.env`: `DISCORD_TOKEN`, `DISCORD_GUILD_ID`, `OPENAI_API_KEY`, `USE_OPENROUTER`, `CODEX_API_KEY`

## Data Sources
- Discord (raw messages, channels, announcements)
- GitHub (stats, general data)
- Crypto analytics (Codex, CoinGecko, Solana)
- Generic REST APIs

## Development Structure
```
src/
├── aggregator/     # Core engines
├── plugins/        # All plugin implementations
├── helpers/        # Utilities (cache, config, date, file, prompt)
└── types.ts        # Type definitions
```

The system supports specialized modes: `--onlyFetch` (no AI processing), `--onlyGenerate` (process existing data), and configurable output directories.