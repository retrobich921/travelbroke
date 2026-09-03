"""HTTP-слой TravelBroke.

Тонкий фасад: валидирует запрос, отдаёт работу доменному слою
``travelbroke.reach`` и возвращает компактный JSON. Бизнес-логики здесь нет.
"""

from __future__ import annotations

import os
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import date as Date
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from travelbroke import __version__, cities, places, reach
from tutukit.cache import CacheMode, DiskCache
from tutukit.client import TutuError, TutuMCP

TransportMode = Literal["avia", "railway", "bus", "etrain"]

CACHE_DIR = Path(os.environ.get("TB_CACHE_DIR", ".mcp_cache"))
CACHE_MODE: CacheMode = os.environ.get("TB_CACHE_MODE", "record")  # type: ignore[assignment]
CACHE_TTL_S = float(os.environ.get("TB_CACHE_TTL_S", 7 * 24 * 3600))
PHOTO_TTL_S = float(os.environ.get("TB_PHOTO_TTL_S", 30 * 24 * 3600))
"""Месяц: Кремль за неделю никуда не денется, а лишний поход в Википедию — задержка."""

MCP_CONCURRENCY = int(os.environ.get("TB_CONCURRENCY", 16))
"""Сколько запросов к Туту держим в воздухе одновременно.

Расчёт целиком упирается в это число: работы на шесть сотен вызовов, и время
ожидания — это очередь, а не сами запросы. Значение вынесено в окружение,
чтобы подбирать его замером на живом сервере, а не правкой кода.

Подобрано замерами на живом MCP с выключенным кэшем. Абсолютное время сравнивать
нельзя — сервер Туту то быстрее, то медленнее, — поэтому сравнивались пары
прогонов подряд по скорости в вызовах в секунду: 8 даёт 1.2 · 1.2 · 5.3, а 16 на
тех же парах 2.1 · 1.8 · 7.0. Выигрыш 1.3–1.8× и тем больше, чем сильнее загружен
MCP: мы упираемся в собственную очередь, а не в сервер.

Выше поднимать нельзя: на 32 выдача теряет города — часть запросов не доживает
даже до повтора, — а на 24 в логе появляются повторы при выигрыше в пять
процентов. Шестнадцать — последнее значение, где быстрее и результат ровно тот же."""
"""Неделя вместо шести часов по умолчанию: прогретый кэш должен пережить показ."""
STATIC_DIR = Path(__file__).resolve().parents[2] / "static"


# Веса фаз в общей полосе. Перебор городов — самая долгая часть и почти всё
# ожидание пользователя; пересадки считаются по сорока направлениям, обратные
# билеты — по тридцати. Веса подобраны по замерам, а не по числу городов:
# фаза пересадок делает по несколько запросов на город и идёт дольше, чем её
# доля в штуках.
PHASE_WEIGHTS: dict[str, tuple[float, float]] = {
    "fan_out": (0.0, 0.62),
    "transfers": (0.62, 0.92),
    "return": (0.92, 1.0),
}

PHASE_LABELS: dict[str, str] = {
    "idle": "Ожидание",
    "fan_out": "Перебираем города",
    "transfers": "Проверяем пересадки",
    "return": "Ищем обратные билеты",
}


