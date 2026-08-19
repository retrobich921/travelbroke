import { useState, type CSSProperties } from "react";

import { formatPrice } from "../api";
import {
  BUDGET_MAX,
  BUDGET_MIN,
  BUDGET_UNLIMITED,
  HOURS_MAX,
  HOURS_MIN,
} from "../urlState";
import { HourSelect } from "./HourSelect";
import { Icon } from "./Icon";

const MAX_PASSENGERS = 6;
const TIME_PRESETS = [2, 3, 6, 9, 12, 24, 48, 72, 96, 120, 144, 168];

/** Доля заполнения дорожки ползунка — своя отрисовка вместо системной. */
function fill(value: number, min: number, max: number): CSSProperties {
  return { "--tb-progress": `${((value - min) / (max - min)) * 100}%` } as CSSProperties;
}

function plural(count: number): string {
  const last = count % 10;
  const tens = count % 100;
  if (last === 1 && tens !== 11) return "пассажир";
  if (last >= 2 && last <= 4 && (tens < 12 || tens > 14)) return "пассажира";
  return "пассажиров";
}

function durationLabel(hours: number): string {
  if (hours >= 24 && hours % 24 === 0) return `${hours / 24} ${hours === 24 ? "день" : "дня"}`;
  return `${hours} ч`;
}

function budgetLabel(budget: number): string {
  return budget >= BUDGET_UNLIMITED ? "∞ без лимита" : formatPrice(budget);
}

function StayStepper({
  caption,
  value,
  min,
  max,
  onChange,
}: {
  caption: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="min-w-0 flex-1 rounded-xs border border-tb-line bg-tb-fill p-1.5">
      <div className="tb-tag text-[9px] text-tb-muted">{caption}</div>
      <div className="mt-1 flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={() => onChange(value - 1)}
          disabled={value <= min}
          aria-label={`Уменьшить: ${caption}`}
          className="grid size-6 place-items-center rounded-xs border border-tb-line text-tb-ink transition-colors hover:border-tb-accent disabled:opacity-30"
        >
          <Icon name="minus" size={12} />
        </button>
        <span className="tb-num text-sm font-bold text-tb-ink">{value}</span>
        <button
          type="button"
          onClick={() => onChange(value + 1)}
          disabled={value >= max}
          aria-label={`Увеличить: ${caption}`}
          className="grid size-6 place-items-center rounded-xs border border-tb-line text-tb-ink transition-colors hover:border-tb-accent disabled:opacity-30"
        >
          <Icon name="plus" size={12} />
        </button>
      </div>
    </div>
  );
}

