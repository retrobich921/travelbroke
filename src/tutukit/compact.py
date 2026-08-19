"""Ужимание ответов MCP до размера, который не стыдно отдать в LLM или в UI.

Замеры: `search_avia page_size=30` — 160 КБ, отель с `view=rules` — 167 КБ.
Это ~40k токенов на один поиск. Тяжёлое (`details_ref`, `checkout_ref`, сырые
сегменты, тарифные хэши) уходит в side-индекс `refs` и достаётся по `offer_id`,
когда пользователь реально выбрал вариант.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

LIST_KEYS = ("offers", "hotels", "variants", "results")


@dataclass(slots=True)
class Compacted:
    """Лёгкое представление + индекс тяжёлых ссылок."""

    view: dict[str, Any]
    refs: dict[str, dict[str, Any]] = field(default_factory=dict)
    before_b: int = 0
    after_b: int = 0

    @property
    def ratio(self) -> float:
        return self.after_b / self.before_b if self.before_b else 1.0

    def summary(self) -> str:
        return f"{self.before_b // 1024} КБ -> {self.after_b // 1024} КБ ({self.ratio:.0%})"


def _size(obj: Any) -> int:
    return len(json.dumps(obj, ensure_ascii=False).encode())


def _money(price: Any) -> str | None:
    if not isinstance(price, dict):
        return None
    amount = price.get("amount")
    if amount is None:
        return None
    # цену не округляем: сервер требует отдавать как есть
    return f"{amount} {price.get('currency', '')}".strip()


def _route(offer: dict[str, Any]) -> str | None:
    legs = offer.get("legs") or []
    if not legs:
        return None
    first, last = legs[0], legs[-1]
    src, dst = first.get("from"), last.get("to")
    return f"{src} → {dst}" if src and dst else None


def _transport_offer(offer: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": offer.get("offer_id"),
        "transport": offer.get("transport"),
        "price": _money(offer.get("price")),
        "departure_at": offer.get("departure_at"),
        "arrival_at": offer.get("arrival_at"),
        "duration_min": offer.get("duration_min"),
        "carriers": offer.get("carriers"),
        "route": _route(offer),
    }
    segments = offer.get("segments_count")
    if isinstance(segments, int):
        out["transfers"] = max(segments - 1, 0)
    rating = (offer.get("review_summary") or {}).get("rating")
    if rating is not None:
        out["rating"] = rating
    fares = offer.get("fares")
    if isinstance(fares, dict):  # рельсы: сводка по классам вагонов
        out["fares"] = {
            k: fares.get(k)
            for k in ("count", "price_from", "price_to", "seat_categories")
            if fares.get(k) is not None
        }
    if isinstance(offer.get("variants"), list):  # авиа/автобус/электрички
        out["fare_options"] = len(offer["variants"])
    if offer.get("search_results_url"):
        out["search_url"] = offer["search_results_url"]
    return {k: v for k, v in out.items() if v is not None}


def _hotel(hotel: dict[str, Any]) -> dict[str, Any]:
    best = hotel.get("best_offer") or {}
    out = {
        "id": hotel.get("hotel_id"),
        "name": hotel.get("name"),
        "stars": hotel.get("stars"),
        "rating": hotel.get("rating"),
        "reviews": hotel.get("review_count"),
        "address": hotel.get("address"),
        "room": best.get("room_name"),
        # цена уже за весь период и состав гостей — не умножать на ночи
        "price_stay_total": _money(best.get("price")),
        "free_cancellation": best.get("free_cancellation"),
        "breakfast": best.get("breakfast_included"),
    }
    return {k: v for k, v in out.items() if v is not None}


def _refs_of(item: dict[str, Any]) -> dict[str, Any]:
    keep = {k: item[k] for k in ("details_ref", "checkout_ref") if k in item}
    for k in ("transport", "hotel_id", "hotel_geo_id"):
        if k in item:
            keep[k] = item[k]
    return keep


def _meta(meta: Any) -> dict[str, Any]:
    if not isinstance(meta, dict):
        return {}
    out: dict[str, Any] = {}
    for side in ("from", "to", "resolved_geo"):
        val = meta.get(side)
        if isinstance(val, dict):
            out[side] = {k: val[k] for k in ("name", "geo_id", "region", "also_named") if k in val}
    for key in ("total_matched", "has_more", "page", "page_size"):
        if key in meta:
            out[key] = meta[key]
    carriers = meta.get("carriers_available")
    if isinstance(carriers, list) and carriers:
        # нужны только имена: фильтровать можно лишь строкой отсюда
        out["carriers_available"] = [c.get("name") for c in carriers[:12] if isinstance(c, dict)]
    return out


def compact_search(data: dict[str, Any], limit: int = 5) -> Compacted:
    """Ответ любого `search_*` -> компактный вид + индекс refs по id."""
    before = _size(data)
    key = next((k for k in LIST_KEYS if isinstance(data.get(k), list)), None)
    if key is None:
        return Compacted(view=data, before_b=before, after_b=before)

    items = data[key][:limit]
    refs: dict[str, dict[str, Any]] = {}
    rows: list[dict[str, Any]] = []
    for item in items:
        is_hotel = "hotel_id" in item
        row = _hotel(item) if is_hotel else _transport_offer(item)
        ident = row.get("id")
        if ident is not None:
            refs[str(ident)] = _refs_of(item)
        rows.append(row)

    view: dict[str, Any] = {key: rows}
    meta = _meta(data.get("meta"))
    if meta:
        view["meta"] = meta
    if len(data[key]) > limit:
        view["shown"] = f"{limit} из {len(data[key])} на странице"

    return Compacted(view=view, refs=refs, before_b=before, after_b=_size(view))
