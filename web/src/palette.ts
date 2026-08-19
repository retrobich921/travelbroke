/**
 * Цветовая рампа цены: лайм (дёшево) → фиолетовый (дорого).
 *
 * Интерполяция идёт в OKLCH, а не в sRGB: линейное смешение #d0ff1a и #c1acff
 * в sRGB даёт грязную серо-зелёную середину, в OKLCH переход остаётся чистым.
 */
import { formatHex, interpolate } from "culori";

export const CHEAP = "#d0ff1a";
export const EXPENSIVE = "#c1acff";
export const UNREACHABLE = "#b9b6d6";

const ramp = interpolate([CHEAP, EXPENSIVE], "oklch");

/** Цвет для доли `t` в диапазоне цен, где 0 — самое дешёвое, 1 — самое дорогое. */
export function priceColor(t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  return formatHex(ramp(clamped)) ?? UNREACHABLE;
}

/** Готовые ступени для легенды. */
export function legendStops(count = 5): string[] {
  return Array.from({ length: count }, (_, i) => priceColor(i / (count - 1)));
}

/** Нормализует цену в долю от диапазона [min, max]. */
export function priceRatio(price: number, min: number, max: number): number {
  if (max <= min) return 0;
  return (price - min) / (max - min);
}
