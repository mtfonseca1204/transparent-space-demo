const chartSkeletons = [
  "bp-skeleton-line",
  "bp-skeleton-bars",
  "bp-skeleton-line",
  "bp-skeleton-bars",
];

export function DashboardRouteSkeleton() {
  return (
    <div className="bp-grid-background min-h-screen">
      <aside className="hidden md:flex fixed inset-y-0 left-0 z-20 w-[287px] flex-col border-r border-[var(--ts-line)] bg-[var(--ts-surface)]/85">
        <div className="px-5 py-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 bp-skeleton rounded" />
            <div className="space-y-2">
              <div className="h-4 w-32 bp-skeleton-pulse rounded" />
              <div className="h-3 w-20 bp-skeleton-pulse rounded" />
            </div>
          </div>
          <div className="h-10 w-full bp-skeleton-pulse rounded" />
        </div>
        <div className="border-t border-[var(--ts-line-soft)] px-5 py-4 space-y-3">
          <div className="h-4 w-36 bp-skeleton-pulse rounded" />
          <div className="h-4 w-28 bp-skeleton-pulse rounded" />
        </div>
        <div className="border-t border-[var(--ts-line-soft)] px-4 py-5 space-y-3">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="flex items-center gap-3">
              <div className="h-7 w-7 bp-skeleton rounded-full" />
              <div className="h-4 flex-1 bp-skeleton-pulse rounded" />
            </div>
          ))}
        </div>
      </aside>

      <main className="min-h-screen border-l border-[var(--ts-line)] md:ml-[287px]">
        <div className="dashboard-canvas min-h-screen p-4 md:p-6">
          <div className="mb-6 flex items-center gap-4">
            <div className="h-12 w-12 bp-skeleton rounded-full" />
            <div className="space-y-2">
              <div className="h-5 w-56 bp-skeleton-pulse rounded" />
              <div className="h-3 w-40 bp-skeleton-pulse rounded" />
            </div>
          </div>

          <div className="grid grid-cols-1 border border-[var(--ts-line)] bg-[var(--ts-surface)]/60 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="min-h-[128px] border-b border-[var(--ts-line-soft)] p-5 sm:border-r xl:border-b-0"
              >
                <div className="h-3 w-24 bp-skeleton-pulse rounded" />
                <div className="mt-8 h-8 w-28 bp-skeleton-pulse rounded" />
                <div className="mt-5 h-3 w-16 bp-skeleton-pulse rounded" />
              </div>
            ))}
          </div>

          <div className="mt-6 flex gap-5 border-b border-[var(--ts-line)] pb-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="h-4 w-24 bp-skeleton-pulse rounded" />
            ))}
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {chartSkeletons.map((variant, index) => (
              <div
                key={index}
                className="ts-panel min-h-[300px] border border-[var(--ts-line)] bg-[var(--ts-surface)]/60"
              >
                <div className="ts-panel-head">
                  <div className="h-4 w-40 bp-skeleton-pulse rounded" />
                </div>
                <div className="ts-panel-body">
                  <div className={variant} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
