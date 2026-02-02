# Scripts Directory

Utility scripts for the AI News aggregator.

## Table of Contents

- [Episode Recording & Clipping](#episode-recording--clipping)
- [Discord Channel Management](#discord-channel-management)
- [Discord User Management](#discord-user-management)
- [Collection Scripts](#collection-scripts)
- [Webhook Server](#webhook-server)
- [Integration](#integration)

## Episode Recording & Clipping

Tools for recording Shmotime episodes and extracting clips with scene-level precision.

### Quick Start

```bash
# Record an episode (v6 captures word timestamps from TTS)
npm run record6 -- --show=Cron-Job --date=2026-02-02 https://shmotime.com/shmotime_episode/my-episode/

# List scenes
npm run clip -- list episodes/*.mp4

# Extract a clip
npm run clip -- extract episodes/*.mp4 --scene=3

# Search transcript
npm run clip -- search episodes/*.mp4 --query="topic"
```

### Recording (recorder6.js)

Captures word-level timestamps from ElevenLabs TTS `speak_start` events.

```bash
npm run record6 -- [options] <url>

# Example
npm run record6 -- --show=Cron-Job --date=2026-02-02 --headless \
  https://shmotime.com/shmotime_episode/workflow-revolution/
```

**Options:**
| Option | Description |
|--------|-------------|
| `--show=NAME` | Show name for filename (default: Show) |
| `--date=YYYY-MM-DD` | Override date for filenames |
| `--headless` | Run browser in headless mode |
| `--output=DIR` | Output directory (default: ./episodes) |
| `--format=FORMAT` | Video format: webm or mp4 (default: webm) |
| `--fps=N` | Frame rate (default: 30) |
| `--width=N` | Video width (default: 1920) |
| `--height=N` | Video height (default: 1080) |
| `--stop-recording-at=EVENT` | Stop trigger (default: end_postcredits) |
| `--mute` | Mute audio during recording |
| `--no-record` | Disable video recording (data only) |
| `--no-export` | Disable JSON export |
| `--no-fix-framerate` | Skip FFmpeg post-processing |

**Output files:**
- `{date}_{show}_{episode}.mp4` - Final video (webm deleted after conversion)
- `{date}_{show}_{episode}_session-log.json` - Timing data (v6 format)

### Clipping (clip.ts)

Extract clips from videos using scene data from session-log.json.

#### List Scenes

```bash
npm run clip -- list <video-path>

# Example output:
#   #  START    DUR   LOCATION          PREVIEW
# ────────────────────────────────────────────────────────────────
#   1  0:09      28s  news-studio       Welcome back to Cron Job...
#   2  0:37      38s  interview-room    Today we're discussing...
```

#### Extract Scenes

```bash
# Single scene
npm run clip -- extract <video> --scene=3

# Scene range (single combined clip)
npm run clip -- extract <video> --from=2 --to=5

# Multiple specific scenes (separate clips)
npm run clip -- extract <video> --scenes=1,3,7

# Direct time range
npm run clip -- extract <video> --start=1:30 --end=2:45
```

#### Search & Extract

Find clips by transcript content:

```bash
# Find matches (preview)
npm run clip -- search <video> --query="ElizaOS"

# Extract matching clips
npm run clip -- search <video> --query="ElizaOS" --extract --padding=2
```

#### Options

| Option | Description |
|--------|-------------|
| `--scene=N` | Extract single scene |
| `--from=N --to=M` | Extract scene range as one clip |
| `--scenes=1,3,7` | Extract multiple scenes (separate clips) |
| `--start=M:SS` | Start time for direct time-based clipping |
| `--end=M:SS` | End time for direct time-based clipping |
| `--query="text"` | Search transcript and extract matches |
| `--extract` | Actually cut clips (for search command) |
| `--padding=N` | Seconds before/after search matches (default: 2) |
| `--output=DIR` | Output directory (default: episodes/clips) |
| `--dry-run` | Show commands without executing |

**Output to `episodes/clips/`:**
```
episodes/clips/
  {episode}_scene3.mp4           # Single scene
  {episode}_scene2-5.mp4         # Scene range
  {episode}_search_ElizaOS_1.mp4 # Search result
```

## Discord Channel Management

Unified TypeScript CLI for discovering and managing Discord channels.

### Quick Start

```bash
# Discover channels (Discord API, or raw data if no token)
npm run channels -- discover

# Analyze channels with LLM (TRACK/MAYBE/SKIP)
npm run channels -- analyze

# Generate PR markdown with config changes
npm run channels -- propose
```

### All Commands

```bash
# Discovery & Analysis
npm run channels -- discover                # Fetch channels from Discord (or raw data fallback)
npm run channels -- analyze                 # Analyze channels needing it (30+ days old)
npm run channels -- analyze --all           # Re-analyze all channels
npm run channels -- analyze --channel=ID    # Analyze single channel
npm run channels -- propose [--dry-run]     # Generate PR markdown

# Query Commands
npm run channels -- list [--tracked|--active|--muted|--quiet]
npm run channels -- show <channelId>
npm run channels -- stats

# Management Commands
npm run channels -- track <channelId>
npm run channels -- untrack <channelId>
npm run channels -- mute <channelId>
npm run channels -- unmute <channelId>

# Registry Commands
npm run channels -- build-registry [--dry-run]
```

### Workflow

```bash
npm run channels -- discover   # Fetch channels
npm run channels -- analyze    # Run LLM analysis
npm run channels -- propose    # Generate PR markdown
```

**GitHub Actions**: Monthly workflow analyzes channels and creates draft PRs.

### Aliases

For convenience, these npm scripts are available:
- `npm run discover-channels` → `npm run channels -- discover`
- `npm run analyze-channels` → `npm run channels -- analyze`

## Discord User Management

TypeScript CLI for managing Discord user data and avatars.

```bash
# Build user index from raw Discord logs
npm run users -- index

# Fetch avatar URLs from Discord API
npm run users -- fetch-avatars [--rate-limit=<ms>] [--skip-existing]

# Download avatar images locally
npm run users -- download-avatars [--rate-limit=<ms>] [--skip-existing]

# Build discord_users table from discordRawData
npm run users -- build-registry [--dry-run]

# Enrich JSON files with nickname maps
npm run users -- enrich [--date=YYYY-MM-DD] [--from/--to] [--all] [--dry-run]
```

## Collection Scripts

### `collect-daily.sh`
Runs daily data collection for specified configurations.

```bash
./collect-daily.sh elizaos.json                    # Yesterday's ElizaOS data
./collect-daily.sh hyperfy-discord.json 2025-01-15 # Specific date
```

## Webhook Server

### `server.js`
HTTP webhook server for triggering collection via GitHub Actions.

**Features:**
- HMAC signature verification
- File locking (prevents concurrent runs)
- Zero external dependencies

**Usage:**
```bash
export COLLECT_WEBHOOK_SECRET=$(openssl rand -hex 32)
npm run webhook
```

**Endpoints:**
- `POST /run-collect` - Trigger collection (HMAC auth required)
- `GET /healthz` - Health check

### `test-webhook.sh`
Test utility for webhook development.

```bash
export COLLECT_WEBHOOK_SECRET="your-secret"
./scripts/test-webhook.sh elizaos.json 2025-01-15
```

## Integration

This system is designed to work seamlessly with the broader AI News Aggregator plugin architecture. All discovered channels are automatically compatible with:

- `DiscordRawDataSource` plugins
- `DiscordChannelRegistry` for metadata storage
- Historical data collection
- Media download functionality
- Content enrichment and AI processing
