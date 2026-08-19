/**
 * Состояние карты в адресной строке.
 *
 * Ссылка полностью описывает вид: откуда, когда, за сколько, на чём и какой
 * город раскрыт. Так найденный маршрут можно просто переслать, а на демо —
 * открыть заранее подготовленный экран одной ссылкой.
 */
import { MODES, nextSaturday, type Mode } from "./api";

export const BUDGET_MIN = 100;
export const BUDGET_MAX = 100_000;
/** Последнее положение бегунка: «без ограничения». */
export const BUDGET_UNLIMITED = 100_100;
export const HOURS_MIN = 2;
export const HOURS_MAX = 7 * 24;

export interface MapState {
  origin: string;
  date: string;
  budget: number;
  maxHours: number;
  modes: Mode[];
  deep: boolean;
  passengers: number;
  abroadOnly: boolean;
  roundTrip: boolean;
  stayMin: number;
  stayMax: number;
  /** Часы: не выезжать раньше и быть на месте не позже. */
  departAfter: number;
  arriveBefore: number;
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
  abroadOnly: false,
  roundTrip: false,
  stayMin: 1,
  stayMax: 3,
  departAfter: 0,
  arriveBefore: 24,
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Читает состояние из адресной строки, подставляя значения по умолчанию. */
export function readState(search: string = window.location.search): MapState {
  const params = new URLSearchParams(search);
  return {
    origin: params.get("from") ?? DEFAULT_STATE.origin,
    date: params.get("date") ?? DEFAULT_STATE.date,
    budget: clamp(parseNumber(params.get("budget"), DEFAULT_STATE.budget), BUDGET_MIN, BUDGET_UNLIMITED),
    maxHours: clamp(parseNumber(params.get("hours"), DEFAULT_STATE.maxHours), HOURS_MIN, HOURS_MAX),
    modes: parseModes(params.get("modes")),
    // До трёх пересадок — постоянное правило поиска, отключать его ссылкой нельзя.
    deep: true,
    passengers: Math.min(6, Math.max(1, parseNumber(params.get("pax"), 1))),
    abroadOnly: params.get("abroad") === "1",
    roundTrip: params.get("rt") === "1",
    stayMin: clamp(parseNumber(params.get("smin"), 1), 1, 30),
    stayMax: clamp(parseNumber(params.get("smax"), 3), 1, 30),
    departAfter: clamp(Number(params.get("after") ?? 0) || 0, 0, 23),
    arriveBefore: clamp(Number(params.get("before") ?? 24) || 24, 1, 24),
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
  if (state.passengers > 1) params.set("pax", String(state.passengers));
  if (state.abroadOnly) params.set("abroad", "1");
  if (state.roundTrip) {
    params.set("rt", "1");
    params.set("smin", String(state.stayMin));
    params.set("smax", String(state.stayMax));
  }
  if (state.departAfter > 0) params.set("after", String(state.departAfter));
  if (state.arriveBefore < 24) params.set("before", String(state.arriveBefore));
  if (state.selected) params.set("city", state.selected);
  window.history.replaceState(null, "", `?${params.toString()}`);
}
