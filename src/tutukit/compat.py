"""Адаптеры под расхождения между инструкциями MCP Туту и реальными схемами.

Каждое правило получено экспериментом 2026-08-17, подробности в MCP_RECON.md.
Смысл модуля: вызывающий код пишет так, как написано в инструкциях сервера,
а мы молча приводим аргументы к тому, что сервер реально принимает.
"""

from __future__ import annotations

from typing import Any

HOTELS_PRODUCT_TYPE = "hotels"  # не "hotel" — сервер отвергает
SEATMAP_TASKS = frozenset({"far_from_wc", "female", "summary", "together"})

# search_* принимают только adults/children/infants; passengers_* — поля checkout_ref
_PASSENGER_ALIASES = {
    "passengers_full": "adults",
    "passengers_adult": "adults",
    "passengers_child": "children",
    "passengers_infant": "infants",
}

# Пассажирские поля у каждого поиска СВОИ (замерено по схемам tools/list):
# avia — adults/children/infants, bus — adults/children, hotels — adults/children_ages,
# multitransport — adults, rail — только суммарный `passengers`, etrain — вообще ничего.
# Пишем везде adults/children/infants, а сюда приводим.
_SEARCH_PAX: dict[str, dict[str, str]] = {
    "search_avia": {"adults": "adults", "children": "children", "infants": "infants"},
    "search_bus": {"adults": "adults", "children": "children"},
    "search_hotels": {"adults": "adults"},
    "search_multitransport": {"adults": "adults"},
    "search_rail": {"adults": "passengers", "children": "passengers"},
    "search_etrain": {},
}

# transport из оффера -> product_type для get_offer_details
_TRANSPORT_TO_PRODUCT = {
    "railway": "railway",
    "rail": "rail",
    "avia": "avia",
    "bus": "bus",
    "etrain": "etrain",
}


def _fix_passengers(tool: str, args: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """adults/children/infants -> поля, которые понимает конкретный поиск."""
    mapping = _SEARCH_PAX.get(tool)
    if mapping is None:
        return args, []
    a = dict(args)
    notes: list[str] = []
    for key in ("adults", "children", "infants"):
        if key not in a:
            continue
        value = a.pop(key)
        target = mapping.get(key)
        if target is None:
            notes.append(f"{key} отброшен: {tool} не принимает пассажиров")
            continue
        if target != key:
            notes.append(f"{key} -> {target} ({tool})")
        a[target] = a.get(target, 0) + value if target in a else value
    return a, notes


def normalize(tool: str, args: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Чинит известные грабли в аргументах. Возвращает (аргументы, заметки)."""
    a = dict(args)
    notes: list[str] = []

    if tool.startswith("search_"):
        for src, dst in _PASSENGER_ALIASES.items():
            if src in a:
                a[dst] = a.pop(src)
                notes.append(f"{src} -> {dst} (поиск не принимает passengers_*)")
        a, pax_notes = _fix_passengers(tool, a)
        notes += pax_notes

    if tool == "create_checkout_link":
        # инструкции сервера говорят «передай checkout_ref», но схема плоская
        ref = a.pop("checkout_ref", None)
        if isinstance(ref, dict):
            a = {**ref, **a}
            notes.append("checkout_ref развёрнут в плоские аргументы")

    if tool == "get_offer_details":
        if a.get("product_type") == "hotel":
            a["product_type"] = HOTELS_PRODUCT_TYPE
            notes.append("product_type: hotel -> hotels")
        if isinstance(a.get("checkout_ref"), dict):
            # checkout_ref здесь бесполезен: нужен details_ref
            a.pop("checkout_ref")
            notes.append("checkout_ref выброшен: get_offer_details требует details_ref")

    if tool == "get_rail_seatmap":
        task = a.get("task")
        if task is not None and task not in SEATMAP_TASKS:
            a.pop("task")
            notes.append(f"task={task!r} выброшен: допустимы только {sorted(SEATMAP_TASKS)}")
        if isinstance(a.get("checkout_ref"), dict):
            a.pop("checkout_ref")
            notes.append("checkout_ref выброшен: get_rail_seatmap требует details_ref")

    return a, notes


def product_type_of(offer: dict[str, Any]) -> str:
    """Product type для get_offer_details по офферу поиска."""
    transport = offer.get("transport") or (offer.get("details_ref") or {}).get("transport")
    if transport in _TRANSPORT_TO_PRODUCT:
        return _TRANSPORT_TO_PRODUCT[transport]
    if "hotel_id" in offer:
        return HOTELS_PRODUCT_TYPE
    raise ValueError(f"не понял тип оффера: keys={sorted(offer)[:8]}")


def details_args(offer: dict[str, Any], **extra: Any) -> dict[str, Any]:
    """Аргументы get_offer_details из оффера поиска."""
    product = product_type_of(offer)
    if product == HOTELS_PRODUCT_TYPE:
        args = {
            "product_type": HOTELS_PRODUCT_TYPE,
            "hotel_id": offer["hotel_id"],
            "hotel_geo_id": offer.get("hotel_geo_id"),
        }
    else:
        ref = offer.get("details_ref")
        if not isinstance(ref, dict):
            raise ValueError("в оффере нет details_ref")
        args = {"product_type": product, "details_ref": ref}
    return args | extra


def checkout_args(offer: dict[str, Any], **overrides: Any) -> dict[str, Any]:
    """Аргументы create_checkout_link: checkout_ref разворачивается плоско.

    `overrides` — для выбора не самого дешёвого тарифа (offer_hash, service_class)
    или мест (car_number, seat_numbers).
    """
    ref = offer.get("checkout_ref")
    if ref is None:
        raise ValueError("в оффере нет checkout_ref")
    if not isinstance(ref, dict):
        raise TypeError(f"checkout_ref должен быть объектом, а не {type(ref).__name__}")
    return dict(ref) | overrides


def seatmap_args(offer: dict[str, Any], **extra: Any) -> dict[str, Any]:
    """Аргументы get_rail_seatmap: нужен details_ref, а не checkout_ref."""
    ref = offer.get("details_ref")
    if ref is None:
        raise ValueError("в оффере нет details_ref")
    if not isinstance(ref, dict):
        raise TypeError(f"details_ref должен быть объектом, а не {type(ref).__name__}")
    return {"details_ref": ref} | extra
