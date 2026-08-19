"""Расчёт досягаемости: веер запросов и поиск составных маршрутов.

Две фазы, как описано в ADR-0001:

1. **Веер.** Один `search_multitransport` на каждый город-кандидат. Даёт прямую
   цену и время, а заодно `modes_summary` — минимальную цену по каждому виду
   транспорта, из которой работают тумблеры на карте.
2. **Граф.** Для городов, куда прямой маршрут дорогой, пробуем добраться через
   хаб. Хабы отбираются геометрически: крюк через хаб не должен быть длиннее
   прямого пути более чем в ``MAX_DETOUR`` раз, иначе перебор не окупается.

Модуль ничего не знает про HTTP и про формат ответов MCP — за первое отвечает
``travelbroke.api``, за второе ``tutukit``.
"""

from __future__ import annotations

import asyncio
import logging
import math
from dataclasses import dataclass, field
from datetime import date as Date
from typing import Any, cast

import networkx as nx

from travelbroke.cities import City, destinations
from tutukit.client import ToolCallError, TutuError, TutuMCP
from tutukit.diagnose import diagnose

log = logging.getLogger(__name__)

ALL_MODES: tuple[str, ...] = ("avia", "railway", "bus", "etrain")

MAX_DETOUR = 1.35
"""Во сколько раз крюк через хаб может быть длиннее прямого пути по прямой."""

TRANSFER_BUFFER_MIN = 60
"""Минимальный запас между прибытием и отправлением на пересадке, минуты."""

TRANSFER_PENALTY_MIN = 90
"""Штраф ко времени поездки за каждую пересадку — пересадка стоит не только минут."""


@dataclass(frozen=True, slots=True)
class Variant:
    """Один вариант поездки между двумя городами."""

    transport: str
    price: int
    duration_min: int
    transfers: int
    departure_at: str | None = None
    arrival_at: str | None = None
    checkout_url: str | None = None
    route: str | None = None

    @property
    def hours(self) -> float:
        return round(self.duration_min / 60, 1)


@dataclass(slots=True)
class Reach:
    """Итог по одному городу назначения."""

    city: City
    direct: Variant | None = None
    via: City | None = None
    via_legs: tuple[Variant, Variant] | None = None
    by_mode: dict[str, int] = field(default_factory=dict)
    """Минимальная цена по каждому виду транспорта — для тумблеров на клиенте."""
    by_mode_minutes: dict[str, int] = field(default_factory=dict)
    """Минимальное время по каждому виду транспорта, минуты."""
    empty_reason: str | None = None
    empty_message: str | None = None

    @property
    def best_price(self) -> int | None:
        """Цена лучшего из найденных маршрутов: прямого или составного."""
        prices = [v.price for v in (self.direct,) if v is not None]
        if self.via_legs is not None:
            prices.append(sum(leg.price for leg in self.via_legs))
        return min(prices) if prices else None

    @property
    def beats_direct_by(self) -> int | None:
        """Насколько составной маршрут дешевле прямого, если он вообще дешевле."""
        if self.via_legs is None or self.direct is None:
            return None
        saved = self.direct.price - sum(leg.price for leg in self.via_legs)
        return saved if saved > 0 else None


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


def parse_variants(data: dict[str, Any], limit: int = 5) -> list[Variant]:
    """Достаёт из ответа `search_multitransport` то немногое, что нужно карте."""
    variants: list[Variant] = []
    for raw in (data.get("variants") or [])[:limit]:
        price = _to_int_price(raw.get("price"))
        duration = raw.get("duration_min")
        if price is None or not isinstance(duration, int):
            continue
        segments = raw.get("segments_count")
        variants.append(
            Variant(
                transport=str(raw.get("transport") or "unknown"),
                price=price,
                duration_min=duration,
                transfers=max(segments - 1, 0) if isinstance(segments, int) else 0,
                departure_at=raw.get("departure_at"),
                arrival_at=raw.get("arrival_at"),
                checkout_url=raw.get("checkout_url") or raw.get("search_results_url"),
                route=_route_label(raw),
            )
        )
    return variants


def _route_label(raw: dict[str, Any]) -> str | None:
    legs = raw.get("legs")
    if not isinstance(legs, list) or not legs:
        return None
    first = legs[0]
    if not isinstance(first, dict):
        return None
    origin, target = first.get("from"), first.get("to")
    return f"{origin} → {target}" if origin and target else None


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
    when: Date,
    modes: tuple[str, ...],
    price_max: int | None,
) -> tuple[list[Variant], dict[str, int], dict[str, int], str | None, str | None]:
    """Один поиск между парой городов. Ошибку инструмента считаем пустым результатом."""
    args: dict[str, Any] = {
        "origin": origin,
        "destination": target,
        "departure_date": when.isoformat(),
        "optimize_for": "price",
        "view": "compact",
    }
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
    when: Date,
    *,
    modes: tuple[str, ...] = ALL_MODES,
    price_max: int | None = None,
    limit: int | None = None,
) -> list[Reach]:
    """Фаза 1: прямая досягаемость каждого города-кандидата из точки отправления."""
    targets = destinations(origin, limit)

    async def one(target: City) -> Reach:
        variants, by_mode, by_minutes, reason, message = await _search_pair(
            mcp, origin.name, target.name, when, modes, price_max
        )
        cheapest = min(variants, key=lambda v: v.price) if variants else None
        return Reach(
            city=target,
            direct=cheapest,
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
        if reach.via is not None and reach.via_legs is not None:
            first, second = reach.via_legs
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


async def deepen(
    mcp: TutuMCP,
    origin: City,
    when: Date,
    reaches: list[Reach],
    hubs: tuple[City, ...],
    *,
    modes: tuple[str, ...] = ALL_MODES,
    top_expensive: int = 20,
    hubs_per_city: int = 2,
) -> list[Reach]:
    """Фаза 2: ищет составные маршруты туда, где прямой вариант дорогой или отсутствует.

    Работает поверх результатов веера и правит их на месте. Считается только для
    ``top_expensive`` худших городов и не более чем через ``hubs_per_city`` хабов
    на город — иначе число запросов растёт быстрее, чем польза.
    """
    ranked = sorted(
        reaches,
        key=lambda r: (r.best_price is not None, r.best_price or 0),
        reverse=True,
    )[:top_expensive]

    # Плечо «отправление → хаб» одно и то же для всех городов, считаем его один раз.
    leg_cache: dict[str, Variant | None] = {}

    async def leg(a: str, b: str) -> Variant | None:
        key = f"{a}→{b}"
        if key not in leg_cache:
            variants, _, _, _, _ = await _search_pair(mcp, a, b, when, modes, None)
            leg_cache[key] = min(variants, key=lambda v: v.price) if variants else None
        return leg_cache[key]

    async def one(reach: Reach) -> None:
        for hub in hub_candidates(origin, reach.city, hubs)[:hubs_per_city]:
            first = await leg(origin.name, hub.name)
            if first is None:
                continue
            second = await leg(hub.name, reach.city.name)
            if second is None:
                continue
            total = first.price + second.price
            if reach.best_price is not None and total >= reach.best_price:
                continue
            reach.via = hub
            reach.via_legs = (first, second)

    await asyncio.gather(*(one(reach) for reach in ranked))
    return reaches
