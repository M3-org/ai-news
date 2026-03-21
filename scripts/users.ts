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
// Command: fetch-avatars
// ============================================================================

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

interface UserActivity {
  userId: string | null;
  helpGiven: Array<{ context: string; resolution: string; date: string }>;
  helpReceived: Array<{ context: string; date: string }>;
  questionsAsked: Array<{ question: string; date: string }>;
  questionsAnswered: Array<{ question: string; date: string }>;
  actionItems: Array<{ type: string; description: string; date: string }>;
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
          userActivity[faq.askedBy].questionsAsked.push({ question: faq.question, date: dateStr });
        }
        if (faq.answeredBy && faq.answeredBy !== "Unknown" && faq.answeredBy !== "Unanswered") {
          if (!userActivity[faq.answeredBy]) userActivity[faq.answeredBy] = createEmptyActivity();
          userActivity[faq.answeredBy].questionsAnswered.push({ question: faq.question, date: dateStr });
        }
      }
      for (const help of category.helpInteractions || []) {
        if (help.helper) {
          if (!userActivity[help.helper]) userActivity[help.helper] = createEmptyActivity();
          userActivity[help.helper].helpGiven.push({ context: help.context, resolution: help.resolution, date: dateStr });
        }
        if (help.helpee) {
          if (!userActivity[help.helpee]) userActivity[help.helpee] = createEmptyActivity();
          userActivity[help.helpee].helpReceived.push({ context: help.context, date: dateStr });
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
  const model = useOpenRouter ? "openai/gpt-4o-mini" : "gpt-4o-mini";

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

    const activityBlock = `Activity across ${activity.activeDates.size} days of logs (${dateRange}):
- Helped others: ${activity.helpGiven.length} times
- Received help: ${activity.helpReceived.length} times
- Questions asked: ${activity.questionsAsked.length}
- Questions answered: ${activity.questionsAnswered.length}
- Mentioned in action items: ${activity.actionItems.length} (${technicalCount} Technical, ${featureCount} Feature, ${docCount} Documentation)`;

    const samplesBlock = [
      activity.helpGiven.length ? `Sample help given:\n${activity.helpGiven.slice(-10).map((h) => `- Context: ${h.context} | Resolution: ${h.resolution}`).join("\n")}` : "",
      activity.actionItems.length ? `Sample action items:\n${activity.actionItems.slice(-15).map((a) => `- [${a.type}] ${a.description}`).join("\n")}` : "",
      activity.questionsAnswered.length ? `Sample questions answered:\n${activity.questionsAnswered.slice(-8).map((q) => `- ${q.question}`).join("\n")}` : "",
      activity.questionsAsked.length ? `Sample questions asked:\n${activity.questionsAsked.slice(-8).map((q) => `- ${q.question}`).join("\n")}` : "",
    ].filter(Boolean).join("\n\n");

    const registryBlock = `Registry data:
- Discord username: ${registryUser.username}
- Roles: ${registryUser.roles.join(", ") || "none"}
- Active: ${firstSeenDate} to ${lastSeenDate}
- Total messages: ${registryUser.totalMessages.toLocaleString()}`;

    let prompt: string;

    if (existingFile && !args.force) {
      // Extract existing prose (everything after the frontmatter)
      const existingProse = existingFile.replace(/^---[\s\S]*?---\n*/, "").trim();
      const existingFrontmatterMatch = existingFile.match(/^---\n([\s\S]*?)\n---/);
      const existingGeneratedAt = existingFrontmatterMatch?.[1].match(/generatedAt:\s*"?([^"\n]+)"?/)?.[1] || "unknown";

      prompt = `You are updating a community profile for "${displayName}" in the ${serverName} Discord server.

Existing profile (generated ${existingGeneratedAt}):
${existingProse}

${registryBlock}

Updated ${activityBlock}

${samplesBlock}

Update the profile based on all available data. Correct anything outdated, extend with new patterns, and note any meaningful shifts in focus or role over time${dateSpanMonths >= 3 ? " — especially if activity evolved across different periods" : ""}. Return the complete updated profile.

Write 2-3 paragraphs. Be specific and grounded in the data. Do not speculate beyond what the evidence shows.
Plain text only, no markdown, no emojis.`;
    } else {
      const temporalInstruction = dateSpanMonths >= 3
        ? "\n5. If their focus or activity shifted meaningfully over time, note how."
        : "";

      prompt = `You are writing a community profile for "${displayName}" in the ${serverName} Discord server.

${registryBlock}

${activityBlock}

${samplesBlock}

Write a 2-3 paragraph profile covering:
1. Who this person is and their role in the community
2. Their domains of expertise and what they work on
3. Their collaboration style — do they teach, build, organize, or ask?
4. Any recurring goals, challenges, or themes visible in the data${temporalInstruction}

Be specific and grounded in the data. Do not speculate beyond what the evidence shows.
Plain text only, no markdown, no emojis.`;
    }

    try {
      const completion = await openai.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 600,
      });
      const profileText = completion.choices[0].message.content?.trim() || "";

      // Write markdown file: YAML frontmatter + prose
      const frontmatter = [
        "---",
        `userId: "${registryUser.id}"`,
        `username: "${registryUser.username}"`,
        `displayName: "${displayName}"`,
        `roles: [${registryUser.roles.map((r) => `"${r}"`).join(", ")}]`,
        `activityTier: "${activity.activeDates.size >= 30 ? "core" : activity.activeDates.size >= 5 ? "regular" : "casual"}"`,
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
