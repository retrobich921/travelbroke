import { MODE_LABELS, formatHours, formatPrice, type Mode, type ReachOut, type VariantOut } from "../api";

const TRANSPORT_LABEL: Record<string, string> = {
  ...MODE_LABELS,
  unknown: "Транспорт",
};

function label(transport: string): string {
  return TRANSPORT_LABEL[transport] ?? transport;
}

function Leg({ variant, index }: { variant: VariantOut; index?: number }) {
  return (
    <div className="flex items-start gap-3 border-t border-white/10 py-3 first:border-t-0">
      {index !== undefined && (
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-tb-muted">
          {index}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-semibold text-white">{label(variant.transport)}</span>
          <span className="text-sm font-bold text-tb-cheap">{formatPrice(variant.price)}</span>
        </div>
        <div className="mt-0.5 text-xs text-tb-muted">
          {formatHours(variant.hours)}
          {variant.transfers > 0 && ` · пересадок: ${variant.transfers}`}
        </div>
        {variant.route && <div className="mt-1 truncate text-xs text-tb-muted/80">{variant.route}</div>}
      </div>
    </div>
  );
}

interface Props {
  reach: ReachOut;
  origin: string;
  modes: Mode[];
  onClose: () => void;
}

/** Карточка выбранного города: из чего складывается поездка и где её купить. */
export function TripCard({ reach, origin, onClose }: Props) {
  const legs = reach.via_legs;
  const composite = legs && reach.beats_direct_by !== null;
  const total = composite ? legs.reduce((sum, leg) => sum + leg.price, 0) : reach.price;
  const buyUrl = composite ? legs[0].checkout_url : reach.direct?.checkout_url;

  return (
    <section className="pointer-events-auto w-88 max-w-[calc(100vw-3rem)] overflow-hidden rounded-3xl bg-tb-ink/95 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl">
      <header className="flex items-start justify-between gap-3 p-5 pb-3">
        <div>
          <div className="text-[11px] font-semibold tracking-wider text-tb-muted uppercase">
            {origin} →
          </div>
          <h2 className="text-2xl font-black text-white">{reach.name}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть"
          className="rounded-full bg-white/10 px-2.5 py-1 text-sm text-tb-muted hover:bg-white/20"
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
            <div className="flex items-end justify-between">
              <span className="text-4xl font-black text-tb-cheap">{formatPrice(total)}</span>
              {reach.hours !== null && (
                <span className="pb-1 text-sm font-semibold text-tb-muted">
                  {formatHours(reach.hours)} в пути
                </span>
              )}
            </div>

            {composite && reach.beats_direct_by !== null && (
              <div className="mt-3 rounded-2xl bg-tb-cheap/15 px-4 py-3 text-sm ring-1 ring-tb-cheap/30">
                <span className="font-bold text-tb-cheap">
                  Дешевле на {formatPrice(reach.beats_direct_by)}
                </span>
                <span className="text-tb-muted"> — если ехать через {reach.via}.</span>
              </div>
            )}
          </div>

          <div className="mt-4 px-5">
            {composite
              ? legs.map((leg, i) => <Leg key={i} variant={leg} index={i + 1} />)
              : reach.direct && <Leg variant={reach.direct} />}
          </div>

          {buyUrl && (
            <a
              href={buyUrl}
              target="_blank"
              rel="noreferrer"
              className="m-5 block rounded-2xl bg-tb-accent px-4 py-3 text-center text-base font-black text-white transition hover:brightness-110"
            >
              Купить на Туту
            </a>
          )}
        </>
      )}
    </section>
  );
}
