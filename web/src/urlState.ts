/**
 * Состояние карты в адресной строке.
 *
 * Ссылка полностью описывает вид: откуда, когда, за сколько, на чём и какой
 * город раскрыт. Так найденный маршрут можно просто переслать, а на демо —
 * открыть заранее подготовленный экран одной ссылкой.
 */
import { MODES, nextSaturday, type Mode } from "./api";

export interface MapState {
  origin: string;
  date: string;
  budget: number;
  maxHours: number;
  modes: Mode[];
  deep: boolean;
  passengers: number;
  selected: string | null;
}

export const DEFAULT_STATE: MapState = {
  origin: "Москва",
  date: nextSaturday(),
  budget: 6000,
  maxHours: 24,
  modes: [...MODES],
  deep: true,
  passengers: 1,
  selected: null,
};

function parseModes(raw: string | null): Mode[] {
  if (!raw) return [...MODES];
  const parsed = raw.split(",").filter((item): item is Mode => MODES.includes(item as Mode));
  return parsed.length ? parsed : [...MODES];
}

function parseNumber(raw: string | null, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Читает состояние из адресной строки, подставляя значения по умолчанию. */
export function readState(search: string = window.location.search): MapState {
  const params = new URLSearchParams(search);
  return {
    origin: params.get("from") ?? DEFAULT_STATE.origin,
    date: params.get("date") ?? DEFAULT_STATE.date,
    budget: parseNumber(params.get("budget"), DEFAULT_STATE.budget),
    maxHours: parseNumber(params.get("hours"), DEFAULT_STATE.maxHours),
    modes: parseModes(params.get("modes")),
    deep: params.get("deep") !== "0",
    passengers: Math.min(6, Math.max(1, parseNumber(params.get("pax"), 1))),
    selected: params.get("city"),
  };
}

/** Обновляет адресную строку, не перезагружая страницу и не плодя историю. */
export function writeState(state: MapState): void {
  const params = new URLSearchParams();
  params.set("from", state.origin);
  params.set("date", state.date);
  params.set("budget", String(state.budget));
  params.set("hours", String(state.maxHours));
  if (state.modes.length !== MODES.length) params.set("modes", state.modes.join(","));
  if (!state.deep) params.set("deep", "0");
  if (state.passengers > 1) params.set("pax", String(state.passengers));
  if (state.selected) params.set("city", state.selected);
  window.history.replaceState(null, "", `?${params.toString()}`);
}
