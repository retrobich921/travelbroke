"""Смоук-проверка обвязки: `uv run python -m tutukit rail Москва Питер 2026-09-01`.

Печатает компактный результат, диагноз пустого ответа и статистику вызовов.
Флаг `--replay` играет записанные ответы из кэша — так проверяется демо без сети.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
from pathlib import Path

from .cache import DiskCache
from .client import ToolCallError, TutuMCP
from .compact import compact_search
from .diagnose import diagnose

MODES = ("avia", "rail", "bus", "etrain", "hotels", "multitransport")
CACHE_DIR = Path(__file__).resolve().parents[2] / ".mcp_cache"


async def run(args: argparse.Namespace) -> int:
    """Выполняет один поиск через MCP и печатает разбор ответа.

    Смоук-проверка: поднимает ли сервер Туту нужный инструмент, что он отдаёт
    и как это классифицирует `diagnose`. Печать идёт в stdout — это CLI.
    """
    tool = f"search_{args.mode}"
    if args.mode == "hotels":
        params = {
            "city_name": args.origin,
            "checkin_date": args.date,
            "checkout_date": args.date_out or args.date,
            "adults": args.adults,
        }
    else:
        params = {
            "origin": args.origin,
            "destination": args.destination,
            "departure_date": args.date,
            "adults": args.adults,
        }

    cache = DiskCache(CACHE_DIR, mode="replay" if args.replay else "record")
    async with TutuMCP(cache=cache) as mcp:
        try:
            data = await mcp.call(tool, **params)
        except ToolCallError as e:
            print(f"инструмент отказал: {e.message.splitlines()[0]}")
            return 1

        verdict = diagnose(tool, params, data)
        small = compact_search(data, limit=args.limit)

        print(json.dumps(small.view, ensure_ascii=False, indent=2))
        print(f"\nсжатие: {small.summary()}, refs в индексе: {len(small.refs)}")
        print(f"диагноз: {verdict.reason} — {verdict.message}")
        if verdict.hint:
            print(f"подсказка: {verdict.hint}")
        if verdict.ambiguity:
            print(f"неоднозначность: {verdict.ambiguity}")
        print(f"вызовы: {mcp.report()}")
    return 0


def main() -> int:
    """Точка входа `python -m tutukit`: разбирает аргументы и запускает `run`."""
    p = argparse.ArgumentParser(prog="tutukit", description="смоук-проверка MCP Туту")
    p.add_argument("mode", choices=MODES)
    p.add_argument("origin")
    p.add_argument("destination", nargs="?", default="")
    p.add_argument("date")
    p.add_argument("--date-out", help="дата выезда для отелей")
    p.add_argument("--adults", type=int, default=1)
    p.add_argument("--limit", type=int, default=5)
    p.add_argument("--replay", action="store_true", help="только кэш, без сети")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.WARNING,
        format="%(levelname)s %(name)s: %(message)s",
    )
    return asyncio.run(run(args))


if __name__ == "__main__":
    raise SystemExit(main())
