// =============================================================================
// Sync State Manager
// Tracks last sync timestamps per query type for incremental fetching
// This enables fetching only new data since last sync instead of full refetch
// =============================================================================

interface SyncStateEntry {
  timestamp: number;  // Last successful sync timestamp (Unix seconds)
  updatedAt: number;  // When this entry was last updated (Date.now() ms)
}

// In-memory sync state (persists for session duration)
const syncState = new Map<string, SyncStateEntry>();

// TTL for sync state entries (clear if not accessed for 30 minutes)
const SYNC_STATE_TTL_MS = 30 * 60 * 1000;

/**
 * Get the last sync timestamp for a given key
 * @param key Unique identifier for the query type (e.g., "lpEvents-0x1234...")
 * @returns Last sync timestamp in Unix seconds, or 0 if never synced
 */
export function getLastSyncTime(key: string): number {
  const entry = syncState.get(key);
  if (!entry) return 0;
  
  // Check if entry has expired
  if (Date.now() - entry.updatedAt > SYNC_STATE_TTL_MS) {
    syncState.delete(key);
    return 0;
  }
  
  return entry.timestamp;
}

/**
 * Set the last sync timestamp for a given key
 * @param key Unique identifier for the query type
 * @param timestamp Unix timestamp in seconds of the latest synced data
 */
export function setLastSyncTime(key: string, timestamp: number): void {
  syncState.set(key, {
    timestamp,
    updatedAt: Date.now(),
  });
}

/**
 * Clear sync state for a specific key
 * @param key Unique identifier to clear
 */
export function clearSyncState(key: string): void {
  syncState.delete(key);
}

/**
 * Clear all sync state (e.g., when switching pools)
 */
export function clearAllSyncState(): void {
  syncState.clear();
}

/**
 * Get all sync state keys (for debugging)
 */
export function getSyncStateKeys(): string[] {
  return Array.from(syncState.keys());
}

/**
 * Prune expired entries from sync state
 * Called periodically to prevent memory growth
 */
export function pruneSyncState(): void {
  const now = Date.now();
  for (const [key, entry] of syncState.entries()) {
    if (now - entry.updatedAt > SYNC_STATE_TTL_MS) {
      syncState.delete(key);
    }
  }
}

/**
 * Build a sync state key for a specific query type and pool
 * @param queryType Type of query (e.g., "batchedPoolData", "candles", "lpSwaps")
 * @param pool Pool address
 * @param timeRange Time range identifier (e.g., "1h", "1d", "1w")
 */
export function buildSyncKey(queryType: string, pool: string, timeRange?: string): string {
  const parts = [queryType, pool.toLowerCase()];
  if (timeRange) parts.push(timeRange);
  return parts.join('-');
}

/**
 * Calculate the fetch start time for incremental sync
 * @param originalStartTime The original start time of the query window
 * @param lastSyncTime The last successful sync timestamp
 * @param minDeltaSeconds Minimum time delta to consider for incremental (default 60s)
 * @returns The start time to use for the fetch
 */
export function calculateIncrementalStart(
  originalStartTime: number,
  lastSyncTime: number,
  minDeltaSeconds: number = 60
): { startTime: number; isIncremental: boolean } {
  // If no previous sync, use original start time
  if (lastSyncTime === 0) {
    return { startTime: originalStartTime, isIncremental: false };
  }
  
  // If last sync is before original start, use original start
  if (lastSyncTime <= originalStartTime) {
    return { startTime: originalStartTime, isIncremental: false };
  }
  
  // Only use incremental if the delta is significant
  const delta = lastSyncTime - originalStartTime;
  if (delta < minDeltaSeconds) {
    return { startTime: originalStartTime, isIncremental: false };
  }
  
  // Use last sync time for incremental fetch
  return { startTime: lastSyncTime, isIncremental: true };
}
