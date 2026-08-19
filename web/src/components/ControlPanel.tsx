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

const LABEL = "text-[11px] font-semibold tracking-wider text-tb-muted uppercase";
const FIELD =
  "mt-1 w-full rounded-xl bg-tb-fill px-3 py-2 text-sm font-medium text-tb-ink outline-none focus:ring-2 focus:ring-tb-accent";

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
    <aside className="tb-sheet pointer-events-auto w-full rounded-3xl bg-tb-panel/95 p-5 shadow-2xl ring-1 ring-tb-line backdrop-blur-xl sm:p-6 lg:w-84">
      <div className="grid grid-cols-2 gap-3">
        <label>
          <span className={LABEL}>Откуда</span>
          <select value={origin} onChange={(e) => onOrigin(e.target.value)} className={FIELD}>
            {cities.map((city) => (
              <option key={city.slug} value={city.name}>
                {city.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className={LABEL}>Когда</span>
          <input
            type="date"
            value={date}
            onChange={(e) => onDate(e.target.value)}
            className={FIELD}
          />
        </label>
      </div>

      <div className="mt-5">
        <div className="flex items-baseline justify-between gap-2">
          <span className={LABEL}>Бюджет</span>
          <span className="text-2xl font-black text-tb-hero">{formatPrice(budget)}</span>
        </div>
        <input
          type="range"
          min={500}
          max={30000}
          step={500}
          value={budget}
          onChange={(e) => onBudget(Number(e.target.value))}
          className="mt-2 w-full accent-tb-accent"
          aria-label="Бюджет поездки"
        />
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className={LABEL}>Не дольше</span>
          <span className="text-2xl font-black text-tb-accent">{maxHours} ч</span>
        </div>
        <input
          type="range"
          min={2}
          max={48}
          step={1}
          value={maxHours}
          onChange={(e) => onMaxHours(Number(e.target.value))}
          className="mt-2 w-full accent-tb-accent"
          aria-label="Максимум часов в пути"
        />
      </div>

      <div className="mt-5">
        <span className={LABEL}>Транспорт</span>
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
                    : "bg-tb-fill text-tb-muted hover:text-tb-ink"
                }`}
              >
                {MODE_LABELS[mode]}
              </button>
            );
          })}
        </div>
      </div>

      <label className="mt-4 flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={deep}
          onChange={(e) => onDeep(e.target.checked)}
          className="mt-1 size-4 shrink-0 accent-tb-accent"
        />
        <span className="text-sm text-tb-muted">
          <span className="font-semibold text-tb-ink">Искать пересадки</span>
          <br />
          Составные маршруты бывают дешевле прямых. На стыковку закладываем запас
          времени, считается дольше.
        </span>
      </label>

      <button
        type="button"
        onClick={onSearch}
        disabled={loading}
        className="mt-5 w-full rounded-2xl bg-tb-accent px-4 py-3 text-base font-black text-white transition hover:brightness-110 disabled:cursor-progress disabled:opacity-60"
      >
        {loading ? "Считаем маршруты…" : "Куда я могу уехать"}
      </button>

      <button
        type="button"
        onClick={share}
        className="mt-2 w-full rounded-2xl bg-tb-fill px-4 py-2 text-sm font-semibold text-tb-muted transition hover:text-tb-ink"
      >
        {copied ? "Ссылка скопирована" : "Поделиться этим видом"}
      </button>
    </aside>
  );
}
