import fs from "fs";
import path from "path";
import { open } from "sqlite";
import sqlite3 from "sqlite3";

interface CliOptions {
  dbPath: string;
  source: string;
  after?: string;
  before?: string;
  rawRoot?: string;
  reportPath?: string;
  apply: boolean;
  strict: boolean;
  channelIds: Set<string>;
}

interface DiscordRawPayload {
  date?: string;
  channel?: {
    id?: string;
    name?: string;
  };
  users?: Record<string, unknown>;
  messages?: Array<{ id?: string; attachments?: unknown[] }>;
}

interface CandidateFile {
  filePath: string;
  dateStr: string;
  channelId: string;
  cid: string;
  payload: DiscordRawPayload;
}

interface ReconcileResult {
  cid: string;
  filePath: string;
  action: "update" | "skip" | "missing_row" | "parse_error";
  reasons: string[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAILY_FILE_RE = /^\d{4}-\d{2}-\d{2}\.json$/;

function printHelp(): void {
  console.log(`
Reconcile SQLite discordRawData rows from exported raw JSON files.

Usage:
  npm run reconcile-raw -- --db data/hyperfy-discord.sqlite --source hyperfy --date 2025-02-24
  npm run reconcile-raw -- --db data/hyperfy-discord.sqlite --source hyperfy --after 2025-02-24 --before 2025-02-25 --apply

Options:
  --db <path>            SQLite database path (default: data/hyperfy-discord.sqlite)
  --source <name>        Source name used in output folder layout (default: hyperfy)
  --date <YYYY-MM-DD>    Reconcile a single date
  --after <YYYY-MM-DD>   Start date (inclusive)
  --before <YYYY-MM-DD>  End date (inclusive)
  --channel <id[,id]>    Optional channel filter (can be repeated)
  --raw-root <path>      Override raw root (default: output/<source>/raw)
  --report <path>        Write JSON report to this path
  --apply                Apply updates (default is dry-run)
  --strict               Exit non-zero on parse errors or missing rows
  --help                 Show this help
`);
}

function parseDateArg(dateStr: string, label: string): void {
  if (!DATE_RE.test(dateStr)) {
    throw new Error(`Invalid ${label} date '${dateStr}'. Expected YYYY-MM-DD.`);
  }
}

function compareDateStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function epochStartUtc(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day, 0, 0, 0, 0) / 1000);
}

function parseCli(argv: string[]): CliOptions {
  const options: CliOptions = {
    dbPath: "data/hyperfy-discord.sqlite",
    source: "hyperfy",
    apply: false,
    strict: false,
    channelIds: new Set<string>(),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    if (arg === "--apply") {
      options.apply = true;
      continue;
    }

    if (arg === "--strict") {
      options.strict = true;
      continue;
    }

    if (arg === "--db") {
      options.dbPath = argv[++i];
      continue;
    }

    if (arg === "--source") {
      options.source = argv[++i];
      continue;
    }

    if (arg === "--date") {
      const date = argv[++i];
      options.after = date;
      options.before = date;
      continue;
    }

    if (arg === "--after") {
      options.after = argv[++i];
      continue;
    }

    if (arg === "--before") {
      options.before = argv[++i];
      continue;
    }

    if (arg === "--raw-root") {
      options.rawRoot = argv[++i];
      continue;
    }

    if (arg === "--report") {
      options.reportPath = argv[++i];
      continue;
    }

    if (arg === "--channel") {
      const value = argv[++i];
      for (const id of value.split(",").map((v) => v.trim()).filter(Boolean)) {
        options.channelIds.add(id);
      }
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.after && options.before) {
    options.after = options.before;
  }
  if (!options.before && options.after) {
    options.before = options.after;
  }

  if (!options.after || !options.before) {
    throw new Error("Provide --date or both --after/--before.");
  }

  parseDateArg(options.after, "after");
  parseDateArg(options.before, "before");

  if (!options.rawRoot) {
    options.rawRoot = path.join("output", options.source, "raw");
  }

  return options;
}

function collectJsonFiles(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const files: string[] = [];

  const walk = (dirPath: string) => {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && DAILY_FILE_RE.test(entry.name)) {
        files.push(fullPath);
      }
    }
  };

  walk(rootDir);
  return files;
}

