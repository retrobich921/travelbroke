import { describe, expect, it } from "vitest";

import { MODES } from "./api";
import {
  BUDGET_MIN,
  BUDGET_UNLIMITED,
  DEFAULT_STATE,
  HOURS_MAX,
  HOURS_MIN,
  readState,
} from "./urlState";

describe("readState", () => {
  it("без параметров отдаёт состояние по умолчанию", () => {
    const state = readState("");

    expect(state.origin).toBe(DEFAULT_STATE.origin);
    expect(state.budget).toBe(DEFAULT_STATE.budget);
    expect(state.modes).toHaveLength(MODES.length);
    expect(state.selected).toBeNull();
  });

  it("читает поделённую ссылку целиком, включая выбранный город", () => {
    const state = readState("?from=Казань&date=2026-09-25&budget=3000&hours=12&city=izhevsk");

    expect(state.origin).toBe("Казань");
    expect(state.date).toBe("2026-09-25");
    expect(state.budget).toBe(3000);
    expect(state.maxHours).toBe(12);
    expect(state.selected).toBe("izhevsk");
  });

  // Значения из ссылки приходят от пользователя и правятся руками, поэтому
  // границы обязан держать код, а не вера в аккуратность того, кто её прислал.
  it("зажимает значения за пределами допустимого диапазона", () => {
    const state = readState("?budget=99999999&hours=99999&pax=42&smin=0&smax=900&after=48&before=0");

    expect(state.budget).toBe(BUDGET_UNLIMITED);
    expect(state.maxHours).toBe(HOURS_MAX);
    expect(state.passengers).toBe(6);
    expect(state.stayMin).toBeGreaterThanOrEqual(1);
    expect(state.stayMax).toBeLessThanOrEqual(30);
    expect(state.departAfter).toBeLessThanOrEqual(23);
    expect(state.arriveBefore).toBeGreaterThanOrEqual(1);
  });

  it("не ломается на мусоре вместо чисел", () => {
    const state = readState("?budget=дешево&hours=-5&pax=0");

    expect(state.budget).toBe(DEFAULT_STATE.budget);
    expect(state.maxHours).toBeGreaterThanOrEqual(HOURS_MIN);
    expect(state.budget).toBeGreaterThanOrEqual(BUDGET_MIN);
    expect(state.passengers).toBe(1);
  });

  it("отбрасывает несуществующие виды транспорта, но не оставляет список пустым", () => {
    expect(readState("?modes=avia,ковёр-самолёт").modes).toEqual(["avia"]);
    expect(readState("?modes=ковёр-самолёт").modes).toHaveLength(MODES.length);
  });

  it("флаги читаются только как явная единица", () => {
    expect(readState("?abroad=1&rt=1").abroadOnly).toBe(true);
    expect(readState("?abroad=1&rt=1").roundTrip).toBe(true);
    expect(readState("?abroad=0").abroadOnly).toBe(false);
    expect(readState("?abroad=true").abroadOnly).toBe(false);
  });
});
