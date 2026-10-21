/**
 * Binary-search: find the candle whose timestamp is <= evMs
 * (i.e. the bucket this event falls into).
 *
 * @param candleTimesMs – sorted array of candle timestamps in milliseconds
 * @param evMs – event timestamp in milliseconds
 * @returns the matching candle timestamp in ms, or -1 if before first candle
 */
export function findCandleBucket(
  candleTimesMs: number[],
  evMs: number
): number {
  let lo = 0;
  let hi = candleTimesMs.length - 1;
  if (hi < 0 || evMs < candleTimesMs[0]!) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (candleTimesMs[mid]! <= evMs) lo = mid;
    else hi = mid - 1;
  }
  return candleTimesMs[lo]!;
}
