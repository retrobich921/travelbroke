import { useMemo, useRef, useState } from "react";

import type { CityOut } from "../api";
import { POPOVER, useDismiss } from "./Popover";

interface Props {
  cities: CityOut[];
  value: string;
  onChange: (value: string) => void;
}

/**
 * Выбор города отправления.
 *
 * Системный `<select>` на Windows рисуется в собственной палитре и в тёмной теме
 * выглядел нечитаемым, поэтому список свой. Заодно появился поиск: городов
 * восемь десятков, листать их мышью — мучение.
 */
export function CitySelect({ cities, value, onChange }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useDismiss(root, open, () => setOpen(false));

  const found = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return cities;
    return cities.filter(
      (city) =>
        city.name.toLowerCase().includes(needle) || city.country.toLowerCase().includes(needle),
    );
  }, [cities, query]);

  const choose = (name: string) => {
    onChange(name);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="mt-1 flex w-full items-center justify-between gap-2 rounded-xl bg-tb-fill px-3 py-2 text-left text-[13px] font-medium text-tb-ink transition hover:brightness-105 focus:ring-2 focus:ring-tb-accent focus:outline-none"
      >
        <span className="truncate">{value}</span>
        <span className="shrink-0 text-tb-muted">▾</span>
      </button>

      {open && (
        <div className={POPOVER}>
          <div className="p-2">
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Найти город"
              className="w-full rounded-lg bg-tb-fill px-3 py-2 text-[13px] text-tb-ink outline-none focus:ring-2 focus:ring-tb-accent"
            />
          </div>
          <ul role="listbox" className="tb-scroll max-h-64 overflow-y-auto px-1 pb-2">
            {found.length === 0 && (
              <li className="px-3 py-4 text-center text-xs text-tb-muted">Ничего не нашлось</li>
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
                      : "text-tb-ink hover:bg-tb-fill"
                  }`}
                >
                  <span className="truncate">{city.name}</span>
                  {city.country !== "Россия" && (
                    <span
                      className={`shrink-0 text-[11px] ${
                        city.name === value ? "text-white/70" : "text-tb-muted"
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
