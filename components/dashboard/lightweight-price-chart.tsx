"use client";

import React, { useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from "react";

export type PriceChartHandle = {
  zoomIn: () => void;
  zoomOut: () => void;
  fitContent: () => void;
};
import { cn } from "@/lib/utils";
import type { OHLCDataPoint } from "@/components/custom-metrics/lp-address-activity";
import type { IChartApi, ISeriesApi, Time, UTCTimestamp } from "lightweight-charts";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  createChart,
} from "lightweight-charts";

type HoverState = {
  time: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  isUp: boolean;
} | null;

const formatTooltipPrice = (price: number): string => {
  if (!Number.isFinite(price)) return "-";
  if (price >= 1000) return price.toFixed(2);
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(6);
};

const formatDateTime = (date: Date): string => {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

export const LightweightPriceChart = forwardRef<PriceChartHandle, {
  data: OHLCDataPoint[];
  className?: string;
}>(function LightweightPriceChart({ data, className }, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const [hover, setHover] = useState<HoverState>(null);
  const [barSpacing, setBarSpacing] = useState<number>(7);

  const candleData = useMemo(() => {
    // lightweight-charts expects UTCTimestamp (seconds) and numeric prices.
    // Max safe value for the chart library is approximately 9e13
    const MAX_CHART_VALUE = 9e13;
    const isValidPrice = (p: number) => Number.isFinite(p) && Math.abs(p) < MAX_CHART_VALUE;
    
    const sorted = (data ?? [])
      .filter((d) => d && isValidPrice(d.open) && isValidPrice(d.high) && isValidPrice(d.low) && isValidPrice(d.close))
      .map((d) => ({
        time: Math.floor(d.timestamp.getTime() / 1000) as UTCTimestamp,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      }))
      .sort((a, b) => (a.time as number) - (b.time as number));
    // Deduplicate by timestamp (lightweight-charts requires strictly ascending times)
    return sorted.filter((c, i) => i === 0 || c.time !== sorted[i - 1].time);
  }, [data]);

  const volumeData = useMemo(() => {
    const sorted = (data ?? [])
      .filter((d) => d && Number.isFinite(d.volume))
      .map((d) => {
        const isUp = d.close >= d.open;
        return {
          time: Math.floor(d.timestamp.getTime() / 1000) as UTCTimestamp,
          value: Math.max(0, Number(d.volume)),
          color: isUp ? "rgba(22, 163, 74, 0.35)" : "rgba(220, 38, 38, 0.35)",
        };
      })
      .sort((a, b) => (a.time as number) - (b.time as number));
    return sorted.filter((c, i) => i === 0 || c.time !== sorted[i - 1].time);
  }, [data]);

  // Create chart once
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Cleanup any prior chart (Fast Refresh safety)
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    }

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#6b7280",
      },
      grid: {
        vertLines: { color: "#f3f4f6" },
        horzLines: { color: "#f3f4f6" },
      },
      rightPriceScale: {
        borderColor: "#e5e7eb",
      },
      timeScale: {
        borderColor: "#e5e7eb",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
        barSpacing,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(156, 163, 175, 0.7)", width: 1, style: 2 },
        horzLine: { color: "rgba(156, 163, 175, 0.4)", width: 1, style: 2 },
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
    });

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#16a34a",
      downColor: "#dc2626",
      wickUpColor: "#15803d",
      wickDownColor: "#b91c1c",
      borderVisible: false,
      priceFormat: {
        type: "custom",
        formatter: (price: number) => {
          if (!Number.isFinite(price)) return "---";
          if (price >= 1_000_000_000) return `${(price / 1_000_000_000).toFixed(2)}B`;
          if (price >= 1_000_000) return `${(price / 1_000_000).toFixed(2)}M`;
          if (price >= 1_000) return price.toLocaleString("en-US", { maximumFractionDigits: 0 });
          if (price >= 0.01) return price.toFixed(4);
          if (price >= 0.0000001) return price.toFixed(8);
          return price.toExponential(2);
        },
      },
    });

    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "", // separate scale
      lastValueVisible: false,
      priceLineVisible: false,
      // Required by HistogramStyleOptions (per-bar colors can override).
      color: "rgba(148, 163, 184, 0.35)",
      base: 0,
    });
    // Show volume in the bottom strip.
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    chartRef.current = chart;
    candleSeriesRef.current = candles;
    volumeSeriesRef.current = volume;

    const onCrosshair = (param: { time?: Time; seriesData: Map<any, any> }) => {
      const t = param.time;
      if (!t || !candleSeriesRef.current) {
        setHover(null);
        return;
      }

      const cd = param.seriesData.get(candleSeriesRef.current);
      if (!cd) {
        setHover(null);
        return;
      }

      const timeSec = typeof t === "number" ? t : (t as any).timestamp;
      const dt = new Date(Number(timeSec) * 1000);
      const open = Number(cd.open);
      const high = Number(cd.high);
      const low = Number(cd.low);
      const close = Number(cd.close);
      const isUp = close >= open;

      // Find matching volume (optional)
      let vol: number | undefined = undefined;
      const vd = volumeSeriesRef.current ? param.seriesData.get(volumeSeriesRef.current) : undefined;
      if (vd && typeof vd.value === "number") vol = vd.value;

      setHover({
        time: dt,
        open,
        high,
        low,
        close,
        volume: vol,
        isUp,
      });
    };

    chart.subscribeCrosshairMove(onCrosshair as any);

    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) chart.applyOptions({ width: w, height: h });
    });
    ro.observe(el);

    // Initial sizing
    chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });

    return () => {
      chart.unsubscribeCrosshairMove(onCrosshair as any);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push data updates
  useEffect(() => {
    const candles = candleSeriesRef.current;
    const vol = volumeSeriesRef.current;
    if (!candles || !vol) return;
    if (candleData.length > 0) candles.setData(candleData as any);
    if (volumeData.length > 0) vol.setData(volumeData as any);
    chartRef.current?.timeScale().fitContent();
  }, [candleData, volumeData]);

  // Apply zoom changes
  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.applyOptions({ timeScale: { barSpacing } });
  }, [barSpacing]);

  const zoomIn = () => setBarSpacing((s) => Math.min(30, s + 1));
  const zoomOut = () => setBarSpacing((s) => Math.max(2, s - 1));
  const fitContent = () => chartRef.current?.timeScale().fitContent();

  // Expose zoom controls to parent via ref
  useImperativeHandle(ref, () => ({ zoomIn, zoomOut, fitContent }));

  if (!data || data.length === 0) {
    return (
      <div className={cn("flex items-center justify-center h-full", className)}>
        <p className="text-sm text-[var(--ts-ink-3)]">No data available</p>
      </div>
    );
  }

  return (
    <div className={cn("relative w-full h-full", className)}>
      {/* Tooltip */}
      {hover && (
        <div className="absolute top-2 left-12 bg-[var(--ts-surface)]/90 backdrop-blur-sm px-3 py-2 text-xs border border-[var(--ts-line)] z-10" style={{ borderRadius: '2px' }}>
          <div className="text-[var(--ts-ink-3)] mb-1 font-mono">{formatDateTime(hover.time)}</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono">
            <span className="text-[var(--ts-ink-3)]">Open</span>
            <span className="text-[var(--ts-ink-0)]">{formatTooltipPrice(hover.open)}</span>
            <span className="text-[var(--ts-ink-3)]">High</span>
            <span className="text-[var(--ts-ink-0)]">{formatTooltipPrice(hover.high)}</span>
            <span className="text-[var(--ts-ink-3)]">Low</span>
            <span className="text-[var(--ts-ink-0)]">{formatTooltipPrice(hover.low)}</span>
            <span className="text-[var(--ts-ink-3)]">Close</span>
            <span className={hover.isUp ? "text-[var(--ts-good)]" : "text-[var(--ts-bad)]"}>{formatTooltipPrice(hover.close)}</span>
          </div>
        </div>
      )}

      {/* Chart container */}
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
});
