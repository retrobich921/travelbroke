import type { FeatureCollection, LineString, Point } from "geojson";
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
import { useTheme, type Theme } from "./theme";
import { readState, writeState } from "./urlState";

// Воркер и его общий чанк лежат статикой в public/ (см. scripts/copy-maplibre-worker.mjs):
// сборщик эмитить эту пару не умеет, а без воркера карта не рендерится вовсе.
maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

const SOURCE = "reachable";
const ORIGIN_SOURCE = "origin";
const ROUTE_SOURCE = "route";

/** Векторные подложки на данных OpenStreetMap: без ключей и регистрации. */
const VECTOR_STYLE: Record<Theme, string> = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
};

/**
 * Запасная подложка на растровых тайлах.
 *
 * Векторный стиль тянет отдельно tiles.json, шрифты и спрайты — точек отказа
 * больше. Растр требует одного запроса на тайл и переживает плохую сеть там,
 * где вектор не поднимается.
 */
function rasterStyle(theme: Theme): maplibregl.StyleSpecification {
  const flavour = theme === "dark" ? "dark_all" : "light_all";
  return {
    version: 8,
    sources: {
      carto: {
        type: "raster",
        tiles: ["a", "b", "c"].map(
          (host) => `https://${host}.basemaps.cartocdn.com/${flavour}/{z}/{x}/{y}.png`,
        ),
        tileSize: 256,
        attribution: "© CARTO, © OpenStreetMap contributors",
      },
    },
    layers: [{ id: "carto", type: "raster", source: "carto" }],
  };
}

/** Сколько ждём векторный стиль, прежде чем откатиться на растровый. */
const STYLE_TIMEOUT_MS = 6000;

interface Palette {
  label: string;
  halo: string;
  saved: string;
  origin: string;
}

function paletteFor(theme: Theme): Palette {
  return theme === "dark"
    ? { label: "#ffffff", halo: "rgba(13,10,43,0.92)", saved: "#d0ff1a", origin: "#7b61ff" }
    : { label: "#151047", halo: "rgba(255,255,255,0.92)", saved: "#3f22b8", origin: "#4b2fc9" };
}

interface MapPoint {
  reach: ReachOut;
  price: number | null;
  hours: number | null;
  /** Проходит ли город по текущим фильтрам бюджета, времени и транспорта. */
  passes: boolean;
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
    return { reach, price: reach.price, hours: reach.hours, passes: true };
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
  return { reach, price, hours, passes: true };
}

/**
 * Все города всегда остаются на карте.
 *
 * Не прошедшие фильтр не исчезают, а гаснут: пропадающие точки рвут связь с
 * выбранным маршрутом (линия уходила в никуда) и скрывают важное — что дальше
 * денег уже не хватает.
 */
function toGeoJSON(points: MapPoint[], min: number, max: number): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: points.map(({ reach, price, hours, passes }) => {
      const ratio = price === null ? 1 : priceRatio(price, min, max);
      const dimmed = !passes || price === null;
      return {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [reach.lon, reach.lat] },
        properties: {
          slug: reach.slug,
          name: reach.name,
          label: dimmed || price === null ? "" : `${reach.name} · ${formatPrice(price)}`,
          color: dimmed ? UNREACHABLE : priceColor(ratio),
          radius: dimmed ? 4 : 7 + 7 * (1 - ratio),
          opacity: dimmed ? 0.28 : 0.95,
          cheap: !dimmed && ratio < 0.35,
          saved: dimmed ? 0 : (reach.beats_direct_by ?? 0),
          savedLabel:
            !dimmed && reach.beats_direct_by ? `−${formatPrice(reach.beats_direct_by)}` : "",
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

/** Линия выбранного маршрута: из точки отправления, при необходимости через хаб. */
function routeGeoJSON(
  origin: CityOut | null,
  target: ReachOut | null,
  byName: Map<string, CityOut>,
): FeatureCollection<LineString> {
  if (!origin || !target) return { type: "FeatureCollection", features: [] };
  const hub = target.via ? byName.get(target.via) : undefined;
  const coordinates: [number, number][] = [[origin.lon, origin.lat]];
  if (hub) coordinates.push([hub.lon, hub.lat]);
  coordinates.push([target.lon, target.lat]);
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates },
        properties: { via: Boolean(hub) },
      },
    ],
  };
}

