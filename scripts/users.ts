/**
 * Unified User Management CLI
 *
 * Consolidates all Discord user operations with discord_users table:
 * - index: Build user index from raw logs
 * - fetch-avatars: Fetch avatar URLs from Discord API
 * - download-avatars: Download avatar images to local storage
 * - build-registry: Build discord_users table from discordRawData
 * - enrich: Enrich daily JSONs with nickname maps from discord_users
 *
 * Usage:
 *   npm run users -- index
 *   npm run users -- fetch-avatars --skip-existing
 *   npm run users -- download-avatars --skip-existing
 *   npm run users -- build-registry
 *   npm run users -- enrich --all
 */

import { open, Database } from "sqlite";
import sqlite3 from "sqlite3";
import { Client, GatewayIntentBits } from "discord.js";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";
import * as dotenv from "dotenv";
import { DiscordUserRegistry } from "../src/plugins/storage/DiscordUserRegistry";
import OpenAI from "openai";
import { outputJson, spinner, resolveDbPathFromConfig, resolveConfigPath } from "./cli";

dotenv.config({ quiet: true });

// ============================================================================
// Types
// ============================================================================

interface DiscordRawData {
  channel: { id: string; name: string };
  date: string;
  users: Record<string, {
    name: string;
    nickname: string | null;
    roles: string[];
  }>;
  messages: Array<{ id: string; uid: string; content: string }>;
}

interface UserProfile {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  avatarHash: string | null;
  isDefault: boolean;
  localPath: string | null;
  roles: string;
  firstSeen: string;
  lastSeen: string;
  totalMessages: number;
  nicknameHistory: string;
  channelActivity: string;
  downloadedAt: number | null;
  fileSize: number | null;
  validated: boolean;
}

interface CliArgs {
  force?: boolean;
  command: string;
  all?: boolean;
  date?: string;
  from?: string;
  to?: string;
  useIndex?: boolean;
  rateLimit?: number;
  skipExisting?: boolean;
  model?: string;
  dryRun?: boolean;
  updateIndex?: boolean;
  source?: string;
  json?: boolean;
  minMentions?: number;
}

// ============================================================================
// CLI Parsing
// ============================================================================

function parseArgs(argv: string[] = process.argv.slice(2)): CliArgs {
  const first = argv[0];
  const command = !first || first === "--help" || first === "-h" ? "help" : first;
  const args: CliArgs = { command };

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--all") args.all = true;
    else if (arg.startsWith("--date=")) args.date = arg.split("=")[1];
    else if (arg.startsWith("--from=")) args.from = arg.split("=")[1];
    else if (arg.startsWith("--to=")) args.to = arg.split("=")[1];
    else if (arg === "--use-index") args.useIndex = true;
    else if (arg.startsWith("--rate-limit=")) args.rateLimit = parseInt(arg.split("=")[1]);
    else if (arg === "--skip-existing") args.skipExisting = true;
    else if (arg === "--force") args.force = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--update-index") args.updateIndex = true;
    else if (arg.startsWith("--source=")) args.source = arg.split("=")[1];
    else if (arg === "--json") args.json = true;
    else if (arg.startsWith("--min-mentions=")) args.minMentions = parseInt(arg.split("=")[1]);
    else if (arg.startsWith("--model=")) args.model = arg.split("=")[1];
  }

  return args;
}

// ============================================================================
// Database Schema
// ============================================================================

async function initDatabase(db: Database): Promise<void> {
  // Initialize discord_users table via DiscordUserRegistry
  const registry = new DiscordUserRegistry(db);
  await registry.initialize();
}

// ============================================================================
// Command: index
// ============================================================================

async function commandIndex(db: Database): Promise<void> {
  console.log("\n🔨 Building User Index from Raw Logs\n");

  const query = `SELECT text, date FROM items WHERE type = 'discordRawData' ORDER BY date ASC`;
  const rows = await db.all(query);

  console.log(`📊 Processing ${rows.length} raw log entries...`);

  const users = new Map<string, any>();
  const userNicknamesByDate = new Map<string, Map<string, string>>();

  let minDate = "";
  let maxDate = "";

  for (const row of rows) {
    try {
      const data: DiscordRawData = JSON.parse(row.text);
      const dateStr = data.date.split("T")[0];

      if (!minDate || dateStr < minDate) minDate = dateStr;
      if (!maxDate || dateStr > maxDate) maxDate = dateStr;

      const messageCounts = new Map<string, number>();
      for (const message of data.messages) {
        messageCounts.set(message.uid, (messageCounts.get(message.uid) || 0) + 1);
      }

      for (const [userId, user] of Object.entries(data.users)) {
        const nickname = user.nickname || user.name;
        const messageCount = messageCounts.get(userId) || 0;
        const roles = Array.isArray(user.roles) ? user.roles : [];

        if (!userNicknamesByDate.has(userId)) {
          userNicknamesByDate.set(userId, new Map());
        }
        userNicknamesByDate.get(userId)!.set(dateStr, nickname);

        if (!users.has(userId)) {
          users.set(userId, {
            userId,
            username: user.name,
            displayName: nickname,
            roles: [...roles],
            firstSeen: dateStr,
            lastSeen: dateStr,
            totalMessages: messageCount,
            channelActivity: {}
          });
        } else {
          const profile = users.get(userId)!;
          if (dateStr > profile.lastSeen) {
            profile.lastSeen = dateStr;
            profile.displayName = nickname;
          }
          profile.roles = Array.from(new Set([...profile.roles, ...roles]));
          profile.totalMessages += messageCount;
        }

        const profile = users.get(userId)!;
        if (messageCount > 0) {
          const channelId = data.channel.id;
          profile.channelActivity[channelId] = (profile.channelActivity[channelId] || 0) + messageCount;
        }
      }
    } catch (err) {
      console.error(`Failed to parse raw log: ${err}`);
    }
  }

  console.log(`\n📝 Building nickname histories for ${users.size} users...`);

  // Build nickname history
  for (const [userId, dateNicknameMap] of userNicknamesByDate.entries()) {
    const profile = users.get(userId)!;
    const sortedDates = Array.from(dateNicknameMap.keys()).sort();

    const nicknameHistory: Array<{ nickname: string; dates: string[] }> = [];
    let currentNickname: string | null = null;
    let currentDates: string[] = [];

    for (const date of sortedDates) {
      const nickname = dateNicknameMap.get(date)!;
      if (nickname === currentNickname) {
        currentDates.push(date);
      } else {
        if (currentNickname !== null) {
          nicknameHistory.push({ nickname: currentNickname, dates: currentDates });
        }
        currentNickname = nickname;
        currentDates = [date];
      }
    }
    if (currentNickname !== null) {
      nicknameHistory.push({ nickname: currentNickname, dates: currentDates });
    }

    profile.nicknameHistory = nicknameHistory;
  }

  // Note: We no longer store in avatar_cache table
  // The user-index.json file (below) is the primary output
  console.log(`\n💾 Preparing to write user-index.json for ${users.size} users...`);

  console.log(`\n✅ User index built successfully!`);
  console.log(`   - ${users.size} users`);
  console.log(`   - Date range: ${minDate} to ${maxDate}`);
}

