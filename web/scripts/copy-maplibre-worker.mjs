/**
 * Кладёт воркер MapLibre в public/.
 *
 * MapLibre грузит воркер отдельным ES-модулем, который импортирует соседний
 * общий чанк по относительному пути. Сборщик такую пару не эмитит, и карта
 * молча не рендерится: воркер отдаёт 404, событие `load` не наступает.
 * Держим оба файла статикой рядом друг с другом — тогда относительный импорт
 * внутри воркера резолвится сам.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, "..", "node_modules", "maplibre-gl", "dist");
const to = join(here, "..", "public");

mkdirSync(to, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(join(from, file), join(to, file));
}
