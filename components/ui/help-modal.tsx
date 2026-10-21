"use client";

import React, { useEffect, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export interface HelpSectionData {
  title: string;
  content: string;
}

// Chart type for illustration mapping
type ChartIllustration = 
  | "price-chart"
  | "liquidity-distribution"
  | "price-impact"
  | "slippage-history"
  | "lp-concentration"
  | "arbitrage"
  | "lp-activity"
  | "capital-efficiency"
  | "volume-by-size"
  | "fee-earnings"
  | "lp-ranges"
  | "radar"
  | "price-range"
  | "liquidity-target"
  | "oracle-comparison"
  | "historical-data"
  | "generic";

// SVG Illustrations for each chart type
const ChartIllustrationSvg: React.FC<{ type: ChartIllustration }> = ({ type }) => {
  const baseColor = "#6366f1"; // indigo-500
  const secondaryColor = "#a5b4fc"; // indigo-300
  const accentColor = "#818cf8"; // indigo-400
  const bgColor = "#eef2ff"; // indigo-50
  const greenColor = "#22c55e";
  const redColor = "#ef4444";
  const orangeColor = "#f97316";

  switch (type) {
    case "price-chart":
      // Candlestick chart illustration
      return (
        <svg viewBox="0 0 200 100" className="w-full h-full">
          <rect x="0" y="0" width="200" height="100" fill={bgColor} rx="8" />
          {/* Grid lines */}
          <line x1="20" y1="25" x2="180" y2="25" stroke="#c7d2fe" strokeWidth="1" strokeDasharray="4 2" />
          <line x1="20" y1="50" x2="180" y2="50" stroke="#c7d2fe" strokeWidth="1" strokeDasharray="4 2" />
          <line x1="20" y1="75" x2="180" y2="75" stroke="#c7d2fe" strokeWidth="1" strokeDasharray="4 2" />
          {/* Candlesticks */}
          <g>
            {/* Green candle 1 */}
            <line x1="35" y1="30" x2="35" y2="70" stroke={greenColor} strokeWidth="1" />
            <rect x="30" y="40" width="10" height="20" fill={greenColor} rx="1" />
            {/* Red candle 2 */}
            <line x1="55" y1="35" x2="55" y2="75" stroke={redColor} strokeWidth="1" />
            <rect x="50" y="35" width="10" height="25" fill={redColor} rx="1" />
            {/* Green candle 3 */}
            <line x1="75" y1="25" x2="75" y2="65" stroke={greenColor} strokeWidth="1" />
            <rect x="70" y="35" width="10" height="20" fill={greenColor} rx="1" />
            {/* Green candle 4 */}
            <line x1="95" y1="20" x2="95" y2="55" stroke={greenColor} strokeWidth="1" />
            <rect x="90" y="25" width="10" height="20" fill={greenColor} rx="1" />
            {/* Red candle 5 */}
            <line x1="115" y1="25" x2="115" y2="60" stroke={redColor} strokeWidth="1" />
            <rect x="110" y="25" width="10" height="25" fill={redColor} rx="1" />
            {/* Green candle 6 */}
            <line x1="135" y1="30" x2="135" y2="65" stroke={greenColor} strokeWidth="1" />
            <rect x="130" y="40" width="10" height="15" fill={greenColor} rx="1" />
            {/* Green candle 7 */}
            <line x1="155" y1="25" x2="155" y2="55" stroke={greenColor} strokeWidth="1" />
            <rect x="150" y="30" width="10" height="15" fill={greenColor} rx="1" />
            {/* Green candle 8 */}
            <line x1="175" y1="20" x2="175" y2="50" stroke={greenColor} strokeWidth="1" />
            <rect x="170" y="25" width="10" height="18" fill={greenColor} rx="1" />
          </g>
        </svg>
      );

    case "liquidity-distribution":
      // Bar chart with current price marker
      return (
        <svg viewBox="0 0 200 100" className="w-full h-full">
          <rect x="0" y="0" width="200" height="100" fill={bgColor} rx="8" />
          {/* Bars */}
          <rect x="20" y="70" width="12" height="15" fill={secondaryColor} rx="2" />
          <rect x="35" y="60" width="12" height="25" fill={secondaryColor} rx="2" />
          <rect x="50" y="50" width="12" height="35" fill={secondaryColor} rx="2" />
          <rect x="65" y="35" width="12" height="50" fill={secondaryColor} rx="2" />
          <rect x="80" y="25" width="12" height="60" fill={baseColor} rx="2" />
          <rect x="95" y="20" width="12" height="65" fill={baseColor} rx="2" />
          <rect x="110" y="25" width="12" height="60" fill={baseColor} rx="2" />
          <rect x="125" y="35" width="12" height="50" fill={secondaryColor} rx="2" />
          <rect x="140" y="50" width="12" height="35" fill={secondaryColor} rx="2" />
          <rect x="155" y="60" width="12" height="25" fill={secondaryColor} rx="2" />
          <rect x="170" y="70" width="12" height="15" fill={secondaryColor} rx="2" />
          {/* Current price line */}
          <line x1="101" y1="10" x2="101" y2="90" stroke={orangeColor} strokeWidth="2" strokeDasharray="4 2" />
          <circle cx="101" cy="10" r="4" fill={orangeColor} />
        </svg>
      );

    case "price-impact":
      // Curved impact line
      return (
        <svg viewBox="0 0 200 100" className="w-full h-full">
          <rect x="0" y="0" width="200" height="100" fill={bgColor} rx="8" />
          {/* Axes */}
          <line x1="30" y1="80" x2="180" y2="80" stroke="#c7d2fe" strokeWidth="2" />
          <line x1="30" y1="20" x2="30" y2="80" stroke="#c7d2fe" strokeWidth="2" />
          {/* Impact curve */}
          <path d="M30,75 Q60,74 80,70 T120,55 T150,35 T180,20" fill="none" stroke={baseColor} strokeWidth="3" strokeLinecap="round" />
          {/* Fill area */}
          <path d="M30,75 Q60,74 80,70 T120,55 T150,35 T180,20 L180,80 L30,80 Z" fill={baseColor} fillOpacity="0.15" />
          {/* Data points */}
          <circle cx="30" cy="75" r="4" fill={baseColor} />
          <circle cx="80" cy="70" r="4" fill={baseColor} />
          <circle cx="120" cy="55" r="4" fill={baseColor} />
          <circle cx="150" cy="35" r="4" fill={baseColor} />
          <circle cx="180" cy="20" r="4" fill={baseColor} />
          {/* Labels */}
          <text x="105" y="95" fontSize="8" fill="#6b7280" textAnchor="middle">Trade Size →</text>
          <text x="15" y="50" fontSize="8" fill="#6b7280" textAnchor="middle" transform="rotate(-90, 15, 50)">Impact</text>
        </svg>
      );

    case "slippage-history":
      // Line chart with bands
      return (
        <svg viewBox="0 0 200 100" className="w-full h-full">
          <rect x="0" y="0" width="200" height="100" fill={bgColor} rx="8" />
          {/* Grid */}
          <line x1="20" y1="50" x2="180" y2="50" stroke="#c7d2fe" strokeWidth="1" strokeDasharray="4 2" />
          {/* Buy band (upper) */}
          <path d="M20,45 L50,42 L80,48 L110,40 L140,44 L170,38 L180,42" fill="none" stroke={greenColor} strokeWidth="2" />
          {/* Sell band (lower) */}
          <path d="M20,55 L50,58 L80,52 L110,60 L140,56 L170,62 L180,58" fill="none" stroke={redColor} strokeWidth="2" />
          {/* Fill between */}
          <path d="M20,45 L50,42 L80,48 L110,40 L140,44 L170,38 L180,42 L180,58 L170,62 L140,56 L110,60 L80,52 L50,58 L20,55 Z" fill={accentColor} fillOpacity="0.1" />
          {/* Center line */}
          <line x1="20" y1="50" x2="180" y2="50" stroke={baseColor} strokeWidth="1" strokeDasharray="2 2" />
          {/* Legend */}
          <circle cx="30" cy="15" r="3" fill={greenColor} />
          <text x="38" y="18" fontSize="7" fill="#6b7280">Buy</text>
          <circle cx="65" cy="15" r="3" fill={redColor} />
          <text x="73" y="18" fontSize="7" fill="#6b7280">Sell</text>
        </svg>
      );

    case "lp-concentration":
      // Pie/donut chart
      return (
        <svg viewBox="0 0 200 100" className="w-full h-full">
          <rect x="0" y="0" width="200" height="100" fill={bgColor} rx="8" />
          <g transform="translate(100, 50)">
            {/* Pie slices */}
            <path d="M0,-35 A35,35 0 0,1 30,17 L0,0 Z" fill={baseColor} />
            <path d="M30,17 A35,35 0 0,1 -17,30 L0,0 Z" fill={accentColor} />
            <path d="M-17,30 A35,35 0 0,1 -35,0 L0,0 Z" fill={secondaryColor} />
            <path d="M-35,0 A35,35 0 0,1 0,-35 L0,0 Z" fill="#c7d2fe" />
            {/* Center circle */}
            <circle cx="0" cy="0" r="18" fill={bgColor} />
            <text x="0" y="4" fontSize="10" fill="#374151" textAnchor="middle" fontWeight="600">LPs</text>
          </g>
          {/* Legend */}
          <rect x="150" y="20" width="8" height="8" fill={baseColor} rx="1" />
          <text x="162" y="27" fontSize="7" fill="#6b7280">35%</text>
          <rect x="150" y="35" width="8" height="8" fill={accentColor} rx="1" />
          <text x="162" y="42" fontSize="7" fill="#6b7280">28%</text>
          <rect x="150" y="50" width="8" height="8" fill={secondaryColor} rx="1" />
          <text x="162" y="57" fontSize="7" fill="#6b7280">22%</text>
          <rect x="150" y="65" width="8" height="8" fill="#c7d2fe" rx="1" />
          <text x="162" y="72" fontSize="7" fill="#6b7280">15%</text>
        </svg>
      );

    case "arbitrage":
      // Gauge/dial indicator
      return (
        <svg viewBox="0 0 200 100" className="w-full h-full">
          <rect x="0" y="0" width="200" height="100" fill={bgColor} rx="8" />
          <g transform="translate(100, 60)">
            {/* Arc background */}
            <path d="M-60,0 A60,60 0 0,1 60,0" fill="none" stroke="#e5e7eb" strokeWidth="12" strokeLinecap="round" />
            {/* Colored segments */}
            <path d="M-60,0 A60,60 0 0,1 -42,-42" fill="none" stroke={greenColor} strokeWidth="12" strokeLinecap="round" />
            <path d="M42,-42 A60,60 0 0,1 60,0" fill="none" stroke={redColor} strokeWidth="12" strokeLinecap="round" />
            {/* Needle */}
            <line x1="0" y1="5" x2="-15" y2="-35" stroke="#374151" strokeWidth="3" strokeLinecap="round" />
            <circle cx="0" cy="0" r="6" fill="#374151" />
            {/* Labels */}
            <text x="-55" y="20" fontSize="8" fill={greenColor} fontWeight="500">BUY</text>
            <text x="35" y="20" fontSize="8" fill={redColor} fontWeight="500">SELL</text>
            <text x="0" y="-25" fontSize="7" fill="#6b7280" textAnchor="middle">-0.35%</text>
          </g>
        </svg>
      );

    case "lp-activity":
      // Stacked bars up and down
      return (
        <svg viewBox="0 0 200 100" className="w-full h-full">
          <rect x="0" y="0" width="200" height="100" fill={bgColor} rx="8" />
          {/* Zero line */}
          <line x1="20" y1="50" x2="180" y2="50" stroke="#9ca3af" strokeWidth="1" />
          {/* Up bars (mints) */}
          <rect x="25" y="35" width="15" height="15" fill="#3b82f6" rx="2" />
          <rect x="45" y="25" width="15" height="25" fill="#8b5cf6" rx="2" />
          <rect x="65" y="40" width="15" height="10" fill="#3b82f6" rx="2" />
          <rect x="85" y="30" width="15" height="20" fill="#06b6d4" rx="2" />
          <rect x="105" y="38" width="15" height="12" fill="#3b82f6" rx="2" />
          <rect x="125" y="20" width="15" height="30" fill="#8b5cf6" rx="2" />
          <rect x="145" y="35" width="15" height="15" fill="#06b6d4" rx="2" />
          <rect x="165" y="42" width="15" height="8" fill="#3b82f6" rx="2" />
          {/* Down bars (burns) */}
          <rect x="25" y="50" width="15" height="20" fill="#f97316" rx="2" />
          <rect x="45" y="50" width="15" height="30" fill="#ef4444" rx="2" />
          <rect x="65" y="50" width="15" height="15" fill="#f97316" rx="2" />
          <rect x="85" y="50" width="15" height="25" fill="#dc2626" rx="2" />
          <rect x="105" y="50" width="15" height="10" fill="#f97316" rx="2" />
          <rect x="125" y="50" width="15" height="35" fill="#ef4444" rx="2" />
          <rect x="145" y="50" width="15" height="20" fill="#dc2626" rx="2" />
          <rect x="165" y="50" width="15" height="12" fill="#f97316" rx="2" />
          {/* Labels */}
          <text x="15" y="30" fontSize="7" fill="#6b7280">+</text>
          <text x="15" y="75" fontSize="7" fill="#6b7280">−</text>
        </svg>
      );

    case "capital-efficiency":
      // Area chart comparison
      return (
        <svg viewBox="0 0 200 100" className="w-full h-full">
          <rect x="0" y="0" width="200" height="100" fill={bgColor} rx="8" />
          {/* Optimal area (light) */}
          <path d="M20,75 Q50,70 80,50 T140,30 T180,25 L180,85 L20,85 Z" fill={secondaryColor} fillOpacity="0.4" />
          {/* Actual area (darker) */}
          <path d="M20,80 Q50,75 80,60 T140,45 T180,40 L180,85 L20,85 Z" fill={baseColor} fillOpacity="0.6" />
          {/* Optimal line */}
          <path d="M20,75 Q50,70 80,50 T140,30 T180,25" fill="none" stroke={secondaryColor} strokeWidth="2" strokeDasharray="4 2" />
          {/* Actual line */}
          <path d="M20,80 Q50,75 80,60 T140,45 T180,40" fill="none" stroke={baseColor} strokeWidth="2" />
          {/* Legend */}
          <line x1="25" y1="15" x2="40" y2="15" stroke={baseColor} strokeWidth="2" />
          <text x="45" y="18" fontSize="7" fill="#6b7280">Actual</text>
          <line x1="85" y1="15" x2="100" y2="15" stroke={secondaryColor} strokeWidth="2" strokeDasharray="4 2" />
          <text x="105" y="18" fontSize="7" fill="#6b7280">Optimal</text>
        </svg>
      );

    case "volume-by-size":
      // Grouped bars by size bucket
      return (
        <svg viewBox="0 0 200 100" className="w-full h-full">
          <rect x="0" y="0" width="200" height="100" fill={bgColor} rx="8" />
          {/* Size buckets */}
          <g>
            <rect x="25" y="30" width="20" height="50" fill={secondaryColor} rx="2" />
            <text x="35" y="90" fontSize="6" fill="#6b7280" textAnchor="middle">$0-1K</text>
          </g>
          <g>
            <rect x="55" y="20" width="20" height="60" fill={accentColor} rx="2" />
            <text x="65" y="90" fontSize="6" fill="#6b7280" textAnchor="middle">$1-5K</text>
          </g>
          <g>
            <rect x="85" y="35" width="20" height="45" fill={baseColor} rx="2" />
            <text x="95" y="90" fontSize="6" fill="#6b7280" textAnchor="middle">$5-10K</text>
          </g>
          <g>
            <rect x="115" y="50" width="20" height="30" fill={accentColor} rx="2" />
            <text x="125" y="90" fontSize="6" fill="#6b7280" textAnchor="middle">$10-50K</text>
          </g>
          <g>
            <rect x="145" y="60" width="20" height="20" fill={secondaryColor} rx="2" />
            <text x="155" y="90" fontSize="6" fill="#6b7280" textAnchor="middle">$50K+</text>
          </g>
        </svg>
      );

    case "fee-earnings":
      // Bar chart with earnings
      return (
        <svg viewBox="0 0 200 100" className="w-full h-full">
          <rect x="0" y="0" width="200" height="100" fill={bgColor} rx="8" />
          {/* Bars with gradient effect */}
          <defs>
            <linearGradient id="feeGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={baseColor} />
              <stop offset="100%" stopColor={accentColor} />
            </linearGradient>
          </defs>
          <rect x="25" y="25" width="18" height="55" fill="url(#feeGradient)" rx="2" />
          <rect x="50" y="35" width="18" height="45" fill="url(#feeGradient)" rx="2" />
          <rect x="75" y="40" width="18" height="40" fill="url(#feeGradient)" rx="2" />
          <rect x="100" y="50" width="18" height="30" fill="url(#feeGradient)" rx="2" />
          <rect x="125" y="55" width="18" height="25" fill="url(#feeGradient)" rx="2" />
          <rect x="150" y="60" width="18" height="20" fill="url(#feeGradient)" rx="2" />
          {/* Dollar signs */}
          <text x="34" y="20" fontSize="8" fill={baseColor} textAnchor="middle" fontWeight="600">$</text>
          <text x="59" y="30" fontSize="8" fill={baseColor} textAnchor="middle" fontWeight="600">$</text>
          <text x="84" y="35" fontSize="8" fill={baseColor} textAnchor="middle" fontWeight="600">$</text>
        </svg>
      );

    case "lp-ranges":
      // Stacked range bars
      return (
        <svg viewBox="0 0 200 100" className="w-full h-full">
          <rect x="0" y="0" width="200" height="100" fill={bgColor} rx="8" />
          {/* Background distribution */}
          <rect x="20" y="70" width="160" height="15" fill="#e5e7eb" rx="2" />
          {/* LP range bars */}
          <rect x="40" y="15" width="80" height="8" fill="#3b82f6" rx="2" opacity="0.8" />
          <rect x="60" y="28" width="60" height="8" fill="#8b5cf6" rx="2" opacity="0.8" />
          <rect x="80" y="41" width="40" height="8" fill="#06b6d4" rx="2" opacity="0.8" />
          <rect x="50" y="54" width="90" height="8" fill="#10b981" rx="2" opacity="0.8" />
          {/* Current price */}
          <line x1="100" y1="10" x2="100" y2="90" stroke={orangeColor} strokeWidth="2" strokeDasharray="4 2" />
          <circle cx="100" cy="10" r="3" fill={orangeColor} />
          {/* Labels */}
          <text x="30" y="20" fontSize="6" fill="#3b82f6">LP1</text>
          <text x="30" y="33" fontSize="6" fill="#8b5cf6">LP2</text>
          <text x="30" y="46" fontSize="6" fill="#06b6d4">LP3</text>
          <text x="30" y="59" fontSize="6" fill="#10b981">LP4</text>
        </svg>
      );

    case "radar":
      // Radar/spider chart
      return (
        <svg viewBox="0 0 200 100" className="w-full h-full">
          <rect x="0" y="0" width="200" height="100" fill={bgColor} rx="8" />
          <g transform="translate(100, 52)">
            {/* Hexagon grid */}
            <polygon points="0,-35 30,-17 30,17 0,35 -30,17 -30,-17" fill="none" stroke="#c7d2fe" strokeWidth="1" />
            <polygon points="0,-25 21,-12 21,12 0,25 -21,12 -21,-12" fill="none" stroke="#c7d2fe" strokeWidth="1" />
            <polygon points="0,-15 13,-7 13,7 0,15 -13,7 -13,-7" fill="none" stroke="#c7d2fe" strokeWidth="1" />
            {/* Spokes */}
            <line x1="0" y1="0" x2="0" y2="-35" stroke="#c7d2fe" strokeWidth="1" />
            <line x1="0" y1="0" x2="30" y2="-17" stroke="#c7d2fe" strokeWidth="1" />
            <line x1="0" y1="0" x2="30" y2="17" stroke="#c7d2fe" strokeWidth="1" />
            <line x1="0" y1="0" x2="0" y2="35" stroke="#c7d2fe" strokeWidth="1" />
            <line x1="0" y1="0" x2="-30" y2="17" stroke="#c7d2fe" strokeWidth="1" />
            <line x1="0" y1="0" x2="-30" y2="-17" stroke="#c7d2fe" strokeWidth="1" />
            {/* Data polygon */}
            <polygon points="0,-28 25,-10 20,15 -5,25 -22,8 -18,-15" fill={baseColor} fillOpacity="0.3" stroke={baseColor} strokeWidth="2" />
            {/* Data points */}
            <circle cx="0" cy="-28" r="3" fill={baseColor} />
            <circle cx="25" cy="-10" r="3" fill={baseColor} />
            <circle cx="20" cy="15" r="3" fill={baseColor} />
            <circle cx="-5" cy="25" r="3" fill={baseColor} />
            <circle cx="-22" cy="8" r="3" fill={baseColor} />
            <circle cx="-18" cy="-15" r="3" fill={baseColor} />
          </g>
        </svg>
      );

    case "price-range":
      // Range indicator with current price
      return (
        <svg viewBox="0 0 200 100" className="w-full h-full">
          <rect x="0" y="0" width="200" height="100" fill={bgColor} rx="8" />
          {/* Range bar background */}
          <rect x="25" y="40" width="150" height="20" fill="#e5e7eb" rx="10" />
          {/* Active range */}
          <rect x="50" y="40" width="80" height="20" fill={greenColor} fillOpacity="0.3" rx="10" />
          <rect x="50" y="40" width="80" height="20" fill="none" stroke={greenColor} strokeWidth="2" rx="10" />
          {/* Range bounds */}
          <circle cx="50" cy="50" r="6" fill={baseColor} />
          <circle cx="130" cy="50" r="6" fill={baseColor} />
          {/* Current price marker */}
          <g transform="translate(90, 50)">
            <polygon points="0,-15 8,-5 8,5 0,15 -8,5 -8,-5" fill={orangeColor} />
            <text x="0" y="3" fontSize="7" fill="white" textAnchor="middle" fontWeight="600">$</text>
          </g>
          {/* Labels */}
          <text x="50" y="75" fontSize="8" fill="#6b7280" textAnchor="middle">Min</text>
          <text x="90" y="75" fontSize="8" fill={orangeColor} textAnchor="middle" fontWeight="500">Current</text>
          <text x="130" y="75" fontSize="8" fill="#6b7280" textAnchor="middle">Max</text>
          {/* Status */}
          <text x="100" y="25" fontSize="9" fill={greenColor} textAnchor="middle" fontWeight="600">✓ IN RANGE</text>
        </svg>
      );

    case "liquidity-target":
      // Target vs actual comparison
      return (
        <svg viewBox="0 0 200 100" className="w-full h-full">
          <rect x="0" y="0" width="200" height="100" fill={bgColor} rx="8" />
          {/* Progress bar background */}
          <rect x="25" y="35" width="150" height="30" fill="#e5e7eb" rx="4" />
          {/* Target line */}
          <line x1="140" y1="30" x2="140" y2="70" stroke="#374151" strokeWidth="2" strokeDasharray="4 2" />
          <text x="140" y="78" fontSize="7" fill="#374151" textAnchor="middle">Target</text>
          {/* Actual fill */}
          <rect x="25" y="35" width="100" height="30" fill={baseColor} rx="4" />
          {/* Percentage */}
          <text x="75" y="55" fontSize="12" fill="white" textAnchor="middle" fontWeight="600">71%</text>
          {/* Labels */}
          <text x="100" y="20" fontSize="9" fill="#6b7280" textAnchor="middle">Liquidity Deployed</text>
        </svg>
      );

    case "oracle-comparison":
      // Multi-line comparison chart
      return (
        <svg viewBox="0 0 200 100" className="w-full h-full">
          <rect x="0" y="0" width="200" height="100" fill={bgColor} rx="8" />
          {/* Grid */}
          <line x1="25" y1="30" x2="180" y2="30" stroke="#c7d2fe" strokeWidth="1" strokeDasharray="2 2" />
          <line x1="25" y1="50" x2="180" y2="50" stroke="#c7d2fe" strokeWidth="1" strokeDasharray="2 2" />
          <line x1="25" y1="70" x2="180" y2="70" stroke="#c7d2fe" strokeWidth="1" strokeDasharray="2 2" />
          {/* DEX price line */}
          <path d="M25,50 L50,48 L75,52 L100,45 L125,50 L150,47 L175,52" fill="none" stroke={baseColor} strokeWidth="2" />
          {/* Oracle 1 */}
          <path d="M25,48 L50,46 L75,50 L100,43 L125,48 L150,45 L175,50" fill="none" stroke={greenColor} strokeWidth="2" strokeDasharray="4 2" />
          {/* Oracle 2 */}
          <path d="M25,52 L50,50 L75,54 L100,47 L125,52 L150,49 L175,54" fill="none" stroke={orangeColor} strokeWidth="2" strokeDasharray="4 2" />
          {/* Legend */}
          <line x1="30" y1="15" x2="45" y2="15" stroke={baseColor} strokeWidth="2" />
          <text x="50" y="18" fontSize="7" fill="#6b7280">DEX</text>
          <line x1="75" y1="15" x2="90" y2="15" stroke={greenColor} strokeWidth="2" strokeDasharray="4 2" />
          <text x="95" y="18" fontSize="7" fill="#6b7280">Chainlink</text>
          <line x1="130" y1="15" x2="145" y2="15" stroke={orangeColor} strokeWidth="2" strokeDasharray="4 2" />
          <text x="150" y="18" fontSize="7" fill="#6b7280">Pyth</text>
        </svg>
      );

    case "historical-data":
      // Complex multi-layer chart
      return (
        <svg viewBox="0 0 200 100" className="w-full h-full">
          <rect x="0" y="0" width="200" height="100" fill={bgColor} rx="8" />
          {/* OHLC candles (small) */}
          <g transform="translate(0, 10)">
            <line x1="35" y1="15" x2="35" y2="35" stroke={greenColor} strokeWidth="1" />
            <rect x="32" y="20" width="6" height="10" fill={greenColor} />
            <line x1="55" y1="12" x2="55" y2="38" stroke={redColor} strokeWidth="1" />
            <rect x="52" y="15" width="6" height="15" fill={redColor} />
            <line x1="75" y1="10" x2="75" y2="32" stroke={greenColor} strokeWidth="1" />
            <rect x="72" y="15" width="6" height="10" fill={greenColor} />
            <line x1="95" y1="8" x2="95" y2="28" stroke={greenColor} strokeWidth="1" />
            <rect x="92" y="12" width="6" height="10" fill={greenColor} />
            <line x1="115" y1="12" x2="115" y2="35" stroke={redColor} strokeWidth="1" />
            <rect x="112" y="15" width="6" height="12" fill={redColor} />
            <line x1="135" y1="15" x2="135" y2="38" stroke={greenColor} strokeWidth="1" />
            <rect x="132" y="22" width="6" height="10" fill={greenColor} />
            <line x1="155" y1="10" x2="155" y2="30" stroke={greenColor} strokeWidth="1" />
            <rect x="152" y="15" width="6" height="8" fill={greenColor} />
            <line x1="175" y1="8" x2="175" y2="25" stroke={greenColor} strokeWidth="1" />
            <rect x="172" y="12" width="6" height="8" fill={greenColor} />
          </g>
          {/* Impact bands */}
          <path d="M25,55 L55,52 L85,58 L115,50 L145,55 L175,48" fill="none" stroke={greenColor} strokeWidth="1.5" opacity="0.7" />
          <path d="M25,70 L55,73 L85,67 L115,75 L145,70 L175,77" fill="none" stroke={redColor} strokeWidth="1.5" opacity="0.7" />
          <path d="M25,55 L55,52 L85,58 L115,50 L145,55 L175,48 L175,77 L145,70 L115,75 L85,67 L55,73 L25,70 Z" fill={accentColor} fillOpacity="0.1" />
          {/* LP events markers */}
          <circle cx="55" cy="85" r="4" fill="#3b82f6" />
          <circle cx="95" cy="85" r="4" fill="#f97316" />
          <circle cx="145" cy="85" r="4" fill="#3b82f6" />
        </svg>
      );

    default:
      // Generic chart illustration
      return (
        <svg viewBox="0 0 200 100" className="w-full h-full">
          <rect x="0" y="0" width="200" height="100" fill={bgColor} rx="8" />
          {/* Simple line chart */}
          <path d="M25,70 L50,60 L75,65 L100,45 L125,50 L150,35 L175,40" fill="none" stroke={baseColor} strokeWidth="2" />
          <path d="M25,70 L50,60 L75,65 L100,45 L125,50 L150,35 L175,40 L175,85 L25,85 Z" fill={baseColor} fillOpacity="0.1" />
          {/* Data points */}
          <circle cx="25" cy="70" r="3" fill={baseColor} />
          <circle cx="75" cy="65" r="3" fill={baseColor} />
          <circle cx="125" cy="50" r="3" fill={baseColor} />
          <circle cx="175" cy="40" r="3" fill={baseColor} />
        </svg>
      );
  }
};

// Map chart titles to illustration types
const getIllustrationForTitle = (title: string): ChartIllustration => {
  const titleLower = title.toLowerCase();
  
  if (titleLower.includes("price chart") || titleLower.includes("ohlc") || titleLower.includes("candlestick")) {
    return "price-chart";
  }
  if (titleLower.includes("liquidity distribution") && !titleLower.includes("lp")) {
    return "liquidity-distribution";
  }
  if (titleLower.includes("price impact")) {
    return "price-impact";
  }
  if (titleLower.includes("slippage")) {
    return "slippage-history";
  }
  if (titleLower.includes("concentration") || titleLower.includes("pie")) {
    return "lp-concentration";
  }
  if (titleLower.includes("arbitrage")) {
    return "arbitrage";
  }
  if (titleLower.includes("new vs exit") || titleLower.includes("entry") || (titleLower.includes("lp activity") && !titleLower.includes("historical"))) {
    return "lp-activity";
  }
  if (titleLower.includes("capital efficiency") || titleLower.includes("efficiency")) {
    return "capital-efficiency";
  }
  if (titleLower.includes("volume") && titleLower.includes("size")) {
    return "volume-by-size";
  }
  if (titleLower.includes("fee") || titleLower.includes("earning")) {
    return "fee-earnings";
  }
  if (titleLower.includes("ranges by address") || titleLower.includes("lp ranges")) {
    return "lp-ranges";
  }
  if (titleLower.includes("strategy") || titleLower.includes("radar")) {
    return "radar";
  }
  if (titleLower.includes("price range") || titleLower.includes("range monitor")) {
    return "price-range";
  }
  if (titleLower.includes("target") || titleLower.includes("liquidity target")) {
    return "liquidity-target";
  }
  if (titleLower.includes("oracle") || titleLower.includes("comparison")) {
    return "oracle-comparison";
  }
  if (titleLower.includes("historical data") || titleLower.includes("historical")) {
    return "historical-data";
  }
  if (titleLower.includes("lp liquidity") || titleLower.includes("distribution comparison")) {
    return "liquidity-distribution";
  }
  if (titleLower.includes("position activity")) {
    return "lp-activity";
  }
  
  return "generic";
};

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  sections: HelpSectionData[];
  className?: string;
}

