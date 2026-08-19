import { useEffect, useMemo, useRef, useState } from "react";

import { fetchCitySuggestions, type CityOut } from "../api";
import { Icon } from "./Icon";
import { POPOVER, useDismiss } from "./Popover";

interface Props {
  cities: CityOut[];
  value: string;
  onChange: (value: string) => void;
}

/**
 * Выбор города отправления.
 *
 * Это combobox, а не ограниченный `<select>`: пользователь может сразу напечатать
 * любой город. Список внизу — быстрые варианты, а не полный каталог мира.
 */
export function CitySelect({ cities, value, onChange }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<CityOut[]>([]);
  const [suggesting, setSuggesting] = useState(false);

  useDismiss(root, open, () => setOpen(false));

  const found = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const local = !needle
      ? cities
      : cities.filter(
          (city) =>
            city.name.toLowerCase().includes(needle) ||
            city.country.toLowerCase().includes(needle),
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
      <div className="mt-1 flex w-full items-center gap-2 rounded-sm border border-tb-line bg-tb-fill px-3 py-2 text-left text-sm font-medium transition-colors duration-150 ease-out focus-within:border-tb-accent">
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
          aria-expanded={open}
          aria-controls={open ? "city-suggestions" : undefined}
          placeholder="Начните вводить город"
          className="min-w-0 flex-1 bg-transparent text-tb-ink outline-none placeholder:text-tb-muted/70"
        />
        <Icon name="search" size={15} className="shrink-0 text-tb-muted" />
      </div>

      {open && (
        <div className={`${POPOVER} left-0 w-full`}>
          <div className="border-b border-tb-line px-3 py-2 text-xs text-tb-muted">
            {query.trim().length < 2
              ? "Начни вводить название — ищем города по всему миру."
              : "Enter — использовать введённый город; ниже — точные подсказки."}
          </div>
          <ul
            id="city-suggestions"
            role="listbox"
            className="tb-scroll max-h-64 overflow-y-auto p-1"
          >
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
                  className={`flex w-full items-center justify-between gap-2 rounded-xs px-3 py-1.5 text-left text-sm transition-colors duration-150 ease-out ${
                    city.name === value
                      ? "bg-tb-accent font-semibold text-white"
                      : "text-tb-ink hover:bg-tb-fill"
                  }`}
                >
                  <span className="truncate">{city.name}</span>
                  {city.country !== "Россия" && (
                    <span
                      className={`shrink-0 text-xs ${
                        city.name === value ? "text-white/75" : "text-tb-muted"
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
