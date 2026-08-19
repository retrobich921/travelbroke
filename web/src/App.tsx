import type { FeatureCollection, Point } from "geojson";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  MODES,
  fetchCities,
  fetchReachable,
  formatPrice,
  nextSaturday,
  type CityOut,
  type Mode,
  type ReachOut,
  type ReachableResponse,
} from "./api";
import { ControlPanel } from "./components/ControlPanel";
import { TripCard } from "./components/TripCard";
import { UNREACHABLE, legendStops, priceColor, priceRatio } from "./palette";

/** Тёмная подложка на данных OpenStreetMap: без ключей, без регистрации. */
const BASEMAP = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const SOURCE = "reachable";

interface Point2D {
  reach: ReachOut;
  price: number | null;
  hours: number | null;
}

/**
 * Цена и время с учётом выбранных видов транспорта.
 *
 * Когда включены все четыре, берём лучший маршрут целиком — он может быть
 * составным. Когда часть выключена, пересчитываем по `by_mode`: это позволяет
 * тумблерам работать мгновенно, не дёргая сервер.
 */
function effective(reach: ReachOut, modes: Mode[]): Point2D {
  if (modes.length === MODES.length) {
    return { reach, price: reach.price, hours: reach.hours };
  }
  let price: number | null = null;
  let hours: number | null = null;
  for (const mode of modes) {
    const candidate = reach.by_mode[mode];
    if (candidate === undefined) continue;
    if (price === null || candidate < price) {
      price = candidate;
      const minutes = reach.by_mode_minutes[mode];
      hours = minutes === undefined ? null : Math.round((minutes / 60) * 10) / 10;
    }
  }
  return { reach, price, hours };
}

function toGeoJSON(points: Point2D[], min: number, max: number): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: points.map(({ reach, price, hours }) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [reach.lon, reach.lat] },
      properties: {
        slug: reach.slug,
        name: reach.name,
        price,
        label: price === null ? reach.name : `${reach.name} · ${formatPrice(price)}`,
        color: price === null ? UNREACHABLE : priceColor(priceRatio(price, min, max)),
        radius: price === null ? 4 : 7 + 6 * (1 - priceRatio(price, min, max)),
        opacity: price === null ? 0.25 : 0.95,
        cheap: price !== null && priceRatio(price, min, max) < 0.35,
        saved: reach.beats_direct_by ?? 0,
        hours: hours ?? 0,
      },
    })),
  };
}

