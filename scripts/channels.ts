/**
 * Discord Channel Management CLI
 *
 * Single source of truth for all channel operations:
 * - discover: Fetch channels from Discord API (or raw data if no token)
 * - analyze: Run LLM analysis on channels to generate recommendations
 * - propose: Generate config diff and PR body for tracking changes
 * - list/show/stats: Query channel data from registry
 * - track/untrack/mute/unmute: Manage channel tracking state
 * - build-registry: Backfill from discordRawData
 *
 * Usage:
 *   npm run channels -- discover
 *   npm run channels -- analyze [--all] [--channel=ID]
 *   npm run channels -- propose [--dry-run]
 *   npm run channels -- list [--tracked|--active|--muted|--quiet]
 *   npm run channels -- show <channelId>
 *   npm run channels -- stats
 *   npm run channels -- track <channelId>
 *   npm run channels -- untrack <channelId>
 *   npm run channels -- mute <channelId>
 *   npm run channels -- unmute <channelId>
 *   npm run channels -- build-registry [--dry-run]
 */

import { open, Database } from "sqlite";
import sqlite3 from "sqlite3";
import { Client, GatewayIntentBits, ChannelType, TextChannel } from "discord.js";
import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import {
  DiscordChannelRegistry,
  DiscordChannel,
  AIAnalysisResult,
  AIRecommendation,
  RecommendedChange
} from "../src/plugins/storage/DiscordChannelRegistry";
import { outputJson, spinner, stepProgress, resolveDbPathFromConfig } from "./cli";

dotenv.config({ quiet: true });

// ============================================================================
// Configuration
// ============================================================================

const CONFIG_DIR = "./config";
const BACKUP_DIR = "./config/backup";
// Activity thresholds (messages per day)
const ACTIVITY_THRESHOLDS = {
  HOT: 50,      // >50 msgs/day
  ACTIVE: 7,    // 7-50 msgs/day
  MODERATE: 1.5 // 1.5-7 msgs/day
  // Below 1.5 = Quiet/Dead
};

// Rate limiting for activity sampling
const SAMPLE_DELAY_MS = 500;

// ============================================================================
// Types
// ============================================================================

interface CliArgs {
  command: string;
  channelId?: string;
  guildId?: string;
  dryRun?: boolean;
  tracked?: boolean;
  active?: boolean;
  muted?: boolean;
  quiet?: boolean;
  testConfigs?: boolean;
  debug?: boolean;
  // Analyze options
  all?: boolean;
  // Config filter
  source?: string;
  json?: boolean;
  // Date range (for archive)
  after?: string;
  before?: string;
  force?: boolean;
  apply?: boolean;
  // Sync options
  withFetch?: boolean;
}

interface DiscordRawData {
  channel: { id: string; name: string; topic?: string; category?: string; guildId?: string; guildName?: string };
  date: string;
  users: Record<string, any>;
  messages: Array<{ id: string; uid: string; content: string }>;
}

interface DiscordSourceConfig {
  type: string;
  name: string;
  params: {
    botToken?: string;
    guildId?: string;
    channelIds?: string[];
  };
}

interface DiscordRawData {
  channel: {
    id: string;
    name: string;
    topic?: string;
    category?: string;
    guildId?: string;
    guildName?: string;
  };
  date: string;
  users: Record<string, { username?: string; displayName?: string; nickname?: string }>;
  messages: Array<{
    id: string;
    uid: string;
    content: string;
    ts?: string;
    timestamp?: string;
  }>;
}

interface LoadedConfig {
  path: string;
  config: any;
  discordSources: DiscordSourceConfig[];
}

interface ChannelActivity {
  velocity: number;
  lastMessage: number | null;
  daysSinceLastMsg?: number;
  badge: string;
  description: string;
}

// ============================================================================
// CLI Parsing
// ============================================================================

function parseArgs(argv: string[] = process.argv.slice(2)): CliArgs {
  const first = argv[0];
  const command = !first || first === "--help" || first === "-h" ? "help" : first;
  const args: CliArgs = { command };

  // Check for channel ID as positional argument
  let argStartIndex = 1;
  if (command !== "help" && argv[1] && !argv[1].startsWith("--")) {
    args.channelId = argv[1];
    argStartIndex = 2;
  }

  for (let i = argStartIndex; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--tracked") args.tracked = true;
    else if (arg === "--active") args.active = true;
    else if (arg === "--muted") args.muted = true;
    else if (arg === "--quiet") args.quiet = true;
    else if (arg === "--test-configs") args.testConfigs = true;
    else if (arg === "--debug") args.debug = true;
    else if (arg === "--all") args.all = true;
    else if (arg.startsWith("--guild=")) args.guildId = arg.split("=")[1];
    else if (arg.startsWith("--channel=")) args.channelId = arg.split("=")[1];
    else if (arg.startsWith("--source=")) args.source = arg.split("=")[1];
    else if (arg === "--json") args.json = true;
    else if (arg.startsWith("--after=")) args.after = arg.split("=")[1];
    else if (arg.startsWith("--before=")) args.before = arg.split("=")[1];
    else if (arg === "-f" || arg === "--force") args.force = true;
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--with-fetch") args.withFetch = true;
  }

  return args;
}

// ============================================================================
// Config Loading
// ============================================================================

function loadConfigs(sourceFilter?: string): Map<string, LoadedConfig> {
  console.log("Loading configuration files...");

  const configs = new Map<string, LoadedConfig>();

  if (!fs.existsSync(CONFIG_DIR)) {
    console.error(`Config directory not found: ${CONFIG_DIR}`);
    return configs;
  }

  const configFiles = fs.readdirSync(CONFIG_DIR)
    .filter(file => file.endsWith(".json"))
    .filter(file => sourceFilter ? file === sourceFilter : true);

  for (const configFile of configFiles) {
    try {
      const configPath = path.join(CONFIG_DIR, configFile);
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

      // Find Discord sources
      const discordSources = config.sources?.filter(
        (source: any) => source.type === "DiscordRawDataSource"
      ) || [];

      if (discordSources.length > 0) {
        configs.set(configFile, {
          path: configPath,
          config,
          discordSources
        });
        console.log(`  Loaded ${configFile}: ${discordSources.length} Discord source(s)`);
      }
    } catch (error: any) {
      console.error(`  Failed to load ${configFile}: ${error.message}`);
    }
  }

  console.log(`Loaded ${configs.size} configurations with Discord sources\n`);
  return configs;
}

function getTrackedChannelIds(configs: Map<string, LoadedConfig>): Map<string, Set<string>> {
  const trackedChannels = new Map<string, Set<string>>(); // guildId -> Set of channel IDs

  for (const [, configData] of configs) {
    for (const source of configData.discordSources) {
      let guildId = source.params?.guildId || "unknown";
      if (guildId.startsWith("process.env.")) {
        const envVar = guildId.replace("process.env.", "");
        guildId = process.env[envVar] || envVar;
      }
      const channelIds = source.params?.channelIds || [];

      if (!trackedChannels.has(guildId)) {
        trackedChannels.set(guildId, new Set());
      }

      for (const channelId of channelIds) {
        trackedChannels.get(guildId)!.add(channelId);
      }
    }
  }

  return trackedChannels;
}

function getGuildIds(configs: Map<string, LoadedConfig>): Set<string> {
  const guildIds = new Set<string>();

  for (const [, configData] of configs) {
    for (const source of configData.discordSources) {
      const guildIdVar = source.params?.guildId?.replace("process.env.", "");
      const guildId = guildIdVar ? process.env[guildIdVar] : source.params?.guildId;
      if (guildId) {
        guildIds.add(guildId);
      }
    }
  }

  return guildIds;
}

// ============================================================================
// Command: discover
// ============================================================================