// ============================================================================
// Command: fetch-avatars / sync-profiles
// ============================================================================

const PROFILE_FRESHNESS_SECONDS = 7 * 24 * 60 * 60;

function isProfileFresh(metadata: any): boolean {
  const fetchedAt = metadata?.profileFetchedAt;
  if (typeof fetchedAt !== "number") return false;
  return fetchedAt >= Math.floor(Date.now() / 1000) - PROFILE_FRESHNESS_SECONDS;
}

function buildDiscordProfileMetadata(discordUser: any): Record<string, any> {
  const metadata: Record<string, any> = {
    profileFetchedAt: Math.floor(Date.now() / 1000),
    globalName: discordUser.globalName ?? null,
    discriminator: discordUser.discriminator ?? null,
    isBot: Boolean(discordUser.bot),
    isSystem: Boolean(discordUser.system),
    avatarHash: discordUser.avatar ?? null,
    bannerHash: discordUser.banner ?? null,
    accentColor: discordUser.accentColor ?? null,
    flags: discordUser.flags?.bitfield?.toString?.() ?? null,
    publicFlags: discordUser.flags?.bitfield?.toString?.() ?? null,
    avatarDecorationData: discordUser.avatarDecorationData ?? null,
  };

  const bannerUrl = typeof discordUser.bannerURL === "function"
    ? discordUser.bannerURL({ size: 512, extension: "png" })
    : null;
  if (bannerUrl) metadata.bannerUrl = bannerUrl;

  if ("collectibles" in discordUser && discordUser.collectibles != null) {
    metadata.collectibles = discordUser.collectibles;
  }
  if ("primaryGuild" in discordUser && discordUser.primaryGuild != null) {
    metadata.primaryGuild = discordUser.primaryGuild;
  }

  return metadata;
}

async function commandSyncProfiles(db: Database, args: CliArgs): Promise<void> {
  console.log("\n👤 Syncing Discord User Profiles\n");

  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    console.error("❌ Error: DISCORD_TOKEN not found in .env");
    process.exit(1);
  }

  // Initialize registry
  const registry = new DiscordUserRegistry(db);
  await registry.initialize();

  // Get users from discord_users table
  const users = await db.all<Array<{ id: string; username: string; displayName: string; avatarUrl: string | null; metadata: string | null }>>(
    `SELECT id, username, displayName, avatarUrl, metadata FROM discord_users`
  );
  console.log(`📖 Found ${users.length} users\n`);

  // Filter users if --skip-existing flag is set
  let usersToFetch = users;
  if (args.skipExisting && !args.force) {
    usersToFetch = users.filter(u => {
      const metadata = u.metadata ? JSON.parse(u.metadata) : null;
      return !isProfileFresh(metadata);
    });
    console.log(`⏭️  Skipping ${users.length - usersToFetch.length} users with fresh profiles\n`);
  }

  if (usersToFetch.length === 0) {
    console.log("✅ All users already have fresh profiles!");
    return;
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
  await client.login(token);
  console.log("🤖 Connected to Discord!\n");

  const rateLimit = args.rateLimit || 100;
  console.log(`🎨 Fetching current profile data (${rateLimit}ms rate limit)...`);
  console.log(`⏳ Estimated time: ~${Math.round(usersToFetch.length * rateLimit / 1000 / 60)} minutes\n`);

  let avatarCount = 0;
  let metadataCount = 0;
  let errorCount = 0;

  for (let i = 0; i < usersToFetch.length; i++) {
    const user = usersToFetch[i];

    if (i > 0 && i % 50 === 0) {
      console.log(`   Progress: ${i}/${usersToFetch.length} (${Math.round(i / usersToFetch.length * 100)}%)`);
    }

    try {
      const discordUser = await client.users.fetch(user.id, { force: true });
      const avatarUrl = discordUser.avatarURL({ size: 256, extension: 'png' }) || discordUser.defaultAvatarURL;
      const profileMetadata = buildDiscordProfileMetadata(discordUser);

      await db.run(
        `UPDATE discord_users SET avatarUrl = ?, metadata = ?, updatedAt = ? WHERE id = ?`,
        [avatarUrl, JSON.stringify(profileMetadata), Math.floor(Date.now() / 1000), user.id]
      );

      if (avatarUrl) avatarCount++;
      metadataCount++;
      await new Promise(resolve => setTimeout(resolve, rateLimit));
    } catch (error: any) {
      errorCount++;
      // Calculate default avatar index based on user ID
      const userIdBigInt = BigInt(user.id);
      const index = Number((userIdBigInt >> 22n) % 6n);
      const defaultUrl = `https://cdn.discordapp.com/embed/avatars/${index}.png`;

      const errorMetadata = {
        profileFetchedAt: Math.floor(Date.now() / 1000),
        fetchError: error.message,
      };
      await db.run(
        `UPDATE discord_users SET avatarUrl = ?, metadata = ?, updatedAt = ? WHERE id = ?`,
        [defaultUrl, JSON.stringify(errorMetadata), Math.floor(Date.now() / 1000), user.id]
      );

      if (error.code !== 10013) {
        console.warn(`   ⚠️  Failed to fetch user ${user.id}: ${error.message}`);
      }
      await new Promise(resolve => setTimeout(resolve, rateLimit));
    }
  }

  await client.destroy();

  console.log(`\n✅ Synced ${usersToFetch.length} user profiles:`);
  console.log(`   - ${avatarCount} avatar URLs updated`);
  console.log(`   - ${metadataCount} metadata records updated`);
  if (errorCount > 0) console.log(`   - ${errorCount} errors`);
}

