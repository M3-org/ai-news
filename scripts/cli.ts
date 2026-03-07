#!/usr/bin/env node

/**
 * Unified CLI for ai-news operations.
 *
 * Also exports shared utilities used by channels.ts, users.ts, weekly.ts,
 * and setup-server.ts — keeping all CLI helpers in one place.
 */

import * as fs from "fs";
import * as path from "path";
import { spawn, spawnSync, execSync } from "child_process";
import { Command } from "commander";
import ora from "ora";
import { runSetup } from "./setup-server";
import { runChannels } from "./channels";
import { runUsers } from "./users";
import { runWeekly } from "./weekly";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type JsonEnvelope<T = unknown> = {
  ok: boolean;
  command: string;
  data?: T;
  warnings?: string[];
  errors?: string[];
};

export interface DiscoveredChannel {
  id: string;
  name: string;
  categoryName: string | null;
  isMuted: boolean;
}

export type SetupState = {
  name: string;
  configPath: string;
  selectedChannels: string[];
  tokenEnvVar: string;
  guildIdEnvVar: string;
  guildId: string;
  mediaEnabled: boolean;
  fetchedFrom?: string;
  fetchedTo?: string;
  steps: Record<string, "pending" | "done" | "skipped">;
};

export type ServerStatus = {
  name: string;
  config: string;
  database: { path: string; sizeBytes: number; exists: boolean };
  channels: { tracked: number; muted: number };
  dataRange: { from: string | null; to: string | null; days: number };
  staleDays: number | null;
  users: number;
  files: { raw: number; summaries: number };
};

// ---------------------------------------------------------------------------
// JSON / quiet mode helpers
// ---------------------------------------------------------------------------

export function isJsonMode(argv: string[] = process.argv.slice(2)): boolean {
  return argv.includes("--json");
}

export function isQuiet(argv: string[] = process.argv.slice(2)): boolean {
  return argv.includes("--quiet") || argv.includes("-q") || process.env.AI_NEWS_QUIET === "1";
}

export function outputJson<T>(payload: JsonEnvelope<T> | T): void {
  console.log(JSON.stringify(payload, null, 2));
}

// ---------------------------------------------------------------------------
// Progress helpers
// ---------------------------------------------------------------------------

export function spinner(text: string, argv?: string[]) {
  const enabled = process.stdout.isTTY && !isJsonMode(argv) && !isQuiet(argv);
  return ora({ text, isSilent: !enabled });
}

export function stepProgress(current: number, total: number, label: string): string {
  return `[${current}/${total}] ${label}`;
}

// ---------------------------------------------------------------------------
// Config / DB resolution
// ---------------------------------------------------------------------------

export function resolveConfigPath(source?: string): string {
  const sourceFile = source || "sources.json";
  return path.resolve(process.cwd(), "config", sourceFile);
}

export function resolveDbPathFromConfig(source?: string): string | null {
  const configPath = resolveConfigPath(source);
  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const storage = config.storage?.find((s: any) => s?.params?.dbPath);
    if (!storage?.params?.dbPath) {
      return null;
    }
    return path.resolve(process.cwd(), storage.params.dbPath);
  } catch {
    return null;
  }
}

export function listConfigFiles(source?: string): string[] {
  const configDir = path.resolve(process.cwd(), "config");
  if (!fs.existsSync(configDir)) return [];
  const files = fs.readdirSync(configDir).filter((f) => f.endsWith(".json"));
  if (!source || source === "all") return files;
  return files.includes(source) ? [source] : [];
}

// ---------------------------------------------------------------------------
// SQLite query helper (shells out to sqlite3 CLI)
// ---------------------------------------------------------------------------

