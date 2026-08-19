import { useState } from "react";

import { MODE_LABELS, MODES, formatPrice, type CityOut, type Mode } from "../api";
import { CitySelect } from "./CitySelect";
import { DatePicker } from "./DatePicker";

interface Props {
  cities: CityOut[];
  origin: string;
  date: string;
  budget: number;
  maxHours: number;
  modes: Mode[];
  deep: boolean;
  passengers: number;
  loading: boolean;
  needsSearch: boolean;
  onOrigin: (value: string) => void;
  onDate: (value: string) => void;
  onBudget: (value: number) => void;
  onMaxHours: (value: number) => void;
  onToggleMode: (mode: Mode) => void;
  onDeep: (value: boolean) => void;
  onPassengers: (value: number) => void;
  onSearch: () => void;
}

const LABEL = "text-[10px] font-semibold tracking-[0.08em] text-tb-muted uppercase";

const MAX_PASSENGERS = 6;

function plural(count: number): string {
  const last = count % 10;
  const tens = count % 100;
  if (last === 1 && tens !== 11) return "пассажир";
  if (last >= 2 && last <= 4 && (tens < 12 || tens > 14)) return "пассажира";
  return "пассажиров";
}

/** Панель управления картой: откуда, когда, за сколько, на чём и вас сколько. */
export function ControlPanel(props: Props) {
  const {
    cities,
    origin,
    date,
    budget,
    maxHours,
    modes,
    deep,
    passengers,
    loading,
    needsSearch,
    onOrigin,
    onDate,
    onBudget,
    onMaxHours,
    onToggleMode,
    onDeep,
    onPassengers,
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
    <aside className="pointer-events-auto w-full shrink-0 rounded-3xl bg-tb-panel/95 p-4 shadow-2xl ring-1 ring-tb-line backdrop-blur-xl sm:p-5">
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <span className={LABEL}>Откуда</span>
          <CitySelect cities={cities} value={origin} onChange={onOrigin} />
        </div>
        <div>
          <span className={LABEL}>Когда</span>
          <DatePicker value={date} onChange={onDate} />
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className={LABEL}>Бюджет на человека</span>
          <span className="text-xl font-black text-tb-hero">{formatPrice(budget)}</span>
        </div>
        <input
          type="range"
          min={500}
          max={30000}
          step={500}
          value={budget}
          onChange={(event) => onBudget(Number(event.target.value))}
          className="mt-1.5 w-full accent-tb-accent"
          aria-label="Бюджет поездки"
        />
      </div>

      <div className="mt-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className={LABEL}>Не дольше</span>
          <span className="text-xl font-black text-tb-accent">{maxHours} ч</span>
        </div>
        <input
          type="range"
          min={2}
          max={48}
          step={1}
          value={maxHours}
          onChange={(event) => onMaxHours(Number(event.target.value))}
          className="mt-1.5 w-full accent-tb-accent"
          aria-label="Максимум часов в пути"
        />
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div>
          <span className={LABEL}>Пассажиры</span>
          <div className="text-[13px] text-tb-muted">
            {passengers} {plural(passengers)}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onPassengers(Math.max(1, passengers - 1))}
            disabled={passengers <= 1}
            aria-label="Убрать пассажира"
            className="size-8 rounded-lg bg-tb-fill text-base font-bold text-tb-ink transition hover:brightness-105 disabled:opacity-40"
          >
            −
          </button>
          <span className="w-6 text-center text-[15px] font-black text-tb-ink">{passengers}</span>
          <button
            type="button"
            onClick={() => onPassengers(Math.min(MAX_PASSENGERS, passengers + 1))}
            disabled={passengers >= MAX_PASSENGERS}
            aria-label="Добавить пассажира"
            className="size-8 rounded-lg bg-tb-fill text-base font-bold text-tb-ink transition hover:brightness-105 disabled:opacity-40"
          >
            +
          </button>
        </div>
      </div>

      <div className="mt-4">
        <span className={LABEL}>Транспорт</span>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          {MODES.map((mode) => {
            const active = modes.includes(mode);
            return (
              <button
                key={mode}
                type="button"
                onClick={() => onToggleMode(mode)}
                aria-pressed={active}
                className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold transition ${
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

      <label className="mt-3.5 flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={deep}
          onChange={(event) => onDeep(event.target.checked)}
          className="mt-0.5 size-3.5 shrink-0 accent-tb-accent"
        />
        <span className="text-[12px] leading-snug text-tb-muted">
          <span className="font-semibold text-tb-ink">Искать пересадки.</span> Составные
          маршруты бывают дешевле прямых, на стыковку закладываем запас времени.
        </span>
      </label>

      <button
        type="button"
        onClick={onSearch}
        disabled={loading}
        className="mt-4 w-full rounded-xl bg-tb-accent px-4 py-2.5 text-[15px] font-black text-white transition hover:brightness-110 disabled:cursor-progress disabled:opacity-60"
      >
        {loading ? "Считаем маршруты…" : needsSearch ? "Обновить карту" : "Куда я могу уехать"}
      </button>

      <button
        type="button"
        onClick={share}
        className="mt-1.5 w-full rounded-xl bg-tb-fill px-4 py-1.5 text-[12px] font-semibold text-tb-muted transition hover:text-tb-ink"
      >
        {copied ? "Ссылка скопирована" : "Поделиться этим видом"}
      </button>
    </aside>
  );
}