async function commandFetchAvatars(db: Database, args: CliArgs): Promise<void> {
  console.log("\n🖼️  Fetching Discord Avatar URLs\n");

  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    console.error("❌ Error: DISCORD_TOKEN not found in .env");
    process.exit(1);
  }

  // Initialize registry
  const registry = new DiscordUserRegistry(db);
  await registry.initialize();

  // Get users from discord_users table
  const users = await db.all<Array<{ id: string; username: string; displayName: string; avatarUrl: string | null }>>(
    `SELECT id, username, displayName, avatarUrl FROM discord_users`
  );
  console.log(`📖 Found ${users.length} users\n`);

  // Filter users if --skip-existing flag is set
  let usersToFetch = users;
  if (args.skipExisting) {
    usersToFetch = users.filter(u => !u.avatarUrl);
    console.log(`⏭️  Skipping ${users.length - usersToFetch.length} users with existing avatars\n`);
  }

  if (usersToFetch.length === 0) {
    console.log("✅ All users already have avatars!");
    return;
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
  await client.login(token);
  console.log("🤖 Connected to Discord!\n");

  const rateLimit = args.rateLimit || 100;
  console.log(`🎨 Fetching avatar URLs (${rateLimit}ms rate limit)...`);
  console.log(`⏳ Estimated time: ~${Math.round(usersToFetch.length * rateLimit / 1000 / 60)} minutes\n`);

  let customCount = 0;
  let defaultCount = 0;
  let errorCount = 0;

  for (let i = 0; i < usersToFetch.length; i++) {
    const user = usersToFetch[i];

    if (i > 0 && i % 50 === 0) {
      console.log(`   Progress: ${i}/${usersToFetch.length} (${Math.round(i / usersToFetch.length * 100)}%)`);
    }

    try {
      const discordUser = await client.users.fetch(user.id);
      const avatarUrl = discordUser.avatarURL({ size: 256, extension: 'png' }) || discordUser.defaultAvatarURL;
      const isDefault = !discordUser.avatar;

      // Update discord_users table with avatarUrl
      await db.run(
        `UPDATE discord_users SET avatarUrl = ?, updatedAt = ? WHERE id = ?`,
        [avatarUrl, Math.floor(Date.now() / 1000), user.id]
      );

      isDefault ? defaultCount++ : customCount++;
      await new Promise(resolve => setTimeout(resolve, rateLimit));
    } catch (error: any) {
      errorCount++;
      // Calculate default avatar index based on user ID
      const userIdBigInt = BigInt(user.id);
      const index = Number((userIdBigInt >> 22n) % 6n);
      const defaultUrl = `https://cdn.discordapp.com/embed/avatars/${index}.png`;

      // Store default avatar
      await db.run(
        `UPDATE discord_users SET avatarUrl = ?, updatedAt = ? WHERE id = ?`,
        [defaultUrl, Math.floor(Date.now() / 1000), user.id]
      );

      if (error.code !== 10013) {
        console.warn(`   ⚠️  Failed to fetch user ${user.id}: ${error.message}`);
      }
      await new Promise(resolve => setTimeout(resolve, rateLimit));
    }
  }

  await client.destroy();

  console.log(`\n✅ Fetched ${usersToFetch.length} avatar URLs:`);
  console.log(`   - ${customCount} custom avatars`);
  console.log(`   - ${defaultCount} default avatars`);
  if (errorCount > 0) console.log(`   - ${errorCount} errors`);
}

// ============================================================================
// Command: build-registry
// ============================================================================

async function commandBuildRegistry(db: Database, args: CliArgs): Promise<void> {
  console.log("\n📊 Building Discord User Registry\n");
  const buildSpinner = spinner("Building user registry", process.argv.slice(2)).start();

  if (args.dryRun) {
    console.log("(DRY RUN - no changes will be made)\n");
  }

  // Initialize registry
  const registry = new DiscordUserRegistry(db);
  await registry.initialize();
  console.log("✓ Initialized discord_users table\n");

  // Get all discordRawData entries ordered by date
  console.log("📥 Fetching discordRawData entries...");
  const rawDataRows = await db.all<Array<{ cid: string; text: string }>>(
    "SELECT cid, text FROM items WHERE type = 'discordRawData' ORDER BY cid"
  );
  console.log(`   Found ${rawDataRows.length} entries\n`);

  if (rawDataRows.length === 0) {
    buildSpinner.stop();
    console.log("⚠️  No discordRawData found. Nothing to process.");
    return;
  }

  // Track progress
  let processed = 0;
  let usersProcessed = 0;
  const userMessageCounts = new Map<string, number>();

  console.log("🔄 Processing entries...\n");

  for (const row of rawDataRows) {
    try {
      const data: DiscordRawData = JSON.parse(row.text);
      const observedAt = data.date.split("T")[0]; // Extract YYYY-MM-DD

      // Count messages per user in this batch
      const messageCounts = new Map<string, number>();
      for (const message of data.messages) {
        messageCounts.set(message.uid, (messageCounts.get(message.uid) || 0) + 1);
      }

      // Process each user
      for (const [userId, user] of Object.entries(data.users)) {
        const messageCount = messageCounts.get(userId) || 0;

        // Track total messages across all dates
        userMessageCounts.set(
          userId,
          (userMessageCounts.get(userId) || 0) + messageCount
        );

        if (!args.dryRun) {
          await registry.upsertUser({
            id: userId,
            username: user.name,
            displayName: user.nickname,
            roles: user.roles || [],
            observedAt,
            messageCount
          });
        }

        usersProcessed++;
      }

      processed++;

      if (processed % 100 === 0) {
        buildSpinner.text = `Processed ${processed}/${rawDataRows.length} entries`;
        console.log(`   Progress: ${processed}/${rawDataRows.length} (${Math.round(processed / rawDataRows.length * 100)}%)`);
      }

    } catch (error) {
      console.error(`   ⚠️  Failed to process ${row.cid}:`, error);
    }
  }

  console.log(`\n✅ Processing complete!`);
  console.log(`   Entries processed: ${processed}`);
  console.log(`   User observations: ${usersProcessed}`);

  if (args.dryRun) {
    buildSpinner.stop();
    if (args.json) {
      outputJson({
        ok: true,
        command: "users.build-registry",
        data: {
          dryRun: true,
          entriesProcessed: processed,
          userObservations: usersProcessed,
        },
      });
      return;
    }
    console.log("\n✓ DRY RUN complete - no changes were made");
    return;
  }

  // Get final stats
  console.log("\n📊 Registry Statistics:");
  const stats = await registry.getStats();
  console.log(`   Total unique users: ${stats.totalUsers}`);
  console.log(`   Users with nickname changes: ${stats.usersWithNicknameChanges}`);
  console.log(`   Users with role changes: ${stats.usersWithRoleChanges}`);
  console.log(`   Total messages tracked: ${stats.totalMessages}`);

  if (stats.mostActiveUser) {
    console.log(`   Most active user: ${stats.mostActiveUser.username} (${stats.mostActiveUser.messages} messages)`);
  }

  // Show sample users with changes
  console.log("\n📝 Sample users with nickname changes:");
  const users = await registry.getAllUsers();
  const usersWithNicknameChanges = users
    .filter(u => u.nicknameChanges.length > 1)
    .slice(0, 5);

  for (const user of usersWithNicknameChanges) {
    console.log(`\n   ${user.username} (${user.totalMessages} messages):`);
    for (const change of user.nicknameChanges.slice(0, 3)) {
      console.log(`      ${change.observedAt}: "${change.nickname}"`);
    }
    if (user.nicknameChanges.length > 3) {
      console.log(`      ... and ${user.nicknameChanges.length - 3} more changes`);
    }
  }

  console.log("\n📝 Sample users with role changes:");
  const usersWithRoleChanges = users
    .filter(u => u.roleChanges.length > 1)
    .slice(0, 5);

  for (const user of usersWithRoleChanges) {
    console.log(`\n   ${user.username}:`);
    for (const change of user.roleChanges.slice(0, 3)) {
      console.log(`      ${change.observedAt}: [${change.roles.join(", ")}]`);
    }
    if (user.roleChanges.length > 3) {
      console.log(`      ... and ${user.roleChanges.length - 3} more changes`);
    }
  }

  console.log("\n🎉 Done!\n");
  buildSpinner.succeed("User registry build complete");
  if (args.json) {
    outputJson({
      ok: true,
      command: "users.build-registry",
      data: {
        dryRun: false,
        entriesProcessed: processed,
        userObservations: usersProcessed,
        stats,
      },
    });
  }
}

