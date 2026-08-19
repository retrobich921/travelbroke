"""Разведка MCP-сервера Туту: что реально отдают инструменты, где дыры, как долго.

Запуск:  python probe.py
Сырые ответы падают в raw/, в stdout — компактная сводка.
"""

from __future__ import annotations

import json
import pathlib
import time
import urllib.error
import urllib.request
from typing import Any

URL = "https://mcp.tutu.ru/mcp"
RAW = pathlib.Path(__file__).parent / "raw"
TIMEOUT = 90

_id = 0


def rpc(method: str, params: dict[str, Any] | None = None) -> tuple[Any, float]:
    """Один JSON-RPC вызов. Возвращает (payload, elapsed_sec)."""
    global _id
    _id += 1
    body = json.dumps(
        {"jsonrpc": "2.0", "id": _id, "method": method, "params": params or {}}
    ).encode()
    req = urllib.request.Request(
        URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        },
    )
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            text = resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return {"_http_error": e.code, "_body": e.read().decode("utf-8", "replace")[:2000]}, time.perf_counter() - t0
    except Exception as e:  # таймаут, обрыв
        return {"_transport_error": repr(e)}, time.perf_counter() - t0
    dt = time.perf_counter() - t0

    # streamable http может ответить SSE-кадрами
    if text.lstrip().startswith("event:") or text.lstrip().startswith("data:"):
        chunks = [
            ln[len("data:") :].strip()
            for ln in text.splitlines()
            if ln.startswith("data:")
        ]
        text = chunks[-1] if chunks else text
    try:
        return json.loads(text), dt
    except json.JSONDecodeError:
        return {"_unparsed": text[:2000]}, dt


def call_tool(name: str, args: dict[str, Any]) -> tuple[Any, float, int]:
    """tools/call + распаковка content[0].text в объект. Возвращает (data, sec, bytes)."""
    payload, dt = rpc("tools/call", {"name": name, "arguments": args})
    size = len(json.dumps(payload, ensure_ascii=False))
    if "error" in payload:
        return {"_rpc_error": payload["error"]}, dt, size
    result = payload.get("result", {})
    if result.get("isError"):
        txt = (result.get("content") or [{}])[0].get("text", "")
        return {"_tool_error": txt[:1500]}, dt, size
    if "structuredContent" in result:
        return result["structuredContent"], dt, size
    blocks = result.get("content") or []
    if blocks and blocks[0].get("type") == "text":
        raw = blocks[0]["text"]
        try:
            return json.loads(raw), dt, size
        except json.JSONDecodeError:
            return {"_text": raw}, dt, size
    return result, dt, size


def shape(data: Any) -> str:
    """Однострочное описание того, что вернулось."""
    if not isinstance(data, dict):
        return f"{type(data).__name__}"
    for key in ("_rpc_error", "_tool_error", "_transport_error", "_http_error", "_unparsed"):
        if key in data:
            return f"{key}: {str(data[key])[:160]}"
    bits = []
    for k in ("offers", "hotels", "results", "variants", "items"):
        if isinstance(data.get(k), list):
            bits.append(f"{k}={len(data[k])}")
    meta = data.get("meta")
    if isinstance(meta, dict):
        if "total_matched" in meta:
            bits.append(f"total={meta['total_matched']}")
        if "has_more" in meta:
            bits.append(f"more={meta['has_more']}")
        for side in ("from", "to", "resolved_geo"):
            v = meta.get(side)
            if isinstance(v, dict):
                bits.append(f"{side}={v.get('name')}/{v.get('geo_id')}")
    if not bits:
        bits.append("keys=" + ",".join(list(data)[:8]))
    return " ".join(bits)