/** Ставит источники и слои поверх текущего стиля. Вызывается заново при смене темы. */
function installLayers(instance: maplibregl.Map, palette: Palette): void {
  const empty: FeatureCollection<Point> = { type: "FeatureCollection", features: [] };
  for (const id of [SOURCE, ORIGIN_SOURCE, ROUTE_SOURCE]) {
    if (!instance.getSource(id)) instance.addSource(id, { type: "geojson", data: empty });
  }

  // Линия маршрута рисуется под точками, чтобы не перекрывать города.
  instance.addLayer({
    id: "route-line",
    type: "line",
    source: ROUTE_SOURCE,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ["case", ["get", "via"], palette.saved, palette.origin],
      "line-width": 2.5,
      "line-opacity": 0.85,
      "line-dasharray": [2, 1.5],
    },
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
      "circle-stroke-color": palette.halo,
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
      "text-color": palette.label,
      "text-halo-color": palette.halo,
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
      "text-color": palette.saved,
      "text-halo-color": palette.halo,
      "text-halo-width": 1.6,
    },
  });

  instance.addLayer({
    id: "origin-point",
    type: "circle",
    source: ORIGIN_SOURCE,
    paint: {
      "circle-radius": 7,
      "circle-color": palette.origin,
      "circle-stroke-width": 3,
      "circle-stroke-color": palette.halo,
    },
  });

  // Точку отправления тоже подписываем — иначе непонятно, откуда идёт линия.
  instance.addLayer({
    id: "origin-label",
    type: "symbol",
    source: ORIGIN_SOURCE,
    layout: {
      "text-field": ["get", "name"],
      "text-size": 12,
      "text-offset": [0, 1.2],
      "text-anchor": "top",
      "text-allow-overlap": true,
    },
    paint: {
      "text-color": palette.label,
      "text-halo-color": palette.halo,
      "text-halo-width": 1.6,
    },
  });
}