// ============================================================================
// Command: enrich
// ============================================================================

async function commandEnrich(db: Database, args: CliArgs): Promise<void> {
  console.log("\n📝 Enriching Discord Summary JSONs\n");

  if (args.dryRun) {
    console.log("(DRY RUN - no changes will be made)\n");
  }

  // Initialize registry
  const registry = new DiscordUserRegistry(db);

  // Determine dates to process
  const jsonDir = path.join(process.cwd(), "data", "discord", "json");
  let datesToProcess: string[] = [];

  if (args.all) {
    const files = fs.readdirSync(jsonDir);
    for (const file of files) {
      if (file.endsWith(".json")) {
        const match = file.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
        if (match) {
          datesToProcess.push(match[1]);
        }
      }
    }
    datesToProcess.sort();
  } else if (args.date) {
    datesToProcess = [args.date];
  } else if (args.from && args.to) {
    const current = new Date(args.from + "T00:00:00Z");
    const end = new Date(args.to + "T00:00:00Z");
    while (current <= end) {
      const year = current.getFullYear();
      const month = String(current.getMonth() + 1).padStart(2, "0");
      const day = String(current.getDate()).padStart(2, "0");
      datesToProcess.push(`${year}-${month}-${day}`);
      current.setDate(current.getDate() + 1);
    }
  } else {
    console.error(`
Usage:
  npm run users -- enrich --date=2025-01-13
  npm run users -- enrich --from=2025-01-01 --to=2025-01-13
  npm run users -- enrich --all
  npm run users -- enrich --all --dry-run
    `.trim());
    process.exit(1);
  }

  console.log(`📊 Processing ${datesToProcess.length} date(s)${args.dryRun ? " (DRY RUN)" : ""}\n`);

  // Process each date
  for (let i = 0; i < datesToProcess.length; i++) {
    const dateStr = datesToProcess[i];
    console.log(`[${i + 1}/${datesToProcess.length}] Processing ${dateStr}...`);

    // Build nickname map for this date
    const nicknameMap = await registry.buildNicknameMapForDate(dateStr);
    console.log(`   Built mapping for ${Object.keys(nicknameMap).length} unique nickname(s)`);

    // Enrich JSON file
    const jsonPath = path.join(jsonDir, `${dateStr}.json`);

    if (!fs.existsSync(jsonPath)) {
      console.warn(`⚠️  JSON file not found: ${jsonPath}`);
      continue;
    }

    const content = fs.readFileSync(jsonPath, "utf-8");
    const data = JSON.parse(content);

    // Check if already enriched
    if (data.nicknameMap && Object.keys(data.nicknameMap).length > 0) {
      console.log(`ℹ️  Already enriched: ${dateStr} (${Object.keys(data.nicknameMap).length} nicknames)`);
      continue;
    }

    // Add nickname map
    data.nicknameMap = nicknameMap;

    if (args.dryRun) {
      console.log(`✓ DRY RUN: Would enrich ${dateStr} with ${Object.keys(nicknameMap).length} nickname mappings`);
    } else {
      fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), "utf-8");
      console.log(`✓ Enriched: ${dateStr} (${Object.keys(nicknameMap).length} nicknames)`);
    }
  }

  console.log(`\n✅ Done!\n`);
}

// ============================================================================
// Command: download-avatars
// ============================================================================

function validateImageFile(filePath: string): boolean {
  try {
    const buffer = fs.readFileSync(filePath);
    if (buffer.length < 8) return false;

    // PNG
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return true;
    // JPEG
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return true;
    // GIF
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return true;
    // WebP
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer.length >= 12 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return true;

    return false;
  } catch {
    return false;
  }
}

function downloadFile(url: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === "https:" ? https : http;
    const file = fs.createWriteStream(outputPath);

    client.get(url, (response) => {
      if (response.statusCode !== 200) {
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      const contentType = response.headers["content-type"];
      if (contentType && !contentType.startsWith("image/")) {
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        reject(new Error(`Invalid content-type: ${contentType}`));
        return;
      }

      response.pipe(file);

      file.on("finish", () => {
        file.close();
        if (!validateImageFile(outputPath)) {
          fs.unlinkSync(outputPath);
          reject(new Error("Invalid image file"));
          return;
        }
        resolve();
      });
    }).on("error", (err) => {
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      reject(err);
    });
  });
}

async function commandDownloadAvatars(db: Database, args: CliArgs): Promise<void> {
  console.log("\n📥 Downloading Avatar Images\n");

  const outputDir = path.join(process.cwd(), "data", "discord", "avatars");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const users = await db.all(`
    SELECT id as user_id, username, displayName as display_name, avatarUrl as avatar_url
    FROM discord_users
    WHERE avatarUrl IS NOT NULL
  `);

  console.log(`📊 Found ${users.length} users with avatar URLs\n`);

  const rateLimit = args.rateLimit || 2000;
  const skipExisting = args.skipExisting !== false;

  console.log(`⏱️  Rate limit: ${rateLimit}ms per request`);
  if (skipExisting) console.log("✓ Skip mode: Will skip already downloaded files\n");

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;
  const processedUrls = new Set<string>();

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    const urlParts = user.avatar_url.split("/");
    const lastPart = urlParts[urlParts.length - 1].split("?")[0];
    const extension = lastPart.includes(".") ? lastPart.split(".").pop() : "png";
    const filename = `${user.user_id}.${extension}`;
    const outputPath = path.join(outputDir, filename);
    const relativePath = `data/discord/avatars/${filename}`;

    if (i > 0 && i % 50 === 0) {
      console.log(`   Progress: ${i}/${users.length} (${Math.round(i / users.length * 100)}%)`);
      console.log(`   Downloaded: ${downloaded} | Skipped: ${skipped} | Failed: ${failed}\n`);
    }

    if (skipExisting && fs.existsSync(outputPath)) {
      skipped++;
      continue;
    }

    if (processedUrls.has(user.avatar_url)) {
      const sourceUser = users.find(u => u.avatar_url === user.avatar_url && fs.existsSync(path.join(outputDir, `${u.user_id}.${extension}`)));
      if (sourceUser) {
        const sourcePath = path.join(outputDir, `${sourceUser.user_id}.${extension}`);
        fs.copyFileSync(sourcePath, outputPath);
        skipped++;
        continue;
      }
    }

    try {
      await downloadFile(user.avatar_url, outputPath);
      processedUrls.add(user.avatar_url);
      downloaded++;
    } catch (error: any) {
      failed++;
      console.warn(`   ❌ Failed: ${user.display_name} - ${error.message}`);
    }

    if (i < users.length - 1) {
      await new Promise(resolve => setTimeout(resolve, rateLimit));
    }
  }

  console.log(`\n✅ Download complete!`);
  console.log(`   Downloaded: ${downloaded}`);
  console.log(`   Skipped: ${skipped}`);
  console.log(`   Failed: ${failed}`);
}

// ============================================================================
// Command: status
// ============================================================================

