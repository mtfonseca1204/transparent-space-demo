/**
 * Retry wrapper for GraphQL requests with exponential backoff
 * Handles 429 rate limit errors from legacy GraphQL indexers
 */

interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  initialDelay: 1000, // 1 second
  maxDelay: 10000, // 10 seconds
  backoffMultiplier: 2,
};

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if an error is a 429 rate limit error
 */
function isRateLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("429") ||
      message.includes("rate limit") ||
      message.includes("query allowance")
    );
  }
  return false;
}

/**
 * Retry a GraphQL request with exponential backoff
 * @param fn Function that makes the GraphQL request
 * @param options Retry configuration options
 * @returns Promise that resolves to the request result
 */
export async function retryGraphQLRequest<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;
  let delay = opts.initialDelay;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Only retry on rate limit errors
      if (!isRateLimitError(error)) {
        throw error;
      }

      // Don't retry if we've exhausted attempts
      if (attempt === opts.maxRetries) {
        throw error;
      }

      // Wait before retrying
      await sleep(delay);

      // Increase delay for next attempt (exponential backoff)
      delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelay);
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError;
}

/**
 * Request queue with concurrency limit to avoid rate limits
 * Allows multiple parallel requests while preventing bursts
 */
class RequestQueue {
  private queue: Array<() => Promise<void>> = [];
  private activeCount = 0;
  private maxConcurrent = resolveMaxConcurrent(); // Allow configurable request concurrency

  async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });

      this.process();
    });
  }

  private async process() {
    if (this.activeCount >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const task = this.queue.shift();
    if (!task) return;

    this.activeCount++;

    try {
      await task();
    } finally {
      this.activeCount--;
      // Immediately process next task if available
      this.process();
    }
  }
}

// Global request queue instance
export const graphqlQueue = new RequestQueue();

function resolveMaxConcurrent(): number {
  const raw =
    process.env.NEXT_PUBLIC_GRAPHQL_MAX_CONCURRENT ??
    process.env.GRAPHQL_MAX_CONCURRENT;
  const parsed = Number(raw);
  if (Number.isFinite(parsed)) {
    return Math.min(30, Math.max(1, Math.floor(parsed)));
  }
  return 10;
}
