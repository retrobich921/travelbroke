import { describe, expect, it } from "vitest";

import type { Mode, ReachOut, VariantOut } from "./api";
import { tripForModes } from "./trip";

const ALL_MODES: Mode[] = ["avia", "railway", "bus", "etrain"];

function variant(transport: string, price: number, extra: Partial<VariantOut> = {}): VariantOut {
  return {
    transport,
    price,
    hours: 3,
    transfers: 0,
    departure_at: null,
    arrival_at: null,
    checkout_url: null,
    route: null,
    waypoints: [],
    checkout_ref: null,
    ...extra,
  };
}

function reach(overrides: Partial<ReachOut> = {}): ReachOut {
  return {
    slug: "izhevsk",
    name: "Ижевск",
    lat: 56.85,
    lon: 53.2,
    hub: false,
    country: "Россия",
    price: null,
    hours: null,
    direct: null,
    variants: [],
    via: null,
    via_legs: null,
    beats_direct_by: null,
    transfer_wait_minutes: null,
    transfer_required_minutes: null,
    transfer_overnight: false,
    options: [],
    back: null,
    back_date: null,
    round_trip_price: null,
    by_mode: {},
    by_mode_minutes: {},
    empty_reason: null,
    empty_message: null,
    ...overrides,
  };
}

describe("tripForModes", () => {
  it("берёт самый дешёвый из разрешённых видов транспорта", () => {
    const trip = tripForModes(
      reach({ variants: [variant("avia", 9000), variant("railway", 1199)] }),
      ALL_MODES,
    );

    expect(trip.kind).toBe("direct");
    expect(trip.kind === "direct" && trip.variant.price).toBe(1199);
  });

  it("не предлагает выключенный вид транспорта", () => {
    const trip = tripForModes(
      reach({ variants: [variant("avia", 9000), variant("railway", 1199)] }),
      ["avia"],
    );

    expect(trip.kind === "direct" && trip.variant.transport).toBe("avia");
  });

  it("сообщает, что маршрута нет, если ни один вариант не подходит", () => {
    const trip = tripForModes(reach({ variants: [variant("railway", 1199)] }), ["avia"]);

    expect(trip.kind).toBe("unavailable");
  });

  // Расписания электричек Туту отдаёт без цены — как price: 0. Ноль здесь
  // означает «цену не публикуют», а не бесплатный билет: если посчитать его
  // ценой, электричка выиграет любое сравнение и станет «самым дешёвым» городом.
  it("не даёт расписанию без цены выиграть у настоящего платного билета", () => {
    const trip = tripForModes(
      reach({ variants: [variant("etrain", 0), variant("railway", 1199)] }),
      ALL_MODES,
    );

    expect(trip.kind === "direct" && trip.variant.transport).toBe("railway");
    expect(trip.kind === "direct" && trip.variant.price).toBe(1199);
  });

  it("всё-таки показывает рейс без цены, если другого варианта нет", () => {
    const trip = tripForModes(reach({ variants: [variant("etrain", 0)] }), ALL_MODES);

    expect(trip.kind).toBe("direct");
    expect(trip.kind === "direct" && trip.variant.price).toBe(0);
  });

  it("составной маршрут показывается только при всех включённых видах транспорта", () => {
    const composite = reach({
      via: "Москва",
      via_legs: [variant("bus", 2300), variant("avia", 2617)],
      beats_direct_by: 637,
    });

    expect(tripForModes(composite, ALL_MODES).kind).toBe("composite");
    // Выключив автобус, нельзя продолжать предлагать стыковку с автобусом.
    expect(tripForModes(composite, ["avia", "railway"]).kind).not.toBe("composite");
  });
});