async function commandStatus(db: Database, args: CliArgs): Promise<void> {
  const stats = await db.get(`
    SELECT
      COUNT(*) as total_users,
      SUM(CASE WHEN avatarUrl IS NOT NULL THEN 1 ELSE 0 END) as with_avatars,
      SUM(totalMessages) as total_messages,
      MIN(firstSeen) as earliest_ts,
      MAX(lastSeen) as latest_ts
    FROM discord_users
  `);
  if (args.json) {
    outputJson({ ok: true, command: "users.status", data: stats });
    return;
  }
  console.log("\n📊 User Cache Statistics\n");

  console.log(`Users: ${stats.total_users}`);
  console.log(`Avatars with URL: ${stats.with_avatars}`);
  console.log(`Total messages tracked: ${stats.total_messages || 0}`);
  if (stats.earliest_ts && stats.latest_ts) {
    const first = new Date(Number(stats.earliest_ts) * 1000).toISOString().split("T")[0];
    const last = new Date(Number(stats.latest_ts) * 1000).toISOString().split("T")[0];
    console.log(`Date Range: ${first} to ${last}`);
  }
  console.log("");
}

// ============================================================================
// Command: generate-profiles
// ============================================================================

/**
 * Sample items distributed across the full date range rather than only the
 * most recent. Splits sorted items into three equal buckets (early/mid/recent)
 * and takes ceil(n/3) evenly from each, so the profile reflects the full arc.
 */
function sampleAcrossRange<T extends { date: string }>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
  const bucketSize = Math.ceil(sorted.length / 3);
  const take = Math.ceil(n / 3);
  const early  = sorted.slice(0, bucketSize);
  const mid    = sorted.slice(bucketSize, bucketSize * 2);
  const recent = sorted.slice(bucketSize * 2);
  const pickEvenly = (bucket: T[], count: number): T[] => {
    if (bucket.length <= count) return bucket;
    const step = bucket.length / count;
    return Array.from({ length: count }, (_, i) => bucket[Math.floor(i * step)]);
  };
  return [...pickEvenly(early, take), ...pickEvenly(mid, take), ...pickEvenly(recent, take)];
}

interface UserActivity {
  userId: string | null;
  helpGiven:         Array<{ context: string; resolution: string; date: string; withUser?: string }>;
  helpReceived:      Array<{ context: string; date: string; fromUser?: string }>;
  questionsAsked:    Array<{ question: string; date: string; answeredBy?: string }>;
  questionsAnswered: Array<{ question: string; date: string; askedBy?: string }>;
  actionItems:       Array<{ type: string; description: string; date: string }>;
  activeDates: Set<string>;
}

function createEmptyActivity(): UserActivity {
  return {
    userId: null,
    helpGiven: [],
    helpReceived: [],
    questionsAsked: [],
    questionsAnswered: [],
    actionItems: [],
    activeDates: new Set(),
  };
}

function topN(names: (string | undefined)[], n: number): string[] {
  const counts = new Map<string, number>();
  for (const name of names) {
    if (name && name !== "Unknown" && name !== "Unanswered" && name !== "Deleted User" && name !== "Community") {
      counts.set(name, (counts.get(name) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name]) => name);
}

async function sampleRawMessages(
  db: Database,
  userId: string,
  sampleDates: string[],
  maxMessages: number = 6
): Promise<Array<{ content: string; date: string }>> {
  if (!userId || sampleDates.length === 0) return [];

  const placeholders = sampleDates.map(() => `cid LIKE ?`).join(" OR ");
  const params = sampleDates.map(d => `%-${d}`);
  const rows = await db.all<Array<{ text: string; cid: string }>>(
    `SELECT text, cid FROM items WHERE type = 'discordRawData' AND (${placeholders})`,
    params
  );

  const byDate = new Map<string, string[]>();
  for (const row of rows) {
    let data: any;
    try { data = JSON.parse(row.text); } catch { continue; }
    if (!data) continue;
    const dateStr: string = (data.date || "").split("T")[0];
    for (const msg of data.messages || []) {
      if (msg.uid !== userId) continue;
      const raw = (msg.content || "").trim();
      // strip wrapping brackets Discord sometimes stores around message content
      const content = raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1).trim() : raw;
      if (
        content.length < 80 ||
        content.startsWith("http") ||
        /^[\s\p{Emoji}\p{P}]+$/u.test(content)
      ) continue;
      if (!byDate.has(dateStr)) byDate.set(dateStr, []);
      byDate.get(dateStr)!.push(content);
    }
  }

  const results: Array<{ content: string; date: string }> = [];
  for (const [date, messages] of [...byDate.entries()].sort()) {
    // take up to 2 per date
    for (const content of messages.slice(0, 2)) {
      results.push({ content, date });
      if (results.length >= maxMessages) return results;
    }
  }
  return results;
}

