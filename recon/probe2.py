"""Второй заход: правильные сигнатуры + проверка сервера под параллельной нагрузкой."""

from __future__ import annotations

import json
import pathlib
import statistics
import time
from concurrent.futures import ThreadPoolExecutor

from probe import RAW, call_tool

OUT = pathlib.Path(__file__).parent / "raw"


def dump(name: str, obj: object) -> None:
    (OUT / f"y_{name}.json").write_text(
        json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def show(label: str, data: object, dt: float, size: int) -> None:
    from probe import shape

    print(f"{dt:6.2f}s {size:>7}b  {label:<30} {shape(data)}", flush=True)


def main() -> None:
    rail_offer = json.loads((RAW / "ref_rail.json").read_text(encoding="utf-8"))
    hotels = json.loads((RAW / "04_search_hotels.json").read_text(encoding="utf-8"))["data"]
    hotel = hotels["hotels"][0]

    print("--- исправленные сигнатуры ---")

    # avia: adults, а не passengers_full
    data, dt, size = call_tool(
        "search_avia",
        {"origin": "Москва", "destination": "Сочи", "departure_date": "2026-09-01", "adults": 1},
    )
    dump("avia_adults", data)
    show("avia c adults=1", data, dt, size)
    avia_offer = (data.get("offers") or [{}])[0]

    # rail details: product_type + details_ref
    data, dt, size = call_tool(
        "get_offer_details",
        {"product_type": "rail", "details_ref": rail_offer["details_ref"]},
    )
    dump("rail_details", data)
    show("get_offer_details rail", data, dt, size)

    data, dt, size = call_tool(
        "get_rail_seatmap", {"details_ref": rail_offer["details_ref"]}
    )
    dump("rail_seatmap", data)
    show("get_rail_seatmap", data, dt, size)

    # seatmap с вопросом-задачей
    data, dt, size = call_tool(
        "get_rail_seatmap",
        {"details_ref": rail_offer["details_ref"], "task": "лучшие нижние места подальше от туалета"},
    )
    dump("rail_seatmap_task", data)
    show("seatmap с task=", data, dt, size)

    # checkout: checkout_ref РАЗВОРАЧИВАЕТСЯ в аргументы, а не передаётся объектом
    data, dt, size = call_tool("create_checkout_link", dict(rail_offer["checkout_ref"]))
    dump("rail_checkout", data)
    show("checkout rail (spread)", data, dt, size)

    if avia_offer.get("checkout_ref"):
        data, dt, size = call_tool("create_checkout_link", dict(avia_offer["checkout_ref"]))
        dump("avia_checkout", data)
        show("checkout avia (spread)", data, dt, size)

    if hotel.get("checkout_ref"):
        data, dt, size = call_tool("create_checkout_link", dict(hotel["checkout_ref"]))
        dump("hotel_checkout", data)
        show("checkout hotel (spread)", data, dt, size)

    data, dt, size = call_tool(
        "get_offer_details",
        {
            "product_type": "hotel",
            "hotel_id": hotel["hotel_id"],
            "hotel_geo_id": hotel.get("hotel_geo_id"),
            "check_in": "2026-09-01",
            "check_out": "2026-09-03",
            "adults": 2,
        },
    )
    dump("hotel_details", data)
    show("get_offer_details hotel", data, dt, size)

    # правила отмены — отдельный view
    data, dt, size = call_tool(
        "get_offer_details",
        {
            "product_type": "hotel",
            "hotel_id": hotel["hotel_id"],
            "hotel_geo_id": hotel.get("hotel_geo_id"),
            "check_in": "2026-09-01",
            "check_out": "2026-09-03",
            "adults": 2,
            "view": "rules",
        },
    )
    dump("hotel_rules", data)
    show("hotel view=rules", data, dt, size)

    print("\n--- параллельная нагрузка: 8 запросов разом ---")
    routes = [
        ("Москва", "Казань"), ("Москва", "Сочи"), ("Санкт-Петербург", "Мурманск"),
        ("Екатеринбург", "Тюмень"), ("Новосибирск", "Омск"), ("Казань", "Самара"),
        ("Ростов-на-Дону", "Краснодар"), ("Уфа", "Пермь"),
    ]

    def one(pair: tuple[str, str]) -> tuple[str, float, str]:
        o, d = pair
        data, dt, _ = call_tool(
            "search_multitransport",
            {"origin": o, "destination": d, "departure_date": "2026-09-05"},
        )
        bad = next(
            (k for k in ("_tool_error", "_rpc_error", "_transport_error", "_http_error") if k in data),
            "",
        )
        return f"{o}→{d}", dt, bad or "ok"

    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(one, routes))
    wall = time.perf_counter() - t0

    for name, dt, status in results:
        print(f"{dt:6.2f}s  {name:<28} {status[:80]}")
    lat = [r[1] for r in results]
    print(
        f"\nwall={wall:.1f}s  медиана={statistics.median(lat):.1f}s  "
        f"макс={max(lat):.1f}s  ошибок={sum(1 for r in results if r[2] != 'ok')}/8"
    )


if __name__ == "__main__":
    main()