export default function App() {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const usedFallback = useRef(false);

  const [theme, toggleTheme] = useTheme();
  const [styleEpoch, setStyleEpoch] = useState(0);
  const [mapNote, setMapNote] = useState<string | null>(null);

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
  const [passengers, setPassengers] = useState(initial.passengers);
  const [selected, setSelected] = useState<string | null>(initial.selected);
  const [panelOpen, setPanelOpen] = useState(true);

  useEffect(() => {
    writeState({ origin, date, budget, maxHours, modes, deep, passengers, selected });
  }, [origin, date, budget, maxHours, modes, deep, passengers, selected]);

  useEffect(() => {
    fetchCities()
      .then(setCities)
      .catch(() => setError("не удалось загрузить справочник городов"));
  }, []);

  // Карта создаётся один раз, поэтому текущую тему держим в ref.
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useEffect(() => {
    if (!container.current || map.current) return;
    const instance = new maplibregl.Map({
      container: container.current,
      style: VECTOR_STYLE[themeRef.current],
      center: [55, 57],
      zoom: 3.1,
      attributionControl: { compact: true },
    });
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

    const install = () => {
      installLayers(instance, paletteFor(themeRef.current));
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
      setStyleEpoch((epoch) => epoch + 1);
    };

    instance.on("load", install);

    // Если векторный стиль не поднялся, молча переходим на растровый.
    const fallback = () => {
      if (usedFallback.current || instance.isStyleLoaded()) return;
      usedFallback.current = true;
      setMapNote("Подложка загружается запасным способом.");
      instance.setStyle(rasterStyle(themeRef.current));
      instance.once("styledata", install);
    };
    const timer = window.setTimeout(fallback, STYLE_TIMEOUT_MS);
    instance.on("error", (event) => {
      console.warn("[map]", event.error?.message ?? event);
      fallback();
    });

    map.current = instance;
    return () => {
      window.clearTimeout(timer);
      instance.remove();
      map.current = null;
    };
  }, []);

  // Смена темы меняет подложку целиком, поэтому слои ставим заново.
  const appliedTheme = useRef(theme);
  useEffect(() => {
    const instance = map.current;
    if (!instance || styleEpoch === 0 || appliedTheme.current === theme) return;
    appliedTheme.current = theme;
    instance.setStyle(usedFallback.current ? rasterStyle(theme) : VECTOR_STYLE[theme]);
    instance.once("styledata", () => {
      installLayers(instance, paletteFor(theme));
      setStyleEpoch((epoch) => epoch + 1);
    });
  }, [theme, styleEpoch]);

  const points = useMemo(() => {
    if (!data) return [];
    return data.cities.map((reach) => {
      const point = effective(reach, modes);
      const passes =
        point.price !== null &&
        point.price <= budget &&
        (point.hours === null || point.hours <= maxHours);
      return { ...point, passes };
    });
  }, [data, modes, budget, maxHours]);

  const visible = useMemo(() => points.filter((point) => point.passes), [points]);

  const bounds = useMemo(() => {
    const prices = visible
      .map((point) => point.price)
      .filter((value): value is number => value !== null);
    if (!prices.length) return { min: 0, max: 1 };
    return { min: Math.min(...prices), max: Math.max(...prices) };
  }, [visible]);

  useEffect(() => {
    if (!styleEpoch || !map.current) return;
    const source = map.current.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined;
    source?.setData(toGeoJSON(visible, bounds.min, bounds.max));
  }, [styleEpoch, visible, bounds]);

  useEffect(() => {
    if (!styleEpoch || !map.current) return;
    const source = map.current.getSource(ORIGIN_SOURCE) as maplibregl.GeoJSONSource | undefined;
    source?.setData(originGeoJSON(data?.origin ?? null));
  }, [styleEpoch, data]);

  const byName = useMemo(() => new Map(cities.map((city) => [city.name, city])), [cities]);
  const chosen = data?.cities.find((reach) => reach.slug === selected) ?? null;

  useEffect(() => {
    if (!styleEpoch || !map.current) return;
    const source = map.current.getSource(ROUTE_SOURCE) as maplibregl.GeoJSONSource | undefined;
    source?.setData(routeGeoJSON(data?.origin ?? null, chosen, byName));
  }, [styleEpoch, data, chosen, byName]);

  const search = useCallback(
    async (city: string, when: string, withTransfers: boolean, people: number) => {
    setLoading(true);
    setError(null);
    setSelected(null);
    try {
      const response = await fetchReachable({
        origin: city,
        date: when,
        modes: [...MODES],
        deep: withTransfers,
        passengers: people,
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

  // Первый расчёт запускаем сами: пустая карта на старте — потерянное впечатление.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void search(origin, date, deep, passengers);
  }, [search, origin, date, deep, passengers]);

  const toggleMode = useCallback((mode: Mode) => {
    setModes((current) =>
      current.includes(mode)
        ? current.length > 1
          ? current.filter((item) => item !== mode)
          : current
        : [...current, mode],
    );
  }, []);

  const cheapest = visible.reduce<MapPoint | null>(
    (best, point) =>
      best === null || (point.price ?? Infinity) < (best.price ?? Infinity) ? point : best,
    null,
  );
  const hidden = points.filter((point) => point.reach.beats_direct_by).length;
  const unreachable = points.length - visible.length;

  const card = "rounded-2xl bg-tb-panel/90 px-4 py-3 ring-1 ring-tb-line backdrop-blur";

  return (
    <div className="relative h-full w-full overflow-hidden bg-tb-bg">
      <div ref={container} className="absolute inset-0" />

      {loading && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 h-1 overflow-hidden bg-tb-fill">
          <div className="h-full w-1/3 animate-[slide_1.4s_ease-in-out_infinite] bg-tb-accent" />
        </div>
      )}

      <header className="tb-scroll pointer-events-none absolute top-0 left-0 z-10 flex max-h-full max-w-[min(19rem,calc(100vw-9rem))] flex-col gap-3 overflow-y-auto p-4 sm:p-6 lg:max-h-[calc(100vh-9rem)]">
        <div className="shrink-0">
          <h1 className="text-2xl font-black tracking-tight text-tb-hero sm:text-4xl">
            TravelBroke
          </h1>
          <p className="mt-1 text-xs text-tb-muted sm:text-sm">
            Ты на мели. Мы всё равно тебя увезём.
          </p>
        </div>

        {data && !loading && (
          <div className={`tb-rise pointer-events-auto shrink-0 ${card}`}>
            <div className="text-tb-ink">
              <span className="text-3xl font-black text-tb-hero">{visible.length}</span>{" "}
              <span className="text-sm">
                {visible.length === 1 ? "город" : "городов"} по карману
              </span>
            </div>
            {cheapest?.price != null && (
              <div className="mt-1 text-xs text-tb-muted">
                Дешевле всего — {cheapest.reach.name} за {formatPrice(cheapest.price)}
              </div>
            )}
            {hidden > 0 && (
              <div className="mt-2 rounded-xl bg-tb-cheap/20 px-3 py-2 text-xs ring-1 ring-tb-accent/25">
                <span className="font-bold text-tb-ink">Скрытых пересадок: {hidden}</span>
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
          <div className={`pointer-events-auto shrink-0 text-sm text-tb-muted ${card}`}>
            Опрашиваем Туту по всем городам сразу.
            {deep && <> Ищем ещё и составные маршруты — это дольше.</>}
          </div>
        )}

        {!loading && data && visible.length === 0 && (
          <div className={`tb-rise pointer-events-auto shrink-0 text-sm ${card}`}>
            <div className="font-semibold text-tb-ink">За эти деньги — никуда.</div>
            <div className="mt-1 text-xs text-tb-muted">
              Подвинь бюджет или добавь часов в пути.
            </div>
          </div>
        )}

        {mapNote && (
          <div className={`pointer-events-auto shrink-0 text-xs text-tb-muted ${card}`}>{mapNote}</div>
        )}

        {error && (
          <div className="pointer-events-auto shrink-0 rounded-2xl bg-red-500/20 px-4 py-3 text-sm text-red-100 ring-1 ring-red-400/40">
            {error}
          </div>
        )}
      </header>

      {/* Правая колонка: кнопки, настройки и карточка поездки в одном потоке.
          Высота колонки ограничена экраном, поэтому карточка не уезжает за край,
          а прокручивается внутри себя. */}
      <div className="pointer-events-none absolute inset-x-3 bottom-3 z-20 flex max-h-[86vh] flex-col-reverse gap-3 sm:inset-x-4 sm:bottom-4 lg:inset-x-auto lg:top-6 lg:right-6 lg:bottom-6 lg:w-84 lg:max-h-none lg:flex-col">
        <div className="pointer-events-auto flex shrink-0 justify-end gap-2">
          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Переключить тему оформления"
            className="rounded-full bg-tb-panel/90 px-3.5 py-2 text-base leading-none text-tb-ink ring-1 ring-tb-line backdrop-blur transition hover:brightness-105"
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
          <button
            type="button"
            onClick={() => setPanelOpen((open) => !open)}
            className="rounded-full bg-tb-panel/90 px-4 py-2 text-sm font-semibold text-tb-ink ring-1 ring-tb-line backdrop-blur transition hover:brightness-105 lg:hidden"
          >
            {panelOpen ? "Скрыть настройки" : "Настроить"}
          </button>
        </div>

        <div className={`contents ${panelOpen ? "" : "hidden lg:contents"}`}>
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
          passengers={passengers}
          onPassengers={setPassengers}
          onSearch={() => void search(origin, date, deep, passengers)}
        />
        </div>
        {chosen && (
          <TripCard
            reach={chosen}
            origin={data?.origin.name ?? origin}
            passengers={passengers}
            filtered={points.some((point) => point.reach.slug === chosen.slug && !point.passes)}
            onClose={() => setSelected(null)}
          />
        )}
      </div>

      <div
        className={`pointer-events-none absolute bottom-6 left-6 z-10 hidden w-64 lg:block ${card}`}
      >
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