async function commandGenerateProfiles(db: Database, args: CliArgs): Promise<void> {
  console.log("\nGenerating User Profiles\n");

  const configPath = resolveConfigPath(args.source);
  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

  const serverName: string =
    config.generators?.find((g: any) => g.params?.summaryType)?.params?.summaryType || "Discord Server";

  const rawOutputPath: string | undefined =
    config.generators?.find((g: any) => g.type === "DiscordSummaryGenerator" && g.params?.outputPath)?.params?.outputPath
    ?? config.generators?.find((g: any) => g.params?.outputPath)?.params?.outputPath;
  if (!rawOutputPath) {
    console.error("No generator outputPath found in config.");
    process.exit(1);
  }

  const outputBase = path.resolve(process.cwd(), rawOutputPath);
  const jsonDir = path.join(outputBase, "json");
  const usersDir = path.join(outputBase, "users");

  if (!fs.existsSync(jsonDir)) {
    console.error(`JSON directory not found: ${jsonDir}`);
    console.error("Run historical generation first.");
    process.exit(1);
  }

  fs.mkdirSync(usersDir, { recursive: true });

  const minMentions = args.minMentions ?? 3;
  const files = fs
    .readdirSync(jsonDir)
    .filter((f) => f.match(/^\d{4}-\d{2}-\d{2}\.json$/))
    .sort();

  console.log(`Scanning ${files.length} daily JSON files...\n`);

  const userActivity: Record<string, UserActivity> = {};

  for (const file of files) {
    let data: any;
    try {
      data = JSON.parse(fs.readFileSync(path.join(jsonDir, file), "utf-8"));
    } catch {
      continue;
    }
    const dateStr = file.replace(".json", "");
    const nicknameMap: Record<string, any> = data.nicknameMap || {};

    for (const [displayName, entry] of Object.entries(nicknameMap)) {
      if (!userActivity[displayName]) userActivity[displayName] = createEmptyActivity();
      userActivity[displayName].activeDates.add(dateStr);
      if (!userActivity[displayName].userId && (entry as any).id) {
        userActivity[displayName].userId = (entry as any).id;
      }
    }

    for (const category of data.categories || []) {
      for (const faq of category.faqs || []) {
        if (faq.askedBy && faq.askedBy !== "Unknown") {
          if (!userActivity[faq.askedBy]) userActivity[faq.askedBy] = createEmptyActivity();
          userActivity[faq.askedBy].questionsAsked.push({
            question: faq.question,
            date: dateStr,
            answeredBy: faq.answeredBy && faq.answeredBy !== "Unanswered" ? faq.answeredBy : undefined,
          });
        }
        if (faq.answeredBy && faq.answeredBy !== "Unknown" && faq.answeredBy !== "Unanswered") {
          if (!userActivity[faq.answeredBy]) userActivity[faq.answeredBy] = createEmptyActivity();
          userActivity[faq.answeredBy].questionsAnswered.push({
            question: faq.question,
            date: dateStr,
            askedBy: faq.askedBy && faq.askedBy !== "Unknown" ? faq.askedBy : undefined,
          });
        }
      }
      for (const help of category.helpInteractions || []) {
        if (help.helper) {
          if (!userActivity[help.helper]) userActivity[help.helper] = createEmptyActivity();
          userActivity[help.helper].helpGiven.push({
            context: help.context,
            resolution: help.resolution,
            date: dateStr,
            withUser: help.helpee || undefined,
          });
        }
        if (help.helpee) {
          if (!userActivity[help.helpee]) userActivity[help.helpee] = createEmptyActivity();
          userActivity[help.helpee].helpReceived.push({
            context: help.context,
            date: dateStr,
            fromUser: help.helper || undefined,
          });
        }
      }
      for (const item of category.actionItems || []) {
        const names: string[] = (item.mentionedBy || "").split(/,\s*|\s+and\s+/);
        for (const rawName of names) {
          const n = rawName.trim();
          if (!n) continue;
          if (!userActivity[n]) userActivity[n] = createEmptyActivity();
          userActivity[n].actionItems.push({ type: item.type, description: item.description, date: dateStr });
        }
      }
    }
  }

  const activeUsers = Object.entries(userActivity)
    .map(([displayName, activity]) => {
      const totalMentions =
        activity.helpGiven.length +
        activity.helpReceived.length +
        activity.questionsAsked.length +
        activity.questionsAnswered.length +
        activity.actionItems.length;
      return { displayName, activity, totalMentions };
    })
    .filter((u) => u.totalMentions >= minMentions)
    .sort((a, b) => b.totalMentions - a.totalMentions);

  console.log(
    `${Object.keys(userActivity).length} unique names found, ${activeUsers.length} meet minimum threshold (${minMentions} mentions)\n`
  );

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("OPENAI_API_KEY not set");
    process.exit(1);
  }
  const useOpenRouter = process.env.USE_OPENROUTER === "true";
  const openai = new OpenAI({
    apiKey,
    ...(useOpenRouter ? { baseURL: "https://openrouter.ai/api/v1" } : {}),
  });
  const model = args.model ?? "anthropic/claude-sonnet-4.6";

  const registry = new DiscordUserRegistry(db);
  let generated = 0;
  let skipped = 0;

  for (let i = 0; i < activeUsers.length; i++) {
    const { displayName, activity, totalMentions } = activeUsers[i];
    process.stdout.write(`[${i + 1}/${activeUsers.length}] ${displayName} (${totalMentions} mentions)... `);

    let registryUser = null;
    if (activity.userId) registryUser = await registry.getUserById(activity.userId);
    if (!registryUser) registryUser = await registry.getUserByNickname(displayName);
    if (!registryUser) registryUser = await registry.getUserByUsername(displayName);

    if (!registryUser) {
      console.log("not in registry, skipped");
      skipped++;
      continue;
    }

    const profileFile = path.join(usersDir, `${displayName.replace(/[/\\?%*:|"<>]/g, "_")}.md`);
    const existingFile = fs.existsSync(profileFile) ? fs.readFileSync(profileFile, "utf-8") : null;

    if (args.skipExisting && existingFile) {
      console.log("already has profile, skipped");
      skipped++;
      continue;
    }

    const firstSeenDate = new Date(registryUser.firstSeen * 1000).toISOString().split("T")[0];
    const lastSeenDate = new Date(registryUser.lastSeen * 1000).toISOString().split("T")[0];
    const technicalCount = activity.actionItems.filter((a) => a.type === "Technical").length;
    const featureCount = activity.actionItems.filter((a) => a.type === "Feature").length;
    const docCount = activity.actionItems.filter((a) => a.type === "Documentation").length;

    const sortedActiveDates = [...activity.activeDates].sort();
    const dateRange = sortedActiveDates.length
      ? `${sortedActiveDates[0]}/${sortedActiveDates[sortedActiveDates.length - 1]}`
      : "unknown";
    const dateSpanMonths = sortedActiveDates.length >= 2 ? (() => {
      const start = new Date(sortedActiveDates[0]);
      const end = new Date(sortedActiveDates[sortedActiveDates.length - 1]);
      return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
    })() : 0;

    const activityTier = activity.activeDates.size >= 30 ? "core"
      : activity.activeDates.size >= 5 ? "regular" : "casual";

    const SAMPLES = activityTier === "core"
      ? { help: 20, actions: 25, questions: 15 }
      : activityTier === "regular"
      ? { help: 12, actions: 15, questions: 10 }
      : { help: 6, actions: 8, questions: 5 };

    // Compute interaction stats from full (unsampled) arrays
    const topHelpees = topN(activity.helpGiven.map(h => h.withUser), 5);
    const topHelpers = topN(activity.helpReceived.map(h => h.fromUser), 5);
    const uniqueCounterparties = new Set([
      ...activity.helpGiven.map(h => h.withUser),
      ...activity.helpReceived.map(h => h.fromUser),
      ...activity.questionsAnswered.map(q => q.askedBy),
    ].filter(Boolean)).size;

    // Sample raw messages from SQLite spread across date range
    const msgSampleDates: string[] = (() => {
      if (sortedActiveDates.length === 0) return [];
      const n = Math.min(9, sortedActiveDates.length);
      const step = sortedActiveDates.length / n;
      return Array.from({ length: n }, (_, i) => sortedActiveDates[Math.floor(i * step)]);
    })();
    const rawMessages = activity.userId
      ? await sampleRawMessages(db, activity.userId, msgSampleDates)
      : [];

    const helpGivenSamples     = sampleAcrossRange(activity.helpGiven,         SAMPLES.help);
    const helpReceivedSamples  = sampleAcrossRange(activity.helpReceived,       SAMPLES.help);
    const actionItemSamples    = sampleAcrossRange(activity.actionItems,        SAMPLES.actions);
    const questAnsweredSamples = sampleAcrossRange(activity.questionsAnswered,  SAMPLES.questions);
    const questAskedSamples    = sampleAcrossRange(activity.questionsAsked,     SAMPLES.questions);

    const activityBlock = `Activity across ${activity.activeDates.size} days of logs (${dateRange}):
- Helped others: ${activity.helpGiven.length} times
- Received help: ${activity.helpReceived.length} times
- Questions asked: ${activity.questionsAsked.length}
- Questions answered: ${activity.questionsAnswered.length}
- Mentioned in action items: ${activity.actionItems.length} (${technicalCount} Technical, ${featureCount} Feature, ${docCount} Documentation)`;

    const samplesBlock = [
      helpGivenSamples.length
        ? `Help given (${helpGivenSamples.length} samples across full date range):\n`
          + helpGivenSamples.map((h) => `- [${h.date}] Context: ${h.context} | Resolution: ${h.resolution}`).join("\n")
        : "",
      helpReceivedSamples.length
        ? `Help received — use for Problems & Challenges section (${helpReceivedSamples.length} samples):\n`
          + helpReceivedSamples.map((h) => `- [${h.date}] ${h.context}`).join("\n")
        : "",
      actionItemSamples.length
        ? `Action items (${actionItemSamples.length} samples):\n`
          + actionItemSamples.map((a) => `- [${a.date}] [${a.type}] ${a.description}`).join("\n")
        : "",
      questAnsweredSamples.length
        ? `Questions answered (${questAnsweredSamples.length} samples):\n`
          + questAnsweredSamples.map((q) => `- [${q.date}] ${q.question}`).join("\n")
        : "",
      questAskedSamples.length
        ? `Questions asked verbatim — use as direct quotes in ## Quotes (${questAskedSamples.length} samples):\n`
          + questAskedSamples.map((q) => `- (${q.date.slice(0, 7)}) "${q.question}"`).join("\n")
        : "",
      rawMessages.length
        ? `Raw message samples (verbatim from chat logs — use some in ## Quotes alongside questions):\n`
          + rawMessages.map((m) => `- (${m.date.slice(0, 7)}) "${m.content}"`).join("\n")
        : "",
    ].filter(Boolean).join("\n\n");

    const interactionBlock = [
      topHelpees.length ? `- Most frequently helps: ${topHelpees.join(", ")}` : "",
      topHelpers.length ? `- Most frequently receives help from: ${topHelpers.join(", ")}` : "",
      uniqueCounterparties > 0 ? `- Unique collaborators: ~${uniqueCounterparties} users` : "",
    ].filter(Boolean).join("\n");

    const registryBlock = `Registry data:
- Discord username: ${registryUser.username}
- Roles: ${registryUser.roles.join(", ") || "none"}
- Active: ${firstSeenDate} to ${lastSeenDate}
- Total messages: ${registryUser.totalMessages.toLocaleString()}`;

    // Derive evidence bounds from actual extracted data (not nicknameMap presence),
    // so Temporal Arc doesn't reference years for which we have no summaries yet.
    const allSampleDates = [
      ...helpGivenSamples.map(h => h.date),
      ...helpReceivedSamples.map(h => h.date),
      ...actionItemSamples.map(a => a.date),
      ...questAnsweredSamples.map(q => q.date),
      ...questAskedSamples.map(q => q.date),
    ].filter(Boolean).sort();
    const evidenceStart = allSampleDates[0]?.slice(0, 7) ?? sortedActiveDates[0]?.slice(0, 7) ?? "";
    const evidenceEnd   = allSampleDates[allSampleDates.length - 1]?.slice(0, 7) ?? sortedActiveDates[sortedActiveDates.length - 1]?.slice(0, 7) ?? "";
    const evidenceSpanMonths = (evidenceStart && evidenceEnd) ? (() => {
      const s = new Date(evidenceStart + "-01");
      const e = new Date(evidenceEnd + "-01");
      return (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
    })() : 0;
    const temporalArcSection = evidenceSpanMonths >= 3
      ? `\n## Temporal Arc\nDate-bucketed bullet list showing how this person's focus shifted over time. Use 2-4 bullets, each starting with a bold year range:\n- **YYYY–YYYY:** what they were focused on in this period\nOnly cover ${evidenceStart} to ${evidenceEnd} — the actual date range of the evidence samples above. Do not extrapolate beyond that range.`
      : "";

    let prompt: string;

    // Compute help ratio strings for injection as hard facts
    const helpRatio = activity.helpReceived.length > 0
      ? ` (${(activity.helpGiven.length / activity.helpReceived.length).toFixed(1)}x more given than received)`
      : "";

    const sharedContext = `${registryBlock}

INTERACTION DATA (computed from full history):
${interactionBlock}

${activityBlock}

${samplesBlock}`;

    const sectionSpec = `Output exactly the following sections in this order. Use the exact ## headings shown. Only include content that is directly grounded in the evidence above — do not infer, speculate, or fill gaps.

## Summary
2-3 bullet points, stats only. Cover: active date range, total messages, help given vs received${helpRatio}, questions asked vs answered. No narrative filler. Example format:
- Active ${firstSeenDate} to ${lastSeenDate} · ${registryUser.totalMessages.toLocaleString()} messages across ${activity.activeDates.size} active days
- Help given: ${activity.helpGiven.length} · Help received: ${activity.helpReceived.length}
- Questions asked: ${activity.questionsAsked.length} · Answered: ${activity.questionsAnswered.length}
Output these exact bullet points — do not rewrite them.

## Focus Areas
Read all the evidence samples above. Count how many times each distinct topic, technology, or domain appears across help given, questions answered, and action items. List the top 5-12 by frequency. Replace N with your actual count. Format exactly as:
- Topic name (N mentions)
Example: "- Blender (8 mentions)". N must be a real integer you counted, not a placeholder.

## Help Interactions
List the top people this person helps and receives help from, using the interaction data above. Format as:
**Gives help to:** name1, name2, name3 (from "Most frequently helps")
**Receives help from:** name1, name2 (from "Most frequently receives help from")
Then 1 sentence describing the pattern of what they help with, grounded in the help given samples.

## Quotes
4-6 direct quotes. Prefer verbatim text from "Raw message samples" over extracted questions — raw messages show how they explain and think. Choose quotes that reveal domain knowledge or characteristic phrasing, not generic chat. Format each as a bullet with the date in parentheses:
- "verbatim text here" (YYYY-MM)
Do NOT add square brackets around the quoted text. Copy it exactly as given in the samples above.
${temporalArcSection}
Output only section content starting from ## Summary. Do not output YAML, code fences, or any preamble.`;

    if (existingFile && !args.force) {
      const existingProse = existingFile.replace(/^---[\s\S]*?---\n*/, "").trim();
      const existingFrontmatterMatch = existingFile.match(/^---\n([\s\S]*?)\n---/);
      const existingGeneratedAt = existingFrontmatterMatch?.[1].match(/generatedAt:\s*"?([^"\n]+)"?/)?.[1] || "unknown";

      prompt = `You are updating a community profile for "${displayName}" in the ${serverName} Discord server.

The existing profile was generated on ${existingGeneratedAt}. New activity data is provided. Output the complete updated profile using the section spec below.

Rules:
1. Use the exact ## headings and order from the section spec. If existing sections differ (old names like "Bio", "Help Patterns", etc.) output the new structure — do not preserve the old headings.
2. Only include content grounded in evidence. Do not extrapolate.
3. For ## Temporal Arc: only cover ${evidenceStart} to ${evidenceEnd}. Do not extend beyond dates in the evidence.
4. For ## Quotes: prefer raw message text over extracted questions.

EXISTING PROFILE (for context — do not copy verbatim, use as prior knowledge):
${existingProse}

${sharedContext}

${sectionSpec}`;
    } else {
      prompt = `You are writing a community profile for "${displayName}" in the ${serverName} Discord server.

${sharedContext}

${sectionSpec}`;
    }

    try {
      const completion = await openai.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
      });
      const profileText = completion.choices[0].message.content?.trim() || "";

      // Write markdown file: YAML frontmatter + prose
      const frontmatter = [
        "---",
        `userId: "${registryUser.id}"`,
        `username: "${registryUser.username}"`,
        `displayName: "${displayName}"`,
        `roles: [${registryUser.roles.map((r) => `"${r}"`).join(", ")}]`,
        `activityTier: "${activityTier}"`,
        `generatedAt: "${new Date().toISOString().split("T")[0]}"`,
        `dateRange: "${dateRange}"`,
        `helpGiven: ${activity.helpGiven.length}`,
        `helpReceived: ${activity.helpReceived.length}`,
        `questionsAsked: ${activity.questionsAsked.length}`,
        `questionsAnswered: ${activity.questionsAnswered.length}`,
        `actionItems: {Technical: ${technicalCount}, Feature: ${featureCount}, Documentation: ${docCount}}`,
        `activeDays: ${activity.activeDates.size}`,
        `totalMessages: ${registryUser.totalMessages}`,
        "---",
      ].join("\n");

      fs.writeFileSync(profileFile, `${frontmatter}\n\n${profileText}\n`);

      // DB notes = latest prose for nicknameMap injection
      await registry.updateNotes(registryUser.id, profileText);

      const existingMeta: Record<string, any> = registryUser.metadata || {};
      await registry.updateMetadata(registryUser.id, {
        ...existingMeta,
        profile: {
          generatedAt: new Date().toISOString().split("T")[0],
          dateRange,
          helpGiven: activity.helpGiven.length,
          helpReceived: activity.helpReceived.length,
          questionsAsked: activity.questionsAsked.length,
          questionsAnswered: activity.questionsAnswered.length,
          actionItems: { Technical: technicalCount, Feature: featureCount, Documentation: docCount },
          activeDays: activity.activeDates.size,
        },
      });

      const mode = existingFile && !args.force ? "updated" : "generated";
      console.log(`${mode} (${profileText.length} chars) → ${path.basename(profileFile)}`);
      generated++;
    } catch (err) {
      console.log(`error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\nDone. Generated: ${generated}, Skipped: ${skipped}\n`);
  console.log(`Profiles written to: ${usersDir}\n`);
}

