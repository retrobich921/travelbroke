import { converter } from "culori";
import { describe, expect, it } from "vitest";

import { legendStops, priceColor, priceRatio } from "./palette";

const toOklch = converter("oklch");

function lightness(color: string): number {
  return toOklch(color)?.l ?? Number.NaN;
}

describe("priceRatio", () => {
  it("нормализует цену в долю диапазона", () => {
    expect(priceRatio(1000, 1000, 5000)).toBe(0);
    expect(priceRatio(5000, 1000, 5000)).toBe(1);
    expect(priceRatio(3000, 1000, 5000)).toBe(0.5);
  });

  it("не делит на ноль, когда все города стоят одинаково", () => {
    expect(priceRatio(2000, 2000, 2000)).toBe(0);
  });
});

describe("priceColor", () => {
  it("зажимает выход за границы диапазона", () => {
    expect(priceColor(-1)).toBe(priceColor(0));
    expect(priceColor(2)).toBe(priceColor(1));
  });

  // Без монотонной светлоты получалась радуга: дешёвый лайм и дорогая сирень
  // были одинаково светлыми, и порядок «дешевле — дороже» глаз не читал.
  it("темнеет монотонно от дешёвого к дорогому", () => {
    const steps = [0, 0.25, 0.5, 0.75, 1].map((t) => lightness(priceColor(t)));

    for (let i = 1; i < steps.length; i += 1) {
      expect(steps[i]).toBeLessThan(steps[i - 1]);
    }
  });

  it("даёт заметный контраст между крайними ценами", () => {
    expect(lightness(priceColor(0)) - lightness(priceColor(1))).toBeGreaterThan(0.3);
  });
});

describe("legendStops", () => {
  it("возвращает запрошенное число ступеней от дешёвого к дорогому", () => {
    const stops = legendStops(5);

    expect(stops).toHaveLength(5);
    expect(stops[0]).toBe(priceColor(0));
    expect(stops[4]).toBe(priceColor(1));
  });
});
