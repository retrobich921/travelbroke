import type { CityOut } from "../api";
import { CitySelect } from "./CitySelect";
import { DatePicker } from "./DatePicker";

const MODES = [
  { icon: "✈", label: "Самолёты" },
  { icon: "▰", label: "Поезда" },
  { icon: "▱", label: "Автобусы" },
  { icon: "◫", label: "Электрички" },
];

interface Props {
  cities: CityOut[];
  origin: string;
  date: string;
  loading: boolean;
  error: string | null;
  onOrigin: (value: string) => void;
  onDate: (value: string) => void;
  onStart: () => void;
}

/**
 * Вход в сценарий: пользователь вводит только город и дату, а детали поездки
 * настраивает уже после появления карты. Так первый шаг остаётся очевидным.
 */
export function StartScreen({
  cities,
  origin,
  date,
  loading,
  error,
  onOrigin,
  onDate,
  onStart,
}: Props) {
  return (
    <section className="absolute inset-0 z-40 overflow-y-auto bg-[#0d0b66] text-[#eff0ff]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-56 left-1/2 h-140 w-220 -translate-x-1/2 rounded-full bg-[#7d71ff]/25 blur-[130px]" />
        <div className="absolute right-[-9rem] bottom-[-13rem] h-100 w-100 rounded-full bg-[#3e35be] blur-[110px]" />
      </div>

      <div className="relative mx-auto flex min-h-full max-w-7xl flex-col px-5 py-5 sm:px-8 sm:py-7">
        <header className="flex items-center justify-between gap-4">
          <div className="text-2xl font-black tracking-[-0.07em] sm:text-3xl">
            Travel<span className="text-[#7d71ff]">Broke</span>
          </div>
          <nav className="hidden items-center gap-7 text-sm font-medium text-[#eff0ff]/78 md:flex" aria-label="Разделы">
            <a href="#how-it-works" className="transition hover:text-white">Как это работает</a>
            <a href="#modes" className="transition hover:text-white">Виды транспорта</a>
            <span className="rounded-full bg-white/10 px-4 py-2 text-xs text-[#eff0ff] ring-1 ring-white/15">
              Без комиссий
            </span>
          </nav>
        </header>

        <div className="mt-6 h-10 rounded-xl bg-linear-to-r from-[#7d71ff] via-[#a79fff] to-[#7d71ff] p-px shadow-[0_12px_42px_rgba(6,4,76,0.24)] sm:mt-8">
          <div className="flex h-full items-center justify-center rounded-[11px] bg-[#171267]/18 px-4 text-center text-xs font-bold tracking-wide text-white sm:text-sm">
            Найди выгодную поездку за минуту — без десятка вкладок и ручного сравнения
          </div>
        </div>

        <main id="how-it-works" className="flex flex-1 flex-col justify-center py-12 lg:py-18">
          <div className="grid items-center gap-10 lg:grid-cols-[1.08fr_0.92fr]">
            <div>
              <div className="mb-5 inline-flex w-fit items-center gap-2 rounded-full bg-[#7d71ff]/25 px-3 py-1.5 text-xs font-bold text-[#eff0ff] ring-1 ring-[#a9a3ff]/45">
                <span className="h-1.5 w-1.5 rounded-full bg-[#d0ff1a]" />
                Данные Туту · маршруты и цены в одном месте
              </div>
              <h1 className="max-w-3xl text-5xl font-black tracking-[-0.06em] text-white sm:text-6xl lg:text-7xl">
                Путешествуй
                <span className="block text-[#eff0ff]">выгодно.</span>
              </h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-[#eff0ff]/78 sm:text-lg">
                Введи город в любой стране и дату. Мы соберём доступные маршруты на карте,
                сравним транспорт и покажем честную цену.
              </p>

              <div className="mt-7 flex flex-wrap gap-2 text-sm font-semibold">
                <span className="rounded-xl bg-white/10 px-3 py-2 ring-1 ring-white/10">✓ Учитываем пересадки</span>
                <span className="rounded-xl bg-white/10 px-3 py-2 ring-1 ring-white/10">✓ Понятный маршрут</span>
                <span className="rounded-xl bg-white/10 px-3 py-2 ring-1 ring-white/10">✓ Переход к покупке</span>
              </div>
            </div>

            <div aria-hidden="true" className="relative mx-auto hidden aspect-square w-full max-w-105 lg:block">
              <div className="absolute inset-6 rounded-[2.5rem] border border-[#b6b1ff]/40 bg-white/7 shadow-2xl backdrop-blur-sm" />
              <div className="absolute inset-14 rounded-[2rem] border border-dashed border-[#b6b1ff]/60" />
              <div className="absolute top-[24%] right-[13%] rounded-2xl bg-[#eff0ff] px-4 py-3 text-[#161150] shadow-xl">
                <div className="text-[10px] font-bold tracking-wider text-[#6b6790] uppercase">Берлин</div>
                <div className="mt-0.5 text-lg font-black">от 8 490 ₽</div>
              </div>
              <div className="absolute bottom-[18%] left-[8%] rounded-2xl bg-[#7d71ff] px-4 py-3 shadow-xl ring-1 ring-white/25">
                <div className="text-[10px] font-bold tracking-wider text-white/65 uppercase">Стамбул</div>
                <div className="mt-0.5 text-lg font-black text-white">от 6 120 ₽</div>
              </div>
              <div className="absolute top-1/2 left-1/2 grid h-22 w-22 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[#d0ff1a] text-4xl text-[#171267] shadow-[0_0_0_12px_rgba(208,255,26,0.12)]">✈</div>
              <div className="absolute top-[47%] right-[29%] h-px w-[29%] -rotate-30 bg-[#d0ff1a]" />
              <div className="absolute bottom-[35%] left-[24%] h-px w-[29%] rotate-28 bg-[#d0ff1a]" />
            </div>
          </div>

          <div className="mt-10 rounded-[1.8rem] bg-white p-3 text-[#17124f] shadow-[0_24px_80px_rgba(5,4,65,0.38)] ring-1 ring-white/50 sm:p-4">
            <div id="modes" className="grid grid-cols-2 gap-2 border-b border-[#e2e1f6] px-1 pb-3 sm:grid-cols-4">
              {MODES.map((mode) => (
                <div key={mode.label} className="flex items-center justify-center gap-2 rounded-xl bg-[#eff0ff] px-2 py-2 text-xs font-bold text-[#272064] sm:text-sm">
                  <span className="grid h-6 w-6 place-items-center rounded-lg bg-[#7d71ff] text-sm text-white">{mode.icon}</span>
                  {mode.label}
                </div>
              ))}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-[1.35fr_1fr_auto] sm:items-end">
              <div>
                <div className="px-1 text-[10px] font-black tracking-[0.1em] text-[#6b6790] uppercase">Откуда</div>
                <CitySelect cities={cities} value={origin} onChange={onOrigin} surface="light" />
              </div>
              <div>
                <div className="px-1 text-[10px] font-black tracking-[0.1em] text-[#6b6790] uppercase">Когда</div>
                <DatePicker value={date} onChange={onDate} surface="light" />
              </div>
              <button
                type="button"
                onClick={onStart}
                disabled={loading}
                className="rounded-xl bg-[#7d71ff] px-6 py-2.5 text-sm font-black text-white shadow-lg shadow-[#7d71ff]/25 transition hover:bg-[#695de8] disabled:cursor-progress disabled:opacity-60"
              >
                {loading ? "Собираем маршруты…" : "Показать карту"}
              </button>
            </div>
            <p className="px-1 pt-3 text-xs font-medium text-[#6b6790]">
              Дата запускает поиск автоматически. Бюджет, пересадки и транспорт настраиваются на карте.
            </p>
          </div>
          {error && <p className="mt-3 text-sm font-medium text-red-200">{error}</p>}
        </main>
      </div>
    </section>
  );
}
