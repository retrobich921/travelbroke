"""Прогрев кэша: заранее выкачивает популярные направления и даты.

Зачем: холодный расчёт карты — это 40–70 обращений к `mcp.tutu.ru`, то есть
десятки секунд ожидания. Прогретый кэш отдаёт ту же карту мгновенно и делает
демонстрацию независимой от того, жив ли сервер Туту в этот момент.

Запуск::

    uv run python -m travelbroke.warm
    uv run python -m travelbroke.warm --origins Москва Санкт-Петербург --weeks 4 --deep
"""

from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import time
from pathlib import Path

from travelbroke import cities, reach
from tutukit.cache import DiskCache
from tutukit.client import TutuMCP

DEFAULT_ORIGINS = ("Москва", "Санкт-Петербург")


def upcoming_saturdays(count: int, *, today: dt.date | None = None) -> list[dt.date]:
    """Ближайшие субботы — самая частая дата короткой поездки."""
    day = today or dt.date.today()
    first = day + dt.timedelta(days=(5 - day.weekday()) % 7 or 7)
    return [first + dt.timedelta(weeks=week) for week in range(count)]


async def warm(
    origins: tuple[str, ...],
    dates: list[dt.date],
    *,
    deep: bool = False,
    cache_dir: Path = Path(".mcp_cache"),
    ttl_s: float = 7 * 24 * 3600,
) -> None:
    """Проходит все пары «город отправления × дата» и складывает ответы в кэш."""
    cache = DiskCache(root=cache_dir, ttl_s=ttl_s)
    async with TutuMCP(cache=cache, concurrency=8) as mcp:
        for name in origins:
            origin = cities.resolve(name)
            if origin is None:
                print(f"[warm] {name}: нет в справочнике, пропускаю")
                continue
            for when in dates:
                started = time.perf_counter()
                before = len(mcp.stats)
                results = await reach.fan_out(mcp, origin, when)
                if deep:
                    results = await reach.deepen(mcp, origin, when, results, cities.HUBS)
                calls = mcp.stats[before:]
                found = sum(1 for item in results if item.best_price is not None)
                hidden = sum(1 for item in results if item.beats_direct_by)
                print(
                    f"[warm] {origin.name} → {when}: "
                    f"{found}/{len(results)} городов, "
                    f"скрытых пересадок {hidden}, "
                    f"{len(calls)} вызовов ({sum(1 for c in calls if c.cached)} из кэша), "
                    f"{time.perf_counter() - started:.1f} с",
                    flush=True,
                )


def main() -> None:
    """Точка входа CLI."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origins", nargs="+", default=list(DEFAULT_ORIGINS))
    parser.add_argument("--weeks", type=int, default=3, help="сколько ближайших суббот прогреть")
    parser.add_argument("--deep", action="store_true", help="прогреть и составные маршруты")
    parser.add_argument("--cache-dir", type=Path, default=Path(".mcp_cache"))
    args = parser.parse_args()

    asyncio.run(
        warm(
            tuple(args.origins),
            upcoming_saturdays(args.weeks),
            deep=args.deep,
            cache_dir=args.cache_dir,
        )
    )


if __name__ == "__main__":
    main()
