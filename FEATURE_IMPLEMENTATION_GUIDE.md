# Feature Implementation Guide - New Chart Features

**Date**: 2025-12-16
**Project**: Transparent Space Frontend
**Related**: See REQUIREMENTS_ANALYSIS.md in indexer project

---

## Table of Contents
1. [Feature 1: Toggleable Chart Elements](#feature-1-toggleable-chart-elements)
2. [Feature 2: $10k Depth Area Chart](#feature-2-10k-depth-area-chart)
3. [Feature 3: Price Oracle Integration](#feature-3-price-oracle-integration)
4. [Testing & Validation](#testing--validation)

---

## Feature 1: Toggleable Chart Elements

### Overview
Allow users to show/hide individual chart overlays in the LP Activity Chart:
- Oracle price band (purple area)
- Depth visualization (bid/ask areas)
- Oracle line (purple line)
- Position ranges (gray rectangles)
- Bid/Ask depth lines

### Current File Structure
```
stores/
  chart-settings-store.ts          # Global settings with Zustand
components/dashboard/
  chart-settings-fab.tsx            # Settings modal UI
  lp-address-activity.tsx           # Main chart with overlays
```

### Implementation Steps

#### Step 1: Extend Settings Store
**File**: `stores/chart-settings-store.ts`

Add new settings section:
```typescript
interface ChartSettingsStore {
  // ... existing settings ...

  // NEW: Chart visibility controls
  chartVisibility: {
    oracleBand: boolean;
    oracleLine: boolean;
    depthAreas: boolean;
    positionRanges: boolean;
    bidAskLines: boolean;
    candlesticks: boolean;
  };

  // NEW: Actions
  toggleChartElement: (element: keyof ChartSettingsStore['chartVisibility']) => void;
  setChartVisibility: (visibility: Partial<ChartSettingsStore['chartVisibility']>) => void;
  resetChartVisibility: () => void;
}

const DEFAULT_CHART_VISIBILITY = {
  oracleBand: true,
  oracleLine: true,
  depthAreas: true,
  positionRanges: true,
  bidAskLines: true,
  candlesticks: true,
};

export const useChartSettings = create<ChartSettingsStore>()(
  persist(
    (set) => ({
      // ... existing state ...
      chartVisibility: DEFAULT_CHART_VISIBILITY,

      toggleChartElement: (element) =>
        set((state) => ({
          chartVisibility: {
            ...state.chartVisibility,
            [element]: !state.chartVisibility[element],
          },
        })),

      setChartVisibility: (visibility) =>
        set((state) => ({
          chartVisibility: {
            ...state.chartVisibility,
            ...visibility,
          },
        })),

      resetChartVisibility: () =>
        set({ chartVisibility: DEFAULT_CHART_VISIBILITY }),
    }),
    {
      name: 'chart-settings',
    }
  )
);
```

#### Step 2: Add Toggle UI
**File**: `components/dashboard/chart-settings-fab.tsx`

Add new section to settings modal:
```typescript
export function ChartSettingsFab() {
  const { chartVisibility, toggleChartElement, resetChartVisibility } = useChartSettings();

  return (
    <Dialog>
      {/* ... existing content ... */}

      {/* NEW SECTION */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Chart Visibility</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={resetChartVisibility}
            className="h-7 text-xs"
          >
            Reset
          </Button>
        </div>

        <div className="space-y-2">
          <ToggleRow
            label="Oracle Price Band"
            description="Purple area showing ±X% from oracle price"
            checked={chartVisibility.oracleBand}
            onCheckedChange={() => toggleChartElement('oracleBand')}
          />

          <ToggleRow
            label="Oracle Line"
            description="Purple line showing oracle price"
            checked={chartVisibility.oracleLine}
            onCheckedChange={() => toggleChartElement('oracleLine')}
          />

          <ToggleRow
            label="Depth Areas"
            description="Bid/ask depth visualization"
            checked={chartVisibility.depthAreas}
            onCheckedChange={() => toggleChartElement('depthAreas')}
          />

          <ToggleRow
            label="Position Ranges"
            description="Gray rectangles showing LP positions"
            checked={chartVisibility.positionRanges}
            onCheckedChange={() => toggleChartElement('positionRanges')}
          />

          <ToggleRow
            label="Bid/Ask Lines"
            description="Green/red lines showing market depth"
            checked={chartVisibility.bidAskLines}
            onCheckedChange={() => toggleChartElement('bidAskLines')}
          />

          <ToggleRow
            label="Candlesticks"
            description="OHLC price candles"
            checked={chartVisibility.candlesticks}
            onCheckedChange={() => toggleChartElement('candlesticks')}
          />
        </div>
      </div>
    </Dialog>
  );
}

// Helper component
function ToggleRow({ label, description, checked, onCheckedChange }: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between space-x-2">
      <div className="flex-1">
        <label className="text-sm font-medium leading-none">{label}</label>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
```

#### Step 3: Update Chart Component
**File**: `components/dashboard/lp-address-activity.tsx`

Add conditional rendering:
```typescript
export function LpAddressActivityChart({ lpAddress, poolAddress }: Props) {
  const { chartVisibility } = useChartSettings();

  // ... existing code ...

  return (
    <svg width={width} height={height}>
      {/* Candlesticks - conditionally render */}
      {chartVisibility.candlesticks && (
        <Group top={focusMargin.top} left={focusMargin.left}>
          {focusOhlc.map((d, i) => (
            <CandlestickBar key={i} {...d} />
          ))}
        </Group>
      )}

      {/* Oracle Band - conditionally render */}
      {chartVisibility.oracleBand && oracleBand && (
        <AreaClosed
          data={focusOhlc}
          x={(d) => focusXScale(d.timestamp) ?? 0}
          y0={(d) => focusYScale(oracleBand.lower) ?? 0}
          y1={(d) => focusYScale(oracleBand.upper) ?? 0}
          fill="url(#oracle-gradient)"
          opacity={0.15}
        />
      )}

      {/* Oracle Line - conditionally render */}
      {chartVisibility.oracleLine && (
        <LinePath
          data={oracleData}
          x={(d) => focusXScale(d.timestamp) ?? 0}
          y={(d) => focusYScale(d.price) ?? 0}
          stroke="#a855f7"
          strokeWidth={1.5}
          strokeDasharray="4,4"
        />
      )}

      {/* Depth Areas - conditionally render */}
      {chartVisibility.depthAreas && (
        <>
          <AreaClosed
            data={focusOhlc}
            x={(d) => focusXScale(d.timestamp) ?? 0}
            y0={(d) => focusYScale(d.bidDepth) ?? 0}
            y1={(d) => focusYScale(d.close) ?? 0}
            fill="#22c55e"
            opacity={0.2}
          />
          <AreaClosed
            data={focusOhlc}
            x={(d) => focusXScale(d.timestamp) ?? 0}
            y0={(d) => focusYScale(d.close) ?? 0}
            y1={(d) => focusYScale(d.askDepth) ?? 0}
            fill="#ef4444"
            opacity={0.2}
          />
        </>
      )}

      {/* Position Ranges - conditionally render */}
      {chartVisibility.positionRanges && positions?.map((pos) => (
        <rect
          key={pos.id}
          x={focusMargin.left}
          y={focusYScale(pos.upperPrice)}
          width={focusWidth}
          height={focusYScale(pos.lowerPrice) - focusYScale(pos.upperPrice)}
          fill="gray"
          opacity={0.1}
          stroke="gray"
          strokeWidth={1}
        />
      ))}

      {/* Bid/Ask Lines - conditionally render */}
      {chartVisibility.bidAskLines && (
        <>
          <LinePath
            data={focusOhlc}
            x={(d) => focusXScale(d.timestamp) ?? 0}
            y={(d) => focusYScale(d.bidDepth) ?? 0}
            stroke="#22c55e"
            strokeWidth={1}
          />
          <LinePath
            data={focusOhlc}
            x={(d) => focusXScale(d.timestamp) ?? 0}
            y={(d) => focusYScale(d.askDepth) ?? 0}
            stroke="#ef4444"
            strokeWidth={1}
          />
        </>
      )}
    </svg>
  );
}
```

### Testing Checklist
- [ ] All toggles work independently
- [ ] Settings persist after page refresh
- [ ] Reset button restores defaults
- [ ] Chart scales correctly with hidden elements
- [ ] No errors when all elements hidden
- [ ] Tooltip still works with hidden elements

---

## Feature 2: $10k Depth Area Chart

### Overview
Replace the ±5% oracle price band with a dynamic area chart showing the price range where you could execute a $10k buy or sell order.

### Architecture Decision: Depth Calculation Location

**Option A: Client-side calculation** ✅ Recommended
- Pro: No indexer changes, works immediately
- Pro: Can adjust amount dynamically ($5k, $10k, $50k)
- Con: More frontend computation

**Option B: Indexer pre-computation**
- Pro: Faster frontend
- Pro: Historical depth data available
- Con: Requires indexer deployment
- Con: Less flexible (fixed amounts)

We'll implement **Option A** first, with Option B as future optimization.

### Data Structures

```typescript
// New types
interface DepthBand {
  timestamp: Date;
  buyPrice: number;    // Max price after buying $10k
  sellPrice: number;   // Min price after selling $10k
}

interface DepthCalculationConfig {
  swapAmountUSD: number;      // Default: 10000
  baseTokenIsUSD: boolean;    // If token1 is USD-stable
  token0PriceUSD?: number;    // Optional: token0 price from oracle
  token1PriceUSD?: number;    // Optional: token1 price from oracle
}
```

### Implementation Steps

#### Step 1: Create Depth Calculation Utility
**New File**: `lib/depth-calculator.ts`

```typescript
import { TickLiquidityData } from '@/hooks/use-tick-liquidity';

/**
 * Calculates price impact and final price for a given swap amount
 * through the tick liquidity distribution.
 *
 * Based on Uniswap V3 math: https://uniswap.org/whitepaper-v3.pdf
 */
export class DepthCalculator {
  private tickLiquidity: TickLiquidityData[];
  private currentTick: number;
  private currentSqrtPriceX96: bigint;
  private token0Decimals: number;
  private token1Decimals: number;

  constructor(
    tickLiquidity: TickLiquidityData[],
    currentTick: number,
    currentSqrtPriceX96: bigint,
    token0Decimals: number,
    token1Decimals: number
  ) {
    this.tickLiquidity = tickLiquidity.sort((a, b) => a.tick - b.tick);
    this.currentTick = currentTick;
    this.currentSqrtPriceX96 = currentSqrtPriceX96;
    this.token0Decimals = token0Decimals;
    this.token1Decimals = token1Decimals;
  }

  /**
   * Calculate final price after buying amountUSD worth of token0
   * (selling token1)
   */
  calculateBuyDepth(amountUSD: number, token1IsUSD: boolean = true): number {
    // Convert USD to token amount
    const currentPrice = this.sqrtPriceX96ToPrice(this.currentSqrtPriceX96);
    const amountToken1 = token1IsUSD
      ? amountUSD
      : amountUSD / currentPrice;

    return this.simulateSwap(
      BigInt(Math.floor(amountToken1 * 10 ** this.token1Decimals)),
      false // selling token1 -> buying token0
    );
  }

  /**
   * Calculate final price after selling amountUSD worth of token0
   * (buying token1)
   */
  calculateSellDepth(amountUSD: number, token1IsUSD: boolean = true): number {
    const currentPrice = this.sqrtPriceX96ToPrice(this.currentSqrtPriceX96);
    const amountToken0 = token1IsUSD
      ? amountUSD / currentPrice
      : amountUSD;

    return this.simulateSwap(
      BigInt(Math.floor(amountToken0 * 10 ** this.token0Decimals)),
      true // selling token0 -> buying token1
    );
  }

  /**
   * Simulate swap through tick liquidity
   * Returns final price (token1 per token0)
   */
  private simulateSwap(
    amountIn: bigint,
    zeroForOne: boolean
  ): number {
    let amountRemaining = amountIn;
    let currentSqrtPrice = this.currentSqrtPriceX96;
    let currentTick = this.currentTick;

    // Get relevant ticks
    const ticks = zeroForOne
      ? this.tickLiquidity.filter((t) => t.tick <= currentTick).reverse()
      : this.tickLiquidity.filter((t) => t.tick >= currentTick);

    for (const tickData of ticks) {
      if (amountRemaining === 0n) break;

      // Get liquidity in this tick range
      const liquidity = BigInt(tickData.liquidityGross);
      if (liquidity === 0n) continue;

      // Calculate how much we can swap in this tick
      const nextSqrtPrice = this.getSqrtRatioAtTick(tickData.tick);
      const maxAmountIn = this.getAmountInForSqrtPriceMove(
        currentSqrtPrice,
        nextSqrtPrice,
        liquidity,
        zeroForOne
      );

      if (maxAmountIn >= amountRemaining) {
        // We can complete the swap in this tick
        currentSqrtPrice = this.getNextSqrtPrice(
          currentSqrtPrice,
          liquidity,
          amountRemaining,
          zeroForOne
        );
        amountRemaining = 0n;
      } else {
        // Move to next tick
        amountRemaining -= maxAmountIn;
        currentSqrtPrice = nextSqrtPrice;
        currentTick = zeroForOne ? tickData.tick - 1 : tickData.tick + 1;
      }
    }

    // Convert final sqrtPrice to actual price
    return this.sqrtPriceX96ToPrice(currentSqrtPrice);
  }

  // Uniswap V3 Math Helpers

  private sqrtPriceX96ToPrice(sqrtPriceX96: bigint): number {
    const Q96 = 2n ** 96n;
    const price = Number(sqrtPriceX96) / Number(Q96);
    const priceSquared = price * price;
    const decimalAdjustment = 10 ** (this.token1Decimals - this.token0Decimals);
    return priceSquared * decimalAdjustment;
  }

  private getSqrtRatioAtTick(tick: number): bigint {
    // Ported from @uniswap/v3-sdk
    const absTick = Math.abs(tick);

    let ratio = (absTick & 0x1) !== 0
      ? BigInt('0xfffcb933bd6fad37aa2d162d1a594001')
      : BigInt('0x100000000000000000000000000000000');

    if ((absTick & 0x2) !== 0) ratio = (ratio * BigInt('0xfff97272373d413259a46990580e213a')) >> 128n;
    if ((absTick & 0x4) !== 0) ratio = (ratio * BigInt('0xfff2e50f5f656932ef12357cf3c7fdcc')) >> 128n;
    if ((absTick & 0x8) !== 0) ratio = (ratio * BigInt('0xffe5caca7e10e4e61c3624eaa0941cd0')) >> 128n;
    if ((absTick & 0x10) !== 0) ratio = (ratio * BigInt('0xffcb9843d60f6159c9db58835c926644')) >> 128n;
    if ((absTick & 0x20) !== 0) ratio = (ratio * BigInt('0xff973b41fa98c081472e6896dfb254c0')) >> 128n;
    if ((absTick & 0x40) !== 0) ratio = (ratio * BigInt('0xff2ea16466c96a3843ec78b326b52861')) >> 128n;
    if ((absTick & 0x80) !== 0) ratio = (ratio * BigInt('0xfe5dee046a99a2a811c461f1969c3053')) >> 128n;
    if ((absTick & 0x100) !== 0) ratio = (ratio * BigInt('0xfcbe86c7900a88aedcffc83b479aa3a4')) >> 128n;
    if ((absTick & 0x200) !== 0) ratio = (ratio * BigInt('0xf987a7253ac413176f2b074cf7815e54')) >> 128n;
    if ((absTick & 0x400) !== 0) ratio = (ratio * BigInt('0xf3392b0822b70005940c7a398e4b70f3')) >> 128n;
    if ((absTick & 0x800) !== 0) ratio = (ratio * BigInt('0xe7159475a2c29b7443b29c7fa6e889d9')) >> 128n;
    if ((absTick & 0x1000) !== 0) ratio = (ratio * BigInt('0xd097f3bdfd2022b8845ad8f792aa5825')) >> 128n;
    if ((absTick & 0x2000) !== 0) ratio = (ratio * BigInt('0xa9f746462d870fdf8a65dc1f90e061e5')) >> 128n;
    if ((absTick & 0x4000) !== 0) ratio = (ratio * BigInt('0x70d869a156d2a1b890bb3df62baf32f7')) >> 128n;
    if ((absTick & 0x8000) !== 0) ratio = (ratio * BigInt('0x31be135f97d08fd981231505542fcfa6')) >> 128n;
    if ((absTick & 0x10000) !== 0) ratio = (ratio * BigInt('0x9aa508b5b7a84e1c677de54f3e99bc9')) >> 128n;
    if ((absTick & 0x20000) !== 0) ratio = (ratio * BigInt('0x5d6af8dedb81196699c329225ee604')) >> 128n;
    if ((absTick & 0x40000) !== 0) ratio = (ratio * BigInt('0x2216e584f5fa1ea926041bedfe98')) >> 128n;
    if ((absTick & 0x80000) !== 0) ratio = (ratio * BigInt('0x48a170391f7dc42444e8fa2')) >> 128n;

    if (tick > 0) ratio = (2n ** 256n - 1n) / ratio;

    return ratio >> 32n;
  }

  private getAmountInForSqrtPriceMove(
    sqrtPriceA: bigint,
    sqrtPriceB: bigint,
    liquidity: bigint,
    zeroForOne: boolean
  ): bigint {
    if (zeroForOne) {
      // Selling token0, amount is in token0
      return (liquidity * (sqrtPriceA - sqrtPriceB)) / (sqrtPriceA * sqrtPriceB / (2n ** 96n));
    } else {
      // Selling token1, amount is in token1
      return (liquidity * (sqrtPriceB - sqrtPriceA)) / (2n ** 96n);
    }
  }

  private getNextSqrtPrice(
    sqrtPrice: bigint,
    liquidity: bigint,
    amountIn: bigint,
    zeroForOne: boolean
  ): bigint {
    if (zeroForOne) {
      const product = amountIn * sqrtPrice;
      const denominator = liquidity * (2n ** 96n) + product;
      return (liquidity * sqrtPrice * (2n ** 96n)) / denominator;
    } else {
      return sqrtPrice + (amountIn * (2n ** 96n)) / liquidity;
    }
  }
}

/**
 * Calculate depth band for entire time series
 */
export function calculateDepthBands(
  ohlcData: OHLCDataPoint[],
  tickLiquidity: TickLiquidityData[],
  poolData: PoolData,
  config: DepthCalculationConfig
): DepthBand[] {
  const calculator = new DepthCalculator(
    tickLiquidity,
    poolData.tick,
    poolData.sqrtPriceX96,
    poolData.token0Decimals,
    poolData.token1Decimals
  );

  return ohlcData.map((ohlc) => {
    const buyPrice = calculator.calculateBuyDepth(
      config.swapAmountUSD,
      config.baseTokenIsUSD
    );
    const sellPrice = calculator.calculateSellDepth(
      config.swapAmountUSD,
      config.baseTokenIsUSD
    );

    return {
      timestamp: ohlc.timestamp,
      buyPrice,
      sellPrice,
    };
  });
}
```

#### Step 2: Add Depth Band to Settings Store
**File**: `stores/chart-settings-store.ts`

```typescript
interface ChartSettingsStore {
  // ... existing ...

  // NEW: Depth band configuration
  depthBandConfig: {
    enabled: boolean;
    swapAmountUSD: number;
    showAsReplacement: boolean;  // Replace oracle band vs. show both
  };

  setDepthBandConfig: (config: Partial<ChartSettingsStore['depthBandConfig']>) => void;
}

const DEFAULT_DEPTH_BAND_CONFIG = {
  enabled: false,
  swapAmountUSD: 10000,  // Default: $10,000 USD (user customizable)
  showAsReplacement: true,
};
```

#### Step 3: Update Chart Component
**File**: `components/dashboard/lp-address-activity.tsx`

```typescript
import { DepthCalculator, calculateDepthBands } from '@/lib/depth-calculator';

export function LpAddressActivityChart({ lpAddress, poolAddress }: Props) {
  const { depthBandConfig, chartVisibility } = useChartSettings();
  const { data: tickLiquidity } = useTickLiquidity(poolAddress);
  const { data: poolData } = usePoolData(poolAddress);

  // Calculate depth bands
  const depthBands = useMemo(() => {
    if (!depthBandConfig.enabled || !tickLiquidity || !poolData) {
      return null;
    }

    return calculateDepthBands(focusOhlc, tickLiquidity, poolData, {
      swapAmountUSD: depthBandConfig.swapAmountUSD,
      baseTokenIsUSD: true, // TODO: detect if token1 is USD-stable
    });
  }, [depthBandConfig, tickLiquidity, poolData, focusOhlc]);

  // Determine which band to show
  const showOracleBand = chartVisibility.oracleBand &&
    (!depthBandConfig.enabled || !depthBandConfig.showAsReplacement);
  const showDepthBand = depthBandConfig.enabled && depthBands;

  return (
    <svg width={width} height={height}>
      {/* Oracle Band - conditional */}
      {showOracleBand && oracleBand && (
        <AreaClosed
          data={focusOhlc}
          x={(d) => focusXScale(d.timestamp) ?? 0}
          y0={(d) => focusYScale(oracleBand.lower) ?? 0}
          y1={(d) => focusYScale(oracleBand.upper) ?? 0}
          fill="url(#oracle-gradient)"
          opacity={0.15}
        />
      )}

      {/* NEW: Depth Band */}
      {showDepthBand && (
        <AreaClosed
          data={depthBands}
          x={(d) => focusXScale(d.timestamp) ?? 0}
          y0={(d) => focusYScale(d.sellPrice) ?? 0}
          y1={(d) => focusYScale(d.buyPrice) ?? 0}
          fill="url(#depth-band-gradient)"
          opacity={0.25}
        />
      )}

      {/* Gradient definition */}
      <defs>
        <linearGradient id="depth-band-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fbbf24" stopOpacity={0.8} />
          <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.8} />
        </linearGradient>
      </defs>

      {/* Legend */}
      {showDepthBand && (
        <text x={10} y={20} className="text-xs fill-yellow-500">
          ${(depthBandConfig.swapAmountUSD / 1000).toFixed(0)}k Depth Band
        </text>
      )}
    </svg>
  );
}
```

#### Step 4: Add UI Controls
**File**: `components/dashboard/chart-settings-fab.tsx`

```typescript
<div className="space-y-3">
  <h3 className="text-sm font-medium">Depth Visualization</h3>

  <div className="space-y-2">
    <div className="flex items-center justify-between">
      <label className="text-sm">Enable Depth Band</label>
      <Switch
        checked={depthBandConfig.enabled}
        onCheckedChange={(enabled) =>
          setDepthBandConfig({ enabled })
        }
      />
    </div>

    {depthBandConfig.enabled && (
      <>
        <div className="space-y-1">
          <label className="text-sm">Swap Amount (USD)</label>
          <Input
            type="number"
            value={depthBandConfig.swapAmountUSD}
            onChange={(e) =>
              setDepthBandConfig({
                swapAmountUSD: Number(e.target.value)
              })
            }
            min={1000}
            max={1000000}
            step={1000}
          />
          <p className="text-xs text-muted-foreground">
            Shows price range for swapping this amount
          </p>
        </div>

        <div className="flex items-center justify-between">
          <label className="text-sm">Replace Oracle Band</label>
          <Switch
            checked={depthBandConfig.showAsReplacement}
            onCheckedChange={(showAsReplacement) =>
              setDepthBandConfig({ showAsReplacement })
            }
          />
        </div>
      </>
    )}
  </div>
</div>
```

### Performance Optimization

The depth calculation is computationally expensive. Optimize with:

1. **Memoization**: Only recalculate when inputs change
2. **Web Worker**: Move calculation off main thread
3. **Throttling**: Limit recalculation frequency
4. **Caching**: Cache results per time window

**Example Web Worker** (optional):
```typescript
// workers/depth-calculator.worker.ts
import { DepthCalculator } from '@/lib/depth-calculator';

self.onmessage = (e) => {
  const { tickLiquidity, poolData, ohlcData, config } = e.data;

  const calculator = new DepthCalculator(
    tickLiquidity,
    poolData.tick,
    poolData.sqrtPriceX96,
    poolData.token0Decimals,
    poolData.token1Decimals
  );

  const depthBands = ohlcData.map((ohlc) => ({
    timestamp: ohlc.timestamp,
    buyPrice: calculator.calculateBuyDepth(config.swapAmountUSD, true),
    sellPrice: calculator.calculateSellDepth(config.swapAmountUSD, true),
  }));

  self.postMessage({ depthBands });
};
```

---

## Feature 3: Price Oracle Integration

### Overview
To accurately convert $10k USD to token amounts, we need real-time token prices.

### Oracle Options Comparison

| Provider | Pros | Cons | Cost |
|----------|------|------|------|
| **CoinGecko API** | Free tier, simple, reliable | Rate limits (50 calls/min free) | Free - $129/mo |
| **Chainlink** | On-chain, decentralized, accurate | Requires contract calls, gas costs | Self-hosted (gas only) |
| **Uniswap TWAP** | Free, always available | Less accurate during volatility | Free |
| **DeFi Llama** | Aggregated, good coverage | Less real-time | Free |

**Recommendation**: Start with **CoinGecko** (simple, free), add **Chainlink** for production.

### Implementation Steps

#### Step 1: Create Oracle Service
**New File**: `lib/price-oracle.ts`

```typescript
import { createClient } from '@/lib/envio-client';

interface TokenPrice {
  address: string;
  priceUSD: number;
  timestamp: number;
}

class PriceOracle {
  private cache = new Map<string, TokenPrice>();
  private cacheTTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Get token price in USD
   */
  async getTokenPriceUSD(tokenAddress: string): Promise<number | null> {
    // Check cache
    const cached = this.cache.get(tokenAddress.toLowerCase());
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.priceUSD;
    }

    // Try CoinGecko
    try {
      const price = await this.fetchFromCoinGecko(tokenAddress);
      if (price) {
        this.cache.set(tokenAddress.toLowerCase(), {
          address: tokenAddress,
          priceUSD: price,
          timestamp: Date.now(),
        });
        return price;
      }
    } catch (error) {
      console.warn('CoinGecko price fetch failed', error);
    }

    // Fallback: Try to derive from pool
    try {
      const price = await this.deriveFromPool(tokenAddress);
      if (price) {
        this.cache.set(tokenAddress.toLowerCase(), {
          address: tokenAddress,
          priceUSD: price,
          timestamp: Date.now(),
        });
        return price;
      }
    } catch (error) {
      console.warn('Pool-derived price failed', error);
    }

    return null;
  }

  private async fetchFromCoinGecko(tokenAddress: string): Promise<number | null> {
    // CoinGecko API endpoint for token price
    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/token_price/world-chain?contract_addresses=${tokenAddress}&vs_currencies=usd`,
      {
        headers: {
          'Accept': 'application/json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status}`);
    }

    const data = await response.json();
    return data[tokenAddress.toLowerCase()]?.usd ?? null;
  }

  private async deriveFromPool(tokenAddress: string): Promise<number | null> {
    // Find pools where this token is paired with known USD-stable token
    const KNOWN_USD_TOKENS = [
      '0x...', // USDC on World Chain
      '0x...', // USDT on World Chain
      '0x...', // DAI on World Chain
    ];

    // Query pool with this token + USD token
    // Get current price from sqrtPriceX96
    // Return calculated price

    // TODO: Implement pool query logic
    return null;
  }

  /**
   * Detect if token is USD-stable
   */
  isUSDStable(tokenAddress: string): boolean {
    const USD_STABLES = new Set([
      '0x...', // USDC
      '0x...', // USDT
      '0x...', // DAI
      '0x...', // ARS (if pegged)
    ].map(addr => addr.toLowerCase()));

    return USD_STABLES.has(tokenAddress.toLowerCase());
  }

  /**
   * Clear cache (for testing or forced refresh)
   */
  clearCache() {
    this.cache.clear();
  }
}

export const priceOracle = new PriceOracle();
```

#### Step 2: Update Depth Calculator
**File**: `lib/depth-calculator.ts`

```typescript
import { priceOracle } from './price-oracle';

export async function calculateDepthBandsWithPrices(
  ohlcData: OHLCDataPoint[],
  tickLiquidity: TickLiquidityData[],
  poolData: PoolData,
  config: DepthCalculationConfig
): Promise<DepthBand[]> {
  // Get token prices
  let token0PriceUSD = config.token0PriceUSD;
  let token1PriceUSD = config.token1PriceUSD;

  if (!token0PriceUSD) {
    token0PriceUSD = await priceOracle.getTokenPriceUSD(poolData.token0);
  }

  if (!token1PriceUSD) {
    token1PriceUSD = await priceOracle.getTokenPriceUSD(poolData.token1);
  }

  // Determine which token is USD-base
  const baseTokenIsUSD = priceOracle.isUSDStable(poolData.token1) ||
    (token1PriceUSD !== null && Math.abs(token1PriceUSD - 1) < 0.1);

  const calculator = new DepthCalculator(
    tickLiquidity,
    poolData.tick,
    poolData.sqrtPriceX96,
    poolData.token0Decimals,
    poolData.token1Decimals
  );

  return ohlcData.map((ohlc) => {
    const buyPrice = calculator.calculateBuyDepth(
      config.swapAmountUSD,
      baseTokenIsUSD
    );
    const sellPrice = calculator.calculateSellDepth(
      config.swapAmountUSD,
      baseTokenIsUSD
    );

    return {
      timestamp: ohlc.timestamp,
      buyPrice,
      sellPrice,
    };
  });
}
```

#### Step 3: Create React Hook
**New File**: `hooks/use-token-price.ts`

```typescript
import { useQuery } from '@tanstack/react-query';
import { priceOracle } from '@/lib/price-oracle';

export function useTokenPrice(tokenAddress: string | undefined) {
  return useQuery({
    queryKey: ['tokenPrice', tokenAddress],
    queryFn: () => {
      if (!tokenAddress) return null;
      return priceOracle.getTokenPriceUSD(tokenAddress);
    },
    enabled: !!tokenAddress,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000,   // 30 minutes
    refetchInterval: 5 * 60 * 1000, // Refresh every 5 minutes
  });
}

export function useTokenPrices(tokenAddresses: string[]) {
  return useQuery({
    queryKey: ['tokenPrices', ...tokenAddresses],
    queryFn: async () => {
      const prices = await Promise.all(
        tokenAddresses.map((addr) => priceOracle.getTokenPriceUSD(addr))
      );
      return Object.fromEntries(
        tokenAddresses.map((addr, i) => [addr, prices[i]])
      );
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}
```

---

## Testing & Validation

### Unit Tests

**File**: `__tests__/lib/depth-calculator.test.ts`

```typescript
import { describe, it, expect } from '@jest/globals';
import { DepthCalculator } from '@/lib/depth-calculator';

describe('DepthCalculator', () => {
  const mockTickLiquidity = [
    { tick: -1000, liquidityGross: '1000000000000000000', liquidityNet: '1000000000000000000' },
    { tick: 0, liquidityGross: '2000000000000000000', liquidityNet: '1000000000000000000' },
    { tick: 1000, liquidityGross: '1000000000000000000', liquidityNet: '-1000000000000000000' },
  ];

  it('calculates buy depth correctly', () => {
    const calculator = new DepthCalculator(
      mockTickLiquidity,
      0,
      BigInt('79228162514264337593543950336'), // sqrtPriceX96 at tick 0
      18,
      6
    );

    const buyPrice = calculator.calculateBuyDepth(10000, true);
    expect(buyPrice).toBeGreaterThan(1); // Price should increase
  });

  it('calculates sell depth correctly', () => {
    const calculator = new DepthCalculator(
      mockTickLiquidity,
      0,
      BigInt('79228162514264337593543950336'),
      18,
      6
    );

    const sellPrice = calculator.calculateSellDepth(10000, true);
    expect(sellPrice).toBeLessThan(1); // Price should decrease
  });

  it('handles zero liquidity gracefully', () => {
    const calculator = new DepthCalculator(
      [],
      0,
      BigInt('79228162514264337593543950336'),
      18,
      6
    );

    expect(() => calculator.calculateBuyDepth(10000, true)).not.toThrow();
  });
});
```

### Integration Tests

```typescript
describe('Depth Band Integration', () => {
  it('renders depth band when enabled', async () => {
    const { container } = render(
      <LpAddressActivityChart
        lpAddress="0x..."
        poolAddress="0x..."
      />
    );

    // Enable depth band
    const settingsButton = screen.getByRole('button', { name: /settings/i });
    fireEvent.click(settingsButton);

    const depthBandToggle = screen.getByLabelText(/enable depth band/i);
    fireEvent.click(depthBandToggle);

    // Wait for calculation
    await waitFor(() => {
      expect(container.querySelector('[fill="url(#depth-band-gradient)"]')).toBeInTheDocument();
    });
  });
});
```

### Manual Testing Checklist

#### Feature 1: Toggleable Elements
- [ ] Open chart settings
- [ ] Toggle each element on/off
- [ ] Verify element appears/disappears
- [ ] Toggle all off - chart should still render
- [ ] Refresh page - settings should persist
- [ ] Click "Reset" - all should return to defaults

#### Feature 2: Depth Band
- [ ] Enable depth band in settings
- [ ] Enter $10,000 as amount
- [ ] Verify yellow/orange area appears
- [ ] Change amount to $5,000 - band should shrink
- [ ] Change to $50,000 - band should grow
- [ ] Toggle "Replace Oracle Band" - oracle should hide/show
- [ ] Compare depth band to actual swap simulation (use Uniswap UI)

#### Feature 3: Price Oracle
- [ ] Check browser console for price fetch logs
- [ ] Verify prices cached (subsequent loads instant)
- [ ] Test with different token pairs
- [ ] Test with USD-stable pairs (should detect automatically)
- [ ] Test offline (should gracefully fallback)

### Validation Metrics

**Depth Calculation Accuracy**:
- Compare calculated depth with actual swap simulation
- Target: Within 2% of actual execution price
- Test with various amounts: $1k, $10k, $50k, $100k

**Performance**:
- Depth calculation time: < 100ms
- Chart render time: < 200ms
- Memory usage: < 50MB increase

**Edge Cases**:
- Zero liquidity ticks
- Extreme price movements
- Very large swap amounts (>$1M)
- Very small swap amounts (<$100)

---

## Deployment Checklist

### Pre-deployment
- [ ] All tests passing
- [ ] Code reviewed
- [ ] Performance profiled
- [ ] Error handling tested
- [ ] Browser compatibility checked (Chrome, Firefox, Safari)

### Deployment
- [ ] Merge to main branch
- [ ] Deploy to staging
- [ ] Test on staging with real data
- [ ] Monitor error logs
- [ ] Deploy to production

### Post-deployment
- [ ] Verify all features working
- [ ] Monitor performance metrics
- [ ] Check error rates
- [ ] Gather user feedback
- [ ] Document any issues

---

## Maintenance & Future Improvements

### Short-term (1-2 weeks)
- Add more oracle providers (Chainlink, DeFi Llama)
- Optimize depth calculation performance
- Add more granular toggle controls
- Improve mobile responsiveness

### Medium-term (1-3 months)
- Move depth calculation to Web Worker
- Pre-compute depth bands in indexer
- Add historical depth analysis
- Support custom token price sources

### Long-term (3-6 months)
- ML-based price prediction overlays
- Real-time depth updates via WebSocket
- Multi-pool depth aggregation
- Advanced trading features (limit orders, alerts)

---

## Support & Documentation

### User Documentation
Location: `/docs/features/depth-band.md`
- How to enable depth band
- How to interpret the visualization
- Configuration options
- Troubleshooting

### Developer Documentation
Location: `/docs/development/depth-calculator.md`
- Architecture overview
- API reference
- Extension guide
- Performance optimization tips

### Troubleshooting Guide
**Issue**: Depth band not appearing
- Check if TickLiquidity data is loaded
- Verify pool has sufficient liquidity
- Check browser console for errors

**Issue**: Inaccurate depth calculation
- Verify token decimals are correct
- Check if price oracle is working
- Compare with actual swap simulation

**Issue**: Performance issues
- Reduce swap amount (less computation)
- Enable Web Worker (if implemented)
- Check React DevTools profiler

---

**Implementation Complete**

All features documented with:
- ✅ Architecture decisions
- ✅ Step-by-step implementation
- ✅ Code examples
- ✅ Testing strategies
- ✅ Deployment checklist
- ✅ Maintenance plan

Ready for development! 🚀
