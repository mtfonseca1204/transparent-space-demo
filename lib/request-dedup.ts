// =============================================================================
// Request Deduplication Layer
// Prevents duplicate in-flight requests to the same endpoint
// If the same request is made while one is still pending, return the existing promise
// =============================================================================

// Map of in-flight requests keyed by request signature
const inFlightRequests = new Map<string, Promise<unknown>>();

/**
 * Execute a request with deduplication
 * If an identical request is already in-flight, return the existing promise
 * @param key Unique key for this request (e.g., JSON.stringify of query + variables)
 * @param fetcher Function that performs the actual request
 * @returns Promise that resolves to the request result
 */
export async function deduplicatedRequest<T>(
  key: string,
  fetcher: () => Promise<T>
): Promise<T> {
  // Check if this request is already in-flight
  const existing = inFlightRequests.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  // Create new request and track it
  const promise = fetcher()
    .finally(() => {
      // Remove from in-flight map when done (success or error)
      inFlightRequests.delete(key);
    });

  inFlightRequests.set(key, promise);
  return promise;
}

/**
 * Build a cache key from a GraphQL query and variables
 * @param query GraphQL query string
 * @param variables Query variables
 * @returns Unique key for this query
 */
export function buildRequestKey(query: string, variables: Record<string, unknown>): string {
  // Normalize the query by removing extra whitespace
  const normalizedQuery = query.replace(/\s+/g, ' ').trim();
  return JSON.stringify({ q: normalizedQuery, v: variables });
}

/**
 * Check if a request is currently in-flight
 * @param key Request key
 * @returns true if request is in-flight
 */
export function isRequestInFlight(key: string): boolean {
  return inFlightRequests.has(key);
}

/**
 * Get count of in-flight requests (for debugging)
 */
export function getInFlightCount(): number {
  return inFlightRequests.size;
}

/**
 * Clear all in-flight requests (for testing/reset)
 */
export function clearInFlightRequests(): void {
  inFlightRequests.clear();
}
