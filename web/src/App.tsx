import type { FeatureCollection, LineString, Point } from "geojson";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  MODES,
  fetchCities,
  IDLE_PROGRESS,
  fetchProgress,
  fetchReachable,
  formatPrice,
  type CityOut,
  type Mode,
  type ProgressOut,
  type ReachOut,
  type ReachableResponse,
  type VariantOut,
} from "./api";
import { ControlPanel } from "./components/ControlPanel";
import { TRANSPORT_PATHS } from "./transport";
import { SearchProgress } from "./components/SearchProgress";
import { StartScreen } from "./components/StartScreen";
import { TripCard } from "./components/TripCard";
import { UNREACHABLE, legendStops, priceColor, priceRatio } from "./palette";
import {
  clearSearchHistory,
  readSearchHistory,
  saveSearchHistory,
  type SearchHistoryEntry,
} from "./searchHistory";
import { tripForModes, type DisplayedTrip } from "./trip";
import { BUDGET_UNLIMITED, readState, writeState } from "./urlState";

// Воркер и его общий чанк лежат статикой в public/ (см. scripts/copy-maplibre-worker.mjs):
// сборщик эмитить эту пару не умеет, а без воркера карта не рендерится вовсе.
maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

const SOURCE = "reachable";
const ORIGIN_SOURCE = "origin";
const ROUTE_SOURCE = "route";
const TRANSFER_SOURCE = "transfer";
type Theme = "dark" | "light";

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
    // Без `glyphs` символьные слои не имеют шрифта, и при откате на растр
    // молча пропадали бы все подписи: города, экономия, точка отправления.
    glyphs: "https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf",
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

/**
 * Палитра слоёв карты.
 *
 * Полотно MapLibre рисуется не браузером, а WebGL: CSS-переменные туда не
 * доходят. Поэтому единственный дубль токенов в проекте живёт здесь — те же
 * цвета, что в `index.css`, только уже посчитанные в sRGB.
 */
interface Palette {
  label: string;
  halo: string;
  saved: string;
  origin: string;
  ink: string;
}

const MAP_PALETTE: Record<Theme, Palette> = {
  dark: {
    label: "#eff1fa",
    halo: "#070916",
    saved: "#d0ff1a",
    origin: "#857aff",
    ink: "#eff1fa",
  },
  light: {
    label: "#151047",
    halo: "#ffffff",
    saved: "#5337cd",
    origin: "#5337cd",
    ink: "#151047",
  },
};

function paletteFor(theme: Theme): Palette {
  return MAP_PALETTE[theme];
}

/**
 * Пиктограммы транспорта на линии маршрута.
 *
 * Эмодзи здесь рисовала бы операционная система — на карте они выглядели
 * цветными наклейками. Берём те же контуры, что и в интерфейсе, и печём из них
 * жетон: диск подложки, контур в цвет темы и знак внутри.
 */