function queryInt(dbPath: string, query: string): number {
  try {
    const out = spawnSync("sqlite3", [dbPath, query], { encoding: "utf8" });
    if (out.status !== 0) return 0;
    return parseInt(out.stdout.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// State detection (used by setup-server.ts)
// ---------------------------------------------------------------------------

export function parseDateValue(val: string): string {
  if (/^\d{9,}$/.test(val)) {
    return new Date(parseInt(val, 10) * 1000).toISOString().split("T")[0];
  }
  return val.split("T")[0];
}

export function getDbDateRange(dbPath: string): { min: string; max: string } | null {
  try {
    const result = spawnSync(
      "sqlite3",
      [dbPath, "SELECT MIN(date), MAX(date) FROM items WHERE type='discordRawData'"],
      { encoding: "utf8" }
    );

    if (result.status !== 0 || !result.stdout.trim()) return null;
    const [min, max] = result.stdout.trim().split("|");
    if (!min || !max) return null;
    return { min: parseDateValue(min), max: parseDateValue(max) };
  } catch {
    return null;
  }
}

export function getConfigChannelIds(configPath: string): string[] {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return config.sources?.[0]?.params?.channelIds || [];
  } catch {
    return [];
  }
}

export function getDiscoveredChannels(dbPath: string): DiscoveredChannel[] {
  try {
    const result = spawnSync(
      "sqlite3",
      [
        dbPath,
        "-json",
        "SELECT id, name, categoryName, isMuted FROM discord_channels WHERE isMuted = 0 ORDER BY categoryName, position",
      ],
      { encoding: "utf8" }
    );
    if (result.status !== 0 || !result.stdout.trim()) return [];
    return JSON.parse(result.stdout);
  } catch {
    return [];
  }
}

export function detectExistingState(state: SetupState): void {
  if (state.configPath && fs.existsSync(state.configPath)) {
    const config = JSON.parse(fs.readFileSync(state.configPath, "utf8"));
    state.steps["server-info"] = "done";

    const src = config.sources?.[0]?.params;
    if (src) {
      const tokenRef = src.botToken as string;
      if (tokenRef?.startsWith("process.env.")) {
        state.tokenEnvVar = state.tokenEnvVar || tokenRef.replace("process.env.", "");
      }
      const guildRef = src.guildId as string;
      if (guildRef?.startsWith("process.env.")) {
        state.guildIdEnvVar = state.guildIdEnvVar || guildRef.replace("process.env.", "");
        const envVal = process.env[state.guildIdEnvVar];
        if (envVal) state.guildId = state.guildId || envVal;
      }
      if (src.channelIds?.length > 0) {
        state.selectedChannels = src.channelIds;
      }
      state.mediaEnabled = src.mediaDownload?.enabled || false;
    }
  }

  const dbPath = resolveDbPathFromConfig(`${state.name}.json`)
    ?? path.resolve(process.cwd(), `data/${state.name}.sqlite`);
  if (!fs.existsSync(dbPath)) return;

  const channelCount = queryInt(dbPath, "SELECT COUNT(*) FROM discord_channels");
  if (channelCount > 0) {
    state.steps["discover"] = "done";
  }

  if (state.selectedChannels.length > 0) {
    state.steps["select"] = "done";
  }

  const dateRange = getDbDateRange(dbPath);
  if (dateRange) {
    state.steps["fetch"] = "done";
    state.steps["backfill"] = "done";
    state.fetchedFrom = dateRange.min;
    state.fetchedTo = dateRange.max;
  }

  const analyzedCount = queryInt(dbPath, "SELECT COUNT(*) FROM discord_channels WHERE aiRecommendation IS NOT NULL");
  if (analyzedCount > 0) {
    state.steps["analyze"] = "done";
  }

  if (channelCount > 0 && dateRange) {
    state.steps["channel-registry"] = "done";
  }

  const userCount = queryInt(dbPath, "SELECT COUNT(*) FROM discord_users");
  if (userCount > 0) {
    state.steps["user-registry"] = "done";
  }
}

// ---------------------------------------------------------------------------
// Status command
// ---------------------------------------------------------------------------

function daysBetween(from: string, to: string): number {
  const a = new Date(from + "T00:00:00Z");
  const b = new Date(to + "T00:00:00Z");
  return Math.max(0, Math.floor((b.getTime() - a.getTime()) / 86400000) + 1);
}

function staleDays(lastDate: string): number {
  const today = new Date();
  const start = new Date(lastDate + "T00:00:00Z");
  return Math.max(0, Math.floor((today.getTime() - start.getTime()) / 86400000));
}

function buildServerStatus(configFile: string): ServerStatus {
  const name = configFile.replace(/\.json$/, "");
  const configPath = path.resolve(process.cwd(), "config", configFile);
  const rawDir = path.resolve(process.cwd(), "output", name, "raw");
  const summariesDir = path.resolve(process.cwd(), "output", name, "summaries");

  const dbPath = resolveDbPathFromConfig(configFile)
    ?? path.resolve(process.cwd(), "data", `${name}.sqlite`);

  const dbExists = fs.existsSync(dbPath);
  const dbSize = dbExists ? fs.statSync(dbPath).size : 0;

  const tracked = dbExists ? queryInt(dbPath, "SELECT COUNT(*) FROM discord_channels WHERE isTracked = 1") : 0;
  const muted = dbExists ? queryInt(dbPath, "SELECT COUNT(*) FROM discord_channels WHERE isMuted = 1") : 0;
  const users = dbExists ? queryInt(dbPath, "SELECT COUNT(*) FROM discord_users") : 0;

  const range = dbExists ? getDbDateRange(dbPath) : null;
  const from = range?.min || null;
  const to = range?.max || null;
  const totalDays = from && to ? daysBetween(from, to) : 0;

  const rawCount = fs.existsSync(rawDir) ? fs.readdirSync(rawDir).length : 0;
  const summaryCount = fs.existsSync(summariesDir) ? fs.readdirSync(summariesDir).length : 0;

  return {
    name,
    config: path.relative(process.cwd(), configPath),
    database: {
      path: path.relative(process.cwd(), dbPath),
      sizeBytes: dbSize,
      exists: dbExists,
    },
    channels: { tracked, muted },
    dataRange: { from, to, days: totalDays },
    staleDays: to ? staleDays(to) : null,
    users,
    files: { raw: rawCount, summaries: summaryCount },
  };
}

export function runStatusCommand(source?: string, asJson = false): JsonEnvelope<ServerStatus | ServerStatus[]> | void {
  const configFiles = listConfigFiles(source);

  if (configFiles.length === 0) {
    const payload: JsonEnvelope = {
      ok: false,
      command: "status",
      errors: ["No config files found for requested source."],
    };
    if (asJson) return payload;
    console.error("No config files found for requested source.");
    return;
  }

  const statuses = configFiles.map(buildServerStatus);

  if (asJson) {
    return {
      ok: true,
      command: "status",
      data: statuses.length === 1 ? statuses[0] : statuses,
    };
  }

  if (statuses.length === 1) {
    const s = statuses[0];
    console.log(`\n${s.name} pipeline status\n`);
    console.log(`  Config:     ${s.config}`);
    console.log(`  Database:   ${s.database.path} (${(s.database.sizeBytes / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`  Channels:   ${s.channels.tracked} tracked, ${s.channels.muted} muted`);
    console.log(`  Data range: ${s.dataRange.from || "n/a"} to ${s.dataRange.to || "n/a"} (${s.dataRange.days} days)`);
    console.log(`  Stale:      ${s.staleDays ?? "n/a"} day(s)`);
    console.log(`  Users:      ${s.users}`);
    console.log(`  Raw output: ${s.files.raw} files`);
    console.log(`  Summaries:  ${s.files.summaries} files\n`);
  } else {
    console.log("\nServer status\n");
    for (const s of statuses) {
      console.log(`  ${s.name.padEnd(18)} tracked=${String(s.channels.tracked).padStart(4)} users=${String(s.users).padStart(4)} stale=${String(s.staleDays ?? "n/a").padStart(4)}`);
    }
    console.log("");
  }
}

// ---------------------------------------------------------------------------
// Doctor command
// ---------------------------------------------------------------------------

type Check = { name: string; ok: boolean; value: string; message?: string };

type DoctorData = {
  system: Check[];
  env: Check[];
  servers: ServerStatus | ServerStatus[];
};

function cmdVersion(command: string): string | null {
  try {
    const output = execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return output.split("\n")[0] || null;
  } catch {
    return null;
  }
}

function envCheck(name: string): Check {
  const value = process.env[name];
  return {
    name,
    ok: !!value,
    value: value ? "set" : "missing",
  };
}

export function runDoctorCommand(asJson = false): JsonEnvelope<DoctorData> | void {
  const nodeVersion = process.version;
  const sqliteVersion = cmdVersion("sqlite3 --version");
  const npmFromEnv = process.env.npm_config_user_agent?.match(/npm\/([0-9.]+)/)?.[1] || null;
  const npmVersion = npmFromEnv || cmdVersion("npm --version");

  const system: Check[] = [
    { name: "node", ok: !!nodeVersion, value: nodeVersion },
    { name: "sqlite3", ok: !!sqliteVersion, value: sqliteVersion || "missing" },
    { name: "npm", ok: !!npmVersion, value: npmVersion || "missing" },
  ];

  const envFile = path.resolve(process.cwd(), ".env");
  const envChecks: Check[] = [
    { name: ".env", ok: fs.existsSync(envFile), value: fs.existsSync(envFile) ? "present" : "missing" },
    envCheck("DISCORD_TOKEN"),
    envCheck("OPENAI_API_KEY"),
    envCheck("USE_OPENROUTER"),
  ];

  const statusPayload = runStatusCommand("all", true);
  const servers = statusPayload && "data" in statusPayload ? statusPayload.data : [];

  const ok = system.every((c) => c.ok) && envChecks.every((c) => c.ok);
  const payload: JsonEnvelope<DoctorData> = {
    ok,
    command: "doctor",
    data: {
      system,
      env: envChecks,
      servers,
    },
    warnings: ok ? [] : ["One or more system/environment checks failed."],
  };

  if (asJson) return payload;

  console.log("\nDoctor\n");
  console.log("System:");
  for (const check of system) {
    console.log(`  ${check.ok ? "OK" : "FAIL"} ${check.name}: ${check.value}`);
  }

  console.log("\nEnvironment:");
  for (const check of envChecks) {
    console.log(`  ${check.ok ? "OK" : "FAIL"} ${check.name}: ${check.value}`);
  }

  if (Array.isArray(servers)) {
    console.log("\nServers:");
    for (const server of servers) {
      if (!server || typeof server !== "object") continue;
      console.log(`  ${server.name}: db=${server.database?.exists ? "OK" : "MISSING"}, stale=${server.staleDays ?? "n/a"}`);
    }
  }

  if (!ok) {
    console.log("\nDoctor found issues. Run with --json for machine-readable details.\n");
  } else {
    console.log("\nAll checks passed.\n");
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function withJsonFlag(args: string[], json: boolean): string[] {
  const next = [...args];
  if (json && !next.includes("--json")) next.push("--json");
  return next;
}

function runTsScript(scriptPath: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(
      "ts-node",
      ["-r", "tsconfig-paths/register", "--transpile-only", scriptPath, ...args],
      {
        stdio: "inherit",
        shell: true,
        cwd: process.cwd(),
      }
    );

    child.on("close", (code) => resolve(code ?? 1));
  });
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const program = new Command();

  program
    .name("ai-news")
    .description("Unified CLI for ai-news operations")
    .option("--json", "Output machine-readable JSON where supported")
    .option("-q, --quiet", "Reduce output and suppress progress indicators")
    .showHelpAfterError();

  program
    .command("run [args...]")
    .description("Run the main pipeline (src/index.ts)")
    .helpOption(false)
    .allowUnknownOption(true)
    .action(async (args: string[] = []) => {
      const opts = program.opts<{ json?: boolean; quiet?: boolean }>();
      if (args.includes("--help") || args.includes("-h")) {
        console.log(`
Usage: ai-news run [options]

Runs the main pipeline from src/index.ts.
Common options:
  --source=<config>.json
  --only-fetch / --onlyFetch
  --only-generate / --onlyGenerate
  --output=<path>
`);
        return;
      }
      if (opts.quiet) process.env.AI_NEWS_QUIET = "1";
      const code = await runTsScript("src/index.ts", withJsonFlag(args, !!opts.json));
      if (code !== 0) process.exit(code);
    });

  program
    .command("fetch [args...]")
    .description("Run historical fetch/generate pipeline (src/historical.ts)")
    .helpOption(false)
    .allowUnknownOption(true)
    .action(async (args: string[] = []) => {
      const opts = program.opts<{ json?: boolean; quiet?: boolean }>();
      if (args.includes("--dry-run")) {
        console.log("Dry run — would execute historical pipeline with:");
        console.log(`  ts-node -r tsconfig-paths/register --transpile-only src/historical.ts ${args.join(" ")}`);
        return;
      }
      if (opts.quiet) process.env.AI_NEWS_QUIET = "1";
      const code = await runTsScript("src/historical.ts", withJsonFlag(args, !!opts.json));
      if (code !== 0) process.exit(code);
    });

  program
    .command("setup [args...]")
    .description("Interactive setup wizard")
    .helpOption(false)
    .allowUnknownOption(true)
    .action(async (args: string[] = []) => {
      const opts = program.opts<{ json?: boolean; quiet?: boolean }>();
      if (opts.quiet) process.env.AI_NEWS_QUIET = "1";
      await runSetup(withJsonFlag(args, !!opts.json));
    });

  program
    .command("channels [args...]")
    .description("Channel management CLI")
    .helpOption(false)
    .allowUnknownOption(true)
    .action(async (args: string[] = []) => {
      const opts = program.opts<{ json?: boolean; quiet?: boolean }>();
      if (opts.quiet) process.env.AI_NEWS_QUIET = "1";
      await runChannels(withJsonFlag(args, !!opts.json));
    });

  program
    .command("users [args...]")
    .description("User registry CLI")
    .helpOption(false)
    .allowUnknownOption(true)
    .action(async (args: string[] = []) => {
      const opts = program.opts<{ json?: boolean; quiet?: boolean }>();
      if (opts.quiet) process.env.AI_NEWS_QUIET = "1";
      await runUsers(withJsonFlag(args, !!opts.json));
    });

  program
    .command("weekly [args...]")
    .description("Weekly summary generator CLI")
    .helpOption(false)
    .allowUnknownOption(true)
    .action(async (args: string[] = []) => {
      const opts = program.opts<{ json?: boolean; quiet?: boolean }>();
      if (opts.quiet) process.env.AI_NEWS_QUIET = "1";
      await runWeekly(withJsonFlag(args, !!opts.json));
    });

  program
    .command("status")
    .description("Show pipeline health status")
    .option("--source <config>", "Config file name (e.g. m3org.json), or 'all'", "all")
    .action((opts: { source: string }) => {
      const global = program.opts<{ json?: boolean }>();
      const payload = runStatusCommand(opts.source, !!global.json);
      if (global.json && payload) {
        outputJson(payload);
      }
    });

  program
    .command("doctor")
    .description("Run environment and pipeline diagnostics")
    .action(() => {
      const global = program.opts<{ json?: boolean }>();
      const payload = runDoctorCommand(!!global.json);
      if (global.json && payload) {
        outputJson(payload);
      }
    });

  await program.parseAsync(argv, { from: "user" });
}

if (require.main === module) {
  runCli().catch((err) => {
    console.error("CLI error:", err);
    process.exit(1);
  });
}
