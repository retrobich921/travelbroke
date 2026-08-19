import { useEffect, useMemo, useRef, useState } from "react";

import { fetchCitySuggestions, type CityOut } from "../api";
import { POPOVER, useDismiss } from "./Popover";

interface Props {
  cities: CityOut[];
  value: string;
  onChange: (value: string) => void;
  /** Светлая форма поверх тёмного лендинга. */
  surface?: "default" | "light";
}

/**
 * Выбор города отправления.
 *
 * Это combobox, а не ограниченный `<select>`: пользователь может сразу напечатать
 * любой город. Список внизу — быстрые варианты, а не полный каталог мира.
 */
export function CitySelect({ cities, value, onChange, surface = "default" }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<CityOut[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const light = surface === "light";

  useDismiss(root, open, () => setOpen(false));

  const found = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const local = !needle
      ? cities
      : cities.filter(
      (city) =>
        city.name.toLowerCase().includes(needle) || city.country.toLowerCase().includes(needle),
      );
    const seen = new Set(local.map((city) => `${city.name}::${city.country}`));
    const remoteMatches = needle.length >= 2 ? remote : [];
    return [...local, ...remoteMatches.filter((city) => !seen.has(`${city.name}::${city.country}`))];
  }, [cities, query, remote]);

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) {
      return;
    }
    const timer = window.setTimeout(() => {
      setSuggesting(true);
      fetchCitySuggestions(needle)
        .then(setRemote)
        .catch(() => setRemote([]))
        .finally(() => setSuggesting(false));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [query]);

  const choose = (name: string) => {
    onChange(name);
    setOpen(false);
    setQuery("");
    setRemote([]);
  };

  const submitTypedCity = () => {
    const city = query.trim();
    if (city) choose(city);
  };

  return (
    <div ref={root} className="relative">
      <div
        className={`mt-1 flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-[13px] font-medium transition focus:ring-2 focus:ring-tb-accent focus:outline-none ${
          light
            ? "bg-[#eff0ff] text-[#17124f] hover:bg-[#e3e2ff]"
            : "bg-tb-fill text-tb-ink hover:brightness-105"
        }`}
      >
        <input
          value={open ? query : value}
          onFocus={() => {
            setOpen(true);
            setQuery("");
          }}
          onChange={(event) => {
            setOpen(true);
            setQuery(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submitTypedCity();
            }
            if (event.key === "Escape") setOpen(false);
          }}
          aria-label="Город отправления"
          aria-autocomplete="list"
          aria-controls={open ? "city-suggestions" : undefined}
          placeholder="Начните вводить город"
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[#8c88aa]"
        />
        <span className="shrink-0 text-tb-muted" aria-hidden="true">⌕</span>
      </div>

      {open && (
        <div className={`${POPOVER} left-0 w-full ${light ? "!bg-white !ring-[#d9d6ff]" : ""}`}>
          <div className="border-b border-tb-line px-3 py-2 text-xs text-tb-muted">
            {query.trim().length < 2
              ? "Начни вводить название — ищем города по всему миру."
              : "Enter — использовать введённый город; ниже — точные подсказки."}
          </div>
          <ul id="city-suggestions" role="listbox" className="tb-scroll max-h-64 overflow-y-auto px-1 py-1">
            {suggesting && <li className="px-3 py-2 text-xs text-tb-muted">Ищем по миру…</li>}
            {!suggesting && found.length === 0 && query.trim().length > 1 && (
              <li className="px-3 py-4 text-center text-xs text-tb-muted">
                Не нашли подсказку. Введи название полностью — Туту попробует распознать его.
              </li>
            )}
            {found.map((city) => (
              <li key={city.slug}>
                <button
                  type="button"
                  role="option"
                  aria-selected={city.name === value}
                  onClick={() => choose(city.name)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition ${
                    city.name === value
                      ? "bg-tb-accent font-semibold text-white"
                      : light
                        ? "text-[#17124f] hover:bg-[#eff0ff]"
                        : "text-tb-ink hover:bg-tb-fill"
                  }`}
                >
                  <span className="truncate">{city.name}</span>
                  {city.country !== "Россия" && (
                    <span
                      className={`shrink-0 text-[11px] ${
                        city.name === value
                          ? "text-white/70"
                          : light
                            ? "text-[#6b6790]"
                            : "text-tb-muted"
                      }`}
                    >
                      {city.country}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
