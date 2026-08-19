import { useRef, useState } from "react";

import { POPOVER, useDismiss } from "./Popover";

interface Props {
  value: number;
  onChange: (value: number) => void;
  /** Подпись над полем. */
  caption: string;
  /** Разрешить вариант «неважно» (24 часа). */
  allowAny?: boolean;
}

function label(hour: number): string {
  return hour >= 24 ? "неважно" : `${String(hour).padStart(2, "0")}:00`;
}

/**
 * Выбор часа.
 *
 * Системный `<select>` на Windows рисуется в собственной палитре и в тёмной
 * теме выглядит инородно — как и список городов, делаем свой.
 */
export function HourSelect({ value, onChange, caption, allowAny = false }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useDismiss(root, open, () => setOpen(false));

  const hours = Array.from({ length: allowAny ? 25 : 24 }, (_, hour) => hour);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full rounded-lg bg-tb-fill px-2.5 py-1.5 text-left transition hover:brightness-105 focus:ring-2 focus:ring-tb-accent focus:outline-none"
      >
        <span className="block text-[10px] text-tb-muted">{caption}</span>
        <span className="flex items-center justify-between gap-1">
          <span className="text-[13px] font-semibold text-tb-ink">{label(value)}</span>
          <span className="text-tb-muted">▾</span>
        </span>
      </button>

      {open && (
        <ul role="listbox" className={`${POPOVER} left-0 max-h-56 w-full overflow-y-auto p-1`}>
          {hours.map((hour) => (
            <li key={hour}>
              <button
                type="button"
                role="option"
                aria-selected={hour === value}
                onClick={() => {
                  onChange(hour);
                  setOpen(false);
                }}
                className={`w-full rounded-md px-2.5 py-1.5 text-left text-[13px] transition ${
                  hour === value
                    ? "bg-tb-accent font-semibold text-white"
                    : "text-tb-ink hover:bg-tb-fill"
                }`}
              >
                {label(hour)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