async function commandDiscover(db: Database, args: CliArgs): Promise<void> {
  console.log("\n Discord Channel Discovery\n");
  const discoverSpinner = spinner("Discovering channels", process.argv.slice(2)).start();

  // Initialize registry
  const registry = new DiscordChannelRegistry(db);
  await registry.initialize();

  const configs = loadConfigs(args.source);

  if (args.testConfigs) {
    discoverSpinner.stop();
    console.log("Running in test mode (no Discord API calls)\n");
    validateConfigs(configs);
    return;
  }

  // Find a valid Discord token
  let botToken: string | null = null;
  for (const [configName, configData] of configs) {
    for (const source of configData.discordSources) {
      const tokenVar = source.params?.botToken?.replace("process.env.", "");
      if (tokenVar && process.env[tokenVar]) {
        botToken = process.env[tokenVar]!;
        console.log(`Using token from ${configName} (${tokenVar})`);
        break;
      }
    }
    if (botToken) break;
  }

  // Fallback to building from raw data if no Discord token
  if (!botToken) {
    discoverSpinner.stop();
    console.log("No Discord token available. Building registry from raw data...\n");
    await buildRegistryFromRawData(db, registry, true);

    const stats = await registry.getStats();
    console.log("\nRegistry now contains " + stats.totalChannels + " channels");
    console.log("  Tracked: " + stats.trackedChannels);
    console.log("\nNext steps:");
    console.log("1. Run 'npm run channels -- analyze --stale' to analyze channels with LLM");
    console.log("2. Run 'npm run channels -- propose' to generate config changes");
    return;
  }

  if (configs.size === 0) {
    discoverSpinner.fail("No valid Discord configs found");
    console.error("No valid Discord configurations found");
    process.exit(1);
  }

  // Load previously unavailable channels from registry
  const unavailableChannels = new Set<string>(
    (await registry.getUnavailableChannels()).map(c => c.id)
  );
  if (unavailableChannels.size > 0) {
    console.log(`Loaded ${unavailableChannels.size} previously unavailable channels from registry\n`);
  }

  // Get tracked channels from config
  const trackedChannels = getTrackedChannelIds(configs);

  // Connect to Discord
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
  });

  console.log("Connecting to Discord...");
  await client.login(botToken);
  discoverSpinner.text = "Connected to Discord";
  console.log(`Connected to Discord as ${client.user?.tag}\n`);

  // Discover channels from each guild
  const guildIds = getGuildIds(configs);
  const allChannels = new Map<string, { guild: any; channels: Map<string, TextChannel> }>();
  const channelActivity = new Map<string, ChannelActivity>();

  console.log("Discovering channels...");
  let guildIndex = 0;
  for (const guildId of guildIds) {
    guildIndex += 1;
    discoverSpinner.text = stepProgress(guildIndex, guildIds.size, `Scanning guild ${guildId}`);
    try {
      const guild = await client.guilds.fetch(guildId);
      const channels = await guild.channels.fetch();

      const textChannels = new Map<string, TextChannel>();
      channels
        .filter(channel => channel?.type === ChannelType.GuildText)
        .sort((a, b) => {
          const categoryA = a!.parent?.name || "zzz_Uncategorized";
          const categoryB = b!.parent?.name || "zzz_Uncategorized";
          if (categoryA !== categoryB) {
            return categoryA.localeCompare(categoryB);
          }
          return (a!.position || 0) - (b!.position || 0);
        })
        .forEach(channel => {
          textChannels.set(channel!.id, channel as TextChannel);
        });

      allChannels.set(guildId, { guild, channels: textChannels });
      console.log(`  ${guild.name}: Found ${textChannels.size} text channels`);

      // Upsert all channels to registry
      const observedAt = new Date().toISOString().split("T")[0];
      const tracked = trackedChannels.get(guildId) || new Set<string>();

      for (const [channelId, channel] of textChannels) {
        try {
          await registry.upsertChannel({
            id: channelId,
            guildId: guildId,
            guildName: guild.name,
            name: channel.name,
            topic: channel.topic || null,
            categoryId: channel.parentId || null,
            categoryName: channel.parent?.name || null,
            type: channel.type,
            position: channel.position,
            nsfw: channel.nsfw,
            rateLimitPerUser: channel.rateLimitPerUser || 0,
            createdAt: Math.floor(channel.createdTimestamp! / 1000),
            observedAt,
            isTracked: tracked.has(channelId),
          });
        } catch (error: any) {
          if (args.debug) {
            console.error(`    Failed to upsert channel ${channelId}: ${error.message}`);
          }
        }
      }
    } catch (error: any) {
      console.error(`  Failed to fetch guild ${guildId}: ${error.message}`);
    }
  }

  console.log("");

  // Sample activity from each channel
  console.log("Sampling channel activity...\n");

    let sampled = 0;
    let errors = 0;
    const totalChannels = Array.from(allChannels.values())
      .reduce((sum, g) => sum + g.channels.size, 0);

    for (const [guildId, guildData] of allChannels) {
      console.log(`  ${guildData.guild.name}:`);

      for (const [channelId, channel] of guildData.channels) {
        try {
          const messages = await channel.messages.fetch({ limit: 100 });

          if (messages.size === 0) {
            channelActivity.set(channelId, {
              velocity: 0,
              lastMessage: null,
              badge: "dead",
              description: "empty"
            });
          } else {
            const oldest = messages.last()!;
            const newest = messages.first()!;
            const oldestTime = oldest.createdTimestamp;
            const newestTime = newest.createdTimestamp;
            const now = Date.now();

            const daySpan = Math.max((newestTime - oldestTime) / (1000 * 60 * 60 * 24), 0.1);
            const velocity = messages.size / daySpan;
            const daysSinceLastMsg = (now - newestTime) / (1000 * 60 * 60 * 24);

            let badge: string, description: string;
            if (daysSinceLastMsg > 90) {
              badge = "dead";
              description = `${Math.floor(daysSinceLastMsg)}d ago`;
            } else if (velocity >= ACTIVITY_THRESHOLDS.HOT) {
              badge = "hot";
              description = `${Math.round(velocity)}/day`;
            } else if (velocity >= ACTIVITY_THRESHOLDS.ACTIVE) {
              badge = "active";
              description = `${Math.round(velocity)}/day`;
            } else if (velocity >= ACTIVITY_THRESHOLDS.MODERATE) {
              badge = "moderate";
              description = `${velocity.toFixed(1)}/day`;
            } else {
              badge = "quiet";
              description = velocity > 0.1 ? `${velocity.toFixed(1)}/day` : `${Math.floor(daysSinceLastMsg)}d ago`;
            }

            channelActivity.set(channelId, {
              velocity,
              lastMessage: newestTime,
              daysSinceLastMsg,
              badge,
              description
            });

            // Record activity in registry
            const observedAt = new Date().toISOString().split("T")[0];
            try {
              await registry.recordActivity(channelId, observedAt, messages.size);
              // Clear unavailable status if it was previously set
              if (unavailableChannels.has(channelId)) {
                await registry.clearUnavailable(channelId);
                unavailableChannels.delete(channelId);
              }
            } catch (e) {
              // Channel might not exist in registry
            }
          }

          sampled++;
          process.stdout.write(`\r    Sampled ${sampled}/${totalChannels} channels...`);
          await sleep(SAMPLE_DELAY_MS);

        } catch (error: any) {
          channelActivity.set(channelId, {
            velocity: 0,
            lastMessage: null,
            badge: "locked",
            description: "no access"
          });
          errors++;

          // Mark inaccessible channels as unavailable (but not tracked ones)
          const tracked = trackedChannels.get(guildId)?.has(channelId);
          if (!tracked) {
            await registry.markUnavailable(channelId, (error as any).message || "Bot lacks access");
            unavailableChannels.add(channelId);
          }
        }
      }
    }

    console.log(`\n\n  Sampled ${sampled} channels (${errors} inaccessible)\n`);

  await client.destroy();

  // Print summary stats
  const stats = await registry.getStats();
  console.log("\n Channel discovery complete!");
  console.log(`\nRegistry now contains ${stats.totalChannels} channels`);
  console.log(`  Tracked: ${stats.trackedChannels}`);
  console.log(`  Unavailable: ${unavailableChannels.size}`);
  console.log("\nNext steps:");
  console.log("1. Run 'npm run channels -- analyze --stale' to analyze channels with LLM");
  console.log("2. Run 'npm run channels -- propose' to generate config changes");
  discoverSpinner.succeed("Channel discovery complete");
}

function validateConfigs(configs: Map<string, LoadedConfig>): void {
  console.log("Validating configurations...\n");

  let totalSources = 0;
  let totalChannels = 0;

  for (const [configName, configData] of configs) {
    console.log(`${configName}:`);

    for (const source of configData.discordSources) {
      totalSources++;
      const channelCount = source.params?.channelIds?.length || 0;
      totalChannels += channelCount;

      console.log(`  - ${source.name}: ${channelCount} channels configured`);

      const requiredVars: string[] = [];
      if (source.params?.botToken?.includes("process.env.")) {
        requiredVars.push(source.params.botToken.replace("process.env.", ""));
      }
      if (source.params?.guildId?.includes("process.env.")) {
        requiredVars.push(source.params.guildId.replace("process.env.", ""));
      }

      if (requiredVars.length > 0) {
        const missingVars = requiredVars.filter(varName => !process.env[varName]);
        if (missingVars.length > 0) {
          console.log(`    Missing environment variables: ${missingVars.join(", ")}`);
        } else {
          console.log(`    Environment variables configured`);
        }
      }
    }
    console.log("");
  }

  console.log(`Summary: ${totalSources} Discord sources, ${totalChannels} channels total\n`);
}