// ============================================================================
// Command: help
// ============================================================================

function commandHelp(): void {
  console.log(`
📚 Discord User Registry CLI

Commands:
  index              Build user-index.json from raw Discord logs
  fetch-avatars      Fetch avatar URLs from Discord API → discord_users table
                     Options: --rate-limit=<ms> --skip-existing
  download-avatars   Download avatar images to data/discord/avatars/
                     Options: --rate-limit=<ms> --skip-existing
  build-registry     Build discord_users table from discordRawData
                     Options: --dry-run
  status             Show registry/avatar cache statistics
  enrich             Enrich JSON files with nickname maps from discord_users
                     Options: --date=YYYY-MM-DD --from/--to --all --dry-run
  generate-profiles  Generate AI profiles for active users from summary JSONs
                     Options: --min-mentions=<n> (default: 3) --skip-existing --force

Options:
  --source=<config>.json  Target a specific config (e.g. --source=m3org.json)
                          Without --source, processes all configs in config/
  --json                  Output machine-readable JSON summary where supported

Examples:
  npm run users -- build-registry --source=m3org.json
  npm run users -- index --source=elizaos.json
  npm run users -- fetch-avatars --rate-limit=100 --skip-existing
  npm run users -- download-avatars --rate-limit=2000 --skip-existing
  npm run users -- build-registry
  npm run users -- build-registry --dry-run
  npm run users -- enrich --date=2025-01-15
  npm run users -- enrich --from=2025-01-01 --to=2025-01-15
  npm run users -- enrich --all
  npm run users -- enrich --all --dry-run
  npm run users -- generate-profiles --source=m3org.json
  npm run users -- generate-profiles --source=m3org.json --min-mentions=5 --skip-existing
  npm run users -- generate-profiles --source=m3org.json --force

Note:
  - User data is stored in discord_users table (see DiscordUserRegistry)
  - Avatar URLs are stored in discord_users.avatarUrl field
  - build-registry populates discord_users from discordRawData items
  - enrich adds nicknameMap to daily JSON files using discord_users data
  - download-avatars saves images locally (2000ms rate limit recommended)
  - generate-profiles reads all summary JSONs and writes AI-generated profiles
    to output/<server>/summaries/users/<displayName>.md (YAML frontmatter + prose)
    and discord_users.notes (latest prose for nicknameMap injection)
  - Re-running generate-profiles does delta updates (patch existing profile with new data)
  - Use --skip-existing to skip users who already have a profile file
  - Use --force to fully regenerate profiles instead of delta-patching
  `);
}

