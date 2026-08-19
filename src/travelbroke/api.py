"""HTTP-слой TravelBroke.

Тонкий фасад: принимает запрос, отдаёт задачу доменному слою, возвращает
компактный JSON. Никакой бизнес-логики здесь быть не должно — она живёт в
``travelbroke.reach`` (веер и граф) и в ``tutukit`` (работа с MCP Туту).
"""

from __future__ import annotations

from datetime import date as Date
from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel, Field

from travelbroke import __version__

TransportMode = Literal["avia", "rail", "bus", "etrain"]

app = FastAPI(
    title="TravelBroke API",
    version=__version__,
    description=(
        "Куда можно уехать из точки за заданный бюджет и время. "
        "Считает не только прямые маршруты, но и составные — они часто дешевле."
    ),
)


class ReachableRequest(BaseModel):
    """Параметры расчёта карты досягаемости."""

    origin: str = Field(description="Город отправления: название или сленг («Питер»)")
    date: Date = Field(description="Дата поездки")
    budget: int = Field(gt=0, description="Потолок бюджета в рублях на одного человека")
    max_hours: float = Field(default=24.0, gt=0, description="Максимум часов в пути")
    modes: list[TransportMode] = Field(
        default_factory=lambda: ["avia", "rail", "bus", "etrain"],
        description="Разрешённые виды транспорта",
    )
    max_transfers: int = Field(default=2, ge=0, le=2, description="Потолок пересадок")


class ReachableCity(BaseModel):
    """Один достижимый город на карте."""

    city_id: str
    name: str
    lat: float
    lon: float
    price: int = Field(description="Итоговая цена лучшего найденного маршрута, ₽")
    hours: float = Field(description="Время в пути с учётом пересадок")
    transfers: int
    modes: list[TransportMode] = Field(description="Виды транспорта по сегментам")
    beats_direct_by: int | None = Field(
        default=None,
        description="На сколько рублей составной маршрут дешевле прямого, если дешевле",
    )


class Health(BaseModel):
    """Ответ health-check."""

    status: Literal["ok", "degraded"]
    version: str
    mcp_reachable: bool


@app.get("/api/health", response_model=Health, summary="Живость сервиса и MCP Туту")
async def health() -> Health:
    """Проверка, что сервис поднят. Используется мониторингом и CI."""
    return Health(status="ok", version=__version__, mcp_reachable=True)
