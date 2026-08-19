import type { FeatureCollection, Point } from "geojson";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  MODES,
  fetchCities,
  fetchReachable,
  formatPrice,
  type CityOut,
  type Mode,
  type ReachOut,
  type ReachableResponse,
} from "./api";
import { ControlPanel } from "./components/ControlPanel";
import { TripCard } from "./components/TripCard";
import { UNREACHABLE, legendStops, priceColor, priceRatio } from "./palette";
import { readState, writeState } from "./urlState";

/** Тёмная подложка на данных OpenStreetMap: без ключей, без регистрации. */
const BASEMAP = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const SOURCE = "reachable";
const ORIGIN_SOURCE = "origin";

interface MapPoint {
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
function effective(reach: ReachOut, modes: Mode[]): MapPoint {
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

function toGeoJSON(points: MapPoint[], min: number, max: number): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: points.map(({ reach, price, hours }) => {
      const ratio = price === null ? 1 : priceRatio(price, min, max);
      return {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [reach.lon, reach.lat] },
        properties: {
          slug: reach.slug,
          name: reach.name,
          label: price === null ? reach.name : `${reach.name} · ${formatPrice(price)}`,
          color: price === null ? UNREACHABLE : priceColor(ratio),
          radius: price === null ? 4 : 7 + 7 * (1 - ratio),
          opacity: price === null ? 0.25 : 0.95,
          cheap: price !== null && ratio < 0.35,
          saved: reach.beats_direct_by ?? 0,
          savedLabel: reach.beats_direct_by ? `−${formatPrice(reach.beats_direct_by)}` : "",
          hours: hours ?? 0,
        },
      };
    }),
  };
}