function addTransportIcons(instance: maplibregl.Map, palette: Palette): void {
  for (const [mode, path] of Object.entries(TRANSPORT_PATHS)) {
    const id = `tb-${mode}`;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="64" height="64">` +
      `<circle cx="16" cy="16" r="14.5" fill="${palette.halo}" stroke="${palette.ink}" stroke-width="1.2"/>` +
      `<g transform="translate(6 6)" fill="${palette.ink}" fill-rule="evenodd">` +
      `<path transform="scale(0.833)" d="${path}"/></g></svg>`;
    const image = new Image(64, 64);
    image.onload = () => {
      if (instance.hasImage(id)) instance.removeImage(id);
      instance.addImage(id, image, { pixelRatio: 2 });
    };
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }
}

/**
 * Окно поездки: не выезжать раньше и быть на месте не позже.
 *
 * Наша аудитория отталкивается от цены, а не от даты, поэтому время — мягкий
 * фильтр поверх уже загруженной матрицы: он не требует новых запросов к Туту.
 */
function withinTimeWindow(trip: DisplayedTrip, after: number, before: number): boolean {
  if (after <= 0 && before >= 24) return true;
  if (trip.kind === "unavailable") return false;
  const start = trip.kind === "composite" ? trip.legs[0] : trip.variant;
  const finish = trip.kind === "composite" ? trip.legs[1] : trip.variant;
  if (!start.departure_at || !finish.arrival_at) return true;
  const departure = new Date(start.departure_at);
  const arrival = new Date(finish.arrival_at);
  if (Number.isNaN(departure.getTime()) || Number.isNaN(arrival.getTime())) return true;
  if (departure.getHours() < after) return false;
  if (before < 24 && arrival.getHours() >= before) return false;
  return true;
}

interface MapPoint {
  reach: ReachOut;
  trip: DisplayedTrip;
  price: number | null;
  hours: number | null;
  /** Проходит ли город по текущим фильтрам бюджета, времени и транспорта. */
  passes: boolean;
}

/**
 * Цена и время с учётом выбранных видов транспорта.
 *
 * Берём конкретный вариант, который увидит пользователь в карточке. Нельзя
 * красить город по агрегату `by_mode`, а по клику говорить «нет маршрутов».
 */
function effective(reach: ReachOut, modes: Mode[]): MapPoint {
  const trip = tripForModes(reach, modes);
  if (trip.kind === "unavailable") {
    return { reach, trip, price: null, hours: null, passes: false };
  }
  if (trip.kind === "composite") {
    const price =
      trip.legs[0].price > 0 && trip.legs[1].price > 0
        ? trip.legs[0].price + trip.legs[1].price
        : null;
    return {
      reach,
      trip,
      price,
      hours: reach.hours,
      passes: true,
    };
  }
  return {
    reach,
    trip,
    price: trip.variant.price > 0 ? trip.variant.price : null,
    hours: trip.variant.hours,
    passes: true,
  };
}

/**
 * На карте остаются только города, для которых текущие фильтры оставили
 * конкретный маршрут. Поэтому точку можно открыть без противоречия в карточке.
 */
function toGeoJSON(
  points: MapPoint[],
  min: number,
  max: number,
  showSavings: boolean,
): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: points.map(({ reach, price, hours, passes }) => {
      const knownPrice = price !== null && price > 0;
      const ratio = knownPrice ? priceRatio(price, min, max) : 1;
      const dimmed = !passes || !knownPrice;
      return {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [reach.lon, reach.lat] },
        properties: {
          slug: reach.slug,
          name: reach.name,
          label: dimmed || !knownPrice ? "" : `${reach.name} · ${formatPrice(price)}`,
          color: dimmed ? UNREACHABLE : priceColor(ratio),
          radius: dimmed ? 3 : 5 + 4.5 * (1 - ratio),
          opacity: dimmed ? 0.34 : 0.95,
          cheap: !dimmed && ratio < 0.18,
          saved: dimmed || !showSavings ? 0 : (reach.beats_direct_by ?? 0),
          savedLabel:
            !dimmed && showSavings && reach.beats_direct_by
              ? `−${formatPrice(reach.beats_direct_by)}`
              : "",
          hours: hours ?? 0,
        },
      };
    }),
  };
}

/**
 * Город пересадки выбранного маршрута.
 *
 * В выдаче его может не быть вовсе — например, при поиске только за границу
 * Москва не направление, но именно через неё едет самый дешёвый вариант.
 */
function transferGeoJSON(
  target: ReachOut | null,
  byName: Map<string, CityOut>,
  trip: DisplayedTrip | null,
): FeatureCollection<Point> {
  if (!trip || trip.kind === "unavailable") {
    return { type: "FeatureCollection", features: [] };
  }
  // Внутри одного предложения Туту может быть несколько сегментов (например,
  // Нижнекамск → Москва → Пекин). Это такие же пересадки, как и наш маршрут
  // из двух отдельных билетов, поэтому показываем их тем же понятным маркером.
  const names = [
    ...(trip.kind === "composite" && target?.via ? [target.via] : []),
    ...(trip.kind === "direct" ? trip.variant.waypoints.slice(1, -1) : []),
    ...(trip.kind === "composite" ? trip.legs.flatMap((leg) => leg.waypoints.slice(1, -1)) : []),
  ];
  const seen = new Set<string>();
  const cities = names.flatMap((name) => {
    const city = byName.get(name);
    if (!city) return [];
    const key = city.name.toLocaleLowerCase("ru-RU");
    if (seen.has(key)) return [];
    seen.add(key);
    return [city];
  });
  return {
    type: "FeatureCollection",
    features: cities.map((city) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [city.lon, city.lat] },
      properties: { name: city.name },
    })),
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

type Coordinates = [number, number];

/** Квадратичная дуга для самолёта: длинный перелёт не выглядит как автодорога. */
function curvedCoordinates(from: Coordinates, to: Coordinates, bend: number): Coordinates[] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const distance = Math.hypot(dx, dy);
  if (distance < 0.1) return [from, to];

  const normal: Coordinates = [-dy / distance, dx / distance];
  const middle: Coordinates = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  const control: Coordinates = [
    middle[0] + normal[0] * Math.min(distance * bend, 7),
    middle[1] + normal[1] * Math.min(distance * bend, 7),
  ];
  return Array.from({ length: 25 }, (_, index) => {
    const t = index / 24;
    const inverse = 1 - t;
    return [
      inverse * inverse * from[0] + 2 * inverse * t * control[0] + t * t * to[0],
      inverse * inverse * from[1] + 2 * inverse * t * control[1] + t * t * to[1],
    ];
  });
}

/**
 * Схема маршрута по виду транспорта.
 *
 * Это не навигационная геометрия: Туту отдаёт станции и рейсы, но не треки
 * рельсов и дорог. Поэтому автобус и поезд честно обозначаются стилем линии,
 * а самолёт получает читаемую воздушную дугу.
 */
function segmentCoordinates(from: Coordinates, to: Coordinates, transport: string): Coordinates[] {
  if (transport === "avia") return curvedCoordinates(from, to, 0.18);
  if (transport === "bus") return curvedCoordinates(from, to, 0.035);
  return [from, to];
}

/** Координаты реальных сегментов оффера. Если точка не найдена, не подменяем
 * её случайной геометрией: остаётся одна нейтральная линия между концами. */
function variantStops(
  variant: VariantOut,
  from: Coordinates,
  to: Coordinates,
  byName: Map<string, CityOut>,
): Coordinates[] {
  const names = variant.waypoints.slice(1, -1);
  const stops = names.map((name) => byName.get(name));
  if (stops.some((city) => !city)) return [from, to];
  return [from, ...stops.map((city) => [city!.lon, city!.lat] as Coordinates), to];
}

function segmentsForVariant(
  variant: VariantOut,
  from: Coordinates,
  to: Coordinates,
  byName: Map<string, CityOut>,
): Array<{ from: Coordinates; to: Coordinates; transport: string }> {
  const stops = variantStops(variant, from, to, byName);
  return stops.slice(1).map((stop, index) => ({
    from: stops[index],
    to: stop,
    transport: variant.transport,
  }));
}

/** Линии выбранного маршрута: по одному плечу с соответствующим транспортом. */
function routeGeoJSON(
  origin: CityOut | null,
  target: ReachOut | null,
  byName: Map<string, CityOut>,
  trip: DisplayedTrip | null,
): FeatureCollection<LineString> {
  if (!origin || !target || !trip || trip.kind === "unavailable") {
    return { type: "FeatureCollection", features: [] };
  }
  const start: Coordinates = [origin.lon, origin.lat];
  const finish: Coordinates = [target.lon, target.lat];
  const segments: Array<{ from: Coordinates; to: Coordinates; transport: string }> =
    trip.kind === "composite" && target.via && byName.get(target.via)
      ? [
          ...segmentsForVariant(
            trip.legs[0],
            start,
            [byName.get(target.via)!.lon, byName.get(target.via)!.lat],
            byName,
          ),
          ...segmentsForVariant(
            trip.legs[1],
            [byName.get(target.via)!.lon, byName.get(target.via)!.lat],
            finish,
            byName,
          ),
        ]
      : trip.kind === "direct"
        ? segmentsForVariant(trip.variant, start, finish, byName)
        : [];
  return {
    type: "FeatureCollection",
    features: segments.map((segment, index) => ({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: segmentCoordinates(segment.from, segment.to, segment.transport),
      },
      properties: {
        transport: segment.transport,
        icon: segment.transport in TRANSPORT_PATHS ? `tb-${segment.transport}` : "",
        segment: index + 1,
      },
    })),
  };
}

/**
 * Русские подписи на подложке.
 *
 * Плитки CARTO собраны по схеме OpenMapTiles: у объектов есть `name:ru`, но
 * стиль по умолчанию печатает `name` — латиницей. `coalesce` оставляет исходное
 * имя там, где перевода нет, поэтому подписи не могут пропасть.
 */
function localiseLabels(instance: maplibregl.Map): void {
  for (const layer of instance.getStyle().layers ?? []) {
    if (layer.type !== "symbol") continue;
    try {
      const field = instance.getLayoutProperty(layer.id, "text-field");
      if (field === undefined) continue;
      instance.setLayoutProperty(layer.id, "text-field", [
        "coalesce",
        ["get", "name:ru"],
        ["get", "name"],
      ]);
    } catch {
      /* слой без текста или с недоступным свойством — оставляем как есть */
    }
  }
}

/** Ставит источники и слои поверх текущего стиля. Вызывается заново при смене темы. */
function installLayers(instance: maplibregl.Map, palette: Palette): void {
  localiseLabels(instance);
  const empty: FeatureCollection<Point> = { type: "FeatureCollection", features: [] };
  for (const id of [SOURCE, ORIGIN_SOURCE, ROUTE_SOURCE, TRANSFER_SOURCE]) {
    if (!instance.getSource(id)) instance.addSource(id, { type: "geojson", data: empty });
  }

  // Общий контур держит путь читаемым на любой подложке.
  instance.addLayer({
    id: "route-casing",
    type: "line",
    source: ROUTE_SOURCE,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": palette.halo,
      "line-width": 7,
      "line-opacity": 0.8,
    },
  });

  // Воздушный коридор: дуга + пунктир.
  instance.addLayer({
    id: "route-avia",
    type: "line",
    source: ROUTE_SOURCE,
    filter: ["==", ["get", "transport"], "avia"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#c1acff",
      "line-width": 3,
      "line-opacity": 0.95,
      "line-dasharray": [2, 1.4],
    },
  });

  // Поезд: две рельсы и пунктирные шпалы посередине.
  instance.addLayer({
    id: "route-railway",
    type: "line",
    source: ROUTE_SOURCE,
    filter: ["==", ["get", "transport"], "railway"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#d0ff1a", "line-width": 4, "line-opacity": 0.95 },
  });
  instance.addLayer({
    id: "route-railway-sleepers",
    type: "line",
    source: ROUTE_SOURCE,
    filter: ["==", ["get", "transport"], "railway"],
    layout: { "line-cap": "butt", "line-join": "round" },
    paint: { "line-color": palette.halo, "line-width": 1.3, "line-opacity": 0.9, "line-dasharray": [0.15, 1.1] },
  });

  // Электричка сохраняет рельсовую фактуру, но отличается холодным цветом.
  instance.addLayer({
    id: "route-etrain",
    type: "line",
    source: ROUTE_SOURCE,
    filter: ["==", ["get", "transport"], "etrain"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#4de3ff", "line-width": 4, "line-opacity": 0.95, "line-dasharray": [1.4, 0.5] },
  });

  // Автобус — тёплая дорожная разметка, визуально не смешивается с поездом.
  instance.addLayer({
    id: "route-bus",
    type: "line",
    source: ROUTE_SOURCE,
    filter: ["==", ["get", "transport"], "bus"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#ffb454", "line-width": 3.2, "line-opacity": 0.95, "line-dasharray": [1.4, 0.75] },
  });

  addTransportIcons(instance, palette);
  instance.addLayer({
    id: "route-icons",
    type: "symbol",
    source: ROUTE_SOURCE,
    filter: ["!=", ["get", "icon"], ""],
    layout: {
      "symbol-placement": "line-center",
      "icon-image": ["get", "icon"],
      "icon-size": 0.62,
      "icon-allow-overlap": true,
      "icon-rotation-alignment": "viewport",
    },
  });

  // Мягкое свечение под самыми дешёвыми городами — глаз находит их первыми.
  instance.addLayer({
    id: "cities-glow",
    type: "circle",
    source: SOURCE,
    filter: ["==", ["get", "cheap"], true],
    paint: {
      "circle-radius": ["*", ["get", "radius"], 2.4],
      "circle-color": ["get", "color"],
      "circle-opacity": 0.13,
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
      "circle-radius": 6,
      "circle-color": palette.halo,
      "circle-stroke-width": 3,
      "circle-stroke-color": palette.origin,
    },
  });

  // Город пересадки появляется на карте только вместе с выбранным маршрутом:
  // в выдаче его может не быть вовсе (например, при поиске только за границу).
  instance.addLayer({
    id: "transfer-point",
    type: "circle",
    source: TRANSFER_SOURCE,
    paint: {
      "circle-radius": 6,
      "circle-color": palette.saved,
      "circle-stroke-width": 2,
      "circle-stroke-color": palette.halo,
    },
  });

  instance.addLayer({
    id: "transfer-label",
    type: "symbol",
    source: TRANSFER_SOURCE,
    layout: {
      "text-field": ["concat", "пересадка · ", ["get", "name"]],
      "text-size": 11,
      "text-offset": [0, 1.2],
      "text-anchor": "top",
      "text-allow-overlap": true,
    },
    paint: {
      "text-color": palette.saved,
      "text-halo-color": palette.halo,
      "text-halo-width": 1.6,
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

  const theme: Theme = "dark";
  const [styleEpoch, setStyleEpoch] = useState(0);
  const [mapNote, setMapNote] = useState<string | null>(null);

  const [cities, setCities] = useState<CityOut[]>([]);
  const [data, setData] = useState<ReachableResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ProgressOut>(IDLE_PROGRESS);
  const [eta, setEta] = useState<number | null>(null);
  // Сырая оценка остатка скачет вместе со скоростью сети: сглаживаем её,
  // иначе цифра прыгает «4 минуты → 20 секунд → 4 минуты» и ей не верят.
  const smoothedEta = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Начальное состояние берём из адресной строки: ссылкой можно поделиться.
  const [initial] = useState(readState);
  const [shouldSearchFromLink] = useState(
    () =>
      new URLSearchParams(window.location.search).has("from") ||
      new URLSearchParams(window.location.search).has("date"),
  );
  const [origin, setOrigin] = useState(initial.origin);
  const [date, setDate] = useState(initial.date);
  const [budget, setBudget] = useState(initial.budget);
  const [maxHours, setMaxHours] = useState(initial.maxHours);
  const [modes, setModes] = useState<Mode[]>(initial.modes);
  const [passengers, setPassengers] = useState(initial.passengers);
  const [abroadOnly, setAbroadOnly] = useState(initial.abroadOnly);
  const [roundTrip, setRoundTrip] = useState(initial.roundTrip);
  const [stayMin, setStayMin] = useState(initial.stayMin);
  const [stayMax, setStayMax] = useState(initial.stayMax);
  const [departAfter, setDepartAfter] = useState(initial.departAfter);
  const [arriveBefore, setArriveBefore] = useState(initial.arriveBefore);
  const [selected, setSelected] = useState<string | null>(initial.selected);
  const [recentSearches, setRecentSearches] = useState<SearchHistoryEntry[]>(readSearchHistory);
  // На телефоне пульт закрыт: он занимает весь экран, и карта — то, ради чего
  // пришли — оказывалась под ним целиком. На большом экране места хватает всем.
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 1024);
  const [lastSearch, setLastSearch] = useState<{
    origin: string;
    date: string;
    passengers: number;
    modes: string;
    abroadOnly: boolean;
    roundTrip: boolean;
    stayMin: number;
    stayMax: number;
  } | null>(() => ({
    origin: initial.origin,
    date: initial.date,
    passengers: initial.passengers,
    modes: initial.modes.join(","),
    abroadOnly: initial.abroadOnly,
    roundTrip: initial.roundTrip,
    stayMin: initial.stayMin,
    stayMax: initial.stayMax,
  }));
  // Только самый свежий расчёт имеет право менять карту и счётчик. Иначе два
  // одновременных запроса по очереди перерисовывают числа и старую выдачу.
  const searchRun = useRef(0);

  useEffect(() => {
    writeState({
      origin,
      date,
      budget,
      maxHours,
      modes,
      passengers,
      abroadOnly,
      roundTrip,
      stayMin,
      stayMax,
      departAfter,
      arriveBefore,
      selected,
    });
  }, [
    origin,
    date,
    budget,
    maxHours,
    modes,
    passengers,
    abroadOnly,
    roundTrip,
    stayMin,
    stayMax,
    departAfter,
    arriveBefore,
    selected,
  ]);

  useEffect(() => {
    fetchCities()
      .then(setCities)
      .catch(() => setError("не удалось загрузить справочник городов"));
  }, []);

  useEffect(() => {
    if (!container.current || map.current) return;
    const instance = new maplibregl.Map({
      container: container.current,
      style: VECTOR_STYLE[theme],
      center: [55, 57],
      zoom: 3.1,
      attributionControl: { compact: true },
    });
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

    const install = () => {
      installLayers(instance, paletteFor(theme));
      instance.on("click", "cities", (event) => {
        const slug = event.features?.[0]?.properties?.slug;
        if (typeof slug !== "string") return;
        setSelected(slug);
        // На узком экране карточка и пульт делят одно место — показываем ту,
        // которую пользователь только что запросил тапом.
        if (window.innerWidth < 1024) setPanelOpen(false);
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
      instance.setStyle(rasterStyle(theme));
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

  const points = useMemo(() => {
    if (!data) return [];
    return data.cities.map((reach) => {
      const point = effective(reach, modes);
      const passes =
        point.price !== null &&
        (budget >= BUDGET_UNLIMITED || point.price <= budget) &&
        (point.hours === null || point.hours <= maxHours) &&
        withinTimeWindow(point.trip, departAfter, arriveBefore);
      return { ...point, passes };
    });
  }, [data, modes, budget, maxHours, departAfter, arriveBefore]);

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
    source?.setData(toGeoJSON(visible, bounds.min, bounds.max, modes.length === MODES.length));
  }, [styleEpoch, visible, bounds, modes]);

  useEffect(() => {
    if (!styleEpoch || !map.current) return;
    const source = map.current.getSource(ORIGIN_SOURCE) as maplibregl.GeoJSONSource | undefined;
    source?.setData(originGeoJSON(data?.origin ?? null));
  }, [styleEpoch, data]);

  const byName = useMemo(() => new Map(cities.map((city) => [city.name, city])), [cities]);
  const chosen = data?.cities.find((reach) => reach.slug === selected) ?? null;
  const chosenTrip = useMemo(
    () => (chosen ? tripForModes(chosen, modes) : null),
    [chosen, modes],
  );
  const needsSearch =
    data !== null &&
    (lastSearch === null ||
      lastSearch.origin !== origin ||
      lastSearch.date !== date ||
      lastSearch.passengers !== passengers ||
      lastSearch.modes !== modes.join(",") ||
      lastSearch.abroadOnly !== abroadOnly ||
      lastSearch.roundTrip !== roundTrip ||
      lastSearch.stayMin !== stayMin ||
      lastSearch.stayMax !== stayMax);
  // После изменения параметров старая матрица остаётся видимой для сравнения,
  // но карточку прошлого запроса не выдаём за результат новых условий.
  const chosenRoute = needsSearch || chosenTrip?.kind === "unavailable" ? null : chosen;

  useEffect(() => {
    if (!styleEpoch || !map.current) return;
    const source = map.current.getSource(ROUTE_SOURCE) as maplibregl.GeoJSONSource | undefined;
    source?.setData(
      routeGeoJSON(
        data?.origin ?? null,
        chosenRoute,
        byName,
        chosenTrip,
      ),
    );
  }, [styleEpoch, data, chosenRoute, chosenTrip, byName]);

  // Точка пересадки живёт отдельным источником: слои под неё были, а данные в
  // них никто не клал — город стыковки не появлялся на карте вовсе.
  useEffect(() => {
    if (!styleEpoch || !map.current) return;
    const source = map.current.getSource(TRANSFER_SOURCE) as maplibregl.GeoJSONSource | undefined;
    source?.setData(transferGeoJSON(chosenRoute, byName, chosenTrip));
  }, [styleEpoch, chosenRoute, chosenTrip, byName]);

  const search = useCallback(
    async (city: string, when: string, people: number, keepSelected = false) => {
      const run = ++searchRun.current;
      const searchModes = [...modes];
      const searchAbroadOnly = abroadOnly;
      const searchRoundTrip = roundTrip;
      const searchBudget = budget;
      const searchStayMin = stayMin;
      const searchStayMax = stayMax;
      setLoading(true);
      setError(null);
      setProgress(IDLE_PROGRESS);
      setEta(null);
      smoothedEta.current = null;
      if (!keepSelected) setSelected(null);
      let ticker: number | null = null;

      try {
        // Полоса заполняется по факту: сервер отчитывается, сколько городов уже
        // перебрано и сколько осталось. Опрашиваем раз в 700 мс — чаще незачем,
        // за это время успевает измениться несколько городов.
        ticker = window.setInterval(() => {
          void fetchProgress()
            .then((now) => {
              if (run !== searchRun.current) return;
              setProgress(now);
              if (now.eta_s === null) {
                setEta(null);
                smoothedEta.current = null;
                return;
              }
              // Экспоненциальное сглаживание: новая оценка входит на треть,
              // поэтому цифра ползёт ровно, а не дёргается вслед за сетью.
              const previous = smoothedEta.current;
              if (previous === null) {
                smoothedEta.current = now.eta_s;
              } else {
                const blended = previous * 0.7 + now.eta_s * 0.3;
                // Вниз оценка идёт свободно, вверх — вязко. Расти ей нельзя
                // запретить совсем: если сеть замедлилась, честнее показать
                // рост, чем застыть на «осталось 5 с» на целую минуту.
                smoothedEta.current =
                  blended <= previous ? blended : previous + (blended - previous) * 0.15;
              }
              setEta(smoothedEta.current);
            })
            .catch(() => undefined);
        }, 700);
      const response = await fetchReachable({
        origin: city,
        date: when,
        modes: searchModes,
        passengers: people,
        abroad_only: searchAbroadOnly,
        round_trip: searchRoundTrip,
        stay_min: searchStayMin,
        stay_max: searchStayMax,
      });
      if (run !== searchRun.current) return;
      setData(response);
      setLastSearch({
        origin: city,
        date: when,
        passengers: people,
        modes: searchModes.join(","),
        abroadOnly: searchAbroadOnly,
        roundTrip: searchRoundTrip,
        stayMin: searchStayMin,
        stayMax: searchStayMax,
      });

      // Показываем всю найденную географию, а не фиксированный масштаб вокруг
      // точки отправления: поиск идёт по всему миру, и Стамбул с Ереваном при
      // жёстком zoom 3.5 просто оставались за краем экрана.
      // Масштаб подгоняем по городам, которые проходят бюджет, а не по всем, у
      // кого вообще нашлась цена. Каталог теперь глобальный: цена находится и
      // до Веллингтона, и карта после поиска раскрывалась на весь глобус, хотя
      // по карману были соседние области. Если бюджет не прошёл никто —
      // показываем всё найденное, чтобы экран не остался пустым.
      const priced = response.cities.filter((item) => item.price !== null);
      const affordable = priced.filter(
        (item) => searchBudget >= BUDGET_UNLIMITED || (item.price ?? 0) <= searchBudget,
      );
      const found = affordable.length ? affordable : priced;
      if (map.current && found.length) {
        const box = new maplibregl.LngLatBounds(
          [response.origin.lon, response.origin.lat],
          [response.origin.lon, response.origin.lat],
        );
        for (const item of found) box.extend([item.lon, item.lat]);
        // Отступы несимметричны: слева сводка и легенда, справа пульт —
        // без запаса города уезжают под панели и подписи не читаются.
        const wide = window.innerWidth >= 1024;
        map.current.fitBounds(box, {
          padding: wide
            ? { top: 90, bottom: 90, left: 330, right: 380 }
            : { top: 70, bottom: 120, left: 40, right: 40 },
          maxZoom: 5,
          duration: 900,
        });
      } else {
        map.current?.easeTo({
          center: [response.origin.lon, response.origin.lat],
          zoom: 3.5,
          duration: 900,
        });
      }
      } catch (cause) {
        if (run === searchRun.current) {
          setError(cause instanceof Error ? cause.message : "расчёт не удался");
        }
      } finally {
        if (ticker !== null) window.clearInterval(ticker);
        if (run === searchRun.current) setLoading(false);
      }
    },
    [abroadOnly, modes, roundTrip, stayMax, stayMin],
  );

  const chooseDate = useCallback(
    (value: string) => {
      setDate(value);
      void search(origin, value, passengers);
    },
    [origin, passengers, search],
  );

  const useRecentSearch = useCallback((entry: SearchHistoryEntry) => {
    setOrigin(entry.origin);
    setDate(entry.date);
    setModes(entry.modes);
    setBudget(entry.budget);
    setMaxHours(entry.maxHours);
    setPassengers(entry.passengers);
    setDepartAfter(entry.departAfter);
    setArriveBefore(entry.arriveBefore);
    setAbroadOnly(entry.abroadOnly);
    setRoundTrip(entry.roundTrip);
    setStayMin(entry.stayMin);
    setStayMax(entry.stayMax);
  }, []);

  const startFromLanding = useCallback(() => {
    const entry: SearchHistoryEntry = {
      origin,
      date,
      modes,
      budget,
      maxHours,
      passengers,
      departAfter,
      arriveBefore,
      abroadOnly,
      roundTrip,
      stayMin,
      stayMax,
    };
    setRecentSearches(saveSearchHistory(entry));
    void search(origin, date, passengers);
  }, [
    abroadOnly,
    arriveBefore,
    budget,
    date,
    departAfter,
    maxHours,
    modes,
    origin,
    passengers,
    roundTrip,
    search,
    stayMax,
    stayMin,
  ]);

  // Ссылки из «Поделиться этим видом» не должны попадать на лендинг: параметры
  // уже содержат полноценный поисковый сценарий. Откладываем запуск на кадр,
  // чтобы сначала успели подключиться карта и обработчики её источников.
  useEffect(() => {
    if (!shouldSearchFromLink) return;
    const timer = window.setTimeout(() => {
      void search(initial.origin, initial.date, initial.passengers, true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initial, search, shouldSearchFromLink]);

  const toggleMode = useCallback((mode: Mode) => {
    setModes((current) =>
      current.includes(mode)
        ? current.length > 1
          ? current.filter((item) => item !== mode)
          : current
        : [...current, mode],
    );
  }, []);

  const unreachable = points.length - visible.length;

  const card = "tb-plate px-4 py-3";

  return (
    <div className="relative h-full w-full overflow-hidden bg-tb-bg">
      <div ref={container} className="absolute inset-0" />

      {!data && (
        <StartScreen
          cities={cities}
          origin={origin}
          date={date}
          modes={modes}
          loading={loading}
          progress={progress}
          eta={eta}
          error={error}
          budget={budget}
          maxHours={maxHours}
          passengers={passengers}
          departAfter={departAfter}
          arriveBefore={arriveBefore}
          abroadOnly={abroadOnly}
          roundTrip={roundTrip}
          stayMin={stayMin}
          stayMax={stayMax}
          onOrigin={setOrigin}
          // На лендинге изменение даты — это лишь настройка будущего запроса.
          // Поиск там выполняется только явным нажатием «Показать карту».
          onDate={setDate}
          onToggleMode={toggleMode}
          onBudget={setBudget}
          onMaxHours={setMaxHours}
          onPassengers={setPassengers}
          onDepartAfter={setDepartAfter}
          onArriveBefore={setArriveBefore}
          onAbroadOnly={setAbroadOnly}
          onRoundTrip={setRoundTrip}
          onStay={(min, max) => {
            setStayMin(min);
            setStayMax(max);
          }}
          recentSearches={recentSearches}
          onUseRecent={useRecentSearch}
          onClearRecent={() => {
            clearSearchHistory();
            setRecentSearches([]);
          }}
          onStart={startFromLanding}
        />
      )}

      {loading && data && (
        <div className="tb-plate pointer-events-none absolute top-4 left-1/2 z-30 w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 px-4 py-3">
          <SearchProgress progress={progress} eta={eta} />
        </div>
      )}

      <header
        className={`tb-scroll pointer-events-none absolute top-0 left-0 z-10 flex max-h-full max-w-[min(19rem,calc(100vw-9rem))] flex-col gap-3 overflow-y-auto p-4 sm:p-6 lg:overflow-hidden ${
          chosen ? "lg:max-h-[calc(100vh-2rem)]" : "lg:max-h-[calc(100vh-9rem)]"
        }`}
      >
        <div className="shrink-0">
          <h1 className="font-display text-xl font-extrabold tracking-[-0.05em] text-tb-ink sm:text-2xl">
            Travel<span className="text-tb-hero">Broke</span>
          </h1>
        </div>

        {mapNote && (
          <div className={`pointer-events-auto shrink-0 text-xs text-tb-muted ${card}`}>{mapNote}</div>
        )}

        {error && (
          <div className="tb-plate pointer-events-auto shrink-0 border-l-2 border-l-red-400 px-4 py-3 text-sm text-tb-ink">
            {error}
          </div>
        )}

        {/* Результат — слева, под сводкой; настройки — справа. На ноутбуке пульт
            занимает всю правую колонку, и карточке там не оставалось высоты. */}
        {chosen && !needsSearch && (
          <div className="hidden min-h-0 lg:flex lg:flex-1 lg:flex-col">
            <TripCard
              reach={chosen}
              trip={chosenTrip ?? { kind: "unavailable" }}
              origin={data?.origin.name ?? origin}
              passengers={passengers}
              onClose={() => setSelected(null)}
            />
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
            onClick={() => setPanelOpen((open) => !open)}
            aria-expanded={panelOpen}
            className="tb-plate px-4 py-2 text-sm font-semibold text-tb-ink transition-colors duration-150 ease-out hover:text-tb-hero lg:hidden"
          >
            {panelOpen ? "Скрыть настройки" : "Настроить"}
          </button>
        </div>

        <div className={`contents ${panelOpen ? "" : "hidden lg:contents"}`}>
        <ControlPanel
          cities={cities}
          origin={origin}
          date={date}
          modes={modes}
          loading={loading}
          needsSearch={needsSearch}
          budget={budget}
          maxHours={maxHours}
          passengers={passengers}
          departAfter={departAfter}
          arriveBefore={arriveBefore}
          abroadOnly={abroadOnly}
          roundTrip={roundTrip}
          stayMin={stayMin}
          stayMax={stayMax}
          onOrigin={setOrigin}
          onDate={chooseDate}
          onToggleMode={toggleMode}
          onBudget={setBudget}
          onMaxHours={setMaxHours}
          onPassengers={setPassengers}
          onDepartAfter={setDepartAfter}
          onArriveBefore={setArriveBefore}
          onAbroadOnly={setAbroadOnly}
          onRoundTrip={setRoundTrip}
          onStay={(min, max) => {
            setStayMin(min);
            setStayMax(max);
          }}
          onSearch={() => void search(origin, date, passengers)}
        />
        </div>
        {chosen && !needsSearch && (
          <div className="flex min-h-0 flex-1 flex-col lg:hidden">
            <TripCard
              reach={chosen}
              trip={chosenTrip ?? { kind: "unavailable" }}
              origin={data?.origin.name ?? origin}
              passengers={passengers}
              onClose={() => setSelected(null)}
            />
          </div>
        )}
      </div>

      <div
        className={`pointer-events-none absolute bottom-6 left-6 z-10 hidden w-60 ${
          chosen ? "" : "lg:block"
        } ${card}`}
      >
        <div className="tb-tag">Цена поездки</div>
        <div className="mt-2 flex h-2 overflow-hidden rounded-xs">
          {legendStops(24).map((color) => (
            <span key={color} className="flex-1" style={{ backgroundColor: color }} />
          ))}
        </div>
        <div className="tb-num mt-1.5 flex justify-between text-2xs text-tb-muted">
          <span>{visible.length ? formatPrice(bounds.min) : "дёшево"}</span>
          <span>{visible.length ? formatPrice(bounds.max) : "дорого"}</span>
        </div>
        {unreachable > 0 && (
          <div className="mt-2 flex items-center gap-2 border-t border-tb-line pt-2 text-2xs text-tb-muted">
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: UNREACHABLE, opacity: 0.5 }}
            />
            скрытые точки — вне бюджета или фильтров
          </div>
        )}
      </div>
    </div>
  );
}
