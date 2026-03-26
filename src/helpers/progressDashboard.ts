import readline from "node:readline";

export type DashboardLogLevel =
  | "info"
  | "success"
  | "warning"
  | "error"
  | "debug"
  | "channel";

export interface DashboardTaskState {
  label: string;
  status?: string;
  detail?: string;
  current?: number;
  total?: number;
  startedAt?: number;
  updatedAt?: number;
}

interface DashboardEvent {
  level: DashboardLogLevel;
  message: string;
  timestamp: number;
}

interface DashboardOverallState {
  label?: string;
  current?: number;
  total?: number;
  detail?: string;
}

interface ProgressDashboardOptions {
  title: string;
  enabled?: boolean;
  refreshMs?: number;
  maxTasks?: number;
  maxEvents?: number;
}

const LEVEL_LABELS: Record<DashboardLogLevel, string> = {
  info: "INFO",
  success: "OK",
  warning: "WARN",
  error: "ERR",
  debug: "DEBUG",
  channel: "CHAN",
};

let activeDashboard: ProgressDashboard | null = null;

export function getActiveProgressDashboard(): ProgressDashboard | null {
  return activeDashboard;
}

export function setActiveProgressDashboard(dashboard: ProgressDashboard | null): void {
  activeDashboard = dashboard;
}

export class ProgressDashboard {
  private readonly title: string;
  private readonly enabled: boolean;
  private readonly refreshMs: number;
  private readonly maxTasks: number;
  private readonly maxEvents: number;
  private readonly startedAt = Date.now();
  private readonly stats = new Map<string, string>();
  private readonly tasks = new Map<string, DashboardTaskState>();
  private readonly events: DashboardEvent[] = [];

  private headerLines: string[] = [];
  private overall: DashboardOverallState = {};
  private transientMessage: string | null = null;
  private renderedLineCount = 0;
  private renderTimer: NodeJS.Timeout | null = null;
  private disposed = false;

  constructor(options: ProgressDashboardOptions) {
    this.title = options.title;
    this.enabled = options.enabled ?? (Boolean(process.stdout.isTTY) && process.env.TERM !== "dumb");
    this.refreshMs = options.refreshMs ?? 100;
    this.maxTasks = options.maxTasks ?? 8;
    this.maxEvents = options.maxEvents ?? 5;
  }

  public isInteractive(): boolean {
    return this.enabled && !this.disposed;
  }

  public setHeaderLines(lines: string[]): void {
    this.headerLines = lines.filter(Boolean);
    this.scheduleRender();
  }

  public setOverall(state: DashboardOverallState): void {
    this.overall = {
      ...this.overall,
      ...state,
    };
    this.scheduleRender();
  }

  public setStats(stats: Record<string, string | number | undefined>): void {
    for (const [key, value] of Object.entries(stats)) {
      if (value === undefined || value === null || value === "") {
        this.stats.delete(key);
        continue;
      }
      this.stats.set(key, String(value));
    }
    this.scheduleRender();
  }

  public upsertTask(id: string, state: Partial<DashboardTaskState> & { label?: string }): void {
    const existing = this.tasks.get(id);
    const startedAt = state.startedAt ?? existing?.startedAt ?? Date.now();
    this.tasks.set(id, {
      label: state.label ?? existing?.label ?? id,
      status: state.status ?? existing?.status,
      detail: state.detail ?? existing?.detail,
      current: state.current ?? existing?.current,
      total: state.total ?? existing?.total,
      startedAt,
      updatedAt: Date.now(),
    });
    this.scheduleRender();
  }

  public removeTask(id: string): void {
    if (this.tasks.delete(id)) {
      this.scheduleRender();
    }
  }

  public clearTasks(): void {
    if (this.tasks.size === 0) return;
    this.tasks.clear();
    this.scheduleRender();
  }

  public pushEvent(level: DashboardLogLevel, message: string): void {
    if (level === "debug" && !process.env.DEBUG) {
      return;
    }

    this.events.push({
      level,
      message,
      timestamp: Date.now(),
    });

    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }

    this.scheduleRender();
  }

  public setTransientMessage(message: string | null): void {
    this.transientMessage = message;
    this.scheduleRender();
  }

  public clearTransientMessage(): void {
    if (!this.transientMessage) return;
    this.transientMessage = null;
    this.scheduleRender();
  }

  public getStatsSnapshot(): Record<string, string> {
    return Object.fromEntries(this.stats.entries());
  }

  public finish(summaryLines: string[] = []): void {
    this.disposed = true;
    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
      this.renderTimer = null;
    }

    if (this.enabled) {
      this.clearRenderedArea();
    }

    if (summaryLines.length > 0) {
      process.stdout.write(summaryLines.join("\n") + "\n");
    }

    if (activeDashboard === this) {
      activeDashboard = null;
    }
  }

  public dispose(): void {
    this.finish([]);
  }

  private scheduleRender(): void {
    if (!this.enabled || this.disposed) return;
    if (this.renderTimer) return;

    this.renderTimer = setTimeout(() => {
      this.renderTimer = null;
      this.render();
    }, this.refreshMs);
  }

  private render(): void {
    if (!this.enabled || this.disposed) return;

    const lines = this.buildLines();
    if (this.renderedLineCount > 0) {
      readline.moveCursor(process.stdout, 0, -this.renderedLineCount);
      readline.cursorTo(process.stdout, 0);
    }
    readline.clearScreenDown(process.stdout);
    process.stdout.write(lines.join("\n") + "\n");
    this.renderedLineCount = lines.length;
  }

  private clearRenderedArea(): void {
    if (!this.enabled || this.renderedLineCount === 0) return;
    readline.moveCursor(process.stdout, 0, -this.renderedLineCount);
    readline.cursorTo(process.stdout, 0);
    readline.clearScreenDown(process.stdout);
    this.renderedLineCount = 0;
  }

  private buildLines(): string[] {
    const width = Math.max(80, process.stdout.columns || 120);
    const now = Date.now();
    const lines: string[] = [];

    lines.push(this.truncate(`== ${this.title} ==`, width));
    lines.push(this.truncate(`Elapsed: ${formatDuration(now - this.startedAt)}`, width));

    for (const line of this.headerLines) {
      lines.push(this.truncate(line, width));
    }

    if (this.overall.label || typeof this.overall.current === "number" || typeof this.overall.total === "number") {
      const total = this.overall.total ?? 0;
      const current = this.overall.current ?? 0;
      const bar = total > 0 ? renderBar(current, total, 24) : renderPulse(now);
      const countText = total > 0 ? `${current}/${total}` : `${current}`;
      const detail = this.overall.detail ? ` | ${this.overall.detail}` : "";
      const label = this.overall.label ? ` ${this.overall.label}` : "";
      lines.push(this.truncate(`Overall: ${bar} ${countText}${label}${detail}`, width));
    }

    if (this.stats.size > 0) {
      const statLine = Array.from(this.stats.entries())
        .map(([key, value]) => `${labelize(key)} ${value}`)
        .join(" | ");
      lines.push(this.truncate(`Stats: ${statLine}`, width));
    }

    if (this.transientMessage) {
      lines.push(this.truncate(`Progress: ${this.transientMessage}`, width));
    }

    lines.push("Active Tasks:");
    if (this.tasks.size === 0) {
      lines.push("  idle");
    } else {
      const orderedTasks = Array.from(this.tasks.values())
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .slice(0, this.maxTasks);

      for (const task of orderedTasks) {
        const parts = [`  ${truncateMiddle(task.label, 18)}`];
        if (task.status) {
          parts.push(task.status);
        }
        if (task.total && task.total > 0 && typeof task.current === "number") {
          parts.push(renderBar(task.current, task.total, 10));
        }
        if (task.detail) {
          parts.push(task.detail);
        }
        if (task.startedAt) {
          parts.push(formatDuration(now - task.startedAt));
        }
        lines.push(this.truncate(parts.join(" | "), width));
      }
    }

    if (this.events.length > 0) {
      lines.push("Recent Events:");
      for (const event of this.events) {
        lines.push(this.truncate(`  [${LEVEL_LABELS[event.level]}] ${event.message}`, width));
      }
    }

    return lines;
  }

  private truncate(value: string, width: number): string {
    if (value.length <= width) return value;
    if (width <= 3) return value.slice(0, width);
    return `${value.slice(0, width - 3)}...`;
  }
}

function renderBar(current: number, total: number, width: number): string {
  const safeTotal = total <= 0 ? 1 : total;
  const boundedCurrent = Math.max(0, Math.min(current, safeTotal));
  const filled = Math.round((boundedCurrent / safeTotal) * width);
  return `[${"=".repeat(filled)}${"-".repeat(width - filled)}]`;
}

function renderPulse(timestamp: number): string {
  const frames = ["[>---------]", "[-=>-------]", "[---=>-----]", "[-----=>---]", "[-------=>-]"];
  return frames[Math.floor(timestamp / 200) % frames.length];
}

function truncateMiddle(value: string, width: number): string {
  if (value.length <= width) return value;
  if (width <= 3) return value.slice(0, width);

  const left = Math.ceil((width - 3) / 2);
  const right = Math.floor((width - 3) / 2);
  return `${value.slice(0, left)}...${value.slice(value.length - right)}`;
}

function labelize(key: string): string {
  return key.replace(/[_-]+/g, " ");
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
