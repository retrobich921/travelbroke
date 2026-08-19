import { useState } from "react";

import { MODE_LABELS, MODES, type CityOut, type Mode } from "../api";
import { AdvancedFilters, type FilterHandlers, type FilterValues } from "./AdvancedFilters";
import { CitySelect } from "./CitySelect";
import { DatePicker } from "./DatePicker";
import { Icon } from "./Icon";

interface Props extends FilterValues, FilterHandlers {
  cities: CityOut[];
  origin: string;
  date: string;
  modes: Mode[];
  loading: boolean;
  needsSearch: boolean;
  onOrigin: (value: string) => void;
  onDate: (value: string) => void;
  onToggleMode: (mode: Mode) => void;
  onSearch: () => void;
}

/** Тонкая линия-разделитель между блоками пульта. */
function Rule() {
  return <div className="my-4 border-t border-tb-line" />;
}

/** Панель управления картой: откуда, когда, за сколько, на чём и вас сколько. */
export function ControlPanel(props: Props) {
  const {
    cities,
    origin,
    date,
    modes,
    loading,
    needsSearch,
    onOrigin,
    onDate,
    onToggleMode,
    onSearch,
    ...filters
  } = props;

  const [copied, setCopied] = useState(false);

  /** Весь вид карты описан адресной строкой, так что делиться нечем, кроме неё. */
  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* буфер обмена закрыт политикой браузера — ссылка и так в адресной строке */
    }
  };

  // Прокрутки у панели нет намеренно: `overflow` обрезал бы выпадающие списки
  // городов и часов и календарь — они absolute внутри неё.
  return (
    <aside className="tb-plate pointer-events-auto w-full shrink-0 p-4">
      <div className="grid grid-cols-2 gap-2.5">
        <label className="block">
          <span className="tb-tag">Откуда</span>
          <CitySelect cities={cities} value={origin} onChange={onOrigin} />
        </label>
        <label className="block">
          <span className="tb-tag">Когда</span>
          <DatePicker value={date} onChange={onDate} />
        </label>
      </div>

      <Rule />

      <div>
        <span className="tb-tag">Транспорт</span>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          {MODES.map((mode) => {
            const active = modes.includes(mode);
            return (
              <button
                key={mode}
                type="button"
                onClick={() => onToggleMode(mode)}
                aria-pressed={active}
                className={`flex items-center gap-2 rounded-sm border px-2.5 py-1.5 text-sm font-medium transition-colors duration-150 ease-out ${
                  active
                    ? "border-tb-accent/70 bg-tb-accent/15 text-tb-ink"
                    : "border-tb-line text-tb-muted/70 hover:border-tb-muted hover:text-tb-ink"
                }`}
              >
                <Icon name={mode} size={16} />
                {MODE_LABELS[mode]}
              </button>
            );
          })}
        </div>
      </div>

      <Rule />

      <AdvancedFilters {...filters} />

      <button
        type="button"
        onClick={onSearch}
        disabled={loading}
        className={`mt-4 w-full rounded-sm px-4 py-2.5 text-sm font-bold transition-[filter,transform] duration-150 ease-out hover:brightness-115 active:translate-y-px disabled:cursor-progress disabled:opacity-60 ${
          needsSearch ? "bg-tb-hero text-tb-bg" : "bg-tb-accent text-white"
        }`}
      >
        {loading ? "Считаем маршруты…" : needsSearch ? "Обновить карту" : "Куда я могу уехать"}
      </button>

      <button
        type="button"
        onClick={share}
        className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-sm px-4 py-1.5 text-xs font-semibold text-tb-muted transition-colors duration-150 ease-out hover:text-tb-ink"
      >
        <Icon name={copied ? "check" : "link"} size={13} />
        {copied ? "Ссылка скопирована" : "Поделиться этим видом"}
      </button>
    </aside>
  );
}
