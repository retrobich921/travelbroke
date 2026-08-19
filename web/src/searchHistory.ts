import type { Mode } from "./api";

const COOKIE = "travelbroke_recent_searches";
const MAX_ENTRIES = 5;
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export interface SearchHistoryEntry {
  origin: string;
  date: string;
  modes: Mode[];
  budget: number;
  maxHours: number;
  passengers: number;
  departAfter: number;
  arriveBefore: number;
  abroadOnly: boolean;
  roundTrip: boolean;
  stayMin: number;
  stayMax: number;
}

function valid(entry: Partial<SearchHistoryEntry>): entry is SearchHistoryEntry {
  return (
    typeof entry.origin === "string" &&
    typeof entry.date === "string" &&
    Array.isArray(entry.modes) &&
    typeof entry.budget === "number" &&
    typeof entry.maxHours === "number" &&
    typeof entry.passengers === "number" &&
    typeof entry.departAfter === "number" &&
    typeof entry.arriveBefore === "number" &&
    typeof entry.abroadOnly === "boolean" &&
    typeof entry.roundTrip === "boolean" &&
    typeof entry.stayMin === "number" &&
    typeof entry.stayMax === "number"
  );
}

export function readSearchHistory(): SearchHistoryEntry[] {
  const encoded = document.cookie
    .split("; ")
    .find((item) => item.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!encoded) return [];
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(encoded));
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is SearchHistoryEntry => valid(entry))
      : [];
  } catch {
    return [];
  }
}

export function saveSearchHistory(entry: SearchHistoryEntry): SearchHistoryEntry[] {
  const previous = readSearchHistory();
  const unique = previous.filter(
    (item) => !(item.origin === entry.origin && item.date === entry.date),
  );
  const next = [entry, ...unique].slice(0, MAX_ENTRIES);
  document.cookie = `${COOKIE}=${encodeURIComponent(JSON.stringify(next))}; Max-Age=${MAX_AGE_SECONDS}; Path=/; SameSite=Lax`;
  return next;
}

export function clearSearchHistory(): void {
  document.cookie = `${COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
}