PROBES: list[tuple[str, str, dict[str, Any]]] = [
    # --- базовые поиски по каждому виду транспорта ---
    ("avia: Мск→Сочи", "search_avia",
     {"origin": "Москва", "destination": "Сочи", "departure_date": "2026-09-01", "passengers_full": 1}),
    ("rail: Мск→Питер", "search_rail",
     {"origin": "Москва", "destination": "Санкт-Петербург", "departure_date": "2026-09-01"}),
    ("bus: Мск→Тула", "search_bus",
     {"origin": "Москва", "destination": "Тула", "departure_date": "2026-09-01"}),
    ("etrain: Мск→Одинцово", "search_etrain",
     {"origin": "Москва", "destination": "Одинцово", "departure_date": "2026-09-01"}),
    ("hotels: Сочи 2 ночи", "search_hotels",
     {"city_name": "Сочи", "checkin_date": "2026-09-01", "checkout_date": "2026-09-03", "adults": 2}),
    ("multi: Мск→Казань", "search_multitransport",
     {"origin": "Москва", "destination": "Казань", "departure_date": "2026-09-01", "optimize_for": "price"}),

    # --- нагрузка/объём ---
    ("multi: время вместо цены", "search_multitransport",
     {"origin": "Москва", "destination": "Казань", "departure_date": "2026-09-01", "optimize_for": "time"}),
    ("avia: page_size=30", "search_avia",
     {"origin": "Москва", "destination": "Сочи", "departure_date": "2026-09-01", "page_size": 30}),
    ("avia: view=full", "search_avia",
     {"origin": "Москва", "destination": "Сочи", "departure_date": "2026-09-01", "view": "full", "page_size": 3}),

    # --- фильтры ---
    ("avia: direct_only+price_max", "search_avia",
     {"origin": "Москва", "destination": "Сочи", "departure_date": "2026-09-01",
      "direct_only": True, "price_max": 8000}),

    # --- граничные случаи: тут ищем дыры ---
    ("edge: город-омоним Ростов", "search_rail",
     {"origin": "Москва", "destination": "Ростов", "departure_date": "2026-09-01"}),
    ("edge: сленг Питер→Мск", "search_rail",
     {"origin": "Питер", "destination": "Мск", "departure_date": "2026-09-01"}),
    ("edge: несуществующий город", "search_rail",
     {"origin": "Москва", "destination": "Кукуево-Задрищенск", "departure_date": "2026-09-01"}),
    ("edge: дата в прошлом", "search_avia",
     {"origin": "Москва", "destination": "Сочи", "departure_date": "2020-01-01"}),
    ("edge: дата +11 месяцев", "search_avia",
     {"origin": "Москва", "destination": "Сочи", "departure_date": "2027-07-15"}),
    ("edge: заграница Мск→Стамбул", "search_avia",
     {"origin": "Москва", "destination": "Стамбул", "departure_date": "2026-09-01"}),
    ("edge: глухой маршрут автобус", "search_bus",
     {"origin": "Норильск", "destination": "Анадырь", "departure_date": "2026-09-01"}),
    ("edge: отель на сегодня", "search_hotels",
     {"city_name": "Москва", "checkin_date": "2026-08-17", "checkout_date": "2026-08-18", "adults": 1}),

    # --- ресурсы ---
    ("res: tutu://status", "fetch_resource", {"uri": "tutu://status"}),
    ("res: tutu://help/overview", "fetch_resource", {"uri": "tutu://help/overview"}),
    ("res: tutu://special-offers", "fetch_resource", {"uri": "tutu://special-offers"}),
]


def main() -> None:
    RAW.mkdir(exist_ok=True)
    rows: list[tuple[str, float, int, str]] = []

    # схемы инструментов сохраняем целиком — понадобятся как справочник
    schemas, dt = rpc("tools/list")
    (RAW / "tools.json").write_text(
        json.dumps(schemas, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    tools = schemas.get("result", {}).get("tools", [])
    print(f"tools/list: {len(tools)} инструментов, {dt:.2f}s\n")

    for i, (label, tool, args) in enumerate(PROBES):
        data, dt, size = call_tool(tool, args)
        (RAW / f"{i:02d}_{tool}.json").write_text(
            json.dumps({"args": args, "data": data}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        rows.append((label, dt, size, shape(data)))
        print(f"{dt:6.2f}s {size:>7}b  {label:<28} {shape(data)}", flush=True)

    print("\n--- второй заход: детали по найденному офферу ---")
    rail = json.loads((RAW / "01_search_rail.json").read_text(encoding="utf-8"))["data"]
    offers = rail.get("offers") or []
    if offers:
        ref = offers[0].get("checkout_ref")
        (RAW / "ref_rail.json").write_text(
            json.dumps(offers[0], ensure_ascii=False, indent=2), encoding="utf-8"
        )
        for label, tool, args in [
            ("details: rail offer", "get_offer_details", {"checkout_ref": ref}),
            ("seatmap: rail", "get_rail_seatmap", {"checkout_ref": ref}),
            ("checkout: rail", "create_checkout_link", {"checkout_ref": ref}),
        ]:
            data, dt, size = call_tool(tool, args)
            (RAW / f"x_{tool}.json").write_text(
                json.dumps({"args": args, "data": data}, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            print(f"{dt:6.2f}s {size:>7}b  {label:<28} {shape(data)}", flush=True)
    else:
        print("rail-офферов нет, второй заход пропущен")

    slow = sorted(rows, key=lambda r: -r[1])[:3]
    print("\nсамые медленные:", ", ".join(f"{r[0]} {r[1]:.1f}s" for r in slow))
    heavy = sorted(rows, key=lambda r: -r[2])[:3]
    print("самые жирные:   ", ", ".join(f"{r[0]} {r[2] // 1024}KB" for r in heavy))


if __name__ == "__main__":
    main()