// ============================================================================
// Main
// ============================================================================

const CONFIG_DIR = "./config";

function resolveDbPaths(source?: string): string[] {
  const configFiles = source
    ? [source]
    : fs.readdirSync(CONFIG_DIR).filter((f) => f.endsWith(".json"));

  const paths: string[] = [];
  for (const configFile of configFiles) {
    const dbPath = resolveDbPathFromConfig(configFile);
    if (dbPath && fs.existsSync(dbPath)) {
      paths.push(dbPath);
    }
  }
  return paths;
}

export async function runUsers(argv: string[] = process.argv.slice(2)) {
  const args = parseArgs(argv);

  // Help doesn't need a database
  if (args.command === "help" || !args.command) {
    commandHelp();
    return;
  }

  const dbPaths = resolveDbPaths(args.source);

  if (dbPaths.length === 0) {
    console.error("No databases found. Use --source=<config>.json or add configs to config/.");
    process.exit(1);
  }

  for (const dbPath of dbPaths) {
    if (!args.json) {
      console.log(`\nUsing database: ${path.relative(process.cwd(), dbPath)}`);
    }
    const db = await open({ filename: dbPath, driver: sqlite3.Database });

    await initDatabase(db);

    switch (args.command) {
      case "index":
        await commandIndex(db);
        break;
      case "fetch-avatars":
        await commandFetchAvatars(db, args);
        break;
      case "sync-profiles":
        await commandSyncProfiles(db, args);
        break;
      case "build-registry":
        await commandBuildRegistry(db, args);
        break;
      case "enrich":
        await commandEnrich(db, args);
        break;
      case "download-avatars":
        await commandDownloadAvatars(db, args);
        break;
      case "status":
        await commandStatus(db, args);
        break;
      case "generate-profiles":
        await commandGenerateProfiles(db, args);
        break;
      default:
        commandHelp();
        break;
    }

    await db.close();
  }
}

if (require.main === module) {
  runUsers().catch((err) => {
    console.error("❌ Error:", err);
    process.exit(1);
  });
}