function getActivityBadge(velocity: number, daysSinceActivity?: number): string {
  if (daysSinceActivity && daysSinceActivity > 90) return "⚫";
  if (velocity >= ACTIVITY_THRESHOLDS.HOT) return "🔥";
  if (velocity >= ACTIVITY_THRESHOLDS.ACTIVE) return "🟢";
  if (velocity >= ACTIVITY_THRESHOLDS.MODERATE) return "🔵";
  return "⚫";
}

// ============================================================================
// Command: analyze
// ============================================================================

async function loadChannelMessages(
  db: Database,
  channelId: string,
  limit: number = 100
): Promise<{ messages: string[]; lastMsgDate: string | null }> {
  const rows = await db.all<Array<{ text: string; date: number }>>(
    `SELECT text, date FROM items
     WHERE type = 'discordRawData'
       AND json_extract(text, '$.channel.id') = ?
     ORDER BY date DESC
     LIMIT 10`,
    channelId
  );

  const messages: string[] = [];
  let lastMsgDate: string | null = null;

  for (const row of rows) {
    try {
      const data: DiscordRawData = JSON.parse(row.text);
      for (const msg of data.messages) {
        const msgTs = msg.ts || msg.timestamp;
        if (msgTs && (!lastMsgDate || msgTs > lastMsgDate)) {
          lastMsgDate = msgTs.split("T")[0];
        }
        if (!msg.content.trim()) continue;
        const user = data.users[msg.uid];
        const username = (user as any)?.name || user?.nickname || msg.uid;
        const botTag = (user as any)?.isBot ? " [BOT]" : "";
        messages.push(`[${username}${botTag}]: ${msg.content.slice(0, 500)}`);
        if (messages.length >= limit) break;
      }
    } catch (e) {
      // Skip malformed entries
    }
    if (messages.length >= limit) break;
  }

  return { messages, lastMsgDate };
}

function formatChannelProfile(channel: DiscordChannel, messages: string[], lastMsgDate: string | null): string {
  const lastActivity = lastMsgDate || (channel.lastActivityAt
    ? new Date(channel.lastActivityAt * 1000).toISOString().split("T")[0]
    : "unknown");
  const velocity = channel.currentVelocity > 0
    ? `${channel.currentVelocity.toFixed(1)} msgs/day (all-time avg)`
    : "inactive";
  const msgBlock = messages.length > 0
    ? messages.map(m => `  ${m}`).join("\n")
    : "  (no messages in database)";
  return [
    `Activity: ${velocity} | ${channel.totalMessages} total msgs | Last active: ${lastActivity}`,
    `Category: ${channel.categoryName || "none"}`,
    `Recent messages:\n${msgBlock}`,
  ].join("\n");
}

async function batchAnalyzeChannels(
  openai: OpenAI,
  model: string,
  channels: DiscordChannel[]
): Promise<Map<string, AIAnalysisResult>> {
  const today = new Date().toISOString().split("T")[0];

  const channelSections = channels.map(ch =>
    `### #${ch.name} (ID: ${ch.id})\n${ch.notes || "(no profile)"}`
  ).join("\n\n---\n\n");

  const prompt = `All channels below had activity in the last 7 days. Classify each as TRACK or MAYBE only.

${channelSections}

---

Rules:
- TRACK: Multiple different users having back-and-forth conversation.
- MAYBE: Single user posting, bot-only feed, or only link dumps with no replies.

Respond ONLY with a JSON array using the exact IDs provided:
[{"id":"<channel_id>","recommendation":"TRACK|MAYBE","reason":"10 words max"}, ...]`;

  const completion = await (openai.chat.completions.create as any)({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 16384,
    ...(process.env.USE_OPENROUTER === "true" ? { reasoning: { effort: "none" } } : {})
  });

  let content = completion.choices[0]?.message?.content ||
                completion.choices[0]?.message?.reasoning || "";
  content = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error(`No JSON array in response: ${content.slice(0, 300)}`);

  const results: Array<{ id: string; recommendation: AIRecommendation; reason: string }> = JSON.parse(jsonMatch[0]);
  const map = new Map<string, AIAnalysisResult>();
  for (const r of results) {
    map.set(r.id, { recommendation: r.recommendation, reason: r.reason || "" });
  }
  return map;
}

async function analyzeChannelWithLLM(
  openai: OpenAI,
  model: string,
  channel: DiscordChannel,
  messagesText: string
): Promise<AIAnalysisResult | null> {
  const categoryInfo = channel.categoryName ? ` (category: ${channel.categoryName})` : "";
  const velocityInfo = channel.currentVelocity > 0 ? `${channel.currentVelocity.toFixed(1)} msgs/day (all-time avg)` : "inactive";
  const lastActivityInfo = channel.lastActivityAt
    ? `Last message: ${new Date(channel.lastActivityAt * 1000).toISOString().split("T")[0]}`
    : "Last message: unknown";
  const today = new Date().toISOString().split("T")[0];
  const prompt = `Today is ${today}. Analyze this Discord channel #${channel.name}${categoryInfo}.
Activity: ${velocityInfo}, ${channel.totalMessages} total messages. ${lastActivityInfo}.

Recent messages (users tagged [BOT] are bots/webhooks):
${messagesText}

Respond ONLY with valid JSON, no thinking:
{
  "recommendation": "TRACK|MAYBE|SKIP",
  "reason": "brief explanation (15 words max)"
}

Guidelines:
- TRACK: Active channel with recent messages (within last few months) and substantive discussion — technical, creative, governance, problem-solving.
- MAYBE: Mixed signal — some useful content but inconsistent activity, or last activity was months ago.
- SKIP: One-way feeds (webhook dumps, commit logs, RSS), join/leave spam, pure price/trading talk, no real conversation, or dormant (last message over 1 month ago).`;

  try {
    const completion = await (openai.chat.completions.create as any)({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 4096,
      ...(process.env.USE_OPENROUTER === "true" ? { reasoning: { effort: "none" } } : {})
    });

    let content = completion.choices[0]?.message?.content ||
                  completion.choices[0]?.message?.reasoning || "";
    // Strip <think> tags in case reasoning leaked through
    content = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

    // Try to extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        recommendation: parsed.recommendation as AIRecommendation,
        reason: parsed.reason || ""
      };
    }

    throw new Error(`No JSON found in response: ${content.slice(0, 300)}`);
  } catch (error: any) {
    console.error(`    LLM error for #${channel.name}: ${error.message}`);
    return null;
  }
}

