import { useMemo, useRef, useState } from "react";

import { POPOVER, useDismiss } from "./Popover";

const MONTHS = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
];

const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

function iso(day: Date): string {
  const shifted = new Date(day.getTime() - day.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 10);
}

function parse(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

/** Понедельник — первый столбец, как принято в русском календаре. */
function weekdayIndex(day: Date): number {
  return (day.getDay() + 6) % 7;
}

function startOfDay(day: Date): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate());
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Дальше горизонта продаж билетов всё равно нет: авиа ~210 дней. */
  maxDays?: number;
}

/**
 * Календарь выбора даты.
 *
 * Системный `<input type="date">` открывает окно Windows со своими цветами —
 * в тёмной теме оно выглядело чужеродным. Свой календарь ещё и умеет то, что
 * нужно именно здесь: подсказки «сегодня» и «ближайшая суббота» и запрет на
 * даты в прошлом.
 */
export function DatePicker({ value, onChange, maxDays = 210 }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => parse(value), [value]);
  const [month, setMonth] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1));

  useDismiss(root, open, () => setOpen(false));

  const today = startOfDay(new Date());
  const limit = new Date(today.getTime() + maxDays * 86_400_000);

  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const start = new Date(first);
    start.setDate(first.getDate() - weekdayIndex(first));
    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      return day;
    });
  }, [month]);

  const shift = (delta: number) =>
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));

  const pick = (day: Date) => {
    onChange(iso(day));
    setOpen(false);
  };

  const nextSaturday = () => {
    const day = new Date(today);
    day.setDate(day.getDate() + ((6 - day.getDay() + 7) % 7 || 7));
    return day;
  };

  const label = selected.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    weekday: "short",
  });

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="mt-1 flex w-full items-center justify-between gap-2 rounded-xl bg-tb-fill px-3 py-2 text-left text-[13px] font-medium text-tb-ink transition hover:brightness-105 focus:ring-2 focus:ring-tb-accent focus:outline-none"
      >
        <span className="truncate">{label}</span>
        <span className="shrink-0 text-tb-muted">▾</span>
      </button>

      {open && (
        <div className={`${POPOVER} p-3`}>
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => shift(-1)}
              aria-label="Предыдущий месяц"
              className="rounded-lg px-2 py-1 text-tb-muted transition hover:bg-tb-fill hover:text-tb-ink"
            >
              ‹
            </button>
            <span className="text-[13px] font-semibold text-tb-ink">
              {MONTHS[month.getMonth()]} {month.getFullYear()}
            </span>
            <button
              type="button"
              onClick={() => shift(1)}
              aria-label="Следующий месяц"
              className="rounded-lg px-2 py-1 text-tb-muted transition hover:bg-tb-fill hover:text-tb-ink"
            >
              ›
            </button>
          </div>

          <div className="mt-2 grid grid-cols-7 gap-0.5 text-center text-[10px] text-tb-muted uppercase">
            {WEEKDAYS.map((name) => (
              <span key={name}>{name}</span>
            ))}
          </div>

          <div className="mt-1 grid grid-cols-7 gap-0.5">
            {days.map((day) => {
              const outside = day.getMonth() !== month.getMonth();
              const disabled = day < today || day > limit;
              const isSelected = iso(day) === value;
              const isToday = iso(day) === iso(today);
              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  disabled={disabled}
                  onClick={() => pick(day)}
                  className={`h-8 rounded-lg text-[12px] transition ${
                    isSelected
                      ? "bg-tb-accent font-bold text-white"
                      : disabled
                        ? "text-tb-muted/35"
                        : outside
                          ? "text-tb-muted hover:bg-tb-fill"
                          : "text-tb-ink hover:bg-tb-fill"
                  } ${isToday && !isSelected ? "ring-1 ring-tb-accent/50" : ""}`}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex gap-2 border-t border-tb-line pt-2">
            <button
              type="button"
              onClick={() => pick(today)}
              className="flex-1 rounded-lg bg-tb-fill px-2 py-1.5 text-[12px] font-semibold text-tb-ink transition hover:brightness-105"
            >
              Сегодня
            </button>
            <button
              type="button"
              onClick={() => pick(nextSaturday())}
              className="flex-1 rounded-lg bg-tb-fill px-2 py-1.5 text-[12px] font-semibold text-tb-ink transition hover:brightness-105"
            >
              В субботу
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
