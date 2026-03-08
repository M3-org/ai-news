/**
 * Database Migration Script
 *
 * Applies schema migrations to all configured SQLite databases.
 * Safe to run multiple times — all migrations are idempotent.
 *
 * Usage:
 *   npx tsx scripts/migrate-db.ts [glob-pattern]
 *
 * Examples:
 *   npx tsx scripts/migrate-db.ts                               # migrate config/*.json databases
 *   npx tsx scripts/migrate-db.ts "gh-pages-deploy/data/*.sqlite"  # migrate specific files
 */

import { open, Database } from "sqlite";
import sqlite3 from "sqlite3";
import { glob } from "glob";
import * as fs from "fs";

// ============================================================================
// Migrations
// Each migration is idempotent and identified by a human-readable description.
// ============================================================================

interface Migration {
  description: string;
  apply: (db: Database) => Promise<void>;
}

async function getColumns(db: Database, table: string): Promise<Set<string>> {
  const exists = await db.get(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    table
  );
  if (!exists) return new Set();
  const rows = await db.all<Array<{ name: string }>>(`PRAGMA table_info(${table})`);
  return new Set(rows.map((r) => r.name));
}

const MIGRATIONS: Migration[] = [
  {
    description: "Add aiRecommendation and aiReason to discord_channels",
    async apply(db) {
      const cols = await getColumns(db, "discord_channels");
      if (!cols.has("aiRecommendation")) {
        await db.exec(`ALTER TABLE discord_channels ADD COLUMN aiRecommendation TEXT`);
        await db.exec(`CREATE INDEX IF NOT EXISTS idx_discord_channels_aiRecommendation ON discord_channels(aiRecommendation)`);
      }
      if (!cols.has("aiReason")) {
        await db.exec(`ALTER TABLE discord_channels ADD COLUMN aiReason TEXT`);
      }
    },
  },
  {
    description: "Add unavailableReason and unavailableSince to discord_channels",
    async apply(db) {
      const cols = await getColumns(db, "discord_channels");
      if (!cols.has("unavailableReason")) {
        await db.exec(`ALTER TABLE discord_channels ADD COLUMN unavailableReason TEXT`);
      }
      if (!cols.has("unavailableSince")) {
        await db.exec(`ALTER TABLE discord_channels ADD COLUMN unavailableSince INTEGER`);
      }
    },
  },
];

// ============================================================================
// Per-database migration
// ============================================================================

async function migrateDatabase(dbPath: string): Promise<void> {
  console.log(`\nMigrating: ${dbPath}`);
  const db = await open({ filename: dbPath, driver: sqlite3.Database });

  try {
    for (const migration of MIGRATIONS) {
      try {
        await migration.apply(db);
        console.log(`  ✓ ${migration.description}`);
      } catch (err: any) {
        // duplicate column name = already applied
        if (err.message?.includes("duplicate column") || err.message?.includes("no such table")) {
          console.log(`  - ${migration.description} (skipped: already applied)`);
        } else {
          throw err;
        }
      }
    }
  } finally {
    await db.close();
  }
}

// ============================================================================
// Config-based database discovery
// ============================================================================

async function findDatabasesFromConfigs(): Promise<string[]> {
  const configFiles = await glob("config/*.json");
  const dbPaths: string[] = [];

  for (const configFile of configFiles) {
    try {
      const config = JSON.parse(fs.readFileSync(configFile, "utf-8"));
      // Support both settings.dbPath and storage[0].options.filename patterns
      const dbPath =
        config?.settings?.dbPath ||
        config?.storage?.[0]?.options?.filename ||
        config?.storage?.[0]?.params?.dbPath;
      if (dbPath && fs.existsSync(dbPath)) {
        dbPaths.push(dbPath);
      }
    } catch {
      // Skip unparseable config files
    }
  }

  return dbPaths;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  let dbPaths: string[] = [];

  if (args.length > 0) {
    for (const pattern of args) {
      const matched = await glob(pattern);
      if (matched.length > 0) {
        dbPaths.push(...matched);
      } else if (fs.existsSync(pattern)) {
        dbPaths.push(pattern);
      }
    }
  } else {
    dbPaths = await findDatabasesFromConfigs();

    if (dbPaths.length === 0) {
      console.log("No databases found from config files.");
      console.log("Tip: npx tsx scripts/migrate-db.ts 'gh-pages-deploy/data/*.sqlite'");
      process.exit(0);
    }
  }

  dbPaths = [...new Set(dbPaths)];

  if (dbPaths.length === 0) {
    console.error("No matching database files found.");
    process.exit(1);
  }

  console.log(`Found ${dbPaths.length} database(s) to migrate.`);

  let success = 0;
  let failed = 0;

  for (const dbPath of dbPaths) {
    if (!fs.existsSync(dbPath)) {
      console.warn(`  Warning: ${dbPath} does not exist, skipping.`);
      continue;
    }
    try {
      await migrateDatabase(dbPath);
      success++;
    } catch (err) {
      console.error(`  ERROR migrating ${dbPath}:`, err);
      failed++;
    }
  }

  console.log(`\nDone: ${success} succeeded, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