export default function App() {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);

  const [cities, setCities] = useState<CityOut[]>([]);
  const [data, setData] = useState<ReachableResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [origin, setOrigin] = useState("Москва");
  const [date, setDate] = useState(nextSaturday);
  const [budget, setBudget] = useState(6000);
  const [maxHours, setMaxHours] = useState(24);
  const [modes, setModes] = useState<Mode[]>([...MODES]);
  const [deep, setDeep] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    fetchCities().then(setCities).catch(() => setError("не удалось загрузить справочник городов"));
  }, []);

  useEffect(() => {
    if (!container.current || map.current) return;
    const instance = new maplibregl.Map({
      container: container.current,
      style: BASEMAP,
      center: [55, 57],
      zoom: 3.1,
      attributionControl: { compact: true },
    });
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    instance.on("load", () => {
      instance.addSource(SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      instance.addLayer({
        id: "cities-glow",
        type: "circle",
        source: SOURCE,
        filter: ["==", ["get", "cheap"], true],
        paint: {
          "circle-radius": ["*", ["get", "radius"], 2.4],
          "circle-color": ["get", "color"],
          "circle-opacity": 0.16,
          "circle-blur": 0.9,
        },
      });
      instance.addLayer({
        id: "cities",
        type: "circle",
        source: SOURCE,
        paint: {
          "circle-radius": ["get", "radius"],
          "circle-color": ["get", "color"],
          "circle-opacity": ["get", "opacity"],
          "circle-stroke-width": 1,
          "circle-stroke-color": "rgba(21,16,71,0.85)",
        },
      });
      instance.addLayer({
        id: "cities-label",
        type: "symbol",
        source: SOURCE,
        layout: {
          "text-field": ["get", "label"],
          "text-size": 11,
          "text-offset": [0, 1.4],
          "text-anchor": "top",
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "rgba(21,16,71,0.9)",
          "text-halo-width": 1.4,
          "text-opacity": ["get", "opacity"],
        },
      });
      instance.on("click", "cities", (event) => {
        const slug = event.features?.[0]?.properties?.slug;
        if (typeof slug === "string") setSelected(slug);
      });
      instance.on("mouseenter", "cities", () => {
        instance.getCanvas().style.cursor = "pointer";
      });
      instance.on("mouseleave", "cities", () => {
        instance.getCanvas().style.cursor = "";
      });
      setReady(true);
    });
    map.current = instance;
    return () => {
      instance.remove();
      map.current = null;
      setReady(false);
    };
  }, []);

  const visible = useMemo(() => {
    if (!data) return [];
    return data.cities
      .map((reach) => effective(reach, modes))
      .filter(
        (point) =>
          point.price !== null &&
          point.price <= budget &&
          (point.hours === null || point.hours <= maxHours),
      );
  }, [data, modes, budget, maxHours]);

  const bounds = useMemo(() => {
    const prices = visible.map((point) => point.price!).filter((value) => Number.isFinite(value));
    if (!prices.length) return { min: 0, max: 1 };
    return { min: Math.min(...prices), max: Math.max(...prices) };
  }, [visible]);

  useEffect(() => {
    if (!ready || !map.current) return;
    const source = map.current.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined;
    source?.setData(toGeoJSON(visible, bounds.min, bounds.max));
  }, [ready, visible, bounds]);

  const search = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelected(null);
    try {
      const response = await fetchReachable({ origin, date, modes: [...MODES], deep });
      setData(response);
      const home = response.origin;
      map.current?.easeTo({ center: [home.lon, home.lat], zoom: 3.6, duration: 900 });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "расчёт не удался");
    } finally {
      setLoading(false);
    }
  }, [origin, date, deep]);

  const toggleMode = useCallback((mode: Mode) => {
    setModes((current) =>
      current.includes(mode)
        ? current.length > 1
          ? current.filter((item) => item !== mode)
          : current
        : [...current, mode],
    );
  }, []);

  const chosen = data?.cities.find((reach) => reach.slug === selected) ?? null;
  const cheapest = visible.reduce<Point2D | null>(
    (best, point) => (best === null || point.price! < best.price! ? point : best),
    null,
  );

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={container} className="absolute inset-0" />

      <header className="pointer-events-none absolute top-0 left-0 z-10 p-6">
        <h1 className="text-4xl font-black tracking-tight text-tb-cheap">TravelBroke</h1>
        <p className="mt-1 max-w-70 text-sm text-tb-muted">
          Ты на мели. Мы всё равно тебя увезём.
        </p>

        {data && (
          <div className="pointer-events-auto mt-5 rounded-2xl bg-tb-ink/85 px-4 py-3 text-sm ring-1 ring-white/10 backdrop-blur">
            <div className="text-white">
              <span className="text-2xl font-black text-tb-cheap">{visible.length}</span>{" "}
              {visible.length === 1 ? "город" : "городов"} по карману
            </div>
            {cheapest && (
              <div className="mt-1 text-xs text-tb-muted">
                Дешевле всего — {cheapest.reach.name} за {formatPrice(cheapest.price!)}
              </div>
            )}
            <div className="mt-2 text-[11px] text-tb-muted/70">
              {data.calls} запросов к Туту, из них {data.cached} из кэша
            </div>
          </div>
        )}

        {error && (
          <div className="pointer-events-auto mt-4 max-w-70 rounded-2xl bg-red-500/20 px-4 py-3 text-sm text-red-100 ring-1 ring-red-400/40">
            {error}
          </div>
        )}
      </header>

      <div className="pointer-events-none absolute top-6 right-6 bottom-6 z-10 flex flex-col items-end gap-4 overflow-y-auto">
        <ControlPanel
          cities={cities}
          origin={origin}
          date={date}
          budget={budget}
          maxHours={maxHours}
          modes={modes}
          deep={deep}
          loading={loading}
          onOrigin={setOrigin}
          onDate={setDate}
          onBudget={setBudget}
          onMaxHours={setMaxHours}
          onToggleMode={toggleMode}
          onDeep={setDeep}
          onSearch={search}
        />
        {chosen && (
          <TripCard
            reach={chosen}
            origin={data?.origin.name ?? origin}
            modes={modes}
            onClose={() => setSelected(null)}
          />
        )}
      </div>

      <div className="pointer-events-none absolute bottom-6 left-6 z-10 w-64 rounded-2xl bg-tb-ink/85 px-4 py-3 ring-1 ring-white/10 backdrop-blur">
        <div className="text-[11px] font-semibold tracking-wider text-tb-muted uppercase">
          Цена поездки
        </div>
        <div className="mt-2 flex h-2.5 overflow-hidden rounded-full">
          {legendStops(24).map((color) => (
            <span key={color} className="flex-1" style={{ backgroundColor: color }} />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-tb-muted">
          <span>{visible.length ? formatPrice(bounds.min) : "дёшево"}</span>
          <span>{visible.length ? formatPrice(bounds.max) : "дорого"}</span>
        </div>
      </div>
    </div>
  );
}
