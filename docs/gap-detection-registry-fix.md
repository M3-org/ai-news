# Gap Detection & Channel Registry Fix

## What We Were Trying to Solve

Two related problems in the historical data pipeline for `DiscordRawDataSource`:

1. **Performance**: Range fetches (`--after/--before`) were making one DB query per channel per date to check if data already existed. For 156 channels × 2,893 dates = ~450k individual `getExistingCids` queries per mirror run.

2. **Data quality**: The `discord_channels` registry had stale/wrong stats for 108/156 accessible channels — `lastActivityAt` was set to ancient dates (2018–2022), `activityHistory` had large gaps, and `currentVelocity` was near-zero for channels that were actually active.

---

## Root Causes Found

### Bug 1: `connect()` zombie state (`DiscordRawDataSource.ts`)
`_hasLoggedIn = true` was set **before** `await this._loginPromise`. If login threw, `_loginPromise` was never cleared and `_hasLoggedIn` stayed `true`. The next `connect()` call would wait forever for a `ready` event — permanent hang.

### Bug 2: Cache miss fallback fires on empty dates (`DiscordRawDataSource.ts`)
The preload cache used `this._existingCidsCache?.get(date) ?? await this.storage.getExistingCids(allCids)`. When the cache was populated but a date had no entries, `get(date)` returned `undefined`, triggering `??` and firing a full DB query — defeating the entire cache for newly-fetched dates.

### Bug 3: Preload query ignored date range + called `getDb()` twice (`DiscordRawDataSource.ts`)
`SELECT cid FROM items WHERE type = 'discordRawData'` scanned ALL rows ever with no date filter. For m3org with 306k rows this loaded the entire table on every range fetch. Also called `getDb()` twice unnecessarily.

### Bug 4: `lastActivityAt` overwritten by backfill direction (`DiscordChannelRegistry.ts`)
`recordActivity()` used `SET lastActivityAt = ?` (unconditional). During a newest→oldest historical backfill, every date call overwrote `lastActivityAt` with something older. After 2,893 iterations, it ended at the oldest date (`2018-04-11`) for channels that existed from the start. The 90-entry `activityHistory` cap also filled up mid-backfill, leaving a gap in recent history.

When `mirror` ran with everything cached, `recordActivity` was never called at all, so stale values persisted indefinitely.

---

## Fixes Applied

### `src/plugins/sources/DiscordRawDataSource.ts`

**Fix 1 — zombie state:**
```typescript
// Before
this._hasLoggedIn = true;
this._loginPromise = this.client.login(this.botToken);
await this._loginPromise;

// After
try {
  this._loginPromise = this.client.login(this.botToken);
  await this._loginPromise;
  this._hasLoggedIn = true;  // only set on success
} finally {
  this._loginPromise = null;  // always cleared
}
```

**Fix 2 — cache miss fallback:**
```typescript
// Before (undefined from .get() triggers ?? and fires DB query)
this._existingCidsCache?.get(date) ?? await this.storage.getExistingCids(allCids)

// After (explicit null check distinguishes "no cache" from "cache but empty date")
this._existingCidsCache !== null
  ? (this._existingCidsCache.get(date) ?? new Set<string>())
  : await this.storage.getExistingCids(allCids)
```

**Fix 3 — scoped preload query:**
```typescript
// Before: scans entire table
SELECT cid FROM items WHERE type = 'discordRawData'

// After: scoped to range, uses idx_items_type_date index, getDb() called once
const afterEpoch = Math.floor(new Date(after + 'T00:00:00Z').getTime() / 1000);
const beforeEpoch = Math.floor(new Date(before + 'T00:00:00Z').getTime() / 1000) + 86400;
SELECT cid FROM items WHERE type = 'discordRawData' AND date >= ? AND date < ?
```

### `src/plugins/storage/DiscordChannelRegistry.ts`

**Fix 4 — prevent future `lastActivityAt` corruption:**
```sql
-- Before
SET lastActivityAt = ?

-- After (only moves forward, never backwards)
SET lastActivityAt = MAX(COALESCE(lastActivityAt, 0), ?)
```

**New: `syncStats()` method** — rebuilds all 4 activity stats from `items.metadata.messageCount` without hitting Discord API:
- Phase 1: all-time totals + latest fetch date (one GROUP BY query over full table)
- Phase 2: per-day message counts for last 90 days (scoped by `idx_items_type_date`)
- Recomputes `lastActivityAt`, `totalMessages`, `currentVelocity`, `activityHistory` for all channels

### `scripts/channels.ts`

- `mirror` now calls `registry.syncStats()` automatically after the subprocess completes
- New `channels sync-stats` standalone command for one-off repairs
- Enhanced `channels stats` output: shows actual message coverage (records with content vs empty), channels active in last 30/90 days with counts, coverage date range

---

## Current State (m3org.sqlite)

After running `npm run channels -- sync-stats --source=m3org.json`:

| Metric | Before | After |
|---|---|---|
| Channels with stale `lastActivityAt` (pre-2024) | 108/156 | 0/156 |
| `lastActivityAt` accuracy | Wrong (oldest date from backfill) | Correct (latest fetch date) |
| `activityHistory` | Gap-filled from mid-backfill | Correct last 90 days |
| `currentVelocity` | Near-zero for most channels | Reflects actual recent activity |

Raw data coverage: 306,435 records, 2018-04-11 → 2026-03-12, complete (no gaps).

Active channels (last 90 days): 27 out of 156 accessible. The rest are archived/dead — empty records are correct.

---

## Blockers / Open Questions

1. **`mirror` still closes quickly** — this is correct behavior when all data is already present. But there's no easy way to tell "data is complete" vs "mirror is broken" from the outside. A dry-run mode showing coverage gaps would help.

2. **Empty records vs truly missing data** — 274,333 of 306,435 records are `empty=true` (channels had no messages that day). This is real, but hard to distinguish from "was never properly fetched." The early-exit optimization (`lastMessageId < startOfDay`) fires for dead channels and saves an empty record — correct, but opaque.

3. **`totalMessages` in registry can double-count** — `recordActivity` uses `totalMessages = totalMessages + messageCount` (cumulative increment). If a channel date is ever re-fetched with FORCE_OVERWRITE, the count inflates. `syncStats()` resets it correctly from items, but it drifts again after the next fetch. Consider switching to a direct `SUM` query for display instead of maintaining a running counter.

4. **`activityHistory` capped at 90 entries** — fine for velocity, but means the registry only "knows" recent activity. Long-dead channels look identical to channels that just started. The `last_msg_date` from items is more reliable for determining true channel health.

---

## Related Commands

```bash
# Fix stale registry stats (safe to run anytime)
npm run channels -- sync-stats --source=m3org.json

# Check what's actually in the DB
npm run channels -- stats --source=m3org.json

# Force-refetch a specific date range (ignores cache)
FORCE_OVERWRITE=true npm run historical -- --source=m3org.json \
  --after=2026-03-01 --before=2026-03-12 --onlyFetch

# Generate summaries from existing raw data
npm run channels -- archive --after=YYYY-MM-DD --before=YYYY-MM-DD --source=m3org.json
```