function isInRange(dateStr: string, after: string, before: string): boolean {
  return compareDateStrings(dateStr, after) >= 0 && compareDateStrings(dateStr, before) <= 0;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}

function normalizeEpochSeconds(value: number): number {
  return value > 1_000_000_000_000 ? Math.floor(value / 1000) : value;
}

function buildUpdatedMetadata(existing: Record<string, unknown>, payload: DiscordRawPayload, dateStr: string): Record<string, unknown> {
  const users = payload.users || {};
  const messages = payload.messages || [];

  return {
    ...existing,
    channelId: payload.channel?.id || existing.channelId || null,
    channelName: payload.channel?.name || existing.channelName || null,
    messageCount: messages.length,
    userCount: Object.keys(users).length,
    dateProcessed: dateStr,
  };
}

function deriveTitle(existingTitle: string | null, payload: DiscordRawPayload, dateStr: string): string {
  if (existingTitle && existingTitle.trim().length > 0) {
    return existingTitle;
  }
  const channel = payload.channel?.name || payload.channel?.id || "unknown-channel";
  return `Raw Discord Data: ${channel} (${dateStr})`;
}

function deriveSource(existingSource: string | null, existingMetadata: Record<string, any>, payload: DiscordRawPayload): string {
  if (existingSource && existingSource.trim().length > 0) {
    return existingSource;
  }
  const guildName = existingMetadata.guildName || "UnknownGuild";
  const channelName = payload.channel?.name || existingMetadata.channelName || payload.channel?.id || "unknown-channel";
  return `${guildName} - ${channelName}`;
}

