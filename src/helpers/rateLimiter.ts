/**
 * Discord-compliant rate limiter that respects API headers and implements proper backoff
 *
 * @module helpers/rateLimiter
 */

import fs from "fs";
import { logger } from "./cliHelper";
import { delay } from "./generalHelper";

// Discord rate limit constants
const DISCORD_GLOBAL_RATE_LIMIT = 50;  // requests per second
const DISCORD_RATE_LIMIT_WINDOW = 1000; // 1 second window
const MAX_CONCURRENT_DOWNLOADS = 1; // Serial downloads to avoid Cloudflare IP-level burst detection

/**
 * Discord-compliant rate limiter that respects API headers and implements proper backoff
 */
export class DiscordRateLimiter {
  private requestQueue: Array<() => void> = [];
  private globalRateLimit: { resetAt: number; remaining: number } = { resetAt: 0, remaining: DISCORD_GLOBAL_RATE_LIMIT };
  private bucketLimits: Map<string, { resetAt: number; remaining: number; limit: number }> = new Map();
  private processing = false;
  private activeRequests = 0;
  private pausedUntil = 0;

  pause(ms: number) {
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms);
  }

  getRemainingPause(): number {
    return Math.max(0, this.pausedUntil - Date.now());
  }

  /**
   * Add a request to the rate-limited queue
   */
  async enqueue<T>(request: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.requestQueue.push(async () => {
        try {
          const result = await request();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      this.processQueue();
    });
  }

  /**
   * Process the request queue respecting rate limits
   */
  private async processQueue() {
    if (this.processing || this.requestQueue.length === 0 || this.activeRequests >= MAX_CONCURRENT_DOWNLOADS) {
      return;
    }

    this.processing = true;

    while (this.requestQueue.length > 0 && this.activeRequests < MAX_CONCURRENT_DOWNLOADS) {
      const now = Date.now();

      // Check pause and bucket exhaustion before dispatching
      const waitMs = Math.max(this.getRemainingPause(), this.shouldDelay());
      if (waitMs > 0) {
        logger.debug(`Rate limiter paused for ${Math.round(waitMs / 1000)}s`);
        await delay(waitMs);
        continue;
      }

      // Check global rate limit
      if (now < this.globalRateLimit.resetAt && this.globalRateLimit.remaining <= 0) {
        const waitTime = this.globalRateLimit.resetAt - now;
        logger.debug(`Global rate limit hit, waiting ${waitTime}ms`);
        await delay(waitTime);
        continue;
      }

      // Reset global rate limit if window passed
      if (now >= this.globalRateLimit.resetAt) {
        this.globalRateLimit = { resetAt: now + DISCORD_RATE_LIMIT_WINDOW, remaining: DISCORD_GLOBAL_RATE_LIMIT };
      }

      const request = this.requestQueue.shift()!;
      this.activeRequests++;
      this.globalRateLimit.remaining--;

      // Execute request without blocking the queue
      setImmediate(async () => {
        try {
          await request();
        } catch (error) {
          logger.debug(`Request failed: ${error}`);
        } finally {
          this.activeRequests--;
          // Continue processing queue
          setImmediate(() => this.processQueue());
        }
      });

      // 1–2s jitter between requests to avoid predictable cadence Cloudflare can pattern-match
      await delay(1000 + Math.random() * 1000);
    }

    this.processing = false;
  }

  /**
   * Update rate limits based on Discord response headers
   */
  updateRateLimits(headers: any, bucket?: string) {
    const now = Date.now();

    // Update global rate limit from headers
    if (headers['x-ratelimit-global']) {
      const retryAfter = parseFloat(headers['retry-after']) * 1000;
      this.globalRateLimit = { resetAt: now + retryAfter, remaining: 0 };
      logger.warning(`Global rate limit hit, reset in ${retryAfter}ms`);
    }

    // Update bucket-specific rate limit
    if (bucket && headers['x-ratelimit-limit']) {
      const limit = parseInt(headers['x-ratelimit-limit']);
      const remaining = parseInt(headers['x-ratelimit-remaining'] || '0');
      const resetAfter = parseFloat(headers['x-ratelimit-reset-after'] || '1') * 1000;

      this.bucketLimits.set(bucket, {
        resetAt: now + resetAfter,
        remaining,
        limit
      });

      if (remaining <= 0) {
        logger.debug(`Bucket ${bucket} rate limit hit, reset in ${resetAfter}ms`);
      }
    }
  }

  /**
   * Persist current pause state to a file so restarts can honour an active rate limit window
   */
  savePauseState(filePath: string) {
    if (this.getRemainingPause() > 0) {
      fs.writeFileSync(filePath, JSON.stringify({ pausedUntil: this.pausedUntil }));
    } else {
      try { fs.unlinkSync(filePath); } catch {}
    }
  }

  /**
   * Restore pause state from file written by a previous run
   */
  loadPauseState(filePath: string) {
    try {
      const { pausedUntil } = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (pausedUntil > Date.now()) this.pausedUntil = pausedUntil;
    } catch {}
  }

  /**
   * Check if a request to a specific bucket should be delayed
   */
  shouldDelay(bucket?: string): number {
    const now = Date.now();
    let delayMs = 0;

    // Check global rate limit
    if (now < this.globalRateLimit.resetAt && this.globalRateLimit.remaining <= 0) {
      delayMs = Math.max(delayMs, this.globalRateLimit.resetAt - now);
    }

    // Check bucket rate limit
    if (bucket && this.bucketLimits.has(bucket)) {
      const bucketLimit = this.bucketLimits.get(bucket)!;
      if (now < bucketLimit.resetAt && bucketLimit.remaining <= 0) {
        delayMs = Math.max(delayMs, bucketLimit.resetAt - now);
      }
    }

    return delayMs;
  }
}
