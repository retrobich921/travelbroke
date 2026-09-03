"""Что посмотреть в городе: подборка достопримечательностей с фотографиями.

Сценарий продукта — «не знаю куда, знаю сколько денег»: человек тыкает в город
на карте, и ему нужно за секунду понять, что там вообще есть. Цена этот вопрос
не закрывает, фотографии закрывают.

Источник — Википедия, а не поиск по картинкам. Причина не в лицензиях (хотя
CC-BY-SA честнее чужой выдачи), а в постановке задачи. Запрос «фото Москвы»
возвращает десять ракурсов Кремля: поисковик ранжирует картинки по похожести на
запрос, а нам нужно обратное — десять *разных* мест. Википедия отдаёт
структурированный список объектов рядом с координатами, и одна фотография на
объект даёт разнообразие по построению, а не фильтрацией постфактум.

Отбор решает четыре задачи, каждая проверена на живой выдаче:

1. **Охват города.** `geosearch` возвращает ближайшие статьи, поэтому один зонд
   по центру Москвы даёт полсотни объектов в трёхстах метрах от Красной площади.
   Зондируем пять точек — центр и четыре в стороны.
2. **Значимость.** Тип объекта её не заменяет: «Таможенный мост» и «Кремль» оба
   мосты-и-крепости. Размер статьи — надёжный прокси, и он приходит для всех
   страниц пачки, в отличие от счётчика просмотров, который на пятидесяти
   страницах возвращается пустым.
3. **Разнообразие.** Разнос точек в пространстве плюс потолок на объекты одного
   типа: восемь мечетей подряд — это не «что посмотреть в Казани».
4. **Отсев.** Станции метро, кладбища, заводы, события («Падение
   Константинополя»), организации и статья про сам город.
"""

from __future__ import annotations

import asyncio
import math
import re
from dataclasses import dataclass
from typing import Any

import httpx

WIKI_HOST = "ru.wikipedia.org"

USER_AGENT = "TravelBroke/0.1 (hackathon prototype; https://github.com/retrobich921/travelbroke)"
"""Викимедиа требует опознаваемый User-Agent и режет анонимные обращения."""

PHOTO_LIMIT = 8
"""Больше восьми не помещается в карточку и не читается за один взгляд."""

MIN_GAP_KM = 0.3
"""Разные по типу объекты рядом — это разные места: Айя-София и Топкапы в 600 м."""

SAME_KIND_GAP_KM = 0.75
"""Однотипные и рядом — почти наверняка один комплекс.

Спасская, Никольская и Троицкая башни стоят в трёхстах пятидесяти метрах друг от
друга: по расстоянию это разные точки, по смыслу — один Кремль с разных сторон.
Именно от такой подборки просили избавиться, а тип объекта отличает её от
случая «собор и дворец по соседству», где показать нужно оба."""

MAX_PER_KIND = 3
"""Потолок на объекты одного типа: иначе подборка вырождается в восемь храмов."""

PROBE_OFFSET_DEG = 0.035
"""Смещение зондов от центра, примерно четыре километра."""

_INTERESTING = re.compile(
    r"музе|собор|храм|дворец|парк|театр|памятник|крепост|башн|мост|площад|монастыр"
    r"|галере|усадьб|замок|мечет|синагог|сад|набережн|маяк|водопад|озер|пляж|остров"
    r"|стадион|цирк|зоопарк|аквариум|кремл"
    r"|museum|cathedral|palace|park|theat|monument|fortress|tower|bridge|square"
    r"|mosque|temple|castle|garden|beach",
    re.I,
)

_REJECTED = re.compile(
    # транспорт и инфраструктура — фотографировать нечего
    r"станция метро|метрополитен|остановочный пункт|платформа|вокзал|аэропорт"
    r"|улица|переулок|проспект|проезд|шоссе|бульвар|тоннел"
    # административные единицы и жильё
    r"|микрорайон|район |округ|посёлок|деревн|жилой|квартал"
    # учреждения, предприятия и деньги
    r"|школа|больниц|заво|фабрик|бизнес-центр|институт|университет|конструкторское"
    r"|кладбищ|казарм|архив|компани|корпораци|предприяти|банк|пенсионн|нпф"
    # административные и исторические образования: это не место, куда идут гулять
    r"|губерни|эмират|область|края|провинци|воеводств|префектур"
    # события, а не места
    r"|осада|битва|сражен|восстан|катастроф|авари|пожар|падение|оборона"
    r"|список"
    r"|railway station|metro station|airport|list of|district|school|hospital"
    r"|cemetery|university|company|battle|siege|emirate|province|governorate|bank",
    re.I,
)

_SETTLEMENT = re.compile(r"^(город|столица|посёлок|село|населённый пункт|city|town)", re.I)
"""Статья про сам город — не достопримечательность в нём."""

_KINDS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "культовое",
        re.compile(r"мечет|собор|храм|церк|монастыр|синагог|часовн|mosque|cathedral|church", re.I),
    ),
    ("музей", re.compile(r"музе|галере|museum|galler", re.I)),
    (
        "природа",
        re.compile(r"парк|сад|сквер|заповедн|озер|остров|гора|пляж|park|garden|beach", re.I),
    ),
    ("сцена", re.compile(r"театр|опер|цирк|филармон|стадион|theat|opera|circus|stadium", re.I)),
    (
        "здание",
        re.compile(r"дворец|замок|усадьб|башн|крепост|кремл|palace|castle|tower|fortress", re.I),
    ),
    ("город", re.compile(r"площад|мост|набережн|square|bridge|embankment", re.I)),
)


