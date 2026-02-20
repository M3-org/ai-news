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
  messages?: Array<{
    id?: string;
    attachments?: unknown[];
  }>;
}

interface AuditRow {
  cid: string;
  channelId: string;
  rowDate: string;
  payloadDate?: string;
  filePath: string;
  status: "ok" | "mismatch";
  issues: string[];
  dbMessageCount: number;
  fileMessageCount?: number;
  dbAttachmentCount: number;
  fileAttachmentCount?: number;
  missingInFileCount?: number;
  extraInFileCount?: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAILY_CID_RE = /^discord-raw-(\d+)-(\d{4}-\d{2}-\d{2})$/;

function printHelp(): void {
  console.log(`
Audit SQLite discordRawData rows against exported raw JSON files.

Usage:
  npm run audit-raw -- --db data/hyperfy-discord.sqlite --source hyperfy --date 2025-02-24
  npm run audit-raw -- --db data/hyperfy-discord.sqlite --source hyperfy --after 2025-02-24 --before 2025-02-25 --strict

Options:
  --db <path>            SQLite database path (default: data/hyperfy-discord.sqlite)
  --source <name>        Source name used in output folder layout (default: hyperfy)
  --date <YYYY-MM-DD>    Audit a single date
  --after <YYYY-MM-DD>   Start date (inclusive)
  --before <YYYY-MM-DD>  End date (inclusive)
  --channel <id[,id]>    Optional channel filter (can be repeated)
  --raw-root <path>      Override raw root (default: output/<source>/raw)
  --report <path>        Write JSON audit report to this path
  --strict               Exit non-zero when mismatches are found
  --help                 Show this help
`);
}

function sanitizeName(name: string): string {
  if (!name) return "unknown";
  return name
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_\-]/g, "")
    .replace(/__+/g, "_")
    .toLowerCase();
}

function normalizeEpochSeconds(value: number): number {
  return value > 1_000_000_000_000 ? Math.floor(value / 1000) : value;
}

function parseDateArg(dateStr: string, label: string): void {
  if (!DATE_RE.test(dateStr)) {
    throw new Error(`Invalid ${label} date '${dateStr}'. Expected YYYY-MM-DD.`);
  }
}

function epochStartUtc(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day, 0, 0, 0, 0) / 1000);
}

function addDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function parseCli(argv: string[]): CliOptions {
  const options: CliOptions = {
    dbPath: "data/hyperfy-discord.sqlite",
    source: "hyperfy",
    strict: false,
    channelIds: new Set<string>(),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
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

function countAttachments(payload: DiscordRawPayload): number {
  const messages = payload.messages || [];
  let count = 0;
  for (const message of messages) {
    if (Array.isArray(message.attachments)) {
      count += message.attachments.length;
    }
  }
  return count;
}

function extractMessageIds(payload: DiscordRawPayload): Set<string> {
  const ids = new Set<string>();
  for (const message of payload.messages || []) {
    if (message.id) {
      ids.add(message.id);
    }
  }
  return ids;
}

function setDiffCount(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const value of a) {
    if (!b.has(value)) {
      count++;
    }
  }
  return count;
}

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2));

  const startEpoch = epochStartUtc(options.after!);
  const endExclusiveEpoch = epochStartUtc(addDays(options.before!, 1));

  const db = await open({ filename: options.dbPath, driver: sqlite3.Database });

  const rows = await db.all<Array<{
    cid: string;
    date: number;
    text: string;
    metadata: string | null;
  }>>(
    `
    SELECT cid, date, text, metadata
    FROM items
    WHERE type = 'discordRawData'
      AND date >= ?
      AND date < ?
    ORDER BY date ASC, cid ASC
    `,
    [startEpoch, endExclusiveEpoch]
  );

  const results: AuditRow[] = [];
  let skippedNonDailyCid = 0;

  for (const row of rows) {
    const cidMatch = row.cid.match(DAILY_CID_RE);
    if (!cidMatch) {
      skippedNonDailyCid++;
      continue;
    }

    const channelId = cidMatch[1];
    if (options.channelIds.size > 0 && !options.channelIds.has(channelId)) {
      continue;
    }

    const cidDate = cidMatch[2];
    const rowEpoch = normalizeEpochSeconds(row.date);
    const rowDate = new Date(rowEpoch * 1000).toISOString().slice(0, 10);

    const issues: string[] = [];

    if (cidDate !== rowDate) {
      issues.push("cid_date_mismatch");
    }

    let dbPayload: DiscordRawPayload;
    try {
      dbPayload = JSON.parse(row.text) as DiscordRawPayload;
    } catch {
      results.push({
        cid: row.cid,
        channelId,
        rowDate,
        filePath: "",
        status: "mismatch",
        issues: [...issues, "db_json_parse_error"],
        dbMessageCount: 0,
        dbAttachmentCount: 0,
      });
      continue;
    }

    const payloadDate = dbPayload.date?.slice(0, 10);
    if (payloadDate && payloadDate !== rowDate) {
      issues.push("payload_date_mismatch");
    }

    let metadata: Record<string, any> = {};
    if (row.metadata) {
      try {
        metadata = JSON.parse(row.metadata) as Record<string, any>;
      } catch {
        issues.push("metadata_parse_error");
      }
    }

    const guildName = String(metadata.guildName || options.source);
    const channelName = String(metadata.channelName || dbPayload.channel?.name || channelId);
    const filePath = path.join(
      options.rawRoot!,
      sanitizeName(guildName),
      sanitizeName(channelName),
      `${rowDate}.json`
    );

    const dbMessageCount = (dbPayload.messages || []).length;
    const dbAttachmentCount = countAttachments(dbPayload);
    const dbMessageIds = extractMessageIds(dbPayload);

    const auditRow: AuditRow = {
      cid: row.cid,
      channelId,
      rowDate,
      payloadDate,
      filePath,
      status: "ok",
      issues,
      dbMessageCount,
      dbAttachmentCount,
    };

    if (!fs.existsSync(filePath)) {
      auditRow.status = "mismatch";
      auditRow.issues.push("raw_file_missing");
      results.push(auditRow);
      continue;
    }

    try {
      const filePayload = JSON.parse(fs.readFileSync(filePath, "utf8")) as DiscordRawPayload;
      const fileDate = filePayload.date?.slice(0, 10);
      if (fileDate && fileDate !== rowDate) {
        auditRow.issues.push("file_date_mismatch");
      }

      const fileMessageCount = (filePayload.messages || []).length;
      const fileAttachmentCount = countAttachments(filePayload);
      const fileMessageIds = extractMessageIds(filePayload);

      auditRow.fileMessageCount = fileMessageCount;
      auditRow.fileAttachmentCount = fileAttachmentCount;

      if (dbMessageCount !== fileMessageCount) {
        auditRow.issues.push("message_count_mismatch");
      }
      if (dbAttachmentCount !== fileAttachmentCount) {
        auditRow.issues.push("attachment_count_mismatch");
      }

      const missingInFileCount = setDiffCount(dbMessageIds, fileMessageIds);
      const extraInFileCount = setDiffCount(fileMessageIds, dbMessageIds);

      if (missingInFileCount > 0 || extraInFileCount > 0) {
        auditRow.issues.push("message_id_set_mismatch");
        auditRow.missingInFileCount = missingInFileCount;
        auditRow.extraInFileCount = extraInFileCount;
      }
    } catch {
      auditRow.issues.push("raw_file_parse_error");
    }

    if (auditRow.issues.length > 0) {
      auditRow.status = "mismatch";
    }

    results.push(auditRow);
  }

  await db.close();

  const total = results.length;
  const mismatches = results.filter((r) => r.status === "mismatch");
  const summary = {
    source: options.source,
    dbPath: options.dbPath,
    rawRoot: options.rawRoot,
    after: options.after,
    before: options.before,
    channelFilter: Array.from(options.channelIds),
    strict: options.strict,
    scannedRows: total,
    mismatchRows: mismatches.length,
    okRows: total - mismatches.length,
    skippedNonDailyCid,
    generatedAt: new Date().toISOString(),
  };

  console.log(`\nRaw Data Audit (${options.source})`);
  console.log(`Range: ${options.after} -> ${options.before}`);
  console.log(`Scanned rows: ${summary.scannedRows}`);
  console.log(`OK rows: ${summary.okRows}`);
  console.log(`Mismatch rows: ${summary.mismatchRows}`);
  if (skippedNonDailyCid > 0) {
    console.log(`Skipped non-daily CID rows: ${skippedNonDailyCid}`);
  }

  if (mismatches.length > 0) {
    console.log("\nMismatches (first 25):");
    for (const row of mismatches.slice(0, 25)) {
      console.log(`- ${row.cid} :: ${row.issues.join(", ")}`);
    }
  }

  if (options.reportPath) {
    const reportDir = path.dirname(options.reportPath);
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    fs.writeFileSync(
      options.reportPath,
      JSON.stringify({ summary, mismatches, rows: results }, null, 2),
      "utf8"
    );

    console.log(`\nWrote report: ${options.reportPath}`);
  }

  if (options.strict && mismatches.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`audit-raw failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
