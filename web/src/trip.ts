import type { Mode, ReachOut, VariantOut } from "./api";

export type DisplayedTrip =
  | { kind: "direct"; variant: VariantOut }
  | { kind: "composite"; legs: [VariantOut, VariantOut] }
  | { kind: "unavailable" };

/**
 * Выбирает карточку из того же набора конкретных офферов, что и карта.
 *
 * Составной маршрут годится только при включённых всех видах транспорта:
 * если выключить автобус, нельзя продолжать предлагать стыковку с автобусом
 * только потому, что она была выгодной до переключения.
 */
export function tripForModes(reach: ReachOut, modes: Mode[]): DisplayedTrip {
  const legs = reach.via_legs;
  if (
    modes.length === 4 &&
    legs !== null &&
    legs.length === 2 &&
    reach.beats_direct_by !== null
  ) {
    return { kind: "composite", legs: [legs[0], legs[1]] };
  }

  // Fallback нужен только на время обновления уже задеплоенного бэкенда:
  // новый ответ всегда содержит полный `variants`.
  const offers = reach.variants.length > 0 ? reach.variants : reach.direct ? [reach.direct] : [];
  const allowed = offers.filter((offer) => modes.includes(offer.transport as Mode));
  const variant = allowed.reduce<VariantOut | null>(
    (best, offer) => (best === null || offer.price < best.price ? offer : best),
    null,
  );
  return variant ? { kind: "direct", variant } : { kind: "unavailable" };
}
