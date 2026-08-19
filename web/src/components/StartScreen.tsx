import { useState } from "react";

import { MODES, MODE_LABELS, type CityOut, type Mode } from "../api";
import { AdvancedFilters, type FilterHandlers, type FilterValues } from "./AdvancedFilters";
import { CitySelect } from "./CitySelect";
import { DatePicker } from "./DatePicker";
import { Icon } from "./Icon";
import { SearchProgress } from "./SearchProgress";
import type { SearchHistoryEntry } from "../searchHistory";

/** Города, из которых уезжают чаще всего — быстрый выбор под строкой поиска. */
const QUICK_CITIES = ["Москва", "Санкт-Петербург", "Казань", "Екатеринбург"];

function iso(day: Date): string {
  return new Date(day.getTime() - day.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function isoIn(days: number): string {
  const day = new Date();
  day.setDate(day.getDate() + days);
  return iso(day);
}

function isoNextSaturday(): string {
  const day = new Date();
  day.setDate(day.getDate() + ((6 - day.getDay() + 7) % 7 || 7));
  return iso(day);
}

function historyDate(value: string): string {
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

interface Props extends FilterValues, FilterHandlers {
  cities: CityOut[];
  origin: string;
  date: string;
  modes: Mode[];
  loading: boolean;
  calls: number;
  error: string | null;
  onOrigin: (value: string) => void;
  onDate: (value: string) => void;
  onToggleMode: (mode: Mode) => void;
  onStart: () => void;
  recentSearches: SearchHistoryEntry[];
  onUseRecent: (entry: SearchHistoryEntry) => void;
  onClearRecent: () => void;
}

/**
 * Вход в сценарий.
 *
 * Строка поиска устроена как на Туту: ряд видов транспорта, под ним одна белая
 * плашка с полями и кнопкой, под ней — быстрые подстановки города и даты. Всё
 * лишнее убрано: ни макетов с выдуманными ценами, ни плашек с галочками, ни
 * ссылок в никуда. Настройки, которые раньше жили только над картой, доступны
 * прямо здесь — под «Расширенными фильтрами», так что полноценный поиск
 * запускается со стартового экрана, а не после него.
 */
export function StartScreen(props: Props) {
  const {
    cities,
    origin,
    date,
    modes,
    passengers,
    loading,
    calls,
    error,
    onOrigin,
    onDate,
    onToggleMode,
    onPassengers,
    onStart,
    recentSearches,
    onUseRecent,
    onClearRecent,
    ...filters
  } = props;

  const [advanced, setAdvanced] = useState(false);

  const quickDates = [
    { label: "Сегодня", value: isoIn(0) },
    { label: "Завтра", value: isoIn(1) },
    { label: "В субботу", value: isoNextSaturday() },
  ];

  return (
    <section className="absolute inset-0 z-40 overflow-y-auto bg-tb-bg">
      <div className="tb-band">
        <div className="mx-auto w-full max-w-6xl px-5 py-5 sm:px-8 sm:py-7">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div className="font-display text-xl font-extrabold tracking-[-0.05em] text-tb-ink">
              Travel<span className="text-tb-hero">Broke</span>
            </div>
            <div className="tb-tag">на данных MCP Туту</div>
          </header>

          <h1 className="font-display mt-8 max-w-3xl text-2xl font-extrabold tracking-[-0.045em] text-tb-ink sm:text-3xl lg:text-4xl">
            Ты на мели. <span className="text-tb-hero">Мы всё равно тебя увезём.</span>
          </h1>
          <p className="mt-3 max-w-2xl text-base text-tb-muted">
            Не «сколько стоит билет до Сочи», а «покажи всё, куда я уеду за эти деньги» —
            по всему миру и всеми видами транспорта сразу.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {["252 страны · 34 000 городов", "4 вида транспорта", "составные маршруты"].map((fact) => (
              <span
                key={fact}
                className="rounded-full border border-tb-line px-3 py-1 text-xs font-medium text-tb-ink"
              >
                {fact}
              </span>
            ))}
          </div>

          {/* Ряд видов транспорта — он же фильтр: карта считается по включённым. */}
          <div className="mt-7 flex flex-wrap gap-1">
            {MODES.map((mode) => {
              const active = modes.includes(mode);
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onToggleMode(mode)}
                  aria-pressed={active}
                  title={active ? "Выключить этот транспорт" : "Включить этот транспорт"}
                  className="group flex w-20 flex-col items-center gap-1.5 rounded-md py-2 transition-colors duration-150 ease-out hover:bg-tb-fill"
                >
                  <span
                    className={`grid size-9 place-items-center rounded-full transition-colors duration-150 ease-out ${
                      active
                        ? "bg-tb-ink text-tb-band"
                        : "border border-tb-line text-tb-muted group-hover:text-tb-ink"
                    }`}
                  >
                    <Icon name={mode} size={18} />
                  </span>
                  <span
                    className={`text-xs font-medium ${active ? "text-tb-ink" : "text-tb-muted"}`}
                  >
                    {MODE_LABELS[mode]}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Белый остров: строка поиска и её выпадающие списки всегда светлые. */}
          <div className="tb-light-island tb-plate mt-3 p-3 sm:p-4">
            <div className="grid gap-3 md:grid-cols-[minmax(12rem,1.4fr)_minmax(10rem,1fr)_8rem_auto] md:items-end">
              <label className="block">
                <span className="tb-tag">Откуда</span>
                <CitySelect cities={cities} value={origin} onChange={onOrigin} />
              </label>
              <label className="block">
                <span className="tb-tag">Когда</span>
                <DatePicker value={date} onChange={onDate} />
              </label>
              <div>
                <span className="tb-tag">Пассажиры</span>
                <div className="mt-1 flex h-9 items-center justify-between rounded-xs border border-tb-line bg-tb-fill px-1.5">
                  <button
                    type="button"
                    onClick={() => onPassengers(Math.max(1, passengers - 1))}
                    disabled={passengers <= 1}
                    aria-label="Убрать пассажира"
                    className="grid size-6 place-items-center rounded-xs text-tb-ink transition-colors hover:bg-white disabled:opacity-30"
                  >
                    <Icon name="minus" size={13} />
                  </button>
                  <span className="tb-num text-sm font-bold text-tb-ink">{passengers} пасс.</span>
                  <button
                    type="button"
                    onClick={() => onPassengers(Math.min(6, passengers + 1))}
                    disabled={passengers >= 6}
                    aria-label="Добавить пассажира"
                    className="grid size-6 place-items-center rounded-xs text-tb-ink transition-colors hover:bg-white disabled:opacity-30"
                  >
                    <Icon name="plus" size={13} />
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={onStart}
                disabled={loading}
                className="mt-1 flex items-center justify-center gap-2 rounded-sm bg-tb-accent px-6 py-2.5 text-sm font-bold text-white transition-[filter,transform] duration-150 ease-out hover:brightness-115 active:translate-y-px disabled:cursor-progress disabled:opacity-60"
              >
                {loading ? "Собираем маршруты…" : "Показать карту"}
                {!loading && <Icon name="arrowRight" size={16} />}
              </button>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-tb-line pt-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {QUICK_CITIES.map((city) => (
                  <button
                    key={city}
                    type="button"
                    onClick={() => onOrigin(city)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-150 ease-out ${
                      origin === city
                        ? "bg-tb-accent text-white"
                        : "bg-tb-fill text-tb-muted hover:text-tb-ink"
                    }`}
                  >
                    {city}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {quickDates.map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    onClick={() => onDate(option.value)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-150 ease-out ${
                      date === option.value
                        ? "bg-tb-accent text-white"
                        : "bg-tb-fill text-tb-muted hover:text-tb-ink"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setAdvanced((open) => !open)}
                aria-expanded={advanced}
                className="ml-auto flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-tb-hero transition-colors duration-150 ease-out hover:brightness-110"
              >
                Расширенные фильтры
                <span className={`transition-transform duration-150 ${advanced ? "rotate-180" : ""}`}>
                  <Icon name="chevronDown" size={13} />
                </span>
              </button>
            </div>

            {advanced && (
              <div className="tb-rise mt-3 border-t border-tb-line pt-4">
                <AdvancedFilters
                  layout="wide"
                  showPassengers={false}
                  passengers={passengers}
                  onPassengers={onPassengers}
                  {...filters}
                />
              </div>
            )}

            {loading && (
              <div className="mt-3 border-t border-tb-line pt-3">
                <SearchProgress
                  calls={calls}
                  note={filters.deep ? "и составные маршруты" : undefined}
                />
              </div>
            )}

            {error && <p className="mt-3 text-xs font-medium text-red-500">{error}</p>}
          </div>

        </div>
      </div>

      <div className="mx-auto w-full max-w-6xl px-5 py-7 sm:px-8 sm:py-9">
        <div className="tb-plate border border-tb-line p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="tb-tag">Недавние поиски</div>
              <p className="mt-1 text-xs text-tb-muted">Сохраняются только в cookie этого браузера.</p>
            </div>
            {recentSearches.length > 0 && (
              <button
                type="button"
                onClick={onClearRecent}
                className="text-xs font-semibold text-tb-muted transition-colors hover:text-tb-hero"
              >
                Очистить
              </button>
            )}
          </div>

          {recentSearches.length === 0 ? (
            <p className="mt-4 text-sm text-tb-muted">Твои следующие поиски появятся здесь.</p>
          ) : (
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {recentSearches.map((entry) => (
                <button
                  key={`${entry.origin}-${entry.date}`}
                  type="button"
                  onClick={() => onUseRecent(entry)}
                  className="group rounded-xs border border-tb-line bg-tb-fill px-3 py-2.5 text-left transition-colors hover:border-tb-accent"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-tb-ink">{entry.origin}</span>
                    <span className="tb-num shrink-0 text-2xs text-tb-muted">{historyDate(entry.date)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-2xs text-tb-muted">
                    <span>{entry.passengers} {entry.passengers === 1 ? "пассажир" : "пассажира"}</span>
                    <span className="tb-num">до {entry.maxHours >= 24 ? `${Math.ceil(entry.maxHours / 24)} дн.` : `${entry.maxHours} ч`}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
