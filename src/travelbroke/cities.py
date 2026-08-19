"""Справочник городов-кандидатов и их координат.

MCP Туту резолвит города по названию и отдаёт `geo_id`, но координат не даёт —
а карте они нужны. Держим свой компактный справочник: это дешевле и надёжнее
геокодера, а список городов всё равно ограничен сверху, иначе веер запросов
не укладывается во время.

Координаты — центры городов, WGS84.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import httpx


@dataclass(frozen=True, slots=True)
class City:
    """Город-кандидат для карты досягаемости."""

    name: str
    lat: float
    lon: float
    hub: bool = False
    """Хаб участвует в поиске составных маршрутов как промежуточная точка."""
    country: str = "Россия"
    """Страна. Заграница помечается отдельно — до неё не всякий транспорт ходит."""
    country_code: str = ""
    """ISO-код страны, когда он известен. Нужен для корректного поиска внутри страны."""
    aliases: tuple[str, ...] = ()
    """Написания города на других языках для сверки результата Туту."""

    @property
    def abroad(self) -> bool:
        return self.country != "Россия"

    @property
    def slug(self) -> str:
        """Стабильный идентификатор для URL и ключей на клиенте."""
        return self.name.lower().replace(" ", "-").replace("ё", "е")


# Хабы выбраны как крупные пересадочные узлы с плотным наземным сообщением.
CITIES: tuple[City, ...] = (
    City("Москва", 55.7558, 37.6173, hub=True),
    City("Санкт-Петербург", 59.9311, 30.3609, hub=True),
    City("Нижний Новгород", 56.3269, 44.0059, hub=True),
    City("Казань", 55.7963, 49.1088, hub=True),
    City("Екатеринбург", 56.8389, 60.6057, hub=True),
    City("Ростов-на-Дону", 47.2357, 39.7015, hub=True),
    City("Краснодар", 45.0355, 38.9753, hub=True),
    City("Самара", 53.1959, 50.1002, hub=True),
    City("Воронеж", 51.6720, 39.1843, hub=True),
    City("Тула", 54.1961, 37.6182, hub=True),
    City("Новосибирск", 55.0084, 82.9357),
    City("Челябинск", 55.1644, 61.4368),
    City("Омск", 54.9885, 73.3242),
    City("Уфа", 54.7388, 55.9721),
    City("Красноярск", 56.0184, 92.8672),
    City("Пермь", 58.0105, 56.2502),
    City("Волгоград", 48.7080, 44.5133),
    City("Саратов", 51.5462, 46.0086),
    City("Тюмень", 57.1522, 65.5272),
    City("Ижевск", 56.8527, 53.2115),
    City("Ульяновск", 54.3142, 48.4031),
    City("Барнаул", 53.3548, 83.7698),
    City("Иркутск", 52.2870, 104.3050),
    City("Хабаровск", 48.4827, 135.0838),
    City("Владивосток", 43.1332, 131.9113),
    City("Ярославль", 57.6261, 39.8845),
    City("Махачкала", 42.9849, 47.5047),
    City("Томск", 56.4977, 84.9744),
    City("Оренбург", 51.7727, 55.0988),
    City("Кемерово", 55.3547, 86.0873),
    City("Рязань", 54.6269, 39.6916),
    City("Астрахань", 46.3497, 48.0408),
    City("Пенза", 53.2007, 45.0046),
    City("Липецк", 52.6031, 39.5708),
    City("Киров", 58.6035, 49.6679),
    City("Чебоксары", 56.1439, 47.2489),
    City("Калининград", 54.7104, 20.4522),
    City("Курск", 51.7373, 36.1874),
    City("Ставрополь", 45.0428, 41.9734),
    City("Сочи", 43.5855, 39.7231),
    City("Тверь", 56.8587, 35.9176),
    City("Иваново", 57.0004, 40.9739),
    City("Брянск", 53.2434, 34.3639),
    City("Белгород", 50.5977, 36.5858),
    City("Владимир", 56.1290, 40.4070),
    City("Архангельск", 64.5401, 40.5433),
    City("Калуга", 54.5293, 36.2754),
    City("Смоленск", 54.7818, 32.0401),
    City("Мурманск", 68.9585, 33.0827),
    City("Псков", 57.8194, 28.3319),
    City("Великий Новгород", 58.5215, 31.2710),
    City("Петрозаводск", 61.7891, 34.3596),
    City("Кострома", 57.7676, 40.9268),
    City("Вологда", 59.2181, 39.8886),
    City("Анапа", 44.8949, 37.3164),
    City("Геленджик", 44.5622, 38.0848),
    City("Минеральные Воды", 44.2089, 43.1356),
    City("Сургут", 61.2500, 73.4167),
    City("Сыктывкар", 61.6688, 50.8360),
    City("Йошкар-Ола", 56.6388, 47.8908),
    City("Саранск", 54.1838, 45.1749),
    City("Тамбов", 52.7212, 41.4523),
    City("Орёл", 52.9668, 36.0625),
    City("Владикавказ", 43.0367, 44.6678),
    City("Нальчик", 43.4981, 43.6189),
    City("Улан-Удэ", 51.8335, 107.5841),
    City("Магнитогорск", 53.4186, 58.9797),
    City("Новокузнецк", 53.7557, 87.1099),
    City("Набережные Челны", 55.7436, 52.3958),
    City("Нижний Тагил", 57.9195, 59.9650),
    City("Курган", 55.4500, 65.3333),
    City("Череповец", 59.1269, 37.9094),
    City("Новороссийск", 44.7239, 37.7686),
    City("Симферополь", 44.9521, 34.1024),
    City("Севастополь", 44.6167, 33.5254),
    City("Грозный", 43.3169, 45.6981),
    # Заграница: MCP Туту резолвит эти города и продаёт до них билеты.
    City("Минск", 53.9006, 27.5590, hub=True, country="Беларусь"),
    City("Сухум", 43.0015, 41.0234, country="Абхазия"),
    City("Гагра", 43.2800, 40.2667, country="Абхазия"),
    City("Тбилиси", 41.7151, 44.8271, hub=True, country="Грузия"),
    City("Батуми", 41.6168, 41.6367, country="Грузия"),
    City("Кутаиси", 42.2679, 42.6946, country="Грузия"),
    City("Ереван", 40.1792, 44.4991, hub=True, country="Армения"),
    City("Гюмри", 40.7894, 43.8475, country="Армения"),
    City("Баку", 40.4093, 49.8671, hub=True, country="Азербайджан"),
    City("Астана", 51.1694, 71.4491, hub=True, country="Казахстан"),
    City("Алматы", 43.2220, 76.8512, hub=True, country="Казахстан"),
    City("Актау", 43.6410, 51.1980, country="Казахстан"),
    City("Караганда", 49.8047, 73.1094, country="Казахстан"),
    City("Шымкент", 42.3417, 69.5901, country="Казахстан"),
    City("Бишкек", 42.8746, 74.5698, hub=True, country="Киргизия"),
    City("Ош", 40.5283, 72.7985, country="Киргизия"),
    City("Ташкент", 41.2995, 69.2401, hub=True, country="Узбекистан"),
    City("Самарканд", 39.6270, 66.9750, country="Узбекистан"),
    City("Бухара", 39.7747, 64.4286, country="Узбекистан"),
    City("Душанбе", 38.5598, 68.7870, country="Таджикистан"),
    City("Ашхабад", 37.9601, 58.3261, country="Туркменистан"),
    City("Кишинёв", 47.0105, 28.8638, country="Молдова"),
    City("Стамбул", 41.0082, 28.9784, hub=True, country="Турция"),
    City("Анталья", 36.8969, 30.7133, country="Турция"),
    City("Анкара", 39.9334, 32.8597, country="Турция"),
    City("Измир", 38.4237, 27.1428, country="Турция"),
    City("Дубай", 25.2048, 55.2708, hub=True, country="ОАЭ"),
    City("Абу-Даби", 24.4539, 54.3773, country="ОАЭ"),
    City("Шарджа", 25.3463, 55.4209, country="ОАЭ"),
    City("Тель-Авив", 32.0853, 34.7818, country="Израиль"),
    City("Каир", 30.0444, 31.2357, country="Египет"),
    City("Хургада", 27.2579, 33.8116, country="Египет"),
    City("Шарм-эль-Шейх", 27.9158, 34.3300, country="Египет"),
    City("Пекин", 39.9042, 116.4074, hub=True, country="Китай"),
    City("Шанхай", 31.2304, 121.4737, country="Китай"),
    City("Харбин", 45.8038, 126.5349, country="Китай"),
    City("Улан-Батор", 47.8864, 106.9057, country="Монголия"),
    City("Бангкок", 13.7563, 100.5018, country="Таиланд"),
    City("Пхукет", 7.8804, 98.3923, country="Таиланд"),
    City("Дели", 28.6139, 77.2090, country="Индия"),
    City("Белград", 44.7866, 20.4489, country="Сербия"),
    City("Будапешт", 47.4979, 19.0402, country="Венгрия"),
    City("Прага", 50.0755, 14.4378, country="Чехия"),
    City("Хельсинки", 60.1699, 24.9384, country="Финляндия"),
    City("Рига", 56.9496, 24.1052, country="Латвия"),
    City("Таллин", 59.4370, 24.7536, country="Эстония"),
    City("Вильнюс", 54.6872, 25.2797, country="Литва"),
    City("Варшава", 52.2297, 21.0122, country="Польша"),
    City("Берлин", 52.5200, 13.4050, country="Германия"),
    City("Париж", 48.8566, 2.3522, country="Франция"),
    City("Рим", 41.9028, 12.4964, country="Италия"),
    City("Барселона", 41.3851, 2.1734, country="Испания"),
)

BY_NAME: dict[str, City] = {city.name: city for city in CITIES}
BY_SLUG: dict[str, City] = {city.slug: city for city in CITIES}
HUBS: tuple[City, ...] = tuple(city for city in CITIES if city.hub)


def resolve(name: str) -> City | None:
    """Находит город по названию или слагу, без учёта регистра."""
    key = name.strip()
    return BY_NAME.get(key) or BY_SLUG.get(key.lower().replace(" ", "-").replace("ё", "е"))


def _normalized_name(value: str) -> str:
    """Сравнение городов без регистра, дефисов и диакритических различий."""
    return " ".join(
        "".join(
            char if char.isalnum() else " " for char in value.casefold().replace("ё", "е")
        ).split()
    )


def matches_name(city: City, reported: str) -> bool:
    """Совпадает ли город, который Туту реально зарезолвил, с ожидаемым.

    GeoNames использует английские названия, Туту чаще возвращает русские.
    Алиасы позволяют признать Cairo → Каир, но не Zarqa → Навои.
    """
    normalized = _normalized_name(reported)
    return normalized in {_normalized_name(name) for name in (city.name, *city.aliases)}


MAJOR_HUBS: frozenset[str] = frozenset(
    {"Москва", "Санкт-Петербург", "Стамбул", "Дубай", "Алматы", "Минск"}
)
"""Узлы, через которые реально летают и ездят. Их проверяем первыми."""

MAX_DESTINATIONS = 380
"""Потолок веера: вся Россия плюс сбалансированный обзор пяти континентов."""

# В одном запросе нельзя честно опросить десятки тысяч городов: каждый из них —
# отдельный вызов поиска Туту. Поэтому каталог широкий, а веер ограничен и
# раскладывается по регионам. Так Африка и обе Америки не проигрывают Европе по
# одному лишь расстоянию от Москвы.
REGION_QUOTA: dict[str, int] = {
    "EU": 55,
    "AS": 70,
    "AF": 55,
    "NA": 50,
    "SA": 40,
    "OC": 25,
}

# Сохранено как публичная константа для старых интеграционных проверок. Реальная
# квота теперь существенно больше и задаётся REGION_QUOTA.
ABROAD_QUOTA = 24

SMALL_COUNTRY_CITIES = 15
LARGE_COUNTRY_CITIES = 50
LARGE_COUNTRY_POPULATION = 50_000_000

# Имена из Nominatim и из нашего русского каталога приводим к одному ISO-коду.
# Для остальных стран код приходит прямо из GeoNames.
COUNTRY_CODES: dict[str, str] = {
    "Россия": "RU",
    "Russia": "RU",
    "Беларусь": "BY",
    "Belarus": "BY",
    "Абхазия": "GE",
    "Грузия": "GE",
    "Georgia": "GE",
    "Армения": "AM",
    "Armenia": "AM",
    "Азербайджан": "AZ",
    "Azerbaijan": "AZ",
    "Казахстан": "KZ",
    "Kazakhstan": "KZ",
    "Киргизия": "KG",
    "Кыргызстан": "KG",
    "Kyrgyzstan": "KG",
    "Узбекистан": "UZ",
    "Uzbekistan": "UZ",
    "Таджикистан": "TJ",
    "Tajikistan": "TJ",
    "Туркменистан": "TM",
    "Turkmenistan": "TM",
    "Молдова": "MD",
    "Moldova": "MD",
    "Турция": "TR",
    "Turkey": "TR",
    "ОАЭ": "AE",
    "United Arab Emirates": "AE",
    "Израиль": "IL",
    "Israel": "IL",
    "Египет": "EG",
    "Egypt": "EG",
    "Китай": "CN",
    "China": "CN",
    "Монголия": "MN",
    "Mongolia": "MN",
    "Таиланд": "TH",
    "Thailand": "TH",
    "Индия": "IN",
    "India": "IN",
    "Сербия": "RS",
    "Serbia": "RS",
    "Венгрия": "HU",
    "Hungary": "HU",
    "Чехия": "CZ",
    "Czechia": "CZ",
    "Финляндия": "FI",
    "Finland": "FI",
    "Латвия": "LV",
    "Latvia": "LV",
    "Эстония": "EE",
    "Estonia": "EE",
    "Литва": "LT",
    "Lithuania": "LT",
    "Польша": "PL",
    "Poland": "PL",
    "Германия": "DE",
    "Germany": "DE",
    "Франция": "FR",
    "France": "FR",
    "Италия": "IT",
    "Italy": "IT",
    "Испания": "ES",
    "Spain": "ES",
    "США": "US",
    "United States": "US",
    "Бразилия": "BR",
    "Brazil": "BR",
    "Австралия": "AU",
    "Australia": "AU",
}


def country_id(city: City) -> str:
    """Устойчивая страна города: ISO-код либо нормализованное имя."""
    return city.country_code or COUNTRY_CODES.get(city.country, city.country.casefold())


@lru_cache(maxsize=1)
def global_catalog() -> tuple[tuple[City, str], ...]:
    """Города мира из локального справочника GeoNames, без сетевого запроса.

    От каждой небольшой страны оставляем 15 наиболее населённых городов, от
    крупных — до 50. Это именно *каталог кандидатов*: в один поиск попадёт
    регионально сбалансированная выборка из него, а не тысячи обращений к Туту.
    """
    import geonamescache  # type: ignore[import-untyped]

    cache = geonamescache.GeonamesCache()
    countries = cache.get_countries()
    grouped: dict[str, list[dict[str, Any]]] = {}
    for raw in cache.get_cities().values():
        code = raw.get("countrycode")
        population = raw.get("population")
        if not isinstance(code, str) or not isinstance(population, int) or population < 20_000:
            continue
        grouped.setdefault(code, []).append(raw)

    catalog: list[tuple[City, str]] = []
    for code, values in grouped.items():
        country = countries.get(code)
        if not isinstance(country, dict):
            continue
        continent = country.get("continentcode")
        name = country.get("name")
        population = country.get("population")
        if not isinstance(continent, str) or not isinstance(name, str):
            continue
        cap = (
            LARGE_COUNTRY_CITIES
            if isinstance(population, int) and population >= LARGE_COUNTRY_POPULATION
            else SMALL_COUNTRY_CITIES
        )
        for raw in sorted(values, key=lambda item: int(item["population"]), reverse=True)[:cap]:
            city_name = raw.get("name")
            latitude = raw.get("latitude")
            longitude = raw.get("longitude")
            aliases = raw.get("alternatenames")
            names = (
                tuple(alias for alias in aliases if isinstance(alias, str))
                if isinstance(aliases, list)
                else ()
            )
            if (
                isinstance(city_name, str)
                and isinstance(latitude, int | float)
                and isinstance(longitude, int | float)
            ):
                catalog.append(
                    (
                        City(
                            city_name,
                            float(latitude),
                            float(longitude),
                            country=name,
                            country_code=code,
                            aliases=names,
                        ),
                        continent,
                    )
                )
    return tuple(catalog)


def _balanced(candidates: list[City], limit: int, origin: City) -> list[City]:
    """Берёт города кругами по странам, начиная с главных городов каждой страны."""
    per_country: dict[str, list[City]] = {}
    for city in candidates:
        per_country.setdefault(country_id(city), []).append(city)
    # В global_catalog города уже отсортированы по населению. Расстояние тут
    # годится только для порядка *стран*: иначе вместо Нью-Йорка и Каира в
    # выдачу попадут пограничные, но не самые полезные для поездки города.
    groups = sorted(
        per_country.values(), key=lambda group: min(distance_km(origin, city) for city in group)
    )
    selected: list[City] = []
    offset = 0
    while len(selected) < limit:
        added = False
        for group in groups:
            if offset < len(group):
                selected.append(group[offset])
                added = True
                if len(selected) == limit:
                    break
        if not added:
            break
        offset += 1
    return selected


def distance_km(a: City, b: City) -> float:
    """Расстояние по прямой между городами, километры."""
    radius = 6371.0
    lat1, lat2 = math.radians(a.lat), math.radians(b.lat)
    dlat = lat2 - lat1
    dlon = math.radians(b.lon - a.lon)
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(h))


def destinations(
    origin: City, limit: int | None = None, *, abroad_only: bool = False
) -> tuple[City, ...]:
    """Список направлений для веера, сбалансированный по континентам.

    Россия остаётся полной: дальние города вроде Владивостока никогда не
    вытесняются. Заграница берётся не «по близости к Москве», а квотами регионов
    с круговым выбором городов по странам — поэтому в ответ попадают Африка и
    Америка, а не только Европа.
    """
    origin_country = country_id(origin)
    local = [city for city in CITIES if city.name != origin.name]
    worldwide = global_catalog()
    known_coordinates = {(round(city.lat, 1), round(city.lon, 1)) for city in local}
    extra = [
        city
        for city, _ in worldwide
        if (round(city.lat, 1), round(city.lon, 1)) not in known_coordinates
    ]
    all_cities = [*local, *extra]
    local_domestic = [city for city in local if country_id(city) == origin_country]
    # У России уже есть вручную проверенный полный набор. Для произвольного
    # города из Nominatim локального списка может не быть — тогда добавляем
    # города его страны из мирового каталога, но не даём одной стране съесть
    # весь глобальный веер.
    domestic_source = (
        local_domestic
        or [city for city in extra if country_id(city) == origin_country][:LARGE_COUNTRY_CITIES]
    )
    domestic = sorted(
        domestic_source,
        key=lambda city: distance_km(origin, city),
    )
    if abroad_only:
        domestic = []

    by_region: dict[str, list[City]] = {region: [] for region in REGION_QUOTA}
    continent_by_code = {city.country_code: continent for city, continent in worldwide}
    for city in all_cities:
        if country_id(city) == origin_country:
            continue
        region = continent_by_code.get(country_id(city))
        if region in by_region:
            by_region[region].append(city)

    foreign: list[City] = []
    for region, quota in REGION_QUOTA.items():
        foreign.extend(_balanced(by_region[region], quota, origin))

    # Географическая дедупликация не позволяет дважды спросить Туту про один
    # и тот же город с русским и английским написанием.
    pool: list[City] = []
    seen: set[tuple[float, float]] = set()
    for city in [*domestic, *foreign]:
        key = round(city.lat, 1), round(city.lon, 1)
        if key not in seen:
            seen.add(key)
            pool.append(city)
        if len(pool) == MAX_DESTINATIONS:
            break
    return tuple(pool if limit is None else pool[:limit])


_GEOCODE_CACHE: dict[str, City | None] = {}
_SUGGEST_CACHE: dict[str, list[City]] = {}


def _from_geocoder(query: str, item: dict[str, Any]) -> City | None:
    """Нормализует городской результат Nominatim в доменную модель."""
    try:
        lat, lon = float(item["lat"]), float(item["lon"])
    except (KeyError, TypeError, ValueError):
        return None
    raw_address = item.get("address")
    address: dict[str, Any] = raw_address if isinstance(raw_address, dict) else {}
    name = query.strip()
    for key in ("city", "town", "municipality", "village", "county"):
        candidate = address.get(key)
        if isinstance(candidate, str) and candidate:
            name = candidate
            break
    raw_country = address.get("country")
    country = raw_country if isinstance(raw_country, str) else "Мир"
    return City(name=name, lat=lat, lon=lon, country=country)


async def resolve_global(name: str) -> City | None:
    """Город из локального списка или глобального геокодера OpenStreetMap.

    Туту остаётся источником транспортных предложений и сам резолвит название
    в своём поиске. Геокодер нужен лишь для координаты точки на карте и для
    подсказок при вводе, поэтому его ответ кэшируем в памяти.
    """
    local = resolve(name)
    if local is not None:
        return local
    query = name.strip()
    if not query:
        return None
    key = query.casefold()
    if key in _GEOCODE_CACHE:
        return _GEOCODE_CACHE[key]
    try:
        async with httpx.AsyncClient(
            timeout=5,
            headers={"User-Agent": "TravelBroke/0.1 (travel map prototype)"},
        ) as client:
            response = await client.get(
                "https://nominatim.openstreetmap.org/search",
                params={
                    "q": query,
                    "format": "jsonv2",
                    "limit": 1,
                    "addressdetails": 1,
                    "accept-language": "ru",
                },
            )
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError):
        return None
    item = (
        payload[0]
        if isinstance(payload, list) and payload and isinstance(payload[0], dict)
        else None
    )
    city = _from_geocoder(query, item) if item else None
    _GEOCODE_CACHE[key] = city
    return city


async def suggest_global(query: str, limit: int = 10) -> list[City]:
    """Подсказки городов по всему миру для поля отправления."""
    needle = query.strip()
    if len(needle) < 2:
        return []
    key = needle.casefold()
    if key in _SUGGEST_CACHE:
        return _SUGGEST_CACHE[key][:limit]
    local = [city for city in CITIES if needle.casefold() in city.name.casefold()]
    try:
        async with httpx.AsyncClient(
            timeout=5,
            headers={"User-Agent": "TravelBroke/0.1 (travel map prototype)"},
        ) as client:
            response = await client.get(
                "https://nominatim.openstreetmap.org/search",
                params={
                    "q": needle,
                    "format": "jsonv2",
                    "limit": limit,
                    "addressdetails": 1,
                    "accept-language": "ru",
                },
            )
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError):
        return local[:limit]
    remote: list[City] = []
    if isinstance(payload, list):
        for item in payload:
            if isinstance(item, dict) and (city := _from_geocoder(needle, item)) is not None:
                remote.append(city)
    seen: set[tuple[str, str]] = set()
    unique: list[City] = []
    for city in [*local, *remote]:
        city_key = city.name.casefold(), city.country.casefold()
        if city_key not in seen:
            seen.add(city_key)
            unique.append(city)
    _SUGGEST_CACHE[key] = unique
    return unique[:limit]