function originGeoJSON(city: CityOut | null): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: city
      ? [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [city.lon, city.lat] },
            properties: { name: city.name },
          },
        ]
      : [],
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

  // Начальное состояние берём из адресной строки: ссылкой можно поделиться.
  const initial = useRef(readState()).current;
  const [origin, setOrigin] = useState(initial.origin);
  const [date, setDate] = useState(initial.date);
  const [budget, setBudget] = useState(initial.budget);
  const [maxHours, setMaxHours] = useState(initial.maxHours);
  const [modes, setModes] = useState<Mode[]>(initial.modes);
  const [deep, setDeep] = useState(initial.deep);
  const [selected, setSelected] = useState<string | null>(initial.selected);
  const [panelOpen, setPanelOpen] = useState(true);

  useEffect(() => {
    writeState({ origin, date, budget, maxHours, modes, deep, selected });
  }, [origin, date, budget, maxHours, modes, deep, selected]);

  useEffect(() => {
    fetchCities()
      .then(setCities)
      .catch(() => setError("не удалось загрузить справочник городов"));
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
      instance.addSource(ORIGIN_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      // Мягкое свечение под самыми дешёвыми городами — глаз находит их первыми.
      instance.addLayer({
        id: "cities-glow",
        type: "circle",
        source: SOURCE,
        filter: ["==", ["get", "cheap"], true],
        paint: {
          "circle-radius": ["*", ["get", "radius"], 2.6],
          "circle-color": ["get", "color"],
          "circle-opacity": 0.16,
          "circle-blur": 0.9,
          "circle-radius-transition": { duration: 450 },
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
          "circle-radius-transition": { duration: 450 },
          "circle-color-transition": { duration: 450 },
        },
      });

      instance.addLayer({
        id: "cities-label",
        type: "symbol",
        source: SOURCE,
        layout: {
          "text-field": ["get", "label"],
          "text-size": 11,
          "text-offset": [0, 1.3],
          "text-anchor": "top",
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "rgba(21,16,71,0.92)",
          "text-halo-width": 1.4,
          "text-opacity": ["get", "opacity"],
        },
      });

      // Бейдж скрытой пересадки — главная фича должна быть видна прямо на карте.
      instance.addLayer({
        id: "cities-saved",
        type: "symbol",
        source: SOURCE,
        filter: [">", ["get", "saved"], 0],
        layout: {
          "text-field": ["get", "savedLabel"],
          "text-size": 11,
          "text-offset": [0, -1.5],
          "text-anchor": "bottom",
          "text-allow-overlap": true,
        },
        paint: {
          "text-color": "#d0ff1a",
          "text-halo-color": "rgba(21,16,71,0.95)",
          "text-halo-width": 1.6,
        },
      });

      instance.addLayer({
        id: "origin-point",
        type: "circle",
        source: ORIGIN_SOURCE,
        paint: {
          "circle-radius": 7,
          "circle-color": "#7b61ff",
          "circle-stroke-width": 3,
          "circle-stroke-color": "#ffffff",
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

  const points = useMemo(
    () => (data ? data.cities.map((reach) => effective(reach, modes)) : []),
    [data, modes],
  );

  const visible = useMemo(
    () =>
      points.filter(
        (point) =>
          point.price !== null &&
          point.price <= budget &&
          (point.hours === null || point.hours <= maxHours),
      ),
    [points, budget, maxHours],
  );

  const bounds = useMemo(() => {
    const prices = visible
      .map((point) => point.price)
      .filter((value): value is number => value !== null);
    if (!prices.length) return { min: 0, max: 1 };
    return { min: Math.min(...prices), max: Math.max(...prices) };
  }, [visible]);

  useEffect(() => {
    if (!ready || !map.current) return;
    const source = map.current.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined;
    source?.setData(toGeoJSON(visible, bounds.min, bounds.max));
  }, [ready, visible, bounds]);

  useEffect(() => {
    if (!ready || !map.current) return;
    const source = map.current.getSource(ORIGIN_SOURCE) as maplibregl.GeoJSONSource | undefined;
    source?.setData(originGeoJSON(data?.origin ?? null));
  }, [ready, data]);

  const search = useCallback(
    async (city: string, when: string, withTransfers: boolean) => {
      setLoading(true);
      setError(null);
      setSelected(null);
      try {
        const response = await fetchReachable({
          origin: city,
          date: when,
          modes: [...MODES],
          deep: withTransfers,
        });
        setData(response);
        map.current?.easeTo({
          center: [response.origin.lon, response.origin.lat],
          zoom: 3.5,
          duration: 900,
        });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "расчёт не удался");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Первый расчёт запускаем сами: пустая карта на старте — потерянное первое впечатление.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !ready) return;
    started.current = true;
    void search(origin, date, deep);
  }, [ready, search, origin, date, deep]);

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
  const cheapest = visible.reduce<MapPoint | null>(
    (best, point) =>
      best === null || (point.price ?? Infinity) < (best.price ?? Infinity) ? point : best,
    null,
  );
  const hidden = points.filter((point) => point.reach.beats_direct_by).length;
  const unreachable = points.length - visible.length;

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={container} className="absolute inset-0" />

      {loading && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 h-1 overflow-hidden bg-white/10">
          <div className="h-full w-1/3 animate-[slide_1.4s_ease-in-out_infinite] bg-tb-cheap" />
        </div>
      )}

      <header className="pointer-events-none absolute top-0 left-0 z-10 max-w-[min(20rem,calc(100vw-2rem))] p-5 sm:p-6">
        <h1 className="text-3xl font-black tracking-tight text-tb-cheap sm:text-4xl">
          TravelBroke
        </h1>
        <p className="mt-1 text-sm text-tb-muted">Ты на мели. Мы всё равно тебя увезём.</p>

        {data && !loading && (
          <div className="pointer-events-auto mt-4 rounded-2xl bg-tb-ink/85 px-4 py-3 ring-1 ring-white/10 backdrop-blur">
            <div className="text-white">
              <span className="text-3xl font-black text-tb-cheap">{visible.length}</span>{" "}
              <span className="text-sm">
                {visible.length === 1 ? "город" : "городов"} по карману
              </span>
            </div>
            {cheapest?.price !== null && cheapest && (
              <div className="mt-1 text-xs text-tb-muted">
                Дешевле всего — {cheapest.reach.name} за {formatPrice(cheapest.price)}
              </div>
            )}
            {hidden > 0 && (
              <div className="mt-2 rounded-xl bg-tb-cheap/12 px-3 py-2 text-xs ring-1 ring-tb-cheap/25">
                <span className="font-bold text-tb-cheap">Найдено скрытых пересадок: {hidden}</span>
                <span className="text-tb-muted"> — там дешевле ехать не напрямую.</span>
              </div>
            )}
            <div className="mt-2 text-[11px] text-tb-muted/70">
              {data.calls} запросов к Туту, {data.cached} из кэша
              {unreachable > 0 && ` · ${unreachable} не проходит по фильтрам`}
            </div>
          </div>
        )}

        {loading && (
          <div className="pointer-events-auto mt-4 rounded-2xl bg-tb-ink/85 px-4 py-3 text-sm text-tb-muted ring-1 ring-white/10 backdrop-blur">
            Опрашиваем Туту по всем городам сразу.
            {deep && <> Ищем ещё и составные маршруты — это дольше.</>}
          </div>
        )}

        {!loading && data && visible.length === 0 && (
          <div className="pointer-events-auto mt-4 rounded-2xl bg-tb-ink/85 px-4 py-3 text-sm ring-1 ring-white/10 backdrop-blur">
            <div className="font-semibold text-white">За эти деньги — никуда.</div>
            <div className="mt-1 text-xs text-tb-muted">
              Самый дешёвый вариант на эту дату —{" "}
              {points
                .filter((point) => point.price !== null)
                .reduce<MapPoint | null>(
                  (best, point) =>
                    best === null || (point.price ?? 0) < (best.price ?? 0) ? point : best,
                  null,
                )?.reach.name ?? "не найден"}
              . Подвинь бюджет или добавь часов в пути.
            </div>
          </div>
        )}

        {error && (
          <div className="pointer-events-auto mt-4 rounded-2xl bg-red-500/20 px-4 py-3 text-sm text-red-100 ring-1 ring-red-400/40">
            {error}
          </div>
        )}
      </header>

      <button
        type="button"
        onClick={() => setPanelOpen((open) => !open)}
        className="absolute top-5 right-5 z-30 rounded-full bg-tb-ink/90 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/15 backdrop-blur lg:hidden"
      >
        {panelOpen ? "Скрыть" : "Настроить"}
      </button>

      <div
        className={`pointer-events-none absolute z-20 flex flex-col gap-4 overflow-y-auto ${
          panelOpen ? "flex" : "hidden lg:flex"
        } inset-x-4 bottom-4 max-h-[70vh] items-stretch pt-16 lg:inset-x-auto lg:top-6 lg:right-6 lg:bottom-6 lg:max-h-none lg:items-end lg:pt-0`}
      >
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
          onSearch={() => void search(origin, date, deep)}
        />
        {chosen && (
          <TripCard
            reach={chosen}
            origin={data?.origin.name ?? origin}
            onClose={() => setSelected(null)}
          />
        )}
      </div>

      <div className="pointer-events-none absolute bottom-6 left-6 z-10 hidden w-64 rounded-2xl bg-tb-ink/85 px-4 py-3 ring-1 ring-white/10 backdrop-blur sm:block">
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
