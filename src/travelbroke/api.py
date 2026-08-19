"""HTTP-слой TravelBroke.

Тонкий фасад: валидирует запрос, отдаёт работу доменному слою
``travelbroke.reach`` и возвращает компактный JSON. Бизнес-логики здесь нет.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from datetime import date as Date
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from travelbroke import __version__, cities, reach
from tutukit.cache import CacheMode, DiskCache
from tutukit.client import TutuMCP

TransportMode = Literal["avia", "railway", "bus", "etrain"]

CACHE_DIR = Path(os.environ.get("TB_CACHE_DIR", ".mcp_cache"))
CACHE_MODE: CacheMode = os.environ.get("TB_CACHE_MODE", "record")  # type: ignore[assignment]
STATIC_DIR = Path(__file__).resolve().parents[2] / "static"


@asynccontextmanager
async def lifespan(app: FastAPI) -> Any:
    """Один клиент MCP на всё приложение: соединения и кэш переживают запросы."""
    cache = DiskCache(root=CACHE_DIR, mode=CACHE_MODE)
    async with TutuMCP(cache=cache, concurrency=8) as mcp:
        app.state.mcp = mcp
        yield


app = FastAPI(
    title="TravelBroke API",
    version=__version__,
    description=(
        "Куда можно уехать из точки за заданный бюджет и время. "
        "Считает не только прямые маршруты, но и составные — они часто дешевле."
    ),
    lifespan=lifespan,
)


class CityOut(BaseModel):
    """Город из справочника."""

    slug: str
    name: str
    lat: float
    lon: float
    hub: bool


class VariantOut(BaseModel):
    """Один сегмент или целый маршрут."""

    transport: str
    price: int
    hours: float
    transfers: int
    departure_at: str | None = None
    arrival_at: str | None = None
    checkout_url: str | None = None
    route: str | None = None


class ReachOut(BaseModel):
    """Достижимость одного города."""

    slug: str
    name: str
    lat: float
    lon: float
    price: int | None = Field(default=None, description="Лучшая найденная цена, ₽")
    hours: float | None = None
    direct: VariantOut | None = None
    via: str | None = Field(default=None, description="Город пересадки, если так дешевле")
    via_legs: list[VariantOut] | None = None
    beats_direct_by: int | None = Field(
        default=None, description="Экономия составного маршрута против прямого, ₽"
    )
    by_mode: dict[str, int] = Field(
        default_factory=dict, description="Минимальная цена по каждому виду транспорта"
    )
    empty_reason: str | None = None
    empty_message: str | None = None


class ReachableRequest(BaseModel):
    """Параметры расчёта карты досягаемости."""

    origin: str = Field(default="Москва", description="Город отправления")
    date: Date = Field(description="Дата поездки")
    modes: list[TransportMode] = Field(
        default_factory=lambda: list(reach.ALL_MODES),
        description="Разрешённые виды транспорта",
    )
    price_max: int | None = Field(default=None, gt=0, description="Жёсткий потолок цены, ₽")
    limit: int | None = Field(
        default=None, gt=0, description="Ограничить число городов (для быстрых прогонов)"
    )
    deep: bool = Field(
        default=False, description="Искать составные маршруты через хабы (медленнее)"
    )


class ReachableResponse(BaseModel):
    """Матрица досягаемости целиком — клиент фильтрует её сам, без запросов к серверу."""

    origin: CityOut
    date: Date
    cities: list[ReachOut]
    calls: int = Field(description="Сколько вызовов MCP потребовалось")
    cached: int = Field(description="Из них отдано кэшем")


class Health(BaseModel):
    """Ответ health-check."""

    status: Literal["ok", "degraded"]
    version: str
    cities: int


def _variant_out(variant: reach.Variant) -> VariantOut:
    return VariantOut(
        transport=variant.transport,
        price=variant.price,
        hours=variant.hours,
        transfers=variant.transfers,
        departure_at=variant.departure_at,
        arrival_at=variant.arrival_at,
        checkout_url=variant.checkout_url,
        route=variant.route,
    )


def _reach_out(item: reach.Reach) -> ReachOut:
    legs = item.via_legs
    total_hours = None
    if item.direct is not None:
        total_hours = item.direct.hours
    if legs is not None:
        via_hours = round(sum(leg.duration_min for leg in legs) / 60, 1)
        if total_hours is None or sum(leg.price for leg in legs) < (item.direct or legs[0]).price:
            total_hours = via_hours
    return ReachOut(
        slug=item.city.slug,
        name=item.city.name,
        lat=item.city.lat,
        lon=item.city.lon,
        price=item.best_price,
        hours=total_hours,
        direct=_variant_out(item.direct) if item.direct else None,
        via=item.via.name if item.via else None,
        via_legs=[_variant_out(leg) for leg in legs] if legs else None,
        beats_direct_by=item.beats_direct_by,
        by_mode=item.by_mode,
        empty_reason=item.empty_reason,
        empty_message=item.empty_message,
    )


@app.get("/api/health", response_model=Health, summary="Живость сервиса")
async def health() -> Health:
    """Проверка, что сервис поднят. Используется мониторингом, CI и деплоем."""
    return Health(status="ok", version=__version__, cities=len(cities.CITIES))


@app.get("/api/cities", response_model=list[CityOut], summary="Справочник городов")
async def list_cities() -> list[CityOut]:
    """Города-кандидаты с координатами — карте они нужны до первого расчёта."""
    return [
        CityOut(slug=c.slug, name=c.name, lat=c.lat, lon=c.lon, hub=c.hub) for c in cities.CITIES
    ]


@app.post("/api/reachable", response_model=ReachableResponse, summary="Карта досягаемости")
async def reachable(request: Annotated[ReachableRequest, ...]) -> ReachableResponse:
    """Считает, куда и за сколько можно уехать из точки в заданную дату.

    Возвращает матрицу целиком: ползунки бюджета и времени на клиенте работают
    по ней локально, без единого дополнительного запроса.
    """
    origin = cities.resolve(request.origin)
    if origin is None:
        raise HTTPException(status_code=422, detail=f"город «{request.origin}» не в справочнике")

    mcp: TutuMCP = app.state.mcp
    before = len(mcp.stats)

    results = await reach.fan_out(
        mcp,
        origin,
        request.date,
        modes=tuple(request.modes),
        price_max=request.price_max,
        limit=request.limit,
    )
    if request.deep:
        results = await reach.deepen(
            mcp, origin, request.date, results, cities.HUBS, modes=tuple(request.modes)
        )

    calls = mcp.stats[before:]
    return ReachableResponse(
        origin=CityOut(
            slug=origin.slug, name=origin.name, lat=origin.lat, lon=origin.lon, hub=origin.hub
        ),
        date=request.date,
        cities=[_reach_out(item) for item in results],
        calls=len(calls),
        cached=sum(1 for call in calls if call.cached),
    )


# Собранный фронтенд монтируется последним, чтобы не перехватывать /api.
if STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