async function commandAnalyze(db: Database, registry: DiscordChannelRegistry, args: CliArgs): Promise<void> {
  console.log("\n Channel Analysis\n");
  const analyzeSpinner = spinner("Preparing channel analysis", process.argv.slice(2)).start();

  // Auto-populate registry if empty but raw data exists
  const stats = await registry.getStats();
  if (stats.totalChannels === 0) {
    const rawCount = await db.get<{ count: number }>(
      "SELECT COUNT(DISTINCT json_extract(text, '$.channel.id')) as count FROM items WHERE type = 'discordRawData'"
    );
    if (rawCount && rawCount.count > 0) {
      console.log(`Registry empty but found ${rawCount.count} channels in raw data.`);
      console.log("Auto-populating registry...\n");
      await buildRegistryFromRawData(db, registry);
      console.log("");
    }
  }

  // Initialize OpenAI
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    analyzeSpinner.fail("OPENAI_API_KEY missing");
    console.error("OPENAI_API_KEY not set in environment");
    process.exit(1);
  }

  const openai = new OpenAI({
    apiKey,
    baseURL: process.env.USE_OPENROUTER === "true" ? "https://openrouter.ai/api/v1" : undefined,
    defaultHeaders: process.env.USE_OPENROUTER === "true" ? {
      "HTTP-Referer": process.env.SITE_URL || "",
      "X-Title": process.env.SITE_NAME || ""
    } : undefined
  });

  const model = process.env.USE_OPENROUTER === "true" ? "qwen/qwen3.5-35b-a3b" : "gpt-4o-mini";

  // Determine which channels to analyze
  let channelsToAnalyze: DiscordChannel[];
  let tracked = 0;
  let maybe = 0;
  let skip = 0;

  if (args.channelId) {
    // Single channel mode
    const channel = await registry.getChannelById(args.channelId);
    if (!channel) {
      console.error(`Channel ${args.channelId} not found in registry`);
      process.exit(1);
    }
    channelsToAnalyze = [channel];
    console.log(`Analyzing single channel: #${channel.name}`);
  } else if (args.all) {
    const allChannels = await registry.getAllChannels();

    // Unavailable channels (bot can't access) — stamp SKIP if not already analyzed
    const unavailable = allChannels.filter(c => c.unavailableReason && !c.aiLastAnalyzed);
    for (const ch of unavailable) {
      await registry.updateAIAnalysis(ch.id, { recommendation: "SKIP", reason: "Channel inaccessible" });
      skip++;
    }
    skip += allChannels.filter(c => c.unavailableReason && c.aiLastAnalyzed).length;

    // channelsToAnalyze: non-unavailable, non-muted (muted = user choice, still might have data)
    channelsToAnalyze = allChannels.filter(c => !c.unavailableReason && !c.isMuted);
    console.log(`Analyzing ${channelsToAnalyze.length} accessible channels (${unavailable.length} unavailable pre-stamped SKIP)`);
  } else {
    // Default: channels needing analysis (never analyzed or >30 days old)
    channelsToAnalyze = await registry.getChannelsNeedingAnalysis(30);
    console.log(`Analyzing ${channelsToAnalyze.length} channels needing analysis`);
  }

  if (channelsToAnalyze.length === 0) {
    analyzeSpinner.stop();
    console.log("\nNo channels to analyze.\n");
    return;
  }

  if (args.dryRun) {
    analyzeSpinner.stop();
    console.log(`\nDry run — would analyze ${channelsToAnalyze.length} channel(s).`);
    const estimatedCalls = args.channelId ? channelsToAnalyze.length : 1;
    console.log(`Estimated API calls: ${estimatedCalls} (${args.channelId ? "per-channel" : "batch"})`);
    return;
  }

  console.log("");

  // Build profiles for all channels (no per-channel LLM)
  console.log("Building channel profiles...");
  const RECENCY_DAYS = 7;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RECENCY_DAYS);
  const cutoffStr = cutoff.toISOString().split("T")[0];

  const noMessages: DiscordChannel[] = [];
  const stale: DiscordChannel[] = [];
  const toClassify: DiscordChannel[] = [];
  const profileRows: Array<{ channel: DiscordChannel; lastMsgDate: string | null }> = [];

  for (let i = 0; i < channelsToAnalyze.length; i++) {
    const channel = channelsToAnalyze[i];
    analyzeSpinner.text = stepProgress(i + 1, channelsToAnalyze.length, `Profiling #${channel.name}`);
    const { messages, lastMsgDate } = await loadChannelMessages(db, channel.id, 10);
    const profile = formatChannelProfile(channel, messages, lastMsgDate);
    await registry.updateNotes(channel.id, profile);
    channel.notes = profile;
    profileRows.push({ channel, lastMsgDate });
    if (messages.length === 0) {
      noMessages.push(channel);
    } else if (!lastMsgDate || lastMsgDate < cutoffStr) {
      stale.push(channel);
    } else {
      toClassify.push(channel);
    }
  }

  // Stats table
  analyzeSpinner.stop();
  console.log("\n| name | lastMsgDate | currentVelocity | totalMessages | aiRecommendation |");
  console.log("|------|-------------|-----------------|---------------|-----------------|");
  for (const { channel, lastMsgDate } of profileRows) {
    const date = lastMsgDate ?? "—";
    const vel = channel.currentVelocity > 0 ? `${channel.currentVelocity.toFixed(1)}/day` : "—";
    const rec = channel.aiRecommendation ?? "—";
    console.log(`| #${channel.name} | ${date} | ${vel} | ${channel.totalMessages} | ${rec} |`);
  }
  console.log("");

  // Pre-classify channels with no messages as SKIP (no LLM needed)
  for (const channel of noMessages) {
    const analysis: AIAnalysisResult = { recommendation: "SKIP", reason: "No messages in database" };
    await registry.updateAIAnalysis(channel.id, analysis);
    skip++;
  }

  // Pre-classify stale channels as SKIP (no LLM needed)
  for (const channel of stale) {
    const analysis: AIAnalysisResult = { recommendation: "SKIP", reason: "No messages in last 7 days" };
    await registry.updateAIAnalysis(channel.id, analysis);
    skip++;
  }

  if (toClassify.length > 0) {
    // Single batch LLM call for all channels with recent data
    console.log(`Running batch analysis (1 LLM call for ${toClassify.length} channels)...`);
    analyzeSpinner.text = "Running batch LLM analysis...";
    analyzeSpinner.start();
    const resultsMap = await batchAnalyzeChannels(openai, model, toClassify);

    analyzeSpinner.stop();
    console.log("\n| name | aiRecommendation | aiReason |");
    console.log("|------|-----------------|---------|");
    for (const channel of toClassify) {
      const analysis = resultsMap.get(channel.id);
      if (analysis) {
        await registry.updateAIAnalysis(channel.id, analysis);
        console.log(`| #${channel.name} | ${analysis.recommendation} | ${analysis.reason} |`);
        if (analysis.recommendation === "TRACK") tracked++;
        else if (analysis.recommendation === "MAYBE") maybe++;
        else skip++;
      } else {
        console.log(`| #${channel.name} | — | (no result) |`);
      }
    }
    console.log("");
  }


  console.log(`\nAnalysis complete!`);
  console.log(`  TRACK: ${tracked}`);
  console.log(`  MAYBE: ${maybe}`);
  console.log(`  SKIP: ${skip}`);
  console.log("\nNext steps:");
  console.log("1. Run 'npm run channels -- propose' to generate config changes");
  console.log("Channel analysis complete");
}

// ============================================================================
// Command: propose
// ============================================================================

async function commandProposeUpdate(db: Database, registry: DiscordChannelRegistry, args: CliArgs): Promise<void> {
  // Get recommended changes from registry
  const changes = await registry.getRecommendedChanges();

  if (changes.length === 0) {
    // No output for piping - the workflow checks for empty output
    if (!args.dryRun) {
      console.error("No recommended changes.");
    }
    return;
  }

  const toAdd = changes.filter(c => c.action === "add");
  const toRemove = changes.filter(c => c.action === "remove");

  // Get stats
  const stats = await registry.getStats();
  const now = new Date();
  const monthYear = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  // Generate markdown PR body
  let md = `## Channel Tracking Update - ${monthYear}\n\n`;

  md += `### Summary\n`;
  md += `- **Channels analyzed**: ${stats.totalChannels}\n`;
  md += `- **Recommended to add**: ${toAdd.length}\n`;
  md += `- **Recommended to remove**: ${toRemove.length}\n\n`;

  // Recommended Additions
  if (toAdd.length > 0) {
    md += `### Recommended Additions\n\n`;
    md += `| Channel | Activity | AI Recommendation | Reason |\n`;
    md += `|---------|----------|-------------------|--------|\n`;

    for (const ch of toAdd) {
      const activityBadge = getActivityBadge(ch.currentVelocity);
      const activityDesc = ch.currentVelocity >= 1 ? `${Math.round(ch.currentVelocity)}/day` : `${ch.currentVelocity.toFixed(1)}/day`;
      md += `| #${ch.channelName} | ${activityBadge} ${activityDesc} | ${ch.recommendation} | ${ch.reason} |\n`;
    }
    md += `\n`;
  }

  // Recommended Removals
  if (toRemove.length > 0) {
    md += `### Recommended Removals\n\n`;
    md += `| Channel | Activity | Reason |\n`;
    md += `|---------|----------|--------|\n`;

    for (const ch of toRemove) {
      const activityBadge = getActivityBadge(ch.currentVelocity);
      const activityDesc = ch.currentVelocity >= 1 ? `${Math.round(ch.currentVelocity)}/day` : `${ch.currentVelocity.toFixed(1)}/day`;
      md += `| #${ch.channelName} | ${activityBadge} ${activityDesc} | ${ch.reason} |\n`;
    }
    md += `\n`;
  }

  // Config changes diff
  md += `### Config Changes\n\n`;
  md += "```diff\n";
  md += `// config/elizaos.json\n`;
  md += `  "channelIds": [\n`;

  for (const ch of toAdd) {
    md += `+   "${ch.channelId}",  // #${ch.channelName}\n`;
  }
  for (const ch of toRemove) {
    md += `-   "${ch.channelId}",  // #${ch.channelName} (${ch.reason})\n`;
  }

  md += `  ]\n`;
  md += "```\n\n";

  md += `---\n`;
  md += `*Generated by channel-update workflow*\n`;

  // Output the markdown
  console.log(md);

  // In dry-run mode, also log to stderr
  if (args.dryRun) {
    console.error(`\n[DRY RUN] Would create PR with ${toAdd.length} additions and ${toRemove.length} removals`);
  }

  // --apply: write changes directly back to config file(s)
  if (args.apply && !args.dryRun) {
    const configs = loadConfigs(args.source);
    let totalAdded = 0;
    let totalRemoved = 0;

    for (const [configName, configData] of configs) {
      let modified = false;

      for (const source of configData.discordSources) {
        const channelIds: string[] = source.params?.channelIds || [];

        for (const ch of toAdd) {
          if (!channelIds.includes(ch.channelId)) {
            channelIds.push(ch.channelId);
            modified = true;
            totalAdded++;
          }
        }

        for (const ch of toRemove) {
          const idx = channelIds.indexOf(ch.channelId);
          if (idx !== -1) {
            channelIds.splice(idx, 1);
            modified = true;
            totalRemoved++;
          }
        }

        source.params.channelIds = channelIds;
      }

      if (modified) {
        fs.writeFileSync(configData.path, JSON.stringify(configData.config, null, 2) + "\n");
        console.error(`Applied to ${configName}: +${totalAdded} added, -${totalRemoved} removed`);
      } else {
        console.error(`No changes needed in ${configName}`);
      }
    }
  }
}

