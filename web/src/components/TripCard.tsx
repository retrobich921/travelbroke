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
import { CityPhotos } from "./CityPhotos";
import { TRANSPORT_PATHS } from "../transport";
import { Icon, type IconName } from "./Icon";

const TRANSPORT_LABEL: Record<string, string> = {
  ...MODE_LABELS,
  unknown: "Транспорт",
};

function label(transport: string): string {
  return TRANSPORT_LABEL[transport] ?? transport;
}

function icon(transport: string): IconName | null {
  return transport in TRANSPORT_PATHS ? (transport as IconName) : null;
}

function timeOf(iso: string | null): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toLocaleString("ru-RU", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function Leg({ variant, index }: { variant: VariantOut; index?: number }) {
  const departure = timeOf(variant.departure_at);
  const arrival = timeOf(variant.arrival_at);
  const mark = icon(variant.transport);
  return (
    <div className="flex items-start gap-3 py-3">
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-xs border border-tb-line text-tb-muted">
        {mark ? (
          <Icon name={mark} size={14} />
        ) : (
          <span className="tb-num text-2xs font-bold">{index ?? "·"}</span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-semibold text-tb-ink">
            {index !== undefined && <span className="tb-num text-tb-muted">{index}. </span>}
            {label(variant.transport)}
          </span>
          <span className="tb-num text-sm font-bold text-tb-hero">
            {formatPrice(variant.price)}
          </span>
        </div>
        <div className="tb-num mt-0.5 text-xs text-tb-muted">
          {formatHours(variant.hours)}
          {variant.transfers > 0 && ` · пересадок внутри: ${variant.transfers}`}
        </div>
        {departure && arrival && (
          <div className="tb-num mt-0.5 text-xs text-tb-muted">
            {departure} → {arrival}
          </div>
        )}
        {variant.route && (
          <div className="mt-1 truncate text-xs text-tb-muted/75">{variant.route}</div>
        )}
        {variant.waypoints.length > 2 && (
          <div className="mt-1 text-xs font-medium text-tb-hero">
            Пересадка: {variant.waypoints.slice(1, -1).join(" → ")}
          </div>
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
    <div className="my-1 border-l-2 border-tb-hero py-2 pl-3">
      <div className="text-sm font-semibold text-tb-ink">
        Пересадка в городе {reach.via} — <span className="tb-num">{formatMinutes(wait)}</span>
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
        className={`flex w-full items-center justify-center gap-2 rounded-sm px-4 py-2.5 text-center text-sm font-bold transition-[filter,transform] duration-150 ease-out hover:brightness-115 active:translate-y-px disabled:cursor-progress ${
          primary
            ? "bg-tb-accent text-white"
            : "border border-tb-line text-tb-ink hover:border-tb-accent"
        }`}
      >
        {busy ? "Открываем Туту…" : caption}
        {!busy && <Icon name="arrowRight" size={14} />}
      </button>
      {error && <p className="mt-1.5 text-xs text-red-400">{error}</p>}
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
  const total = composite ? legs![0].price + legs![1].price : (direct?.price ?? null);
  const hasKnownTotal = total !== null && total > 0;
  const hours = composite ? reach.hours : (direct?.hours ?? null);

  return (
    <section className="tb-rise tb-plate pointer-events-auto flex min-h-0 w-full flex-1 flex-col overflow-y-auto overscroll-contain">
      <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-tb-line bg-tb-panel p-4">
        <div className="min-w-0">
          <div className="tb-tag truncate">{origin} →</div>
          <h2 className="font-display truncate text-xl font-extrabold tracking-[-0.04em] text-tb-ink">
            {reach.name}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть карточку"
          className="grid size-7 shrink-0 place-items-center rounded-xs border border-tb-line text-tb-muted transition-colors duration-150 ease-out hover:border-tb-accent hover:text-tb-ink"
        >
          <Icon name="close" size={13} />
        </button>
      </header>

      {/* Сразу под названием города: человек кликнул точку на карте, чтобы
          понять, что это за место, — фотографии отвечают на это первыми, а цена
          остаётся видна следующей строкой. */}
      <CityPhotos city={reach.name} lat={reach.lat} lon={reach.lon} />

      {trip.kind === "unavailable" ? (
        <div className="p-4 text-sm text-tb-muted">
          <p className="font-semibold text-tb-ink">
            {reach.empty_message ?? "В оставшихся видах транспорта маршрута нет."}
          </p>
          <p className="mt-1 text-xs">
            {reach.empty_reason
              ? "Так ответил сам Туту — мы только назвали причину."
              : "Включи другой транспорт или выбери другой город: старый вариант не показываем, чтобы не запутать."}
          </p>
        </div>
      ) : (
        <>
          <div className="px-4 pt-4">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <span className="tb-num text-3xl font-bold text-tb-hero">
                {hasKnownTotal ? formatPrice(total) : "Цена неизвестна"}
              </span>
              {hours !== null && (
                <span className="tb-num pb-1 text-sm font-semibold text-tb-muted">
                  {formatHours(hours)} в пути
                </span>
              )}
            </div>
            {passengers > 1 && hasKnownTotal && (
              <div className="mt-1 text-xs text-tb-muted">
                На {passengers} чел. — <span className="tb-num">{formatPrice(total * passengers)}</span>.
                Наличие мест проверяется на странице оформления.
              </div>
            )}

            {composite && reach.beats_direct_by !== null && (
              <div className="mt-3 flex items-baseline gap-2 border-l-2 border-tb-hero pl-3 text-sm">
                <span className="tb-num font-bold whitespace-nowrap text-tb-hero">
                  −{formatPrice(reach.beats_direct_by)}
                </span>
                <span className="text-tb-muted">против прямого, если ехать через {reach.via}</span>
              </div>
            )}
          </div>

          <div className="mt-2 divide-y divide-tb-line px-4">
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
            <p className="mx-4 mt-3 text-xs text-tb-muted">
              Это два отдельных билета: единой брони между плечами нет. Мы закладываем
              запас на стыковку, но задержки рейсов Туту не отдаёт — гарантировать
              пересадку никто не может.
            </p>
          )}

          <div className="m-4 flex flex-col gap-1.5">
            {composite ? (
              <>
                <div className="tb-tag">Билеты — покупаются отдельно</div>
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

      {reach.back && (
        <div className="mx-4 mb-4 border-t border-tb-line pt-3">
          <div className="tb-tag">
            Обратно
            {reach.back_date &&
              ` · ${new Date(reach.back_date).toLocaleDateString("ru-RU", {
                day: "numeric",
                month: "short",
              })}`}
          </div>
          <Leg variant={reach.back} />
          {reach.round_trip_price !== null && (
            <div className="mb-2 text-xs font-semibold text-tb-ink">
              Туда и обратно — <span className="tb-num">{formatPrice(reach.round_trip_price)}</span>
              {passengers > 1 && (
                <>
                  {" · на "}
                  {passengers} чел.{" "}
                  <span className="tb-num">{formatPrice(reach.round_trip_price * passengers)}</span>
                </>
              )}
            </div>
          )}
          <BuyButton
            variant={reach.back}
            caption="Билет обратно"
            passengers={passengers}
            primary={false}
          />
        </div>
      )}

      {reach.options.length > 1 && (
        <details className="mx-4 mb-4 border-t border-tb-line pt-3">
          <summary className="cursor-pointer list-none text-xs font-semibold text-tb-ink transition-colors duration-150 ease-out hover:text-tb-hero">
            Ещё варианты туда ({reach.options.length - 1})
          </summary>
          <div className="mt-1 divide-y divide-tb-line">
            {reach.options.slice(1, 5).map((option, index) => (
              <div key={`${option.transport}-${option.price}-${index}`} className="pb-2">
                <Leg variant={option} />
                <BuyButton
                  variant={option}
                  caption="Выбрать этот рейс"
                  passengers={passengers}
                  primary={false}
                />
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