@dataclass
class SearchTracker:
    """Состояние одного расчёта: сколько сделано, сколько осталось и сколько ждать.

    Расчёт — один блокирующий POST, узнать его ход изнутри нельзя. Поэтому домен
    отчитывается сюда обратным вызовом, а фронт опрашивает `/api/progress`.
    Трекер один на приложение: параллельных расчётов сценарий не предполагает,
    а гонка за него в худшем случае показывает чужую полосу, но ничего не ломает.
    """

    active: bool = False
    phase: str = "idle"
    done: int = 0
    total: int = 0
    started_at: float = 0.0

    def start(self) -> None:
        self.active = True
        self.phase = "fan_out"
        self.done = 0
        self.total = 0
        self.started_at = time.monotonic()

    def update(self, phase: str, done: int, total: int) -> None:
        self.phase, self.done, self.total = phase, done, total

    def finish(self) -> None:
        self.active = False
        self.phase = "idle"

    @property
    def elapsed_s(self) -> float:
        return time.monotonic() - self.started_at if self.started_at else 0.0

    @property
    def fraction(self) -> float:
        """Доля всей работы: положение внутри фазы, растянутое на её вес."""
        start, end = PHASE_WEIGHTS.get(self.phase, (0.0, 1.0))
        inner = self.done / self.total if self.total else 0.0
        return min(1.0, start + (end - start) * inner)

    @property
    def eta_s(self) -> float | None:
        """Остаток по фактической скорости с начала расчёта.

        Пока сделано меньше пяти процентов, оценка скачет так, что вредна:
        лучше честно не показывать ничего, чем «осталось 4 минуты», а через
        секунду — «осталось 20 секунд».
        """
        done = self.fraction
        if not self.active or done < 0.05:
            return None
        elapsed = self.elapsed_s
        if elapsed <= 0:
            return None
        return max(0.0, elapsed / done - elapsed)


