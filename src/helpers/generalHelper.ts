import { logger } from "./cliHelper";

/**
 * General utility functions for the AI News Aggregator.
 * This module provides common helper functions used across the application.
 * 
 * @module helpers
 */

export const MAX_RETRIES = 3;
export const RETRY_DELAY = 1000; // 1 second

export const time = {
  seconds: {
    day: 86400,
    hour: 3600,
    minute: 60,
    second: 1
  },
  milliseconds: {
    day: 86400000,
    hour: 3600000,
    minute: 60000,
    second: 1000,
    millisecond: 1
  }
}

/**
 * Creates a promise that resolves after a specified delay.
 * Useful for implementing rate limiting or adding delays between operations.
 * 
 * @param ms - The number of milliseconds to delay
 * @returns A promise that resolves after the specified delay
 */
export const delay = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Type guard to check if an object has a specific property
 * @param obj - Object to check
 * @param prop - Property name to check for
 * @returns True if object has the property
 */
export const hasProperty = (obj: any, prop: string): obj is Record<string, any> => {
  return obj !== null && typeof obj === 'object' && prop in obj;
};

/**
 * Safely parses JSON with type checking
 * @param jsonString - JSON string to parse
 * @param fallback - Fallback value if parsing fails
 * @returns Parsed object or fallback
 */
export const safeJsonParse = <T>(jsonString: string, fallback: T): T => {
  try {
    const result = JSON.parse(jsonString);
    return result !== null && typeof result === 'object' ? result : fallback;
  } catch {
    return fallback;
  }
};

/**
 * Type guard to check if value is a non-empty string
 * @param value - Value to check
 * @returns True if value is a non-empty string
 */
export const isNonEmptyString = (value: any): value is string => {
  return typeof value === 'string' && value.length > 0;
};

/**
 * Type guard to check if value is a valid array
 * @param value - Value to check
 * @returns True if value is an array
 */
export const isValidArray = (value: any): value is any[] => {
  return Array.isArray(value);
};

/**
 * Classifies Discord API errors as permanent or transient.
 * Inspired by discrawl's error handling — permanent errors (Missing Access,
 * Unknown Channel) should not be retried, while transient errors (rate limits,
 * server errors) should be retried with backoff.
 */
export function classifyDiscordError(error: unknown): { isPermanent: boolean; reason: string } {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  if (message.includes('missing access') || message.includes('missing permissions')) {
    return { isPermanent: true, reason: 'missing_access' };
  }
  if (message.includes('unknown channel')) {
    return { isPermanent: true, reason: 'unknown_channel' };
  }
  return { isPermanent: false, reason: message.slice(0, 120) };
}

/**
 * Returns true if the error is a permanent Discord API error that should not be retried.
 */
export function isPermanentDiscordError(error: unknown): boolean {
  return classifyDiscordError(error).isPermanent;
}

/**
 * Creates a generic Retry Operation that resolves until it is succesful.
 * Useful for hitting an outside API with exponential backing off.
 * Permanent Discord errors (Missing Access, Unknown Channel) are not retried.
 *
 * @param operation - Function to call until succesful
 * @param retries - Number of times to retry Function call
 * @returns A promise that is the operation response sent in
 */
export const retryOperation = async (operation: () => Promise<any>, retries = MAX_RETRIES): Promise<any> => {
    for (let i = 0; i < retries; i++) {
      try {
        return await operation();
      } catch (error) {
        const err = error as Error;
        // Don't retry permanent errors — saves API calls and time
        if (isPermanentDiscordError(error)) {
          throw error;
        }
        // Check for rate limiting errors specifically
        if (err.message.includes('rate limit') || err.message.includes('429')) {
          logger.warning(`Rate limit hit, waiting longer before retry...`);
          await delay(RETRY_DELAY * Math.pow(2, i)); // Exponential backoff
        } else if (i === retries - 1) {
          throw error;
        } else {
          logger.warning(`Operation failed, retrying in ${RETRY_DELAY}ms... ${err.message}`);
          await delay(RETRY_DELAY);
        }
      }
    }
    throw new Error('Operation failed after max retries');
  }

/**
 * Runs an async function over an array with bounded concurrency.
 * Uses a worker-pool pattern with index-based work stealing.
 */
export async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
  return results;
}