// ============================================================================
// Command: list
// ============================================================================

async function commandList(registry: DiscordChannelRegistry, args: CliArgs): Promise<void> {
  let channels: DiscordChannel[];

  if (args.tracked) {
    if (!args.json) console.log("\n Tracked Channels\n");
    channels = await registry.getTrackedChannels();
  } else if (args.active) {
    if (!args.json) console.log("\n Active Channels (velocity >= 1.5)\n");
    channels = await registry.getActiveChannels(1.5);
  } else if (args.muted) {
    if (!args.json) console.log("\n Muted Channels\n");
    channels = (await registry.getAllChannels()).filter(c => c.isMuted);
  } else if (args.quiet) {
    if (!args.json) console.log("\n Quiet Channels (no activity in 90 days)\n");
    channels = await registry.getInactiveChannels(90);
  } else {
    if (!args.json) console.log("\n All Channels\n");
    channels = await registry.getAllChannels();
  }

  if (channels.length === 0) {
    if (args.json) {
      outputJson({ ok: true, command: "channels.list", data: [] });
      return;
    }
    console.log("   No channels found.\n");
    return;
  }

  if (args.json) {
    outputJson({ ok: true, command: "channels.list", data: channels });
    return;
  }

  // Group by guild
  const byGuild = new Map<string, DiscordChannel[]>();
  for (const channel of channels) {
    const guildName = channel.guildName || "Unknown Guild";
    if (!byGuild.has(guildName)) {
      byGuild.set(guildName, []);
    }
    byGuild.get(guildName)!.push(channel);
  }

  for (const [guildName, guildChannels] of byGuild) {
    console.log(`\n${guildName}:`);
    for (const ch of guildChannels) {
      const velocity = ch.currentVelocity.toFixed(1);
      const tracked = ch.isTracked ? "T" : " ";
      const muted = ch.isMuted ? "M" : " ";
      const category = ch.categoryName ? `[${ch.categoryName}]` : "";
      console.log(`  ${tracked} ${muted} #${ch.name.padEnd(25)} ${velocity.padStart(6)} msgs/day  ${category}`);
    }
  }

  console.log(`\nTotal: ${channels.length} channels\n`);
}

// ============================================================================
// Command: show
// ============================================================================

async function commandShow(registry: DiscordChannelRegistry, channelId: string): Promise<void> {
  const channel = await registry.getChannelById(channelId);
  if (!channel) {
    console.error(`\nChannel ${channelId} not found\n`);
    return;
  }

  console.log(`\n Channel: #${channel.name}\n`);
  console.log(`ID: ${channel.id}`);
  console.log(`Guild: ${channel.guildName} (${channel.guildId})`);
  console.log(`Category: ${channel.categoryName || "(none)"}`);
  console.log(`Topic: ${channel.topic || "(none)"}`);
  console.log(`Type: ${channel.type} | Position: ${channel.position ?? "n/a"}`);
  console.log(`NSFW: ${channel.nsfw} | Rate Limit: ${channel.rateLimitPerUser}s`);

  console.log(`\nActivity:`);
  console.log(`   Current velocity: ${channel.currentVelocity.toFixed(1)} msgs/day`);
  console.log(`   Total messages: ${channel.totalMessages}`);
  console.log(`   Last activity: ${channel.lastActivityAt ? new Date(channel.lastActivityAt * 1000).toISOString().split("T")[0] : "never"}`);

  console.log(`\nTracking:`);
  console.log(`   Is tracked: ${channel.isTracked}`);
  console.log(`   Is muted: ${channel.isMuted}`);
  console.log(`   First seen: ${new Date(channel.firstSeen * 1000).toISOString().split("T")[0]}`);
  console.log(`   Last seen: ${new Date(channel.lastSeen * 1000).toISOString().split("T")[0]}`);

  if (channel.nameChanges.length > 1) {
    console.log(`\nName History (${channel.nameChanges.length} changes):`);
    for (const change of channel.nameChanges.slice(0, 5)) {
      console.log(`   ${change.observedAt}: "${change.name}"`);
    }
    if (channel.nameChanges.length > 5) {
      console.log(`   ... and ${channel.nameChanges.length - 5} more`);
    }
  }

  if (channel.topicChanges.length > 1) {
    console.log(`\nTopic History (${channel.topicChanges.length} changes):`);
    for (const change of channel.topicChanges.slice(0, 3)) {
      const topicPreview = change.topic ? change.topic.slice(0, 60) + (change.topic.length > 60 ? "..." : "") : "(empty)";
      console.log(`   ${change.observedAt}: "${topicPreview}"`);
    }
    if (channel.topicChanges.length > 3) {
      console.log(`   ... and ${channel.topicChanges.length - 3} more`);
    }
  }

  if (channel.activityHistory.length > 0) {
    console.log(`\nRecent Activity (last 7 days):`);
    for (const snapshot of channel.activityHistory.slice(0, 7)) {
      const bar = "\u2588".repeat(Math.min(30, Math.ceil(snapshot.messageCount / 5)));
      console.log(`   ${snapshot.date}: ${snapshot.messageCount.toString().padStart(4)} msgs ${bar}`);
    }
  }

  if (channel.aiRecommendation || channel.aiSummary || channel.aiMannerisms) {
    console.log(`\nAI Analysis:`);
    if (channel.aiRecommendation) {
      console.log(`   Recommendation: ${channel.aiRecommendation}`);
      if (channel.aiReason) console.log(`   Reason: ${channel.aiReason}`);
    }
    // Legacy fields
    if (channel.aiSummary) console.log(`   Summary: ${channel.aiSummary}`);
    if (channel.aiMannerisms) console.log(`   Mannerisms: ${channel.aiMannerisms}`);
    if (channel.aiLastAnalyzed) {
      console.log(`   Last analyzed: ${new Date(channel.aiLastAnalyzed * 1000).toISOString().split("T")[0]}`);
    }
  }

  if (channel.notes) {
    console.log(`\nNotes: ${channel.notes}`);
  }

  console.log("");
}

// ============================================================================
// Command: stats
// ============================================================================

