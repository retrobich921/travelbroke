import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { fetchCityPhotos, type CityPhoto } from "../api";
import { Icon } from "./Icon";

interface Props {
  city: string;
  lat: number;
  lon: number;
}

/**
 * Ответы за время жизни вкладки.
 *
 * Карточка поездки рендерится дважды — своя для широкого экрана и своя для
 * узкого, — поэтому без памяти каждый выбор города уходил бы в сеть двумя
 * одинаковыми запросами. Заодно возврат к уже просмотренному городу
 * отрисовывается мгновенно, без скелета.
 */
const remembered = new Map<string, CityPhoto[]>();

function keyOf(city: string, lat: number, lon: number): string {
  return `${city}|${lat.toFixed(3)}|${lon.toFixed(3)}`;
}

/**
 * Что посмотреть в городе: полоса фотографий достопримечательностей.
 *
 * Сценарий — «не знаю куда, знаю сколько денег». Цена отвечает, доеду ли я;
 * фотографии отвечают, зачем мне туда. Поэтому полоса стоит сразу под названием
 * города, но остаётся именно полосой: карточка про поездку и цену, а не про
 * фотоальбом, и большая картинка сверху увела бы цену за пределы экрана.
 *
 * Отказ Википедии здесь не ошибка, а обычное дело: у маленького города может не
 * быть ни одной статьи с фотографией. Тогда блок просто не рисуется — пустых
 * рамок и надписей «ничего не найдено» пользователь не увидит.
 */
export function CityPhotos({ city, lat, lon }: Props) {
  const cached = remembered.get(keyOf(city, lat, lon));
  const [photos, setPhotos] = useState<CityPhoto[]>(cached ?? []);
  const [loading, setLoading] = useState(cached === undefined);
  const [opened, setOpened] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    setOpened(null);

    const key = keyOf(city, lat, lon);
    const known = remembered.get(key);
    if (known !== undefined) {
      setPhotos(known);
      setLoading(false);
      return;
    }

    setLoading(true);
    setPhotos([]);

    fetchCityPhotos(city, lat, lon)
      .then((found) => {
        remembered.set(key, found);
        return found;
      })
      .then((found) => {
        if (alive) setPhotos(found);
      })
      .catch(() => {
        if (alive) setPhotos([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    // Пока ответ летит, пользователь успевает кликнуть другой город: ответ на
    // прошлый запрос не должен подменить фотографии уже открытой карточки.
    return () => {
      alive = false;
    };
  }, [city, lat, lon]);

  const close = useCallback(() => setOpened(null), []);

  const step = useCallback(
    (delta: number) => {
      setOpened((current) => {
        if (current === null || photos.length === 0) return current;
        return (current + delta + photos.length) % photos.length;
      });
    },
    [photos.length],
  );

  // Клавиатура в лайтбоксе: закрыть и листать, не трогая мышь.
  useEffect(() => {
    if (opened === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === "ArrowRight") step(1);
      if (event.key === "ArrowLeft") step(-1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [opened, close, step]);

  if (loading) {
    // Скелет ровно той же высоты, что и полоса: иначе цена подпрыгивает,
    // когда фотографии наконец приезжают.
    return (
      <div className="flex gap-1.5 overflow-hidden px-4 pt-3" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <div key={index} className="h-[74px] w-[110px] shrink-0 animate-pulse rounded-sm bg-tb-fill" />
        ))}
      </div>
    );
  }

  if (photos.length === 0) return null;

  const current = opened === null ? null : photos[opened];

  return (
    <>
      <section className="relative pt-3" aria-label={`Что посмотреть в городе ${city}`}>
        {/* Полоса шире карточки и прокручивается. Жёсткий обрыв у края читается
            как обрезанная вёрстка, растворение — как «здесь есть ещё». */}
        {photos.length > 2 && (
          <div
            className="pointer-events-none absolute top-3 right-0 bottom-6 w-10 bg-gradient-to-l from-tb-panel to-transparent"
            aria-hidden="true"
          />
        )}
        <div className="tb-scroll flex gap-1.5 overflow-x-auto px-4 pb-1">
          {photos.map((photo, index) => (
            <button
              key={photo.article}
              type="button"
              onClick={() => setOpened(index)}
              title={photo.title}
              className="group relative h-[74px] w-[110px] shrink-0 overflow-hidden rounded-sm border border-tb-line transition-[border-color,transform] duration-150 ease-out hover:border-tb-accent active:translate-y-px"
            >
              <img
                src={photo.image}
                alt={photo.title}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-105"
                onError={(event) => {
                  // Битую картинку прячем вместе с плиткой: пустая рамка
                  // выглядит как поломка, а не как отсутствие фотографии.
                  event.currentTarget.closest("button")?.style.setProperty("display", "none");
                }}
              />
              <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/85 to-transparent px-1.5 pt-4 pb-1 text-left text-[10px] leading-tight font-medium text-white">
                {photo.title}
              </span>
            </button>
          ))}
        </div>
        <p className="px-4 pt-1 text-2xs text-tb-muted">
          Что посмотреть · фотографии из Википедии
        </p>
      </section>

      {/* Через портал в body, а не по месту. `position: fixed` отсчитывается
          от ближайшего предка с `transform`, а анимация появления карточки
          оставляет его насовсем (`animation ... both`) — из-за этого просмотр
          открывался внутри узкой колонки вместо всего экрана. */}
      {current &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
            role="dialog"
            aria-modal="true"
            aria-label={current.title}
            onClick={close}
          >
            <div
              className="flex max-h-full w-full max-w-3xl flex-col gap-3"
              onClick={(event) => event.stopPropagation()}
            >
              <img
                src={current.image}
                alt={current.title}
                className="max-h-[70vh] w-full rounded-md object-contain"
              />
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-display truncate text-lg font-extrabold text-white">
                    {current.title}
                  </div>
                  {current.description && (
                    <div className="mt-0.5 truncate text-sm text-white/70">{current.description}</div>
                  )}
                  <a
                    href={current.article}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block text-xs text-white/60 underline underline-offset-2 hover:text-white"
                  >
                    Википедия · CC BY-SA
                  </a>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="tb-num mr-1 text-xs text-white/60">
                    {(opened ?? 0) + 1} / {photos.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => step(-1)}
                    aria-label="Предыдущая фотография"
                    className="grid size-8 place-items-center rounded-xs border border-white/25 text-white transition-colors hover:border-white/60"
                  >
                    <Icon name="chevronLeft" size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => step(1)}
                    aria-label="Следующая фотография"
                    className="grid size-8 place-items-center rounded-xs border border-white/25 text-white transition-colors hover:border-white/60"
                  >
                    <Icon name="chevronRight" size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={close}
                    aria-label="Закрыть"
                    className="grid size-8 place-items-center rounded-xs border border-white/25 text-white transition-colors hover:border-white/60"
                  >
                    <Icon name="close" size={13} />
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
