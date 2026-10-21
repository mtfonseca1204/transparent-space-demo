export const DEMO_SPACE_SLUG = "demo";
export const DEMO_POOL_KEY_PREFIX = "demo-";

export function isDemoSpaceSlug(spaceSlug?: string | null): boolean {
  return spaceSlug === DEMO_SPACE_SLUG;
}

export function isDemoPoolKey(poolKey?: string | null): boolean {
  return Boolean(poolKey?.trim().toLowerCase().startsWith(DEMO_POOL_KEY_PREFIX));
}