async function commandStats(registry: DiscordChannelRegistry, args: CliArgs, db: Database): Promise<void> {
  const stats = await registry.getStats();
  if (args.json) {
    outputJson({ ok: true, command: "channels.stats", data: stats });
    return;
  }

  // Fetch richer coverage stats directly from items table
  const coverageRow = await db.get<{
    total_records: number; days_with_msgs: number; empty_records: number;
    total_msgs: number; earliest: string; latest: string;
  }>(`
    SELECT
      COUNT(*)                                                                  AS total_records,
      SUM(CASE WHEN CAST(json_extract(metadata,'$.messageCount') AS INTEGER) > 0 THEN 1 ELSE 0 END) AS days_with_msgs,
      SUM(CASE WHEN json_extract(metadata,'$.empty') = 1 THEN 1 ELSE 0 END)   AS empty_records,
      SUM(CAST(json_extract(metadata,'$.messageCount') AS INTEGER))            AS total_msgs,
      date(MIN(date),'unixepoch')                                              AS earliest,
      date(MAX(date),'unixepoch')                                              AS latest
    FROM items WHERE type='discordRawData'`);

  // Channels with real messages in last 30 / 90 days
  const t30 = Math.floor(Date.now() / 1000) - 30 * 86400;
  const t90 = Math.floor(Date.now() / 1000) - 90 * 86400;
  const recentActivity = await db.all<Array<{ ch: string; name: string; msgs_30d: number; msgs_90d: number; last_msg: string }>>(`
    SELECT
      substr(i.cid, 13, length(i.cid) - 23)                                     AS ch,
      c.name,
      SUM(CASE WHEN i.date >= ${t30} THEN CAST(json_extract(i.metadata,'$.messageCount') AS INTEGER) ELSE 0 END) AS msgs_30d,
      SUM(CASE WHEN i.date >= ${t90} THEN CAST(json_extract(i.metadata,'$.messageCount') AS INTEGER) ELSE 0 END) AS msgs_90d,
      date(MAX(CASE WHEN CAST(json_extract(i.metadata,'$.messageCount') AS INTEGER) > 0 THEN i.date ELSE 0 END),'unixepoch') AS last_msg
    FROM items i
    JOIN discord_channels c ON c.id = substr(i.cid, 13, length(i.cid) - 23)
    WHERE i.type='discordRawData' AND c.unavailableReason IS NULL
    GROUP BY ch
    HAVING msgs_90d > 0
    ORDER BY msgs_30d DESC`);

  const pct = coverageRow ? Math.round(100 * coverageRow.days_with_msgs / coverageRow.total_records) : 0;

  console.log("\n Channel Registry Statistics\n");

  console.log(`Channels: ${stats.totalChannels} total, ${stats.trackedChannels} tracked, ${stats.mutedChannels} muted, ${stats.totalChannels - stats.trackedChannels - stats.mutedChannels} unavailable`);
  console.log(`Coverage: ${coverageRow?.earliest ?? '?'} → ${coverageRow?.latest ?? '?'}`);
  console.log(`Records:  ${coverageRow?.total_records.toLocaleString() ?? 0} total  |  ${coverageRow?.days_with_msgs.toLocaleString() ?? 0} with messages (${pct}%)  |  ${coverageRow?.empty_records.toLocaleString() ?? 0} empty`);
  console.log(`Messages: ${(coverageRow?.total_msgs ?? 0).toLocaleString()} across all time`);

  console.log(`\nActivity Distribution (7-day rolling velocity, accessible channels):`);
  console.log(`   Hot     (>50 msgs/day):  ${stats.hotChannels}`);
  console.log(`   Active  (7–50):          ${stats.activeChannels}`);
  console.log(`   Moderate(1.5–7):         ${stats.moderateChannels}`);
  console.log(`   Quiet   (<1.5):          ${stats.quietChannels}`);

  if (recentActivity.length > 0) {
    console.log(`\nChannels with messages in last 90 days (${recentActivity.length} total):`);
    const fmt = (n: number) => n.toString().padStart(6);
    console.log(`   ${'Channel'.padEnd(28)} ${'30d'.padStart(6)} ${'90d'.padStart(6)}  Last message`);
    console.log(`   ${'-'.repeat(28)} ${'-'.repeat(6)} ${'-'.repeat(6)}  ${'-'.repeat(12)}`);
    for (const r of recentActivity.slice(0, 20)) {
      console.log(`   #${r.name.padEnd(27)} ${fmt(r.msgs_30d)} ${fmt(r.msgs_90d)}  ${r.last_msg}`);
    }
    if (recentActivity.length > 20) console.log(`   ... and ${recentActivity.length - 20} more`);
  } else {
    console.log(`\nNo channels with messages in last 90 days.`);
  }

  console.log("");
}

// ============================================================================
// Command: track/untrack
// ============================================================================

async function commandTrack(registry: DiscordChannelRegistry, channelId: string, tracked: boolean): Promise<void> {
  const channel = await registry.getChannelById(channelId);
  if (!channel) {
    console.error(`\nChannel ${channelId} not found\n`);
    return;
  }

  await registry.setTracked(channelId, tracked);
  console.log(`\nChannel #${channel.name} is now ${tracked ? "tracked" : "untracked"}\n`);
}

// ============================================================================
// Command: mute/unmute
// ============================================================================

async function commandMute(registry: DiscordChannelRegistry, channelId: string, muted: boolean): Promise<void> {
  const channel = await registry.getChannelById(channelId);
  if (!channel) {
    console.error(`\nChannel ${channelId} not found\n`);
    return;
  }

  await registry.setMuted(channelId, muted);
  console.log(`\nChannel #${channel.name} is now ${muted ? "muted" : "unmuted"}\n`);
}

// ============================================================================
// Helper: build registry from raw data
// ============================================================================

async function buildRegistryFromRawData(db: Database, registry: DiscordChannelRegistry, verbose: boolean = true): Promise<void> {
  // Get all discordRawData entries ordered by date
  if (verbose) console.log("Fetching discordRawData entries...");
  const rawDataRows = await db.all<Array<{ cid: string; text: string; metadata: string }>>(
    "SELECT cid, text, metadata FROM items WHERE type = 'discordRawData' ORDER BY date ASC"
  );
  if (verbose) console.log(`   Found ${rawDataRows.length} entries\n`);

  if (rawDataRows.length === 0) {
    if (verbose) console.log("No discordRawData found. Nothing to process.");
    return;
  }

  // Track progress
  let processed = 0;
  const channelsSeen = new Set<string>();
  const channelMessageCounts = new Map<string, Map<string, number>>();

  if (verbose) console.log("Processing entries...\n");

  for (const row of rawDataRows) {
    try {
      const data: DiscordRawData = JSON.parse(row.text);
      const metadata = row.metadata ? JSON.parse(row.metadata) : {};
      const observedAt = data.date.split("T")[0];

      const channelId = data.channel?.id || metadata.channelId;
      if (!channelId) continue;

      channelsSeen.add(channelId);

      // Count messages
      if (!channelMessageCounts.has(channelId)) {
        channelMessageCounts.set(channelId, new Map());
      }
      const dateMap = channelMessageCounts.get(channelId)!;
      const currentCount = dateMap.get(observedAt) || 0;
      dateMap.set(observedAt, currentCount + (data.messages?.length || 0));

      // Prepare channel data
      const channelData = {
        id: channelId,
        guildId: metadata.guildId || data.channel?.guildId || "unknown",
        guildName: metadata.guildName || data.channel?.guildName || "unknown",
        name: data.channel?.name || metadata.channelName || "unknown",
        topic: data.channel?.topic || null,
        categoryId: null,
        categoryName: data.channel?.category || null,
        type: 0,
        position: null,
        nsfw: false,
        rateLimitPerUser: 0,
        createdAt: Math.floor(new Date(observedAt).getTime() / 1000),
        observedAt,
        isTracked: true
      };

      try {
        await registry.upsertChannel(channelData);
      } catch (e: any) {
        // Validation errors are expected for some edge cases
      }

      processed++;

      if (verbose && processed % 200 === 0) {
        console.log(`   Progress: ${processed}/${rawDataRows.length} (${Math.round(processed / rawDataRows.length * 100)}%)`);
      }

    } catch (error) {
      // Skip malformed entries
    }
  }

  if (verbose) console.log(`\nRecording activity history...\n`);

  // Record activity for each channel by date
  let activityRecorded = 0;
  for (const [channelId, dateMap] of channelMessageCounts) {
    const sortedDates = Array.from(dateMap.keys()).sort();
    for (const date of sortedDates) {
      const messageCount = dateMap.get(date)!;
      try {
        await registry.recordActivity(channelId, date, messageCount);
        activityRecorded++;
      } catch (error) {
        // Channel might not exist
      }
    }
  }

  if (verbose) {
    console.log(`Processing complete!`);
    console.log(`   Entries processed: ${processed}`);
    console.log(`   Unique channels: ${channelsSeen.size}`);
    console.log(`   Activity records: ${activityRecorded}`);
  }
}

// ============================================================================
// Command: build-registry
// ============================================================================