export const HelpModal: React.FC<HelpModalProps> = ({
  isOpen,
  onClose,
  title,
  sections,
  className,
}) => {
  const [currentPage, setCurrentPage] = useState(0);

  // Reset to first page when modal opens
  useEffect(() => {
    if (isOpen) {
      setCurrentPage(0);
    }
  }, [isOpen]);

  // Handle ESC key to close
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        setCurrentPage((prev) => Math.min(prev + 1, sections.length - 1));
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        setCurrentPage((prev) => Math.max(prev - 1, 0));
      }
    },
    [onClose, sections.length]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  const currentSection = sections[currentPage];
  const isFirstPage = currentPage === 0;
  const isLastPage = currentPage === sections.length - 1;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-modal-title"
    >
      {/* Backdrop - click to close */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal content */}
      <div
        className={cn(
          "relative z-10 w-full max-w-md mx-4",
          "bg-white rounded-lg shadow-xl",
          "border border-gray-200",
          "animate-in fade-in zoom-in-95 duration-200",
          className
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2
            id="help-modal-title"
            className="text-base font-semibold text-gray-900"
          >
            {title}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label="Close"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Illustration */}
        <div className="px-5 pt-4">
          <div className="w-full h-24 rounded-lg overflow-hidden">
            <ChartIllustrationSvg type={getIllustrationForTitle(title)} />
          </div>
        </div>

        {/* Page indicator */}
        <div className="flex items-center justify-center gap-1.5 pt-3 px-5">
          {sections.map((_, index) => (
            <button
              key={index}
              onClick={() => setCurrentPage(index)}
              className={cn(
                "w-2 h-2 rounded-full transition-all",
                index === currentPage
                  ? "bg-gray-800 w-4"
                  : "bg-gray-300 hover:bg-gray-400"
              )}
              aria-label={`Go to page ${index + 1}`}
            />
          ))}
        </div>

        {/* Body - Current Section */}
        <div className="px-5 py-4 min-h-[180px]">
          <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
            <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">
              {currentSection.title}
            </h4>
            <p className="text-sm text-gray-600 leading-relaxed">
              {currentSection.content}
            </p>
          </div>
        </div>

        {/* Footer with navigation */}
        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 rounded-b-lg">
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={() => setCurrentPage((prev) => prev - 1)}
              disabled={isFirstPage}
              className={cn(
                "px-4 py-2 text-sm font-medium rounded-md transition-colors",
                isFirstPage
                  ? "text-gray-300 cursor-not-allowed"
                  : "text-gray-600 hover:bg-gray-100"
              )}
            >
              ← Previous
            </button>
            
            <span className="text-xs text-gray-400">
              {currentPage + 1} / {sections.length}
            </span>

            {isLastPage ? (
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-white bg-gray-800 rounded-md hover:bg-gray-700 transition-colors"
              >
                Got it
              </button>
            ) : (
              <button
                onClick={() => setCurrentPage((prev) => prev + 1)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
              >
                Next →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default HelpModal;
