export const metricColors = {
  // Neutral surfaces
  surface: "#f9fafb", // gray-50
  border: "#e5e7eb", // gray-200

  // Status palettes (Tailwind-like)
  success: {
    surface: "#ecfdf5", // emerald-50
    fillSoft: "#d1fae5", // emerald-100
    border: "#a7f3d0", // emerald-200
    fill: "#34d399", // emerald-400
    text: "#065f46", // emerald-800
  },
  warning: {
    surface: "#fffbeb", // amber-50
    fillSoft: "#fef3c7", // amber-100
    border: "#fde68a", // amber-200
    fill: "#fbbf24", // amber-400
    text: "#92400e", // amber-800
  },
  danger: {
    surface: "#fef2f2", // red-50
    fillSoft: "#fee2e2", // red-100
    border: "#fecaca", // red-200
    fill: "#f87171", // red-400
    text: "#991b1b", // red-800
  },

  // Disabled state (all-gray)
  disabled: {
    surface: "#f3f4f6", // gray-100
    fillSoft: "#e5e7eb", // gray-200
    border: "#d1d5db", // gray-300
    fill: "#9ca3af", // gray-400
    text: "#6b7280", // gray-500
    strongText: "#374151", // gray-700
  },

  neutral: {
    text: "#374151", // gray-700
    muted: "#6b7280", // gray-500
    grid: "#e5e7eb", // gray-200
    tick: "#d1d5db", // gray-300
  },
} as const;

/**
 * Premium LP color palette - refined pastels with subtle vibrancy.
 * Balanced between soft and alive - not harsh but still has presence.
 * 
 * Key: Medium saturation (40-50%) + balanced lightness (50-58%) = premium yet alive.
 */
export const LP_COLORS = [
  "#6A9BD1", // Sky blue - clear, alive
  "#6BB894", // Seafoam - fresh
  "#D4A55A", // Golden honey - warm, inviting
  "#9A7DC4", // Soft violet - distinctive
  "#D18A9A", // Dusty coral - warm pink
  "#5AAFAF", // Teal - refreshing
  "#CC8A6A", // Terracotta - earthy warmth
  "#7A8AD4", // Periwinkle - soft but present
  "#8CB86A", // Fresh sage - lively green
  "#B88AB8", // Orchid - soft purple
  "#D1A06A", // Amber sand - warm neutral
  "#6AC4D1", // Cyan - crisp
  "#C47D7D", // Rosewood - muted red
  "#7DB89A", // Mint - soft green
  "#A8A46A", // Olive gold - earthy
  "#8A7EB8", // Slate violet - cool purple
  "#D19A6A", // Apricot - warm orange
  "#6A8CB8", // Steel blue - industrial
  "#B8A07A", // Khaki - neutral warm
  "#9AB86A", // Lime sage - bright green
] as const;

/** Gray color for "Others" category in charts */
export const OTHERS_COLOR = "#8A94A4";

/**
 * Premium bar colors with light/lighter variants for nested visualizations.
 * Balanced vibrancy - alive but refined.
 */
export const BAR_COLOR_PALETTES = [
  { bg: "#6A9BD1", light: "#8AB4DE", lighter: "#B4D0EC" }, // Sky blue
  { bg: "#9A7DC4", light: "#B49AD4", lighter: "#D0BEE4" }, // Soft violet
  { bg: "#6BB894", light: "#8CCAAC", lighter: "#B4DCC8" }, // Seafoam
  { bg: "#D4A55A", light: "#E0BA7A", lighter: "#ECD4A4" }, // Golden honey
  { bg: "#8A94A4", light: "#A4ACB8", lighter: "#C4C8D0" }, // Neutral gray (for "others")
] as const;

/**
 * Band colors for capital efficiency and range visualizations.
 * Premium palette with subtle vibrancy.
 */
export const BAND_COLORS = [
  { pct: 1, color: "#6A9BD1", bgColor: "rgba(106, 155, 209, 0.35)", bgColorHover: "rgba(106, 155, 209, 0.6)", label: "±1%" },
  { pct: 2, color: "#6BB894", bgColor: "rgba(107, 184, 148, 0.33)", bgColorHover: "rgba(107, 184, 148, 0.58)", label: "±2%" },
  { pct: 5, color: "#9A7DC4", bgColor: "rgba(154, 125, 196, 0.3)", bgColorHover: "rgba(154, 125, 196, 0.52)", label: "±5%" },
  { pct: 10, color: "#5AAFAF", bgColor: "rgba(90, 175, 175, 0.28)", bgColorHover: "rgba(90, 175, 175, 0.5)", label: "±10%" },
] as const;