function deriveLink(existingLink: string | null, existingMetadata: Record<string, any>, payload: DiscordRawPayload): string | null {
  if (existingLink && existingLink.trim().length > 0) {
    return existingLink;
  }
  const guildId = existingMetadata.guildId;
  const channelId = payload.channel?.id;
  if (guildId && channelId) {
    return `https://discord.com/channels/${guildId}/${channelId}`;
  }
  return existingLink;
}

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2));

  const allFiles = collectJsonFiles(options.rawRoot!);

  const candidates: CandidateFile[] = [];
  const results: ReconcileResult[] = [];

  for (const filePath of allFiles) {
    const base = path.basename(filePath);
    const dateStr = base.replace(/\.json$/, "");

    if (!isInRange(dateStr, options.after!, options.before!)) {
      continue;
    }

    try {
      const payload = JSON.parse(fs.readFileSync(filePath, "utf8")) as DiscordRawPayload;
      const channelId = payload.channel?.id;

      if (!channelId) {
        results.push({
          cid: "",
          filePath,
          action: "parse_error",
          reasons: ["missing_channel_id"],
        });
        continue;
      }

      if (options.channelIds.size > 0 && !options.channelIds.has(channelId)) {
        continue;
      }

      candidates.push({
        filePath,
        dateStr,
        channelId,
        cid: `discord-raw-${channelId}-${dateStr}`,
        payload,
      });
    } catch {
      results.push({
        cid: "",
        filePath,
        action: "parse_error",
        reasons: ["file_json_parse_error"],
      });
    }
  }

  const db = await open({ filename: options.dbPath, driver: sqlite3.Database });

  if (options.apply) {
    await db.exec("BEGIN TRANSACTION");
  }

  const updateSql = `
    UPDATE items
    SET type = ?, source = ?, title = ?, text = ?, link = ?, date = ?, metadata = ?
    WHERE cid = ?
  `;

  let updatedRows = 0;

  try {
    for (const candidate of candidates) {
      const existing = await db.get<{
        cid: string;
        type: string;
        source: string | null;
        title: string | null;
        text: string | null;
        link: string | null;
        date: number;
        metadata: string | null;
      }>(
        `SELECT cid, type, source, title, text, link, date, metadata FROM items WHERE cid = ?`,
        [candidate.cid]
      );

      if (!existing) {
        results.push({
          cid: candidate.cid,
          filePath: candidate.filePath,
          action: "missing_row",
          reasons: ["missing_db_row_for_cid"],
        });
        continue;
      }

      const reasons: string[] = [];
      let existingPayload: DiscordRawPayload | undefined;
      if (existing.text) {
        try {
          existingPayload = JSON.parse(existing.text) as DiscordRawPayload;
        } catch {
          reasons.push("db_text_parse_error");
        }
      }

      const existingMetadata: Record<string, any> = (() => {
        if (!existing.metadata) return {};
        try {
          return JSON.parse(existing.metadata) as Record<string, any>;
        } catch {
          reasons.push("db_metadata_parse_error");
          return {};
        }
      })();

      const existingCanonical = existingPayload ? stableStringify(existingPayload) : "";
      const fileCanonical = stableStringify(candidate.payload);
      if (existingCanonical !== fileCanonical) {
        reasons.push("payload_diff");
      }

      const mergedMetadata = buildUpdatedMetadata(existingMetadata, candidate.payload, candidate.dateStr);
      const mergedMetadataCanonical = stableStringify(mergedMetadata);
      const existingMetadataCanonical = stableStringify(existingMetadata);
      if (mergedMetadataCanonical !== existingMetadataCanonical) {
        reasons.push("metadata_diff");
      }

      const expectedEpoch = epochStartUtc(candidate.dateStr);
      const existingEpoch = normalizeEpochSeconds(existing.date);
      if (existingEpoch !== expectedEpoch) {
        reasons.push("date_diff");
      }

      const nextType = "discordRawData";
      if (existing.type !== nextType) {
        reasons.push("type_diff");
      }

      const nextSource = deriveSource(existing.source, existingMetadata, candidate.payload);
      const nextTitle = deriveTitle(existing.title, candidate.payload, candidate.dateStr);
      const nextLink = deriveLink(existing.link, existingMetadata, candidate.payload);

      if (nextSource !== (existing.source || "")) {
        reasons.push("source_diff");
      }
      if (nextTitle !== (existing.title || "")) {
        reasons.push("title_diff");
      }
      if ((nextLink || "") !== (existing.link || "")) {
        reasons.push("link_diff");
      }

      if (reasons.length === 0) {
        results.push({
          cid: candidate.cid,
          filePath: candidate.filePath,
          action: "skip",
          reasons: ["already_in_sync"],
        });
        continue;
      }

      results.push({
        cid: candidate.cid,
        filePath: candidate.filePath,
        action: "update",
        reasons,
      });

      if (options.apply) {
        await db.run(updateSql, [
          nextType,
          nextSource,
          nextTitle,
          fileCanonical,
          nextLink,
          expectedEpoch,
          mergedMetadataCanonical,
          candidate.cid,
        ]);
        updatedRows++;
      }
    }

    if (options.apply) {
      await db.exec("COMMIT");
    }
  } catch (error) {
    if (options.apply) {
      await db.exec("ROLLBACK");
    }
    throw error;
  } finally {
    await db.close();
  }

  const summary = {
    source: options.source,
    dbPath: options.dbPath,
    rawRoot: options.rawRoot,
    after: options.after,
    before: options.before,
    channelFilter: Array.from(options.channelIds),
    apply: options.apply,
    scannedFiles: candidates.length,
    updatesNeeded: results.filter((r) => r.action === "update").length,
    updatedRows,
    missingRows: results.filter((r) => r.action === "missing_row").length,
    parseErrors: results.filter((r) => r.action === "parse_error").length,
    generatedAt: new Date().toISOString(),
  };

  console.log(`\nRaw Data Reconcile (${options.source})`);
  console.log(`Mode: ${options.apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`Range: ${options.after} -> ${options.before}`);
  console.log(`Scanned files: ${summary.scannedFiles}`);
  console.log(`Updates needed: ${summary.updatesNeeded}`);
  console.log(`Updated rows: ${summary.updatedRows}`);
  console.log(`Missing DB rows: ${summary.missingRows}`);
  console.log(`Parse errors: ${summary.parseErrors}`);

  const updatesPreview = results.filter((r) => r.action === "update").slice(0, 25);
  if (updatesPreview.length > 0) {
    console.log("\nUpdates (first 25):");
    for (const row of updatesPreview) {
      console.log(`- ${row.cid} :: ${row.reasons.join(", ")}`);
    }
  }

  if (options.reportPath) {
    const reportDir = path.dirname(options.reportPath);
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    fs.writeFileSync(options.reportPath, JSON.stringify({ summary, results }, null, 2), "utf8");
    console.log(`\nWrote report: ${options.reportPath}`);
  }

  if (options.strict && (summary.missingRows > 0 || summary.parseErrors > 0)) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`reconcile-raw failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