async function commandBuildRegistry(db: Database, args: CliArgs): Promise<void> {
  console.log("\n Building Discord Channel Registry\n");

  if (args.dryRun) {
    console.log("(DRY RUN - no changes will be made)\n");
    return;
  }

  // Initialize registry
  const registry = new DiscordChannelRegistry(db);
  await registry.initialize();
  console.log("Initialized discord_channels table\n");

  await buildRegistryFromRawData(db, registry, true);

  // Get final stats
  console.log("\nRegistry Statistics:");
  const stats = await registry.getStats();
  console.log(`   Total channels: ${stats.totalChannels}`);
  console.log(`   Total guilds: ${stats.totalGuilds}`);
  console.log(`   Tracked channels: ${stats.trackedChannels}`);
  console.log(`   Total messages: ${stats.totalMessages}`);

  console.log(`\n Done!\n`);
}

// ============================================================================
// Command: fix-states (one-time migration)
// ============================================================================

async function commandFixStates(registry: DiscordChannelRegistry, args: CliArgs): Promise<void> {
  const allChannels = await registry.getAllChannels();
  // Heuristic: isMuted=1 AND isTracked=0 = auto-muted by discover (not user-intentional)
  const autoMuted = allChannels.filter(c => c.isMuted && !c.isTracked);

  console.log(`Found ${autoMuted.length} auto-muted channels to migrate to unavailable state`);
  if (args.dryRun) {
    const preview = autoMuted.slice(0, 20);
    for (const ch of preview) {
      console.log(`  ${ch.id} #${ch.name}`);
    }
    if (autoMuted.length > 20) console.log(`  ... and ${autoMuted.length - 20} more`);
    console.log("\n(dry run — no changes made)");
    return;
  }

  for (const ch of autoMuted) {
    await registry.markUnavailable(ch.id, ch.unavailableReason || "Channel inaccessible (migrated from muted)");
    await registry.setMuted(ch.id, false);
  }
  console.log(`Migrated ${autoMuted.length} channels. isMuted is now reserved for user-driven mutes only.`);
}

// ============================================================================
// Command: help
// ============================================================================

async function commandResetUnavailable(registry: DiscordChannelRegistry, args: CliArgs): Promise<void> {
  const unavailable = await registry.getUnavailableChannels();
  if (unavailable.length === 0) {
    console.log("No channels are marked as unavailable.");
    return;
  }

  console.log(`\nUnavailable channels (${unavailable.length}):`);
  for (const ch of unavailable) {
    const since = new Date(ch.since * 1000).toISOString().split('T')[0];
    console.log(`  ${ch.id} ${ch.name.padEnd(30)} ${ch.reason.padEnd(20)} since ${since}`);
  }

  const cleared = await registry.clearAllUnavailable();
  console.log(`\nCleared unavailability status for ${cleared} channel(s).`);
}

// ============================================================================
// Command: sync (discover → analyze → propose pipeline, optionally with mirror)
// ============================================================================

async function commandSync(db: Database, registry: DiscordChannelRegistry, args: CliArgs): Promise<void> {
  if (args.withFetch) {
    console.log("\n=== Step 1/4: Mirror ===");
    await commandMirror(db, registry, args);

    console.log("\n=== Step 2/4: Discover ===");
    try {
      await commandDiscover(db, args);
    } catch (e) {
      console.warn("Discover failed, continuing:", e);
    }

    console.log("\n=== Step 3/4: Analyze ===");
    await commandAnalyze(db, registry, { ...args, all: true });

    console.log("\n=== Step 4/4: Propose ===");
    await commandProposeUpdate(db, registry, args);
  } else {
    console.log("\n=== Step 1/3: Discover ===");
    try {
      await commandDiscover(db, args);
    } catch (e) {
      console.warn("Discover failed, continuing:", e);
    }

    console.log("\n=== Step 2/3: Analyze ===");
    await commandAnalyze(db, registry, { ...args, all: true });

    console.log("\n=== Step 3/3: Propose ===");
    await commandProposeUpdate(db, registry, args);
  }

  if (args.apply) {
    console.log("\nDone. Config updated automatically (--apply).");
  } else {
    console.log("\nDone. Review the proposal above and edit your config channelIds.");
    console.log("Tip: use --apply to write changes to config automatically.");
  }
}

/** @deprecated Use `channels sync --with-fetch` instead */
async function commandRefresh(db: Database, registry: DiscordChannelRegistry, args: CliArgs): Promise<void> {
  console.warn("⚠ 'channels refresh' is deprecated. Use 'channels sync --with-fetch' instead.");
  await commandSync(db, registry, { ...args, withFetch: true });
}

/** @deprecated Use `channels sync` instead */
async function commandUpdate(db: Database, registry: DiscordChannelRegistry, args: CliArgs): Promise<void> {
  console.warn("⚠ 'channels update' is deprecated. Use 'channels sync' instead.");
  await commandSync(db, registry, args);
}

// ============================================================================
// Command: mirror (fetch raw messages from ALL accessible channels → DB)
// ============================================================================

async function commandMirror(db: Database, registry: DiscordChannelRegistry, args: CliArgs): Promise<void> {
  // Get all accessible channels from registry (excludes unavailable)
  const allChannels = await registry.getAllChannels();
  const accessible = allChannels.filter(c => !c.unavailableReason);

  if (accessible.length === 0) {
    console.log("No accessible channels in registry. Run 'channels discover' first.");
    return;
  }

  // Auto-detect date range from channel creation timestamps if not specified
  const after = args.after ?? (() => {
    const earliest = accessible.reduce((min, c) => c.createdAt > 0 && c.createdAt < min ? c.createdAt : min, Infinity);
    return earliest === Infinity ? "2015-01-01" : new Date(earliest * 1000).toISOString().split("T")[0];
  })();
  const before = args.before ?? new Date().toISOString().split("T")[0];

  const channelIds = accessible.map(c => c.id).join(",");

  console.log(`\nMirroring ${accessible.length} accessible channels (${allChannels.length - accessible.length} unavailable skipped)`);
  console.log(`Date range: ${after} → ${before}${!args.after ? " (auto-detected from channel creation dates)" : ""}`);

  // Show breakdown by category
  const byCategory = new Map<string, number>();
  for (const ch of accessible) {
    const cat = ch.categoryName || "Uncategorized";
    byCategory.set(cat, (byCategory.get(cat) || 0) + 1);
  }
  for (const [cat, count] of [...byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`  ${cat}: ${count} channels`);
  }
  if (byCategory.size > 8) console.log(`  ... and ${byCategory.size - 8} more categories`);

  const sourceFlag = args.source ? ` --source=${args.source}` : "";
  const cmd = `npm run historical -- --after=${after} --before=${before} --onlyFetch --channels=<${accessible.length} channel IDs>${sourceFlag}`;
  console.log(`\nWill run: ${cmd}`);

  if (args.dryRun) {
    console.log("(dry run — skipping execution)");
    return;
  }

  const { spawn } = await import("child_process");
  const spawnArgs = [
    "-r", "tsconfig-paths/register", "--transpile-only", "src/historical.ts",
    `--after=${after}`, `--before=${before}`, "--onlyFetch",
    `--channels=${channelIds}`,
  ];
  if (args.source) spawnArgs.push(`--source=${args.source}`);

  console.log(`\nStarting fetch (this may take a while for large ranges)...`);
  const child = spawn("ts-node", spawnArgs, { stdio: "inherit", shell: true, cwd: process.cwd() });
  await new Promise<void>((resolve, reject) => {
    child.on("close", (code: number | null) =>
      code === 0 || code === null ? resolve() : reject(new Error(`Exit code ${code}`))
    );
  });

  console.log("\nSyncing channel registry stats from fetched data...");
  const { updated } = await registry.syncStats();
  console.log(`Updated stats for ${updated} channels.`);
}

// ============================================================================
// Command: archive (generate summaries from existing DB data)
// ============================================================================

