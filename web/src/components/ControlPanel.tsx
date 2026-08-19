import { useState } from "react";

import { MODE_LABELS, MODES, formatPrice, type CityOut, type Mode } from "../api";

interface Props {
  cities: CityOut[];
  origin: string;
  date: string;
  budget: number;
  maxHours: number;
  modes: Mode[];
  deep: boolean;
  loading: boolean;
  onOrigin: (value: string) => void;
  onDate: (value: string) => void;
  onBudget: (value: number) => void;
  onMaxHours: (value: number) => void;
  onToggleMode: (mode: Mode) => void;
  onDeep: (value: boolean) => void;
  onSearch: () => void;
}

/** Панель управления картой: откуда, когда, за сколько и на чём. */
export function ControlPanel(props: Props) {
  const {
    cities,
    origin,
    date,
    budget,
    maxHours,
    modes,
    deep,
    loading,
    onOrigin,
    onDate,
    onBudget,
    onMaxHours,
    onToggleMode,
    onDeep,
    onSearch,
  } = props;

  const [copied, setCopied] = useState(false);

  /** Весь вид карты описан адресной строкой, так что делиться нечем, кроме неё. */
  const share = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <aside className="pointer-events-auto w-84 max-w-[calc(100vw-3rem)] rounded-3xl bg-tb-ink/92 p-6 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl">
      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-1">
          <span className="text-[11px] font-semibold tracking-wider text-tb-muted uppercase">
            Откуда
          </span>
          <select
            value={origin}
            onChange={(e) => onOrigin(e.target.value)}
            className="mt-1 w-full rounded-xl bg-white/10 px-3 py-2 text-sm font-medium text-white outline-none focus:ring-2 focus:ring-tb-accent"
          >
            {cities.map((city) => (
              <option key={city.slug} value={city.name} className="text-tb-ink">
                {city.name}
              </option>
            ))}
          </select>
        </label>

        <label className="col-span-1">
          <span className="text-[11px] font-semibold tracking-wider text-tb-muted uppercase">
            Когда
          </span>
          <input
            type="date"
            value={date}
            onChange={(e) => onDate(e.target.value)}
            className="mt-1 w-full rounded-xl bg-white/10 px-3 py-2 text-sm font-medium text-white outline-none focus:ring-2 focus:ring-tb-accent"
          />
        </label>
      </div>

      <div className="mt-6">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] font-semibold tracking-wider text-tb-muted uppercase">
            Бюджет
          </span>
          <span className="text-2xl font-black text-tb-cheap">{formatPrice(budget)}</span>
        </div>
        <input
          type="range"
          min={500}
          max={30000}
          step={500}
          value={budget}
          onChange={(e) => onBudget(Number(e.target.value))}
          className="mt-2 w-full accent-tb-accent"
        />
      </div>

      <div className="mt-5">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] font-semibold tracking-wider text-tb-muted uppercase">
            Не дольше
          </span>
          <span className="text-2xl font-black text-tb-expensive">{maxHours} ч</span>
        </div>
        <input
          type="range"
          min={2}
          max={48}
          step={1}
          value={maxHours}
          onChange={(e) => onMaxHours(Number(e.target.value))}
          className="mt-2 w-full accent-tb-accent"
        />
      </div>

      <div className="mt-6">
        <span className="text-[11px] font-semibold tracking-wider text-tb-muted uppercase">
          Транспорт
        </span>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {MODES.map((mode) => {
            const active = modes.includes(mode);
            return (
              <button
                key={mode}
                type="button"
                onClick={() => onToggleMode(mode)}
                aria-pressed={active}
                className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                  active
                    ? "bg-tb-accent text-white"
                    : "bg-white/8 text-tb-muted hover:bg-white/15"
                }`}
              >
                {MODE_LABELS[mode]}
              </button>
            );
          })}
        </div>
      </div>

      <label className="mt-5 flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={deep}
          onChange={(e) => onDeep(e.target.checked)}
          className="mt-1 size-4 accent-tb-accent"
        />
        <span className="text-sm text-tb-muted">
          <span className="font-semibold text-white">Искать пересадки</span>
          <br />
          Составные маршруты бывают дешевле прямых. Считается дольше.
        </span>
      </label>

      <button
        type="button"
        onClick={onSearch}
        disabled={loading}
        className="mt-6 w-full rounded-2xl bg-tb-cheap px-4 py-3 text-base font-black text-tb-ink transition hover:brightness-110 disabled:cursor-progress disabled:opacity-60"
      >
        {loading ? "Считаем маршруты…" : "Куда я могу уехать"}
      </button>

      <button
        type="button"
        onClick={share}
        className="mt-2 w-full rounded-2xl bg-white/8 px-4 py-2 text-sm font-semibold text-tb-muted transition hover:bg-white/15 hover:text-white"
      >
        {copied ? "Ссылка скопирована" : "Поделиться этим видом"}
      </button>
    </aside>
  );
}