@dataclass(frozen=True, slots=True)
class Photo:
    """Одна достопримечательность с фотографией."""

    title: str
    description: str | None
    image: str
    """Прямая ссылка на превью с Викисклада."""
    article: str
    """Статья Википедии — источник и подпись по лицензии CC-BY-SA."""
    lat: float
    lon: float
    kind: str


def _distance_km(first: tuple[float, float], second: tuple[float, float]) -> float:
    lat1, lon1 = first
    lat2, lon2 = second
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def _kind_of(text: str) -> str:
    for name, pattern in _KINDS:
        if pattern.search(text):
            return name
    return "прочее"


def _probe_points(lat: float, lon: float) -> list[tuple[float, float, int]]:
    """Центр плюс четыре точки по сторонам: один зонд не покрывает мегаполис."""
    east = PROBE_OFFSET_DEG / max(math.cos(math.radians(lat)), 0.2)
    return [
        (lat, lon, 5000),
        (lat + PROBE_OFFSET_DEG, lon, 4000),
        (lat - PROBE_OFFSET_DEG, lon, 4000),
        (lat, lon + east, 4000),
        (lat, lon - east, 4000),
    ]


def select(pages: list[dict[str, Any]], city: str, limit: int = PHOTO_LIMIT) -> list[Photo]:
    """Отбирает из сырой выдачи Википедии разнообразную подборку с фотографиями.

    Чистая функция: сеть не трогает, поэтому проверяется тестом на фикстуре.
    """
    scored: list[tuple[float, dict[str, Any], tuple[float, float], str, str]] = []
    for page in pages:
        thumbnail = page.get("thumbnail")
        coordinates = page.get("coordinates")
        title = page.get("title")
        if not thumbnail or not coordinates or not title:
            continue

        description = page.get("description") or ""
        text = f"{title} {description}"
        if _REJECTED.search(text) or _SETTLEMENT.match(description):
            continue
        if title.strip().casefold() == city.strip().casefold():
            continue

        size = page.get("length")
        weight = math.log10(size + 1) * 2 if isinstance(size, int) else 0.0
        if _INTERESTING.search(text):
            weight += 2
        if description:
            weight += 0.5

        point = (float(coordinates[0]["lat"]), float(coordinates[0]["lon"]))
        scored.append((weight, page, point, str(thumbnail["source"]), _kind_of(text)))

    scored.sort(key=lambda item: -item[0])

    chosen: list[Photo] = []
    used_points: list[tuple[tuple[float, float], str]] = []
    used_files: set[str] = set()
    used_kinds: dict[str, int] = {}

    for _, page, point, image, kind in scored:
        filename = image.rsplit("/", 1)[-1].split("?")[0]
        if filename in used_files:
            continue
        if any(
            _distance_km(point, other) < (SAME_KIND_GAP_KM if other_kind == kind else MIN_GAP_KM)
            for other, other_kind in used_points
        ):
            continue
        if used_kinds.get(kind, 0) >= MAX_PER_KIND:
            continue

        used_files.add(filename)
        used_points.append((point, kind))
        used_kinds[kind] = used_kinds.get(kind, 0) + 1
        chosen.append(
            Photo(
                title=str(page["title"]),
                description=page.get("description") or None,
                image=image,
                article=f"https://{WIKI_HOST}/?curid={page['pageid']}",
                lat=point[0],
                lon=point[1],
                kind=kind,
            )
        )
        if len(chosen) == limit:
            break
    return chosen


async def _probe(
    client: httpx.AsyncClient, lat: float, lon: float, radius: int
) -> list[dict[str, Any]]:
    params = {
        "action": "query",
        "format": "json",
        "formatversion": "2",
        "generator": "geosearch",
        "ggscoord": f"{lat}|{lon}",
        "ggsradius": str(radius),
        "ggslimit": "50",
        "prop": "pageimages|description|coordinates|info",
        "piprop": "thumbnail",
        "pithumbsize": "800",
        "pilimit": "max",
        "colimit": "max",
    }
    response = await client.get(f"https://{WIKI_HOST}/w/api.php", params=params)
    response.raise_for_status()
    payload: dict[str, Any] = response.json()
    pages = payload.get("query", {}).get("pages", [])
    return pages if isinstance(pages, list) else []


async def fetch(city: str, lat: float, lon: float, limit: int = PHOTO_LIMIT) -> list[Photo]:
    """Достопримечательности города с фотографиями.

    Пять зондов идут параллельно. Отказ любого из них не считается ошибкой:
    подборка — украшение карточки, и ради неё нельзя ронять ответ про цены.
    """
    async with httpx.AsyncClient(
        timeout=12.0, headers={"User-Agent": USER_AGENT}, follow_redirects=True
    ) as client:
        results = await asyncio.gather(
            *(_probe(client, plat, plon, radius) for plat, plon, radius in _probe_points(lat, lon)),
            return_exceptions=True,
        )

    seen: set[int] = set()
    pages: list[dict[str, Any]] = []
    for result in results:
        if isinstance(result, BaseException):
            continue
        for page in result:
            page_id = page.get("pageid")
            if isinstance(page_id, int) and page_id not in seen:
                seen.add(page_id)
                pages.append(page)
    return select(pages, city, limit)
