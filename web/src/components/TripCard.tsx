import {
  MODE_LABELS,
  formatHours,
  formatMinutes,
  formatPrice,
  type ReachOut,
  type VariantOut,
} from "../api";

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

interface Props {
  reach: ReachOut;
  origin: string;
  onClose: () => void;
}

/** Карточка выбранного города: из чего складывается поездка и где её купить. */
export function TripCard({ reach, origin, onClose }: Props) {
  const legs = reach.via_legs;
  const composite = legs !== null && reach.beats_direct_by !== null;
  const total = composite ? legs.reduce((sum, leg) => sum + leg.price, 0) : reach.price;
  const buyUrl = composite ? legs[0].checkout_url : reach.direct?.checkout_url;

  return (
    <section className="tb-rise tb-sheet pointer-events-auto w-full overflow-hidden rounded-3xl bg-tb-panel/97 shadow-2xl ring-1 ring-tb-line backdrop-blur-xl lg:w-88">
      <header className="flex items-start justify-between gap-3 p-5 pb-3">
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

      {total === null ? (
        <div className="px-5 pb-5 text-sm text-tb-muted">
          {reach.empty_message ?? "Туда ничего не нашлось на эту дату."}
        </div>
      ) : (
        <>
          <div className="px-5">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <span className="text-4xl font-black text-tb-hero">{formatPrice(total)}</span>
              {reach.hours !== null && (
                <span className="pb-1 text-sm font-semibold text-tb-muted">
                  {formatHours(reach.hours)} в пути
                </span>
              )}
            </div>

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
                <Leg variant={legs[0]} index={1} />
                <Transfer reach={reach} />
                <Leg variant={legs[1]} index={2} />
              </>
            ) : (
              reach.direct && <Leg variant={reach.direct} />
            )}
          </div>

          {composite && (
            <p className="mx-5 mt-3 text-xs text-tb-muted">
              Это два отдельных билета: единой брони между плечами нет. Мы закладываем
              запас на стыковку, но задержки рейсов Туту не отдаёт — гарантировать
              пересадку никто не может.
            </p>
          )}

          {buyUrl && (
            <a
              href={buyUrl}
              target="_blank"
              rel="noreferrer"
              className="m-5 block rounded-2xl bg-tb-accent px-4 py-3 text-center text-base font-black text-white transition hover:brightness-110"
            >
              {composite ? "Купить первое плечо на Туту" : "Купить на Туту"}
            </a>
          )}
        </>
      )}
    </section>
  );
}
