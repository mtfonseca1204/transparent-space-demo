import { cn } from "@/lib/utils";

export function sidebarAssetRowClass(isActive: boolean, isDemoShowcase: boolean): string {
  return cn(
    "flex items-stretch w-full transition-colors font-mono",
    isActive
      ? isDemoShowcase
        ? "bg-[var(--bp-accent-primary)] text-[var(--ts-ink-inv)]"
        : "bg-[var(--ts-ink-0)] text-[var(--ts-ink-inv)]"
      : "text-[var(--ts-ink-1)] hover:bg-[var(--ts-surface-3)]",
  );
}

export function sidebarNavRowClass(isActive: boolean, isDemoShowcase: boolean): string {
  return cn(
    "flex items-center w-full gap-2.5 px-4 py-1.5",
    "font-mono text-[12px] font-medium tracking-[0.02em] text-left transition-colors",
    isActive
      ? isDemoShowcase
        ? "text-[var(--bp-accent-primary)] bg-[rgba(31,71,220,0.08)]"
        : "text-[var(--ts-ink-0)] bg-[rgba(10,9,6,0.06)]"
      : isDemoShowcase
        ? "text-[var(--ts-ink-1)] hover:bg-[rgba(31,71,220,0.05)] hover:text-[var(--bp-accent-primary)]"
        : "text-[var(--ts-ink-1)] hover:bg-[rgba(10,9,6,0.03)] hover:text-[var(--ts-ink-0)]",
  );
}

export function sidebarTreeItemClass(isActive: boolean, isDemoShowcase: boolean): string {
  return cn(
    "relative flex items-center w-full cursor-pointer transition-colors text-left font-mono",
    isActive
      ? isDemoShowcase
        ? "bg-[var(--bp-accent-primary)] text-[var(--ts-ink-inv)]"
        : "bg-[var(--ts-ink-0)] text-[var(--ts-ink-inv)]"
      : isDemoShowcase
        ? "text-[var(--ts-ink-2)] hover:bg-[rgba(31,71,220,0.05)]"
        : "text-[var(--ts-ink-2)] hover:bg-[var(--ts-surface-2)]",
  );
}

export function sidebarCollapsedGlyphClass(isActive: boolean, isDemoShowcase: boolean): string {
  return cn(
    "relative flex items-center justify-center w-full py-1 px-2 cursor-pointer transition-colors",
    isActive
      ? isDemoShowcase
        ? "text-[var(--bp-accent-primary)] bg-[rgba(31,71,220,0.08)]"
        : "text-[var(--ts-ink-0)] bg-[var(--ts-surface-3)]"
      : "text-[var(--ts-ink-3)] hover:bg-[var(--ts-surface-3)]",
  );
}
