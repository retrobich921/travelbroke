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

from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from travelbroke import __version__, cities, reach
from tutukit.cache import CacheMode, DiskCache
from tutukit.client import TutuError, TutuMCP

TransportMode = Literal["avia", "railway", "bus", "etrain"]

CACHE_DIR = Path(os.environ.get("TB_CACHE_DIR", ".mcp_cache"))
CACHE_MODE: CacheMode = os.environ.get("TB_CACHE_MODE", "record")  # type: ignore[assignment]
CACHE_TTL_S = float(os.environ.get("TB_CACHE_TTL_S", 7 * 24 * 3600))
"""Неделя вместо шести часов по умолчанию: прогретый кэш должен пережить показ."""
STATIC_DIR = Path(__file__).resolve().parents[2] / "static"


@asynccontextmanager
async def lifespan(app: FastAPI) -> Any:
    """Один клиент MCP на всё приложение: соединения и кэш переживают запросы."""
    cache = DiskCache(root=CACHE_DIR, mode=CACHE_MODE, ttl_s=CACHE_TTL_S)
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
    country: str = "Россия"


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
    checkout_ref: dict[str, Any] | None = Field(
        default=None, description="Ссылка на конкретный рейс строится из него через /api/checkout"
    )


class ReachOut(BaseModel):
    """Достижимость одного города."""

    slug: str
    name: str
    lat: float
    lon: float
    price: int | None = Field(default=None, description="Лучшая найденная цена, ₽")
    hours: float | None = None
    direct: VariantOut | None = None
    variants: list[VariantOut] = Field(
        default_factory=list,
        description="Конкретные прямые варианты: карточка выбирает из них оффер по фильтрам",
    )
    via: str | None = Field(default=None, description="Город пересадки, если так дешевле")
    via_legs: list[VariantOut] | None = None
    transfer_wait_minutes: int | None = Field(
        default=None, description="Запас между прибытием и отправлением на пересадке, минуты"
    )
    transfer_required_minutes: int | None = Field(
        default=None, description="Сколько запаса потребовала проверка выполнимости, минуты"
    )
    transfer_overnight: bool = Field(
        default=False, description="Ожидание на пересадке превышает восемь часов"
    )
    beats_direct_by: int | None = Field(
        default=None, description="Экономия составного маршрута против прямого, ₽"
    )
    by_mode: dict[str, int] = Field(
        default_factory=dict, description="Минимальная цена по каждому виду транспорта, ₽"
    )
    by_mode_minutes: dict[str, int] = Field(
        default_factory=dict, description="Минимальное время по каждому виду транспорта, минуты"
    )
    options: list[VariantOut] = Field(
        default_factory=list, description="Несколько лучших вариантов «туда»"
    )
    back: VariantOut | None = Field(default=None, description="Самый дешёвый обратный билет")
    back_date: Date | None = None
    round_trip_price: int | None = Field(
        default=None, description="Туда и обратно вместе, ₽ на человека"
    )
    empty_reason: str | None = None
    empty_message: str | None = None


class ReachableRequest(BaseModel):
    """Параметры расчёта карты досягаемости."""

    origin: str = Field(default="Москва", description="Город отправления")
    date: Date = Field(description="Дата поездки")
    modes: list[TransportMode] = Field(
        default=["avia", "railway", "bus", "etrain"],
        description="Разрешённые виды транспорта",
    )
    price_max: int | None = Field(default=None, gt=0, description="Жёсткий потолок цены, ₽")
    limit: int | None = Field(
        default=None, gt=0, description="Ограничить число городов (для быстрых прогонов)"
    )
    deep: bool = Field(
        default=False, description="Искать составные маршруты через хабы (медленнее)"
    )
    passengers: int = Field(
        default=1, ge=1, le=6, description="Сколько человек едет — уходит в поиск как adults"
    )
    round_trip: bool = Field(default=False, description="Подбирать ещё и обратный билет")
    stay_min: int = Field(default=1, ge=1, le=30, description="Минимум дней на месте")
    stay_max: int = Field(default=3, ge=1, le=30, description="Максимум дней на месте")


class ReachableResponse(BaseModel):
    """Матрица досягаемости целиком — клиент фильтрует её сам, без запросов к серверу."""

    origin: CityOut
    date: Date
    cities: list[ReachOut]
    calls: int = Field(description="Сколько вызовов MCP потребовалось")
    cached: int = Field(description="Из них отдано кэшем")


class CheckoutRequest(BaseModel):
    """Запрос ссылки на покупку конкретного рейса."""

    checkout_ref: dict[str, Any] = Field(description="Объект checkout_ref из варианта поездки")
    passengers: int = Field(default=1, ge=1, le=6, description="Сколько мест нужно")


class CheckoutResponse(BaseModel):
    """Готовая ссылка на оформление."""

    url: str
    kind: str = Field(default="deeplink", description="deeplink или fallback на страницу поиска")


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
        checkout_ref=variant.checkout_ref,
    )


