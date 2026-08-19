import { useState } from "react";

import {
  MODE_LABELS,
  fetchCheckout,
  formatHours,
  formatMinutes,
  formatPrice,
  type ReachOut,
  type VariantOut,
} from "../api";
import type { DisplayedTrip } from "../trip";

const TRANSPORT_LABEL: Record<string, string> = {
  ...MODE_LABELS,
  unknown: "Транспорт",
};

function label(transport: string): string {
  return TRANSPORT_LABEL[transport] ?? transport;
}

function timeOf(iso: string | null): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function Leg({ variant, index }: { variant: VariantOut; index?: number }) {
  const departure = timeOf(variant.departure_at);
  const arrival = timeOf(variant.arrival_at);
  return (
    <div className="flex items-start gap-3 py-3">
      {index !== undefined && (
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-tb-fill text-xs font-bold text-tb-muted">
          {index}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-semibold text-tb-ink">{label(variant.transport)}</span>
          <span className="text-sm font-bold text-tb-hero">{formatPrice(variant.price)}</span>
        </div>
        <div className="mt-0.5 text-xs text-tb-muted">
          {formatHours(variant.hours)}
          {variant.transfers > 0 && ` · пересадок внутри: ${variant.transfers}`}
        </div>
        {departure && arrival && (
          <div className="mt-0.5 text-xs text-tb-muted">
            {departure} → {arrival}
          </div>
        )}
        {variant.route && (
          <div className="mt-1 truncate text-xs text-tb-muted/80">{variant.route}</div>
        )}
      </div>
    </div>
  );
}

/** Пересадка между плечами: сколько ждать и почему столько нужно. */
function Transfer({ reach }: { reach: ReachOut }) {
  const wait = reach.transfer_wait_minutes;
  const required = reach.transfer_required_minutes;
  if (wait === null) return null;

  return (
    <div className="my-1 rounded-2xl bg-tb-fill px-3 py-2.5">
      <div className="text-sm font-semibold text-tb-ink">
        Пересадка в городе {reach.via}: {formatMinutes(wait)}
      </div>
      <div className="mt-1 text-xs text-tb-muted">
        {reach.transfer_overnight
          ? "Ожидание длинное — это ночь между плечами, закладывай ночлег."
          : "Запас достаточный."}
        {required !== null && ` Минимум для такой стыковки — ${formatMinutes(required)}.`}
      </div>
    </div>
  );
}

interface BuyProps {
  variant: VariantOut;
  caption: string;
  passengers: number;
  primary: boolean;
}

/**
 * Кнопка покупки конкретного рейса.
 *
 * Ссылку строим по клику через `create_checkout_link`: она ведёт на страницу
 * выбора мест именно этого рейса, а не на общий поиск. Там же проверяется,
 * хватает ли мест на всю компанию.
 */
function BuyButton({ variant, caption, passengers, primary }: BuyProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const url = variant.checkout_ref
        ? await fetchCheckout(variant.checkout_ref, passengers)
        : variant.checkout_url;
      if (!url) {
        setError("Для этого варианта нет ссылки на конкретный рейс.");
        return;
      }
      window.open(url, "_blank", "noopener");
    } catch {
      setError("Туту не смог подготовить ссылку на этот рейс. Общий поиск не открываем.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={open}
        disabled={busy}
        className={`block w-full rounded-xl px-4 py-2.5 text-center text-[13px] font-black transition hover:brightness-110 disabled:cursor-progress ${
          primary ? "bg-tb-accent text-white" : "bg-tb-fill text-tb-ink ring-1 ring-tb-accent/40"
        }`}
      >
        {busy ? "Открываем Туту…" : caption}
      </button>
      {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
    </div>
  );
}

interface Props {
  reach: ReachOut;
  trip: DisplayedTrip;
  origin: string;
  passengers: number;
  onClose: () => void;
}

/** Карточка выбранного города: из чего складывается поездка и где её купить. */
export function TripCard({ reach, trip, origin, passengers, onClose }: Props) {
  const composite = trip.kind === "composite";
  const legs = composite ? trip.legs : null;
  const direct = trip.kind === "direct" ? trip.variant : null;
  const total = composite ? legs![0].price + legs![1].price : direct?.price ?? null;
  const hours = composite ? reach.hours : direct?.hours ?? null;

  return (
    <section className="tb-rise pointer-events-auto flex w-full min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain rounded-3xl bg-tb-panel/97 shadow-2xl ring-1 ring-tb-line backdrop-blur-xl">
      <header className="sticky top-0 z-10 flex items-start justify-between gap-3 bg-tb-panel/95 p-5 pb-3 backdrop-blur">
        <div>
          <div className="text-[11px] font-semibold tracking-wider text-tb-muted uppercase">
            {origin} →
          </div>
          <h2 className="text-2xl font-black text-tb-ink">{reach.name}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть карточку"
          className="rounded-full bg-tb-fill px-2.5 py-1 text-sm text-tb-muted transition hover:text-tb-ink"
        >
          ✕
        </button>
      </header>

      {trip.kind === "unavailable" ? (
        <div className="px-5 pb-5 text-sm text-tb-muted">
          <p className="font-semibold text-tb-ink">В оставшихся видах транспорта маршрута нет.</p>
          <p className="mt-1">
            Включи другой транспорт или выбери другой город — старый вариант не показываем,
            чтобы не запутать.
          </p>
        </div>
      ) : (
        <>
          <div className="px-5">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <span className="text-4xl font-black text-tb-hero">{formatPrice(total ?? 0)}</span>
              {hours !== null && (
                <span className="pb-1 text-sm font-semibold text-tb-muted">
                  {formatHours(hours)} в пути
                </span>
              )}
            </div>
            {passengers > 1 && total !== null && (
              <div className="mt-1 text-[11px] text-tb-muted">
                На {passengers} чел. — {formatPrice(total * passengers)}. Наличие мест
                проверяется на странице оформления.
              </div>
            )}

            {composite && reach.beats_direct_by !== null && (
              <div className="mt-3 rounded-2xl bg-tb-cheap/20 px-4 py-3 text-sm ring-1 ring-tb-accent/30">
                <span className="font-bold text-tb-ink">
                  Дешевле на {formatPrice(reach.beats_direct_by)}
                </span>
                <span className="text-tb-muted"> — если ехать через {reach.via}.</span>
              </div>
            )}
          </div>

          <div className="mt-3 divide-y divide-tb-line px-5">
            {composite ? (
              <>
                <Leg variant={legs![0]} index={1} />
                <Transfer reach={reach} />
                <Leg variant={legs![1]} index={2} />
              </>
            ) : (
              direct && <Leg variant={direct} />
            )}
          </div>

          {composite && (
            <p className="mx-5 mt-3 text-xs text-tb-muted">
              Это два отдельных билета: единой брони между плечами нет. Мы закладываем
              запас на стыковку, но задержки рейсов Туту не отдаёт — гарантировать
              пересадку никто не может.
            </p>
          )}

          <div className="m-5 flex flex-col gap-1.5">
            {composite ? (
              <>
                <div className="text-[10px] font-semibold tracking-[0.08em] text-tb-muted uppercase">
                  Билеты — покупаются отдельно
                </div>
                <BuyButton
                  variant={legs![0]}
                  caption={`1. ${origin} → ${reach.via}`}
                  passengers={passengers}
                  primary
                />
                <BuyButton
                  variant={legs![1]}
                  caption={`2. ${reach.via} → ${reach.name}`}
                  passengers={passengers}
                  primary={false}
                />
              </>
            ) : (
              direct && (
                <BuyButton
                  variant={direct}
                  caption="Выбрать места на Туту"
                  passengers={passengers}
                  primary
                />
              )
            )}
          </div>
        </>
      )}
    </section>
  );
}