@asynccontextmanager
async def lifespan(app: FastAPI) -> Any:
    """Один клиент MCP на всё приложение: соединения и кэш переживают запросы."""
    cache = DiskCache(root=CACHE_DIR, mode=CACHE_MODE, ttl_s=CACHE_TTL_S)
    # Отдельный кэш с длинным сроком: подборка достопримечательностей живёт
    # месяцами, в отличие от цен, которым хватает недели.
    photo_cache = DiskCache(root=CACHE_DIR / "places", mode=CACHE_MODE, ttl_s=PHOTO_TTL_S)
    async with TutuMCP(cache=cache, concurrency=MCP_CONCURRENCY) as mcp:
        app.state.mcp = mcp
        app.state.tracker = SearchTracker()
        app.state.photo_cache = photo_cache
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
    waypoints: list[str] = Field(
        default_factory=list,
        description="Города фактических сегментов оффера, включая пересадки",
    )
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
        min_length=1,
        max_length=4,
        description="Разрешённые виды транспорта",
    )
    price_max: int | None = Field(default=None, gt=0, description="Жёсткий потолок цены, ₽")
    limit: int | None = Field(
        default=None, gt=0, description="Ограничить число городов (для быстрых прогонов)"
    )
    passengers: int = Field(
        default=1, ge=1, le=6, description="Сколько человек едет — уходит в поиск как adults"
    )
    abroad_only: bool = Field(
        default=False,
        description="Искать только за границу: города страны отправления в выдачу не попадают",
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


class Progress(BaseModel):
    """Ход текущего расчёта — по нему фронт рисует полосу и остаток времени."""

    active: bool = Field(description="Идёт ли расчёт прямо сейчас")
    phase: str = Field(
        description="fan_out — перебор городов, transfers — пересадки, return — обратные"
    )
    done: int = Field(description="Сколько городов текущей фазы уже обработано")
    total: int = Field(description="Сколько городов в текущей фазе всего")
    fraction: float = Field(description="Доля всей работы от 0 до 1 с учётом веса фаз")
    elapsed_s: float = Field(description="Сколько идёт расчёт, секунды")
    eta_s: float | None = Field(
        default=None, description="Оценка остатка, секунды; null пока не по чему оценивать"
    )
    calls: int = Field(description="Сколько вызовов MCP сделано с момента старта сервиса")


class PhotoOut(BaseModel):
    """Одна достопримечательность с фотографией."""

    title: str
    description: str | None = None
    image: str = Field(description="Прямая ссылка на превью с Викисклада")
    article: str = Field(description="Статья Википедии: источник и подпись по CC-BY-SA")
    kind: str = Field(description="Тип объекта: музей, культовое, природа, сцена, здание, город")


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
        waypoints=list(variant.waypoints),
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


@app.get("/api/progress", response_model=Progress, summary="Ход текущего расчёта")
async def progress() -> Progress:
    """Сколько запросов к Туту уже сделано.

    Счётчик сквозной, не привязан к запросу: расчёт — один блокирующий POST,
    и другого способа показать пользователю, что веер идёт, а не завис, нет.
    Фронт снимает базовое значение перед стартом и считает разницу.
    """
    mcp: TutuMCP = app.state.mcp
    tracker: SearchTracker = app.state.tracker
    return Progress(
        active=tracker.active,
        phase=PHASE_LABELS.get(tracker.phase, tracker.phase),
        done=tracker.done,
        total=tracker.total,
        fraction=round(tracker.fraction, 4),
        elapsed_s=round(tracker.elapsed_s, 1),
        eta_s=None if tracker.eta_s is None else round(tracker.eta_s, 1),
        calls=len(mcp.stats),
    )


@app.get(
    "/api/city-photos",
    response_model=list[PhotoOut],
    summary="Что посмотреть в городе",
)
async def city_photos(
    name: str = Query(min_length=1, max_length=120),
    lat: float = Query(ge=-90, le=90),
    lon: float = Query(ge=-180, le=180),
) -> list[PhotoOut]:
    """Подборка достопримечательностей с фотографиями по координатам города.

    Отдельным запросом, а не внутри `/api/reachable`: карточка открывается по
    клику на один город, и тянуть фотографии для всех трёхсот шестидесяти пяти
    ради этого нельзя. Подборка кэшируется надолго — достопримечательности не
    меняются от того, что мы пересчитали цены.

    Пустой список — нормальный ответ, а не ошибка: у маленького города может не
    быть ни одной статьи с фотографией, и карточка просто обходится без них.
    """
    cache: DiskCache = app.state.photo_cache
    key = {"name": name, "lat": round(lat, 3), "lon": round(lon, 3)}
    cached = cache.get("wiki_places", key)
    if cached is not None:
        raw = cached.get("photos", [])
        return [PhotoOut(**item) for item in raw]

    try:
        found = await places.fetch(name, lat, lon)
    except Exception:
        # Витрина не должна ронять карточку с ценами: Википедия недоступна —
        # значит, фотографий просто не будет.
        return []

    result = [
        PhotoOut(
            title=photo.title,
            description=photo.description,
            image=photo.image,
            article=photo.article,
            kind=photo.kind,
        )
        for photo in found
    ]
    cache.put("wiki_places", key, {"photos": [item.model_dump() for item in result]})
    return result


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
    tracker: SearchTracker = app.state.tracker
    before = len(mcp.stats)
    tracker.start()

    try:
        results = await reach.fan_out(
            mcp,
            origin,
            request.date,
            modes=tuple(request.modes),
            price_max=request.price_max,
            limit=request.limit,
            adults=request.passengers,
            abroad_only=request.abroad_only,
            on_progress=tracker.update,
        )
        # Поиск составных вариантов — стандарт, а не опциональная галочка: парсер
        # и конструктор стыковок ограничивают маршрут тремя пересадками.
        results = await reach.deepen(
            mcp,
            origin,
            request.date,
            results,
            cities.HUBS,
            modes=tuple(request.modes),
            adults=request.passengers,
            on_progress=tracker.update,
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
                on_progress=tracker.update,
            )
    finally:
        # Полоса обязана погаснуть и когда расчёт упал: иначе следующий поиск
        # стартует поверх чужого прогресса и покажет ерунду.
        tracker.finish()

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
        # `create_checkout_link` использует не те же поля, что поиск. Для
        # авиа обязательно передать passengers_full: иначе конкретный билет
        # откроется в корзине на одного человека, хотя карта считала компанию.
        # У поезда число мест выбирается на следующем экране Туту, а у автобуса
        # это безопасный prefill страницы мест — ни один вариант не скатывается
        # в общий поисковый URL.
        transport = args.get("transport")
        if transport == "avia":
            args["passengers_full"] = request.passengers
            args.setdefault("passengers_child", 0)
            args.setdefault("passengers_infant", 0)
        elif transport == "bus":
            args["passengers"] = request.passengers
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
