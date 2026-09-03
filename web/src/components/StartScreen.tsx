import { useState, type CSSProperties } from "react";

import { MODES, MODE_LABELS, formatPrice, type CityOut, type Mode, type ProgressOut } from "../api";
import {
  BUDGET_SLIDER_STEPS,
  BUDGET_UNLIMITED,
  budgetToSlider,
  sliderToBudget,
} from "../urlState";
import { AdvancedFilters, type FilterHandlers, type FilterValues } from "./AdvancedFilters";
import { CitySelect } from "./CitySelect";
import { DatePicker } from "./DatePicker";
import { Icon, type IconName } from "./Icon";
import { SearchProgress } from "./SearchProgress";
import type { SearchHistoryEntry } from "../searchHistory";

/** Частые ответы на «сколько у меня есть»: один клик вместо возни с ползунком. */
const BUDGET_PRESETS = [
  { label: "3 000 ₽", value: 3000 },
  { label: "6 000 ₽", value: 6000 },
  { label: "15 000 ₽", value: 15000 },
  { label: "Без лимита", value: BUDGET_UNLIMITED },
];

/** Что стоит знать до первого поиска. Каждый пункт проверяется по коду. */
const FACTS: Array<{ icon: IconName; text: string }> = [
  { icon: "globe", text: "365 направлений" },
  { icon: "swap", text: "до 3 пересадок" },
  { icon: "check", text: "покупка на Туту" },
];

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
  progress: ProgressOut;
  eta: number | null;
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
    progress,
    eta,
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

  const { budget, onBudget } = filters;
  const [advanced, setAdvanced] = useState(false);
  const budgetLabel = budget >= BUDGET_UNLIMITED ? "без лимита" : formatPrice(budget);

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
            <div>
              <div className="font-display text-xl font-extrabold tracking-[-0.05em] text-tb-ink">
                Travel<span className="text-tb-hero">Broke</span>
              </div>
              <div className="mt-0.5 text-xs text-tb-muted">
                Ты на мели. Мы всё равно тебя увезём.
              </div>
            </div>
            <div className="tb-tag">на данных MCP Туту</div>
          </header>

          <h1 className="font-display mt-8 max-w-3xl text-2xl font-extrabold tracking-[-0.045em] text-tb-ink sm:text-3xl lg:text-4xl">
            Задай бюджет. <span className="text-tb-hero">Увидишь карту, куда на него можно уехать.</span>
          </h1>
          <p className="mt-3 max-w-xl text-base text-tb-muted">
            Один поиск проверяет 365 направлений и раскрашивает карту по цене.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {FACTS.map((fact) => (
              <span
                key={fact.text}
                className="flex items-center gap-2 rounded-full bg-tb-fill px-3 py-1.5 text-xs font-medium text-tb-ink"
              >
                <Icon name={fact.icon} size={14} className="shrink-0 text-tb-hero" />
                {fact.text}
              </span>
            ))}
          </div>

          {/* Виды транспорта — не вкладки, а тумблеры: включены все четыре, и
              любой можно выключить. Прежний ряд «знак в кружке + подпись» читался
              как декоративная иконка, поэтому здесь форма чипа с галочкой: она
              сама говорит, что состояние переключается и сейчас оно «включено». */}
          <div className="mt-6">
            <div className="tb-tag mb-2">Чем едем — можно отключить</div>
            <div className="flex flex-wrap gap-2">
              {MODES.map((mode) => {
                const active = modes.includes(mode);
                const last = active && modes.length === 1;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => onToggleMode(mode)}
                    aria-pressed={active}
                    title={
                      last
                        ? "Хотя бы один вид транспорта должен остаться включённым"
                        : active
                          ? `Выключить: ${MODE_LABELS[mode]}`
                          : `Включить: ${MODE_LABELS[mode]}`
                    }
                    className={`flex cursor-pointer items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-semibold transition-[background-color,border-color,color,transform] duration-150 ease-out active:translate-y-px ${
                      active
                        ? "border-tb-ink bg-tb-ink text-tb-band"
                        : "border-tb-line text-tb-muted hover:border-tb-muted hover:text-tb-ink"
                    }`}
                  >
                    <Icon name={mode} size={18} />
                    {MODE_LABELS[mode]}
                    <Icon
                      name={active ? "check" : "plus"}
                      size={13}
                      className={active ? "opacity-70" : "opacity-50"}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Белый остров: строка поиска и её выпадающие списки всегда светлые. */}
          <div className="tb-light-island tb-plate mt-3 p-3 sm:p-4">
            {/* Бюджет — главный фильтр продукта, а не строка в «расширенных».
                Весь вопрос звучит как «куда я уеду за эти деньги», поэтому цена
                стоит первой и крупнее всего остального в строке поиска. */}
            <div className="border-b border-tb-line pb-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <label htmlFor="tb-budget" className="tb-tag">
                  Сколько готов потратить на человека
                </label>
                <span className="tb-num text-2xl font-bold text-tb-hero sm:text-3xl">
                  {budgetLabel}
                </span>
              </div>
              <input
                id="tb-budget"
                type="range"
                min={0}
                max={BUDGET_SLIDER_STEPS}
                step={1}
                value={budgetToSlider(budget)}
                onChange={(event) => onBudget(sliderToBudget(Number(event.target.value)))}
                className="tb-range mt-1"
                style={
                  {
                    "--tb-progress": `${(budgetToSlider(budget) / BUDGET_SLIDER_STEPS) * 100}%`,
                  } as CSSProperties
                }
                aria-valuetext={budgetLabel}
                aria-label="Бюджет на человека: крайнее правое положение снимает ограничение"
              />
              <div className="tb-num mb-2 flex justify-between text-2xs text-tb-muted">
                <span>100 ₽</span>
                <span>без лимита</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {BUDGET_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => onBudget(preset.value)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-150 ease-out ${
                      budget === preset.value
                        ? "bg-tb-accent text-white"
                        : "bg-tb-fill text-tb-muted hover:text-tb-ink"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-[minmax(12rem,1.4fr)_minmax(10rem,1fr)_8rem_auto] md:items-end">
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
                  showBudget={false}
                  passengers={passengers}
                  onPassengers={onPassengers}
                  {...filters}
                />
              </div>
            )}

            {loading && (
              <div className="mt-3 border-t border-tb-line pt-3">
                <SearchProgress progress={progress} eta={eta} />
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