def _reach_out(item: reach.Reach) -> ReachOut:
    """Доменный результат по городу в модель ответа.

    Время составного маршрута считается вместе с ожиданием на пересадке —
    показывать сумму двух плеч без стыковочного часа было бы враньём.
    """
    connection = item.connection
    legs = item.via_legs
    total_hours = item.direct.hours if item.direct is not None else None
    if connection is not None and (item.direct is None or connection.price < item.direct.price):
        total_hours = round(connection.duration_min / 60, 1)
    return ReachOut(
        slug=item.city.slug,
        name=item.city.name,
        lat=item.city.lat,
        lon=item.city.lon,
        price=item.best_price,
        hours=total_hours,
        direct=_variant_out(item.direct) if item.direct else None,
        variants=[_variant_out(variant) for variant in item.variants],
        via=item.via.name if item.via else None,
        via_legs=[_variant_out(leg) for leg in legs] if legs else None,
        transfer_wait_minutes=connection.wait_min if connection else None,
        transfer_required_minutes=connection.required_min if connection else None,
        transfer_overnight=connection.overnight if connection else False,
        beats_direct_by=item.beats_direct_by,
        by_mode=item.by_mode,
        by_mode_minutes=item.by_mode_minutes,
        options=[_variant_out(option) for option in item.options],
        back=_variant_out(item.back) if item.back else None,
        back_date=item.back_date,
        round_trip_price=(
            item.best_price + item.back.price
            if item.back is not None and item.best_price is not None
            else None
        ),
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
        CityOut(slug=c.slug, name=c.name, lat=c.lat, lon=c.lon, hub=c.hub, country=c.country)
        for c in cities.CITIES
    ]


@app.get("/api/city-suggest", response_model=list[CityOut], summary="Глобальные подсказки городов")
async def city_suggest(q: str = Query(min_length=2, max_length=120)) -> list[CityOut]:
    """Ищет город по всему миру; транспорт затем резолвит сам Туту."""
    return [
        CityOut(
            slug=city.slug,
            name=city.name,
            lat=city.lat,
            lon=city.lon,
            hub=city.hub,
            country=city.country,
        )
        for city in await cities.suggest_global(q)
    ]


@app.post("/api/reachable", response_model=ReachableResponse, summary="Карта досягаемости")
async def reachable(request: Annotated[ReachableRequest, ...]) -> ReachableResponse:
    """Считает, куда и за сколько можно уехать из точки в заданную дату.

    Возвращает матрицу целиком: ползунки бюджета и времени на клиенте работают
    по ней локально, без единого дополнительного запроса.
    """
    origin = await cities.resolve_global(request.origin)
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
        adults=request.passengers,
    )
    if request.deep:
        results = await reach.deepen(
            mcp,
            origin,
            request.date,
            results,
            cities.HUBS,
            modes=tuple(request.modes),
            adults=request.passengers,
        )
    if request.round_trip:
        results = await reach.add_return_trips(
            mcp,
            origin,
            request.date,
            results,
            stay_min=request.stay_min,
            stay_max=request.stay_max,
            modes=tuple(request.modes),
            adults=request.passengers,
        )

    calls = mcp.stats[before:]
    return ReachableResponse(
        origin=CityOut(
            slug=origin.slug,
            name=origin.name,
            lat=origin.lat,
            lon=origin.lon,
            hub=origin.hub,
            country=origin.country,
        ),
        date=request.date,
        cities=[_reach_out(item) for item in results],
        calls=len(calls),
        cached=sum(1 for call in calls if call.cached),
    )


@app.post("/api/checkout", response_model=CheckoutResponse, summary="Ссылка на конкретный рейс")
async def checkout(request: Annotated[CheckoutRequest, ...]) -> CheckoutResponse:
    """Строит ссылку на оформление конкретного рейса, а не на страницу поиска.

    `create_checkout_link` принимает поля `checkout_ref` **развёрнутыми**, объект
    целиком он не берёт — это одна из известных ловушек схемы MCP Туту.
    """
    mcp: TutuMCP = app.state.mcp
    args = dict(request.checkout_ref)
    if request.passengers > 1:
        args.setdefault("passengers", request.passengers)
    try:
        data = await mcp.call("create_checkout_link", **args)
    except TutuError as exc:
        raise HTTPException(status_code=502, detail=f"Туту не отдал ссылку: {exc}") from exc

    kind = data.get("kind")
    if kind != "deeplink":
        raise HTTPException(
            status_code=409,
            detail="Туту не отдал ссылку на конкретный рейс — общий поиск не открываем",
        )
    url = data.get("url") or data.get("checkout_url")
    if not isinstance(url, str) or not url:
        raise HTTPException(status_code=502, detail="в ответе Туту нет ссылки на оформление")
    return CheckoutResponse(url=url, kind="deeplink")


# Собранный фронтенд монтируется последним, чтобы не перехватывать /api.
if STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
