// Colour parameters, from the validated reference palette (categorical order is
// the CVD-safety mechanism: slots are assigned in fixed order, never cycled).

export type ThemeName = 'light' | 'dark';

export const CATEGORICAL: Record<ThemeName, string[]> = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
};

/** Colour for categories folded into "Other" and for missing values. */
export const NEUTRAL: Record<ThemeName, string> = { light: '#a3a29c', dark: '#6b6a64' };

/** Single-hue blue sequential ramp; low values recede toward the surface. */
const BLUE_RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
export const SEQUENTIAL: Record<ThemeName, string[]> = {
  light: BLUE_RAMP.slice(1),
  dark: [...BLUE_RAMP].reverse().slice(1),
};

/** Bubble colour when no colour encoding is set. */
export const DEFAULT_COLOR: Record<ThemeName, string> = { light: '#2a78d6', dark: '#3987e5' };

export const MAX_CATEGORY_COLORS = CATEGORICAL.light.length;

/** Theme colours the engine needs for WebGL and the SVG overlay (read from CSS tokens). */
export interface ThemeColors {
  name: ThemeName;
  surface: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  grid: string;
  axis: string;
  accent: string;
}

export function readThemeColors(el: Element = document.documentElement): ThemeColors {
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    name: cs.colorScheme.includes('dark') ? 'dark' : 'light',
    surface: v('--surface-1'),
    textPrimary: v('--text-primary'),
    textSecondary: v('--text-secondary'),
    textMuted: v('--text-muted'),
    grid: v('--grid'),
    axis: v('--axis'),
    accent: v('--accent'),
  };
}