function Hint({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        className="grid size-4 place-items-center rounded-full border border-tb-line text-tb-muted transition-colors hover:border-tb-accent hover:text-tb-accent focus:border-tb-accent focus:text-tb-accent"
        aria-label={text}
      >
        <Icon name="info" size={10} />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute top-5 left-0 z-30 w-52 rounded-xs border border-tb-line bg-tb-panel px-2.5 py-2 text-2xs leading-snug text-tb-ink opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

function SectionTitle({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="tb-tag text-tb-muted">{title}</span>
      <Hint text={hint} />
    </div>
  );
}

export interface FilterValues {
  budget: number;
  maxHours: number;
  passengers: number;
  departAfter: number;
  arriveBefore: number;
  deep: boolean;
  abroadOnly: boolean;
  roundTrip: boolean;
  stayMin: number;
  stayMax: number;
}

export interface FilterHandlers {
  onBudget: (value: number) => void;
  onMaxHours: (value: number) => void;
  onPassengers: (value: number) => void;
  onDepartAfter: (value: number) => void;
  onArriveBefore: (value: number) => void;
  onDeep: (value: boolean) => void;
  onAbroadOnly: (value: boolean) => void;
  onRoundTrip: (value: boolean) => void;
  onStay: (min: number, max: number) => void;
}

interface Props extends FilterValues, FilterHandlers {
  /** `wide` — в две колонки на широкой строке поиска, `column` — в узком пульте. */
  layout?: "column" | "wide";
  /** На лендинге счётчик вынесен в основную строку поиска. */
  showPassengers?: boolean;
}

/** Все границы продублированы в URL и API: в интерфейсе нельзя выставить невалидное. */
export function AdvancedFilters(props: Props) {
  const {
    budget,
    maxHours,
    passengers,
    departAfter,
    arriveBefore,
    abroadOnly,
    roundTrip,
    stayMin,
    stayMax,
    onBudget,
    onMaxHours,
    onPassengers,
    onDepartAfter,
    onArriveBefore,
    onAbroadOnly,
    onRoundTrip,
    onStay,
    layout = "column",
    showPassengers = true,
  } = props;
  const [timeUnit, setTimeUnit] = useState<"hours" | "days">("hours");
  const wide = layout === "wide";
  const customValue = timeUnit === "hours" ? maxHours : Math.ceil(maxHours / 24);

  const setCustomDuration = (raw: number) => {
    const multiplier = timeUnit === "hours" ? 1 : 24;
    const min = timeUnit === "hours" ? HOURS_MIN : 1;
    const max = timeUnit === "hours" ? HOURS_MAX : HOURS_MAX / 24;
    const value = Number.isFinite(raw) ? Math.min(max, Math.max(min, raw)) : min;
    onMaxHours(value * multiplier);
  };

  return (
    <div className={wide ? "grid gap-4 md:grid-cols-2" : "space-y-4"}>
      <div className={`space-y-4 ${wide ? "rounded-sm border border-tb-line bg-tb-fill/45 p-3" : ""}`}>
        <section>
          <div className="flex items-baseline justify-between gap-2">
            <SectionTitle
              title="Бюджет на человека"
              hint="Максимальная цена одного билета туда. Крайнее положение — без ограничения цены."
            />
            <span className="tb-num text-lg font-bold text-tb-hero">{budgetLabel(budget)}</span>
          </div>
          <input
            type="range"
            min={BUDGET_MIN}
            max={BUDGET_UNLIMITED}
            step={100}
            value={budget}
            onChange={(event) => onBudget(Number(event.target.value))}
            className="tb-range mt-1"
            style={fill(budget, BUDGET_MIN, BUDGET_UNLIMITED)}
            aria-label="Бюджет поездки: последнее положение снимает ограничение"
          />
          <div className="tb-num mt-1 flex justify-between text-2xs text-tb-muted">
            <span>{formatPrice(BUDGET_MIN)}</span>
            <span>{formatPrice(BUDGET_MAX)}</span>
          </div>
          <p className="mt-1 text-2xs leading-snug text-tb-muted">Один билет туда · крайнее положение без лимита.</p>
        </section>

        <section className="border-t border-tb-line pt-3">
          <div className="flex items-baseline justify-between gap-2">
            <SectionTitle
              title="Время в пути"
              hint="Максимальная длительность всей поездки: дорога, ожидание и пересадки вместе."
            />
            <span className="tb-num text-lg font-bold text-tb-ink">{durationLabel(maxHours)}</span>
          </div>
          <div className="mt-1.5 grid grid-cols-4 gap-1">
            {TIME_PRESETS.map((hours) => (
              <button
                key={hours}
                type="button"
                onClick={() => onMaxHours(hours)}
                aria-pressed={maxHours === hours}
                className={`rounded-xs border px-1 py-1 text-2xs font-semibold transition-colors ${
                  maxHours === hours
                    ? "border-tb-accent bg-tb-accent/15 text-tb-ink"
                    : "border-tb-line text-tb-muted hover:border-tb-muted hover:text-tb-ink"
                }`}
              >
                {durationLabel(hours)}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-1.5">
            <input
              type="number"
              min={timeUnit === "hours" ? HOURS_MIN : 1}
              max={timeUnit === "hours" ? HOURS_MAX : HOURS_MAX / 24}
              value={customValue}
              onChange={(event) => setCustomDuration(Number(event.target.value))}
              aria-label="Свой максимум времени"
              className="tb-num min-w-0 flex-1 rounded-xs border border-tb-line bg-tb-fill px-2 py-1 text-sm font-semibold text-tb-ink outline-none"
            />
            <select
              value={timeUnit}
              onChange={(event) => setTimeUnit(event.target.value as "hours" | "days")}
              aria-label="Единицы собственного максимума времени"
              className="rounded-xs border border-tb-line bg-tb-fill px-2 text-xs font-semibold text-tb-ink outline-none"
            >
              <option value="hours">часов</option>
              <option value="days">дней</option>
            </select>
          </div>
          <p className="mt-1 text-2xs leading-snug text-tb-muted">Считаем дорогу и ожидание на пересадках.</p>
        </section>

        {showPassengers && <section className="flex items-center justify-between gap-3 border-t border-tb-line pt-3">
          <div>
            <div className="flex items-center gap-1.5">
              <span className="tb-tag">Пассажиры · {passengers} {plural(passengers)}</span>
              <Hint text="Туту рассчитывает цену и наличие сразу на указанное число пассажиров." />
            </div>
            <p className="mt-0.5 text-2xs text-tb-muted">Цена и наличие считаются на всех.</p>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => onPassengers(Math.max(1, passengers - 1))} disabled={passengers <= 1} aria-label="Убрать пассажира" className="grid size-7 place-items-center rounded-xs border border-tb-line text-tb-ink transition-colors hover:border-tb-accent disabled:opacity-35">
              <Icon name="minus" size={13} />
            </button>
            <span className="tb-num w-6 text-center text-sm font-bold text-tb-ink">{passengers}</span>
            <button type="button" onClick={() => onPassengers(Math.min(MAX_PASSENGERS, passengers + 1))} disabled={passengers >= MAX_PASSENGERS} aria-label="Добавить пассажира" className="grid size-7 place-items-center rounded-xs border border-tb-line text-tb-ink transition-colors hover:border-tb-accent disabled:opacity-35">
              <Icon name="plus" size={13} />
            </button>
          </div>
        </section>}

        <section className={`${showPassengers ? "border-t pt-3" : ""} border-tb-line`}>
          <SectionTitle
            title="Время отправления и прибытия"
            hint="Отбрасывает рейсы, которые выезжают раньше или приезжают позже выбранного времени."
          />
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            <HourSelect caption="выезжаю не раньше" value={departAfter} onChange={onDepartAfter} />
            <HourSelect caption="на месте не позже" value={arriveBefore} onChange={onArriveBefore} allowAny />
          </div>
          <p className="mt-1 text-2xs leading-snug text-tb-muted">Отсеивает рейсы по времени отправления и прибытия.</p>
        </section>
      </div>

      <div className={`space-y-3 ${wide ? "rounded-sm border border-tb-line bg-tb-fill/45 p-3" : ""}`}>
        <div className="flex items-center justify-between gap-2 border-b border-tb-line pb-2">
          <SectionTitle
            title="Маршрут и возврат"
            hint="Здесь задаются правила, которые влияют на набор направлений и на поиск обратного билета."
          />
          <span className="tb-num text-2xs text-tb-muted">настройки поиска</span>
        </div>

        <div className="flex items-start gap-2.5 border-l-2 border-tb-accent pl-2.5 text-xs leading-snug text-tb-muted">
          <Icon name="arrowRight" size={15} />
          <span><span className="font-semibold text-tb-ink">До 3 пересадок.</span> Прямые рейсы всегда в приоритете; составные добавляем, только если стыковка выполнима.</span>
        </div>

        <label className="flex cursor-pointer items-start gap-2.5">
          <input type="checkbox" checked={abroadOnly} onChange={(event) => onAbroadOnly(event.target.checked)} className="tb-check mt-0.5" />
          <span className="text-xs leading-snug text-tb-muted"><span className="font-semibold text-tb-ink">Только за границу.</span> Исключает города страны отправления из карты.</span>
        </label>

        <label className="flex cursor-pointer items-start gap-2.5">
          <input type="checkbox" checked={roundTrip} onChange={(event) => onRoundTrip(event.target.checked)} className="tb-check mt-0.5" />
          <span className="text-xs leading-snug text-tb-muted"><span className="font-semibold text-tb-ink">Подобрать обратный билет.</span> Добавляет к расчёту самый выгодный обратный рейс.</span>
        </label>

        {roundTrip && (
          <div className="border-l-2 border-tb-accent/50 pl-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-tb-ink">Дней на месте</span>
              <span className="tb-num text-2xs text-tb-muted">{stayMin}–{stayMax} дн.</span>
            </div>
            <div className="mt-1.5 flex gap-2">
              <StayStepper
                caption="минимум"
                value={stayMin}
                min={1}
                max={Math.min(30, stayMax)}
                onChange={(value) => onStay(value, Math.max(value, stayMax))}
              />
              <StayStepper
                caption="максимум"
                value={stayMax}
                min={stayMin}
                max={30}
                onChange={(value) => onStay(Math.min(stayMin, value), value)}
              />
            </div>
            <p className="mt-1 text-2xs leading-snug text-tb-muted">Проверим обратный билет в этом диапазоне дат.</p>
          </div>
        )}
      </div>
    </div>
  );
}
