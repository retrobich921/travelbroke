import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";

import { legendStops } from "./palette";

/** Тёмная подложка на данных OpenStreetMap, без ключей и регистраций. */
const BASEMAP = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

/** Стартовый вид: европейская часть России целиком. */
const INITIAL_VIEW = { center: [55, 57] as [number, number], zoom: 3.2 };

export default function App() {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);

  const [budget, setBudget] = useState(5000);
  const [maxHours, setMaxHours] = useState(12);

  useEffect(() => {
    if (!container.current || map.current) return;

    map.current = new maplibregl.Map({
      container: container.current,
      style: BASEMAP,
      center: INITIAL_VIEW.center,
      zoom: INITIAL_VIEW.zoom,
      attributionControl: { compact: true },
    });
    map.current.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  return (
    <div className="relative h-full w-full">
      <div ref={container} className="absolute inset-0" />

      <header className="pointer-events-none absolute top-0 left-0 z-10 p-6">
        <h1 className="text-3xl font-black tracking-tight text-tb-cheap">TravelBroke</h1>
        <p className="mt-1 max-w-xs text-sm text-tb-muted">
          Ты на мели. Мы всё равно тебя увезём.
        </p>
      </header>

      <aside className="absolute top-6 right-6 z-10 w-80 rounded-2xl bg-tb-ink/90 p-5 shadow-2xl ring-1 ring-white/10 backdrop-blur">
        <label className="block text-xs font-semibold tracking-wide text-tb-muted uppercase">
          Бюджет
        </label>
        <div className="mt-1 text-2xl font-bold text-tb-cheap">
          {budget.toLocaleString("ru-RU")} ₽
        </div>
        <input
          type="range"
          min={500}
          max={30000}
          step={500}
          value={budget}
          onChange={(e) => setBudget(Number(e.target.value))}
          className="mt-2 w-full accent-tb-accent"
        />

        <label className="mt-5 block text-xs font-semibold tracking-wide text-tb-muted uppercase">
          Максимум в пути
        </label>
        <div className="mt-1 text-2xl font-bold text-tb-expensive">{maxHours} ч</div>
        <input
          type="range"
          min={2}
          max={48}
          step={1}
          value={maxHours}
          onChange={(e) => setMaxHours(Number(e.target.value))}
          className="mt-2 w-full accent-tb-accent"
        />

        <div className="mt-6">
          <div className="text-xs font-semibold tracking-wide text-tb-muted uppercase">Цена</div>
          <div className="mt-2 flex h-3 overflow-hidden rounded-full">
            {legendStops(24).map((color) => (
              <span key={color} className="flex-1" style={{ backgroundColor: color }} />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-xs text-tb-muted">
            <span>дёшево</span>
            <span>дорого</span>
          </div>
        </div>
      </aside>
    </div>
  );
}
