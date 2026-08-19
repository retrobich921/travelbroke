"""Расчёт досягаемости: веер запросов и поиск составных маршрутов.

Две фазы, как описано в ADR-0001:

1. **Веер.** Один `search_multitransport` на каждый город-кандидат. Даёт прямую
   цену и время, а заодно `modes_summary` — минимальную цену и длительность по
   каждому виду транспорта, из которых работают тумблеры на карте.
2. **Граф.** Для городов, куда прямой маршрут дорогой, пробуем добраться через
   хаб. Хабы отбираются геометрически: крюк через хаб не должен быть длиннее
   прямого пути более чем в ``MAX_DETOUR`` раз, иначе перебор не окупается.

Составной маршрут засчитывается, только если пересадка **физически выполнима** —
см. `required_buffer` и ADR-0004.

Модуль ничего не знает про HTTP и про формат ответов MCP — за первое отвечает
``travelbroke.api``, за второе ``tutukit``.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import logging
import math
from dataclasses import dataclass, field
from typing import Any, cast

import networkx as nx

from travelbroke.cities import City, destinations
from tutukit.client import ToolCallError, TutuError, TutuMCP
from tutukit.diagnose import diagnose

log = logging.getLogger(__name__)

ALL_MODES: tuple[str, ...] = ("avia", "railway", "bus", "etrain")

MAX_DETOUR = 1.35
"""Во сколько раз крюк через хаб может быть длиннее прямого пути по прямой."""

BASE_BUFFER_MIN = 60
"""Базовый запас на пересадку: дойти, найти платформу, не бежать."""

AVIA_BUFFER_MIN = 90
"""Добавка, если хотя бы одно плечо — самолёт: регистрация, багаж, досмотр."""

STATION_CHANGE_BUFFER_MIN = 60
"""Добавка, если прибытие и отправление на разных вокзалах: переезд по городу."""

MAX_BUFFER_MIN = 20 * 60
"""Потолок ожидания: сутки на вокзале — это уже не пересадка, а вторая поездка."""


@dataclass(frozen=True, slots=True)
class Variant:
    """Один вариант поездки между двумя городами."""

    transport: str
    price: int
    duration_min: int
    transfers: int
    departure_at: str | None = None
    arrival_at: str | None = None
    departure_point: str | None = None
    arrival_point: str | None = None
    checkout_url: str | None = None
    route: str | None = None
    checkout_ref: dict[str, Any] | None = None
    """Сырой reference оффера: из него `create_checkout_link` делает ссылку на конкретный рейс."""

    @property
    def hours(self) -> float:
        return round(self.duration_min / 60, 1)

    @property
    def departure_dt(self) -> dt.datetime | None:
        return _parse_dt(self.departure_at)

    @property
    def arrival_dt(self) -> dt.datetime | None:
        return _parse_dt(self.arrival_at)


@dataclass(frozen=True, slots=True)
class Connection:
    """Составной маршрут: два плеча и проверенная пересадка между ними."""

    first: Variant
    second: Variant
    wait_min: int
    """Фактический запас между прибытием первого плеча и отправлением второго."""
    required_min: int
    """Сколько запаса потребовала проверка — по нему объясняем решение пользователю."""

    @property
    def price(self) -> int:
        return self.first.price + self.second.price

    @property
    def duration_min(self) -> int:
        """Полное время двери-в-двери, включая ожидание на пересадке."""
        return self.first.duration_min + self.wait_min + self.second.duration_min

    @property
    def overnight(self) -> bool:
        """Ожидание больше восьми часов — это ночёвка, о ней надо предупредить."""
        return self.wait_min >= 8 * 60


@dataclass(slots=True)
class Reach:
    """Итог по одному городу назначения."""

    city: City
    direct: Variant | None = None
    variants: list[Variant] = field(default_factory=list)
    """Конкретные прямые офферы, из которых клиент выбирает вариант по фильтрам."""
    via: City | None = None
    connection: Connection | None = None
    by_mode: dict[str, int] = field(default_factory=dict)
    """Минимальная цена по каждому виду транспорта — для тумблеров на клиенте."""
    by_mode_minutes: dict[str, int] = field(default_factory=dict)
    """Минимальное время по каждому виду транспорта, минуты."""
    options: list[Variant] = field(default_factory=list)
    """Несколько лучших вариантов «туда», а не только самый дешёвый."""
    back: Variant | None = None
    """Самый дешёвый обратный билет в заданном окне дней пребывания."""
    back_date: dt.date | None = None
    """Дата обратного билета."""
    empty_reason: str | None = None
    empty_message: str | None = None

    @property
    def via_legs(self) -> tuple[Variant, Variant] | None:
        """Плечи составного маршрута, если он найден."""
        if self.connection is None:
            return None
        return (self.connection.first, self.connection.second)

    @property
    def best_price(self) -> int | None:
        """Цена лучшего из найденных маршрутов: прямого или составного."""
        prices = [variant.price for variant in (self.direct,) if variant is not None]
        if self.connection is not None:
            prices.append(self.connection.price)
        return min(prices) if prices else None

    @property
    def beats_direct_by(self) -> int | None:
        """Насколько составной маршрут дешевле прямого, если он вообще дешевле."""
        if self.connection is None or self.direct is None:
            return None
        saved = self.direct.price - self.connection.price
        return saved if saved > 0 else None


def _parse_dt(raw: str | None) -> dt.datetime | None:
    """ISO-строка из ответа Туту в datetime. Ошибку разбора считаем отсутствием данных."""
    if not raw:
        return None
    try:
        return dt.datetime.fromisoformat(raw)
    except ValueError:
        log.debug("не разобрал дату %r", raw)
        return None


def _normalize_point(raw: str | None) -> str:
    """Название станции без кода в скобках и без регистра — для сравнения вокзалов."""
    if not raw:
        return ""
    head = raw.split("(")[0]
    return " ".join(head.replace("—", " ").replace("·", " ").split()).casefold()


def same_station(first: Variant, second: Variant) -> bool:
    """Прибытие и отправление происходят на одной и той же станции.

    Когда данных о станциях нет, считаем их разными: осторожная оценка добавит
    лишний час запаса, а не отправит пассажира на невыполнимую пересадку.
    """
    arrival = _normalize_point(first.arrival_point)
    departure = _normalize_point(second.departure_point)
    if not arrival or not departure:
        return False
    return arrival == departure


def required_buffer(first: Variant, second: Variant) -> int:
    """Сколько минут запаса нужно между плечами, чтобы пересадка была выполнимой.

    Расписание Туту не знает о фактических задержках, поэтому запас закладываем
    структурно: час на саму пересадку, плюс полтора часа, если в связке есть
    самолёт, плюс час на переезд, если вокзалы разные. Обоснование — в ADR-0004.
    """
    buffer = BASE_BUFFER_MIN
    if "avia" in (first.transport, second.transport):
        buffer += AVIA_BUFFER_MIN
    if not same_station(first, second):
        buffer += STATION_CHANGE_BUFFER_MIN
    return buffer


def best_connection(firsts: list[Variant], seconds: list[Variant]) -> Connection | None:
    """Самая дешёвая пара плеч, между которыми пересадка физически выполнима."""
    best: Connection | None = None
    for first in firsts:
        arrival = first.arrival_dt
        if arrival is None:
            continue
        for second in seconds:
            departure = second.departure_dt
            if departure is None:
                continue
            wait = round((departure - arrival).total_seconds() / 60)
            need = required_buffer(first, second)
            if wait < need or wait > MAX_BUFFER_MIN:
                continue
            candidate = Connection(first=first, second=second, wait_min=wait, required_min=need)
            if best is None or candidate.price < best.price:
                best = candidate
    return best


def _haversine_km(a: City, b: City) -> float:
    """Расстояние по прямой между городами, километры."""
    radius = 6371.0
    lat1, lat2 = math.radians(a.lat), math.radians(b.lat)
    dlat = lat2 - lat1
    dlon = math.radians(b.lon - a.lon)
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(h))


def detour_ratio(origin: City, hub: City, target: City) -> float:
    """Во сколько раз путь через хаб длиннее прямого. 1.0 — хаб точно по дороге."""
    direct = _haversine_km(origin, target)
    if direct <= 0:
        return math.inf
    return (_haversine_km(origin, hub) + _haversine_km(hub, target)) / direct


def _to_int_price(raw: Any) -> int | None:
    if isinstance(raw, dict):
        raw = raw.get("amount")
    if isinstance(raw, int | float):
        return round(raw)
    return None


def _endpoints(raw: dict[str, Any]) -> tuple[str | None, str | None]:
    """Станции отправления и прибытия из первого и последнего плеча варианта."""
    legs = raw.get("legs")
    if not isinstance(legs, list) or not legs:
        return None, None
    first, last = legs[0], legs[-1]
    if not isinstance(first, dict) or not isinstance(last, dict):
        return None, None
    return first.get("from"), last.get("to")


def parse_variants(data: dict[str, Any], limit: int = 30) -> list[Variant]:
    """Достаёт из ответа `search_multitransport` то немногое, что нужно карте."""
    variants: list[Variant] = []
    for raw in (data.get("variants") or [])[:limit]:
        price = _to_int_price(raw.get("price"))
        duration = raw.get("duration_min")
        if price is None or not isinstance(duration, int):
            continue
        segments = raw.get("segments_count")
        departure_point, arrival_point = _endpoints(raw)
        route = (
            f"{departure_point} → {arrival_point}" if departure_point and arrival_point else None
        )
        variants.append(
            Variant(
                transport=str(raw.get("transport") or "unknown"),
                price=price,
                duration_min=duration,
                transfers=max(segments - 1, 0) if isinstance(segments, int) else 0,
                departure_at=raw.get("departure_at"),
                arrival_at=raw.get("arrival_at"),
                departure_point=departure_point,
                arrival_point=arrival_point,
                # search_results_url ведёт только на общий поиск. Для карточки
                # покупки годится исключительно конкретный checkout_url либо ref.
                checkout_url=raw.get("checkout_url"),
                route=route,
                checkout_ref=raw.get("checkout_ref")
                if isinstance(raw.get("checkout_ref"), dict)
                else None,
            )
        )
    return variants


def parse_modes_summary(data: dict[str, Any]) -> tuple[dict[str, int], dict[str, int]]:
    """Минимумы по каждому виду транспорта из `meta.modes_summary`.

    Возвращает две карты: цена в рублях и длительность в минутах. Из них на
    клиенте работают тумблеры видов транспорта — без единого нового запроса.
    """
    meta = data.get("meta")
    summary = meta.get("modes_summary") if isinstance(meta, dict) else None
    if not isinstance(summary, dict):
        return {}, {}
    prices: dict[str, int] = {}
    minutes: dict[str, int] = {}
    for mode, stats in summary.items():
        if not isinstance(stats, dict):
            continue
        price = _to_int_price(stats.get("min_price"))
        if price is not None:
            prices[str(mode)] = price
        duration = stats.get("min_duration_min")
        if isinstance(duration, int | float):
            minutes[str(mode)] = round(duration)
    return prices, minutes


async def _search_pair(
    mcp: TutuMCP,
    origin: str,
    target: str,
    when: dt.date,
    modes: tuple[str, ...],
    price_max: int | None,
    *,
    adults: int = 1,
    page_size: int | None = 30,
) -> tuple[list[Variant], dict[str, int], dict[str, int], str | None, str | None]:
    """Один поиск между парой городов. Ошибку инструмента считаем пустым результатом."""
    args: dict[str, Any] = {
        "origin": origin,
        "destination": target,
        "departure_date": when.isoformat(),
        "optimize_for": "price",
        "view": "compact",
    }
    if adults > 1:
        args["adults"] = adults
    if page_size is not None:
        args["page_size"] = page_size
    if modes and set(modes) != set(ALL_MODES):
        args["modes"] = list(modes)
    if price_max is not None:
        args["price_max"] = price_max

    try:
        data = await mcp.call("search_multitransport", **args)
    except ToolCallError as exc:
        # Нерезолвящийся город — штатная ситуация, а не падение расчёта.
        return [], {}, {}, "unresolved", str(exc)
    except TutuError as exc:
        log.warning("поиск %s → %s не удался: %s", origin, target, exc)
        return [], {}, {}, "transport_error", str(exc)

    verdict = diagnose("search_multitransport", args, data)
    variants = parse_variants(data)
    reason = None if variants else str(verdict.reason)
    message = None if variants else verdict.message
    prices, minutes = parse_modes_summary(data)
    return variants, prices, minutes, reason, message


async def fan_out(
    mcp: TutuMCP,
    origin: City,
    when: dt.date,
    *,
    modes: tuple[str, ...] = ALL_MODES,
    price_max: int | None = None,
    limit: int | None = None,
    adults: int = 1,
) -> list[Reach]:
    """Фаза 1: прямая досягаемость каждого города-кандидата из точки отправления."""
    targets = destinations(origin, limit)

    async def one(target: City) -> Reach:
        variants, by_mode, by_minutes, reason, message = await _search_pair(
            mcp, origin.name, target.name, when, modes, price_max, adults=adults
        )
        cheapest = min(variants, key=lambda variant: variant.price) if variants else None

        # Карта и карточка обязаны опираться на один и тот же конкретный оффер.
        # Сводка `modes_summary` иногда ссылается на вариант за пределами первой
        # страницы выдачи; его нельзя честно отправить в оформление.
        concrete_by_mode: dict[str, Variant] = {}
        for variant in variants:
            current = concrete_by_mode.get(variant.transport)
            if current is None or variant.price < current.price:
                concrete_by_mode[variant.transport] = variant
        if concrete_by_mode:
            by_mode = {mode: variant.price for mode, variant in concrete_by_mode.items()}
            by_minutes = {mode: variant.duration_min for mode, variant in concrete_by_mode.items()}
        return Reach(
            city=target,
            direct=cheapest,
            options=sorted(variants, key=lambda variant: variant.price)[:5],
            variants=variants,
            by_mode=by_mode,
            by_mode_minutes=by_minutes,
            empty_reason=reason,
            empty_message=message,
        )

    return list(await asyncio.gather(*(one(target) for target in targets)))


def hub_candidates(origin: City, target: City, hubs: tuple[City, ...]) -> list[City]:
    """Хабы, через которые есть смысл искать составной маршрут."""
    return sorted(
        (
            hub
            for hub in hubs
            if hub.name not in (origin.name, target.name)
            and detour_ratio(origin, hub, target) <= MAX_DETOUR
        ),
        key=lambda hub: detour_ratio(origin, hub, target),
    )


async def deepen(
    mcp: TutuMCP,
    origin: City,
    when: dt.date,
    reaches: list[Reach],
    hubs: tuple[City, ...],
    *,
    modes: tuple[str, ...] = ALL_MODES,
    top_expensive: int = 20,
    hubs_per_city: int = 2,
    adults: int = 1,
) -> list[Reach]:
    """Фаза 2: ищет составные маршруты туда, где прямой вариант дорогой.

    Работает поверх результатов веера и правит их на месте. Считается только для
    ``top_expensive`` худших городов и не более чем через ``hubs_per_city`` хабов
    на город — иначе число запросов растёт быстрее, чем польза.

    Второе плечо ищется и на следующий день: пересадка с ночёвкой — нормальный
    вариант для дальнего направления, а вот пересадка, на которую не успеваешь, —
    нет.
    """
    ranked = sorted(
        reaches,
        key=lambda reach: (reach.best_price is not None, reach.best_price or 0),
        reverse=True,
    )[:top_expensive]

    # Плечо «отправление → хаб» одно и то же для всех городов, считаем его один раз.
    leg_cache: dict[tuple[str, str, dt.date], list[Variant]] = {}
    lock = asyncio.Lock()

    async def leg(start: str, finish: str, day: dt.date) -> list[Variant]:
        key = (start, finish, day)
        async with lock:
            cached = leg_cache.get(key)
        if cached is not None:
            return cached
        # Плечам нужен запас вариантов по времени отправления, иначе выполнимой
        # стыковки может не найтись там, где она есть.
        variants, _, _, _, _ = await _search_pair(
            mcp, start, finish, day, modes, None, adults=adults, page_size=20
        )
        async with lock:
            leg_cache[key] = variants
        return variants

    async def one(reach: Reach) -> None:
        for hub in hub_candidates(origin, reach.city, hubs)[:hubs_per_city]:
            firsts = await leg(origin.name, hub.name, when)
            if not firsts:
                continue
            seconds = await leg(hub.name, reach.city.name, when)
            seconds = seconds + await leg(hub.name, reach.city.name, when + dt.timedelta(days=1))
            candidate = best_connection(firsts, seconds)
            if candidate is None:
                continue
            if reach.best_price is not None and candidate.price >= reach.best_price:
                continue
            reach.via = hub
            reach.connection = candidate

    await asyncio.gather(*(one(reach) for reach in ranked))
    return reaches


def build_graph(origin: City, reaches: list[Reach]) -> nx.DiGraph[str]:
    """Граф маршрутов: узлы — города, рёбра — найденные варианты поездки.

    Вес ребра — цена. Время храним отдельным атрибутом, чтобы можно было искать
    и по деньгам, и по часам, не пересобирая граф.
    """
    graph: nx.DiGraph[str] = nx.DiGraph()
    graph.add_node(origin.name, lat=origin.lat, lon=origin.lon)
    for reach in reaches:
        graph.add_node(reach.city.name, lat=reach.city.lat, lon=reach.city.lon)
        if reach.direct is not None:
            graph.add_edge(
                origin.name,
                reach.city.name,
                price=reach.direct.price,
                minutes=reach.direct.duration_min,
                transport=reach.direct.transport,
            )
        if reach.via is not None and reach.connection is not None:
            first, second = reach.connection.first, reach.connection.second
            graph.add_edge(
                origin.name,
                reach.via.name,
                price=first.price,
                minutes=first.duration_min,
                transport=first.transport,
            )
            graph.add_edge(
                reach.via.name,
                reach.city.name,
                price=second.price,
                minutes=second.duration_min,
                transport=second.transport,
            )
    return graph


def cheapest_paths(graph: nx.DiGraph[str], origin: str) -> dict[str, tuple[int, list[str]]]:
    """Дейкстра по цене: минимальная стоимость и маршрут до каждого достижимого города."""
    # Без параметра target networkx возвращает пару словарей, но в стабах это union.
    lengths, paths = nx.single_source_dijkstra(graph, origin, weight="price")
    costs = cast(dict[str, float], lengths)
    routes = cast(dict[str, list[str]], paths)
    return {city: (round(cost), routes[city]) for city, cost in costs.items() if city != origin}


async def add_return_trips(
    mcp: TutuMCP,
    origin: City,
    when: dt.date,
    reaches: list[Reach],
    *,
    stay_min: int = 1,
    stay_max: int = 3,
    modes: tuple[str, ...] = ALL_MODES,
    adults: int = 1,
    top: int = 30,
    max_dates: int = 3,
) -> list[Reach]:
    """Подбирает обратный билет в окне «сколько дней я готов там пробыть».

    Наша аудитория ждёт выгодного момента, а не выбирает дату заранее: поэтому
    обратный билет ищется не на конкретный день, а по всему окну, и берётся
    самый дешёвый. Считаем только для ``top`` самых доступных городов — обратный
    веер по всем восьмидесяти не укладывается ни во время, ни в лимиты MCP.
    """
    stay_min, stay_max = max(1, stay_min), max(1, stay_max)
    if stay_max < stay_min:
        stay_min, stay_max = stay_max, stay_min

    span = list(range(stay_min, stay_max + 1))
    # Окно может быть широким, но каждый лишний день — это ещё один веер запросов.
    if len(span) > max_dates:
        step = (len(span) - 1) / (max_dates - 1) if max_dates > 1 else 0
        span = sorted({span[round(index * step)] for index in range(max_dates)})

    candidates = [reach for reach in reaches if reach.best_price is not None]
    candidates.sort(key=lambda reach: reach.best_price or 0)
    candidates = candidates[:top]

    async def one(reach: Reach) -> None:
        best: tuple[Variant, dt.date] | None = None
        for days in span:
            back_day = when + dt.timedelta(days=days)
            variants, _, _, _, _ = await _search_pair(
                mcp, reach.city.name, origin.name, back_day, modes, None, adults=adults
            )
            if not variants:
                continue
            cheapest = min(variants, key=lambda variant: variant.price)
            if best is None or cheapest.price < best[0].price:
                best = (cheapest, back_day)
        if best is not None:
            reach.back, reach.back_date = best

    await asyncio.gather(*(one(reach) for reach in candidates))
    return reaches