async function commandArchive(db: Database, registry: DiscordChannelRegistry, args: CliArgs): Promise<void> {
  if (!args.after || !args.before) {
    console.error("Error: --after and --before are required");
    console.log("Usage: npm run channels -- archive --after=YYYY-MM-DD --before=YYYY-MM-DD [--source=...]");
    return;
  }

  const afterTs = Math.floor(new Date(args.after).getTime() / 1000);
  const beforeTs = Math.floor(new Date(args.before + "T23:59:59Z").getTime() / 1000);

  // Per-date stats
  const dateCounts = await db.all<Array<{ date: number; cnt: number }>>(
    `SELECT date, COUNT(*) as cnt FROM items
     WHERE type='discordRawData' AND date >= ? AND date <= ?
     GROUP BY date ORDER BY date`,
    afterTs, beforeTs
  );

  if (dateCounts.length === 0) {
    console.log(`No raw data in DB for ${args.after} → ${args.before}.`);
    console.log("Hint: channels must have been fetched during this period.");
    return;
  }

  // Check already-summarized dates
  const existingSummaries = await db.all<Array<{ date: number }>>(
    `SELECT DISTINCT date FROM items WHERE type LIKE '%Summary%' AND date >= ? AND date <= ?`,
    afterTs, beforeTs
  );
  const summarizedDates = new Set(existingSummaries.map(r => r.date));
  const toGenerate = dateCounts.filter(r => args.force || !summarizedDates.has(r.date));

  const firstDate = new Date(dateCounts[0].date * 1000).toISOString().split('T')[0];
  const lastDate = new Date(dateCounts[dateCounts.length - 1].date * 1000).toISOString().split('T')[0];

  console.log(`\nFound data in ${firstDate} → ${lastDate}:`);
  console.log(`  Total dates with raw data:  ${dateCounts.length}`);
  console.log(`  Already summarized:         ${summarizedDates.size}  (use -f to force regenerate)`);
  console.log(`  ──────────────────────────────────`);
  console.log(`  Dates to generate:          ${toGenerate.length}  (~${toGenerate.length} LLM calls)`);

  const sourceFlag = args.source ? ` --source=${args.source}` : "";
  const forceFlag = args.force ? " --force" : " --skip-existing";
  const cmd = `npm run historical -- --after=${args.after} --before=${args.before} --onlyGenerate${forceFlag}${sourceFlag}`;
  console.log(`\nWill run: ${cmd}`);

  if (args.dryRun) {
    console.log("(dry run — skipping execution)");
    return;
  }

  const { spawn } = await import("child_process");
  const spawnArgs = [
    "-r", "tsconfig-paths/register", "--transpile-only", "src/historical.ts",
    `--after=${args.after}`, `--before=${args.before}`, "--onlyGenerate",
  ];
  if (args.source) spawnArgs.push(`--source=${args.source}`);
  if (!args.force) spawnArgs.push("--skip-existing");
  else spawnArgs.push("--force");

  const child = spawn("ts-node", spawnArgs, { stdio: "inherit", shell: true, cwd: process.cwd() });
  await new Promise<void>((resolve, reject) => {
    child.on("close", (code: number | null) =>
      code === 0 || code === null ? resolve() : reject(new Error(`Exit code ${code}`))
    );
  });
}

function commandHelp(): void {
  console.log(`
Discord Channel Management CLI

Pipeline Commands:
  sync [--source=<config>.json] [--dry-run] [--apply]            Run discover → analyze → propose in one step
  sync --with-fetch [--after=YYYY-MM-DD] [--before=YYYY-MM-DD]   Full pipeline: mirror → discover → analyze → propose
       [--source=<config>.json] [--dry-run] [--apply]

Discovery & Analysis:
  discover [--source=<config>.json]                              Fetch channels from Discord (or raw data if no token)
  analyze [--all] [--channel=ID]                                 Run LLM analysis on channels
  propose [--dry-run] [--apply]                                  Generate config diff and PR markdown; --apply writes changes to config
  mirror  [--after=YYYY-MM-DD] [--before=YYYY-MM-DD]             Fetch raw messages from ALL accessible channels → DB
          [--source=<config>.json] [--dry-run]                  (date range auto-detected from channel creation dates)
  archive --after=YYYY-MM-DD --before=YYYY-MM-DD                Generate summaries from existing DB data (uses channelIds from config)
          [--source=<config>.json] [--dry-run] [-f/--force]

Query Commands:
  list [--tracked|--active|--muted|--quiet]   List channels with optional filters
  show <channelId>                            Show detailed channel info
  stats                                       Show channel registry statistics

Management Commands:
  track <channelId>                       Mark channel as tracked
  untrack <channelId>                     Mark channel as not tracked
  mute <channelId>                        Mute channel (hide from recommendations)
  unmute <channelId>                      Unmute channel

Registry Commands:
  build-registry [--dry-run]              Backfill discord_channels from discordRawData
  reset-unavailable                       Clear unavailability status for all channels
  fix-states [--dry-run]                  Migrate auto-muted channels to unavailable state (one-time)

Options:
  --source=<config>.json                  Filter to a single config file (e.g. --source=m3org.json)
  --json                                  Output machine-readable JSON for query commands

Deprecated (still work, use sync instead):
  update [--source=<config>.json]         Alias for 'sync'
  refresh [--after/--before]             Alias for 'sync --with-fetch'

Examples:
  npm run channels -- sync --source=m3org.json                    # Full discover→analyze→propose pipeline
  npm run channels -- sync --with-fetch --source=m3org.json       # Full pipeline including mirror
  npm run channels -- archive --after=2025-10-01 --before=2025-12-01 --source=m3org.json --dry-run  # Preview backfill
  npm run channels -- archive --after=2025-10-01 --before=2025-12-01 --source=m3org.json            # Backfill summaries
  npm run channels -- discover --source=m3org.json  # Discover for a specific config
  npm run channels -- analyze               # Analyze channels needing analysis
  npm run channels -- analyze --all         # Re-analyze all channels
  npm run channels -- analyze --channel=123 # Analyze a single channel
  npm run channels -- propose               # Generate PR body with config changes
  npm run channels -- list --tracked        # List tracked channels

Workflow (run individually or all at once with 'sync'):
  npm run channels -- sync --source=m3org.json     # One-shot pipeline
  1. npm run channels -- discover            # Fetch channels
  2. npm run channels -- analyze             # Run LLM analysis
  3. npm run channels -- propose             # Generate PR body
  `);
}

// ============================================================================
// Utility Functions
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Main
// ============================================================================

function resolveDbPath(source?: string): string {
  return resolveDbPathFromConfig(source) || path.join(process.cwd(), "data", "elizaos.sqlite");
}

export async function runChannels(argv: string[] = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.command === "help" || !args.command) {
    commandHelp();
    return;
  }
  const dbPath = resolveDbPath(args.source);
  if (!args.json) {
    console.log(`Using database: ${path.relative(process.cwd(), dbPath)}`);
  }
  const db = await open({ filename: dbPath, driver: sqlite3.Database });

  // Initialize registry
  const registry = new DiscordChannelRegistry(db);
  await registry.initialize();

  try {
    switch (args.command) {
      case "sync":
        await commandSync(db, registry, args);
        break;
      case "update":
        await commandUpdate(db, registry, args);
        break;
      case "refresh":
        await commandRefresh(db, registry, args);
        break;
      case "mirror":
        await commandMirror(db, registry, args);
        break;
      case "sync-stats": {
        console.log("Rebuilding channel stats from items table...");
        const { updated } = await registry.syncStats();
        console.log(`Done — updated stats for ${updated} channels.`);
        break;
      }
      case "archive":
        await commandArchive(db, registry, args);
        break;
      case "discover":
        await commandDiscover(db, args);
        break;
      case "analyze":
        await commandAnalyze(db, registry, args);
        break;
      case "propose":
        await commandProposeUpdate(db, registry, args);
        break;
      case "list":
        await commandList(registry, args);
        break;
      case "show":
        if (!args.channelId) {
          console.error("\nChannel ID required");
          console.log("Usage: npm run channels -- show <channelId>\n");
        } else {
          await commandShow(registry, args.channelId);
        }
        break;
      case "stats":
        await commandStats(registry, args, db);
        break;
      case "track":
        if (!args.channelId) {
          console.error("\nChannel ID required");
          console.log("Usage: npm run channels -- track <channelId>\n");
        } else {
          await commandTrack(registry, args.channelId, true);
        }
        break;
      case "untrack":
        if (!args.channelId) {
          console.error("\nChannel ID required");
          console.log("Usage: npm run channels -- untrack <channelId>\n");
        } else {
          await commandTrack(registry, args.channelId, false);
        }
        break;
      case "mute":
        if (!args.channelId) {
          console.error("\nChannel ID required");
          console.log("Usage: npm run channels -- mute <channelId>\n");
        } else {
          await commandMute(registry, args.channelId, true);
        }
        break;
      case "unmute":
        if (!args.channelId) {
          console.error("\nChannel ID required");
          console.log("Usage: npm run channels -- unmute <channelId>\n");
        } else {
          await commandMute(registry, args.channelId, false);
        }
        break;
      case "build-registry":
        await commandBuildRegistry(db, args);
        break;
      case "reset-unavailable":
        await commandResetUnavailable(registry, args);
        break;
      case "fix-states":
        await commandFixStates(registry, args);
        break;
      case "help":
      default:
        commandHelp();
        break;
    }
  } finally {
    await db.close();
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down...");
  process.exit(0);
});

if (require.main === module) {
  runChannels().catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
}
