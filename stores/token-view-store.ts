import { create } from "zustand";
import { persist } from "zustand/middleware";

export type DashboardView =
  | { kind: "pool" }
  | { kind: "token"; symbol: string }
  | { kind: "rfq"; poolKey: string }
  | { kind: "rfq-cowswap"; asset: string }
  | { kind: "rfq-bebop"; asset: string }
  | { kind: "rfq-0x"; asset: string }
  | { kind: "rfq-1inch"; asset: string }
  | { kind: "rfq-jupz"; asset: string }
  | { kind: "birds-eye" };

export interface TokenViewState {
  selectedTokenSymbol: string | null;
  dashboardView: DashboardView;
  setSelectedToken: (symbol: string | null) => void;
  setRfqView: (poolKey: string) => void;
  setRfqCowswapView: (asset: string) => void;
  setRfqBebopView: (asset: string) => void;
  setRfq0xView: (asset: string) => void;
  setRfq1inchView: (asset: string) => void;
  setRfqJupzView: (asset: string) => void;
  clearRfqView: () => void;
  setBirdsEyeView: () => void;
  setViewState: (state: Pick<TokenViewState, "selectedTokenSymbol" | "dashboardView">) => void;
}

export const useTokenViewStore = create<TokenViewState>()(
  persist(
    (set) => ({
      selectedTokenSymbol: null,
      dashboardView: { kind: "birds-eye" } as DashboardView,
      setSelectedToken: (symbol) =>
        set({
          selectedTokenSymbol: symbol,
          dashboardView: symbol
            ? { kind: "token", symbol }
            : { kind: "pool" },
        }),
      setRfqView: (poolKey) =>
        set({
          selectedTokenSymbol: null,
          dashboardView: { kind: "rfq", poolKey },
        }),
      setRfqCowswapView: (asset) =>
        set({
          selectedTokenSymbol: null,
          dashboardView: { kind: "rfq-cowswap", asset },
        }),
      setRfqBebopView: (asset) =>
        set({
          selectedTokenSymbol: null,
          dashboardView: { kind: "rfq-bebop", asset },
        }),
      setRfq0xView: (asset) =>
        set({
          selectedTokenSymbol: null,
          dashboardView: { kind: "rfq-0x", asset },
        }),
      setRfq1inchView: (asset) =>
        set({
          selectedTokenSymbol: null,
          dashboardView: { kind: "rfq-1inch", asset },
        }),
      setRfqJupzView: (asset) =>
        set({
          selectedTokenSymbol: null,
          dashboardView: { kind: "rfq-jupz", asset },
        }),
      clearRfqView: () =>
        set({
          selectedTokenSymbol: null,
          dashboardView: { kind: "pool" },
        }),
      setBirdsEyeView: () =>
        set({
          selectedTokenSymbol: null,
          dashboardView: { kind: "birds-eye" },
        }),
      setViewState: (state) => set(state),
    }),
    {
      name: "token-view-store",
      version: 3,
      migrate: (persisted: unknown, version: number) => {
        if (version === 0) {
          const old = persisted as { selectedTokenSymbol?: string | null };
          return {
            selectedTokenSymbol: old.selectedTokenSymbol ?? null,
            dashboardView: { kind: "birds-eye" as const },
          };
        }
        if (version === 1) {
          const old = persisted as { selectedTokenSymbol?: string | null; dashboardView?: { kind?: string } };
          return {
            selectedTokenSymbol: old.selectedTokenSymbol ?? null,
            dashboardView: !old.dashboardView || old.dashboardView.kind === "pool" || old.dashboardView.kind === "qa"
              ? { kind: "birds-eye" as const }
              : (old.dashboardView as DashboardView),
          };
        }
        if (version === 2) {
          const old = persisted as { selectedTokenSymbol?: string | null; dashboardView?: { kind?: string } };
          return {
            selectedTokenSymbol: old.selectedTokenSymbol ?? null,
            dashboardView: old.dashboardView?.kind === "qa"
              ? { kind: "birds-eye" as const }
              : ((old.dashboardView as DashboardView) ?? { kind: "birds-eye" as const }),
          };
        }
        return persisted as TokenViewState;
      },
    }
  )
);
