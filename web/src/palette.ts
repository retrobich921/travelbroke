/**
 * Цветовая рампа цены: лайм (дёшево) → фиолетовый (дорого).
 *
 * Интерполяция идёт в OKLCH, а не в sRGB: линейное смешение в sRGB даёт грязную
 * серо-зелёную середину, в OKLCH переход остаётся чистым.
 *
 * Светлота падает по всей рампе монотонно — 93 % → 74 % → 52 %. Без этого
 * получалась радуга: и дешёвый лайм, и дорогая сирень были одинаково светлыми,
 * порядок «дешевле — дороже» глаз не читал, а дорогие города не выделялись
 * вовсе. Промежуточная точка задана явно, иначе кратчайший путь по тону
 * проводит рампу через насыщенный бирюзовый и вся карта выглядит зелёной.
 */
import { formatHex, interpolate } from "culori";

export const CHEAP = "#d0ff1a";
export const MIDDLE = "oklch(76% 0.1 215)";
export const EXPENSIVE = "oklch(52% 0.2 292)";
export const UNREACHABLE = "#8f8caa";

const ramp = interpolate([CHEAP, MIDDLE, EXPENSIVE], "oklch");

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
