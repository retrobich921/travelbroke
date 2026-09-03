/** Типы ответов бэкенда и тонкие обёртки над fetch. */

export const MODES = ["avia", "railway", "bus", "etrain"] as const;
export type Mode = (typeof MODES)[number];

export const MODE_LABELS: Record<Mode, string> = {
  avia: "Самолёт",
  railway: "Поезд",
  bus: "Автобус",
  etrain: "Электричка",
};

export interface CityOut {
  slug: string;
  name: string;
  lat: number;
  lon: number;
  hub: boolean;
  country: string;
}

export interface VariantOut {
  transport: string;
  price: number;
  hours: number;
  transfers: number;
  departure_at: string | null;
  arrival_at: string | null;
  checkout_url: string | null;
  route: string | null;
  /** Города реальных сегментов оффера Туту; средние — пересадки. */
  waypoints: string[];
  checkout_ref: Record<string, unknown> | null;
}

export interface ReachOut extends CityOut {
  price: number | null;
  hours: number | null;
  direct: VariantOut | null;
  /** Конкретные офферы, на которых держатся переключатели транспорта и покупка. */
  variants: VariantOut[];
  via: string | null;
  via_legs: VariantOut[] | null;
  beats_direct_by: number | null;
  transfer_wait_minutes: number | null;
  transfer_required_minutes: number | null;
  transfer_overnight: boolean;
  options: VariantOut[];
  back: VariantOut | null;
  back_date: string | null;
  round_trip_price: number | null;
  by_mode: Partial<Record<Mode, number>>;
  by_mode_minutes: Partial<Record<Mode, number>>;
  empty_reason: string | null;
  empty_message: string | null;
}

export interface ReachableResponse {
  origin: CityOut;
  date: string;
  cities: ReachOut[];
  calls: number;
  cached: number;
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export async function fetchCities(): Promise<CityOut[]> {
  return json<CityOut[]>(await fetch("/api/cities"));
}

/** Подсказки городов со всего мира; координаты нужны карте, предложения — Туту. */
export async function fetchCitySuggestions(query: string): Promise<CityOut[]> {
  return json<CityOut[]>(
    await fetch(`/api/city-suggest?q=${encodeURIComponent(query)}`),
  );
}

/** Достопримечательность города с фотографией из Википедии. */
export interface CityPhoto {
  title: string;
  description: string | null;
  image: string;
  article: string;
  kind: string;
}

/**
 * Что посмотреть в выбранном городе.
 *
 * Отдельным запросом по клику: тянуть фотографии для всех трёхсот шестидесяти
 * пяти городов сразу — это лишние секунды к расчёту ради того, что человек
 * посмотрит для одного.
 */
export async function fetchCityPhotos(
  name: string,
  lat: number,
  lon: number,
): Promise<CityPhoto[]> {
  const query = new URLSearchParams({ name, lat: String(lat), lon: String(lon) });
  return json<CityPhoto[]>(await fetch(`/api/city-photos?${query.toString()}`));
}

/** Ход расчёта: в каких городах сейчас идёт перебор и сколько осталось ждать. */
export interface ProgressOut {
  active: boolean;
  /** Человеческое название фазы: «Перебираем города», «Проверяем пересадки». */
  phase: string;
  done: number;
  total: number;
  /** Доля всей работы от 0 до 1 с учётом веса фаз. */
  fraction: number;
  elapsed_s: number;
  /** Оценка остатка в секундах; null, пока оценивать не по чему. */
  eta_s: number | null;
  calls: number;
}

export const IDLE_PROGRESS: ProgressOut = {
  active: false,
  phase: "Готовим запрос",
  done: 0,
  total: 0,
  fraction: 0,
  elapsed_s: 0,
  eta_s: null,
  calls: 0,
};

/**
 * Ход расчёта с сервера.
 *
 * Расчёт — один блокирующий POST, поэтому единственный способ показать
 * пользователю движение — отдельно спрашивать сервер, где он сейчас.
 */
export async function fetchProgress(): Promise<ProgressOut> {
  return json<ProgressOut>(await fetch("/api/progress"));
}

/** Остаток времени словами: «3 мин 20 с». */
export function formatEta(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (!minutes) return `${rest} с`;
  return rest ? `${minutes} мин ${rest} с` : `${minutes} мин`;
}

export async function fetchReachable(params: {
  origin: string;
  date: string;
  modes: Mode[];
  passengers: number;
  round_trip: boolean;
  stay_min: number;
  stay_max: number;
  abroad_only: boolean;
}): Promise<ReachableResponse> {
  return json<ReachableResponse>(
    await fetch("/api/reachable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    }),
  );
}

/**
 * Ссылка на оформление конкретного рейса.
 *
 * Строится сервером через `create_checkout_link`, потому что в ответе поиска
 * лежит только reference оффера. Запрашиваем лениво — по клику, а не для всех
 * восьмидесяти городов сразу.
 */
export async function fetchCheckout(
  ref: Record<string, unknown>,
  passengers: number,
): Promise<string> {
  const response = await fetch("/api/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ checkout_ref: ref, passengers }),
  });
  const payload = await json<{ url: string }>(response);
  return payload.url;
}

/** Ближайшая суббота — самая частая дата короткой поездки. */
export function nextSaturday(): string {
  const day = new Date();
  day.setDate(day.getDate() + ((6 - day.getDay() + 7) % 7 || 7));
  return day.toISOString().slice(0, 10);
}

/** Туту может отдать расписание без стоимости как 0 — это не бесплатный билет. */
export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
    return "Цена неизвестна";
  }
  return `${value.toLocaleString("ru-RU")} ₽`;
}

/** Минуты в человеческий вид: «3 ч 20 мин». */
export function formatMinutes(value: number): string {
  const whole = Math.floor(value / 60);
  const minutes = Math.round(value % 60);
  if (!whole) return `${minutes} мин`;
  return minutes ? `${whole} ч ${minutes} мин` : `${whole} ч`;
}

export function formatHours(value: number): string {
  if (value < 1) return `${Math.round(value * 60)} мин`;
  const whole = Math.floor(value);
  const minutes = Math.round((value - whole) * 60);
  return minutes ? `${whole} ч ${minutes} мин` : `${whole} ч`;
}
