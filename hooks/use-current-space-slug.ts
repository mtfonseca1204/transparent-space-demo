"use client";

import { useAuthStore } from "@/lib/auth-store";

export function useCurrentSpaceSlug(): string | null {
  const spaces = useAuthStore((state) => state.spaces);
  const currentSpaceId = useAuthStore((state) => state.currentSpaceId);
  return spaces.find((space) => space.id === currentSpaceId)?.slug ?? null;
}
