"""Почему пусто: сервер отдаёт `offers=[]` одинаково в пяти разных ситуациях.

Замеры 2026-08-17 (avia Мск→Сочи, rail Мск→СПб, bus Мск→Тула), офферов на дату:

| дней вперёд | 30 | 60 | 90 | 120 | 150 | 180 | 240 | 330 |
|-------------|----|----|----|-----|-----|-----|-----|-----|
| avia        | 10 | 10 | 10 | 10  | 10  | 10  |  0  |  0  |
| rail        | 10 | 10 |  2 |  2  |  2  |  0  |  0  |  0  |
| bus         | 10 |  2 |  0 |  0  |  0  |  0  |  0  |  0  |

Горизонт продаж разный у каждого вида транспорта, и сервер об этом не говорит —
просто отдаёт пустой список без предупреждения. Дата в прошлом тоже не ошибка.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

# граница «дальше этого пусто» из таблицы выше; None — не замеряли
SALES_HORIZON_DAYS: dict[str, int] = {
    "avia": 210,
    "rail": 165,
    "railway": 165,
    "bus": 75,
}
FILTER_KEYS = (
    "price_max",
    "direct_only",
    "carriers",
    "flight_numbers",
    "service_class",
)


class EmptyReason(StrEnum):
    OK = "ok"
    PAST_DATE = "past_date"
    BEYOND_HORIZON = "beyond_horizon"
    FILTERS_TOO_STRICT = "filters_too_strict"
    NO_OPTIONS = "no_options"


@dataclass(slots=True)
class Diagnosis:
    reason: EmptyReason
    message: str
    hint: str | None = None
    ambiguity: str | None = None

    @property
    def empty(self) -> bool:
        return self.reason is not EmptyReason.OK


MSK = dt.timezone(dt.timedelta(hours=3))


def _today_msk() -> dt.date:
    """Расписания и горизонты продаж живут в московском времени, а не в локальном."""
    return dt.datetime.now(MSK).date()


def _mode(tool: str) -> str:
    return tool.removeprefix("search_")


def _date_of(args: dict[str, Any]) -> dt.date | None:
    raw = args.get("departure_date") or args.get("checkin_date") or args.get("check_in")
    if not isinstance(raw, str):
        return None
    try:
        return dt.date.fromisoformat(raw[:10])
    except ValueError:
        return None


def ambiguity_warning(args: dict[str, Any], data: dict[str, Any]) -> str | None:
    """Город-омоним: «Ростов» молча становится Ростовом-на-Дону.

    Ловим случай, когда запрошенное название — часть того, что резолвил сервер
    («Ростов» ⊂ «Ростов-на-Дону»). Синонимы вроде «Питер» → «Санкт-Петербург»
    сюда не попадают: там пересечения строк нет.
    """
    meta = data.get("meta")
    if not isinstance(meta, dict):
        return None
    pairs = [
        ("origin", meta.get("from")),
        ("from_city", meta.get("from")),
        ("destination", meta.get("to")),
        ("to_city", meta.get("to")),
        ("city_name", meta.get("resolved_geo")),
    ]
    for arg_key, resolved in pairs:
        asked = args.get(arg_key)
        if not isinstance(asked, str) or not isinstance(resolved, dict):
            continue
        name = resolved.get("name")
        if not isinstance(name, str):
            continue
        also = resolved.get("also_named")
        if also:
            return f"«{asked}» → {name}; сервер видит и другие варианты: {also}"
        if name.casefold() == asked.casefold():
            continue
        if asked.casefold() in name.casefold():
            return (
                f"«{asked}» распознан как {name}"
                f"{' (' + resolved['region'] + ')' if resolved.get('region') else ''} — "
                f"это может быть не тот город, уточните"
            )
    return None


def diagnose(
    tool: str,
    args: dict[str, Any],
    data: dict[str, Any],
    *,
    today: dt.date | None = None,
) -> Diagnosis:
    """Классифицирует результат поиска и даёт готовый текст для пользователя."""
    today = today or _today_msk()
    ambiguity = ambiguity_warning(args, data)

    items: list[Any] = []
    for key in ("offers", "hotels", "variants", "results"):
        if isinstance(data.get(key), list):
            items = data[key]
            break
    if items:
        return Diagnosis(EmptyReason.OK, f"найдено вариантов: {len(items)}", ambiguity=ambiguity)

    when = _date_of(args)
    mode = _mode(tool)

    if when is not None and when < today:
        return Diagnosis(
            EmptyReason.PAST_DATE,
            f"Дата {when:%d.%m.%Y} уже прошла — билеты на неё не продаются.",
            "Укажите будущую дату.",
            ambiguity,
        )

    horizon = SALES_HORIZON_DAYS.get(mode)
    if when is not None and horizon is not None and (when - today).days > horizon:
        return Diagnosis(
            EmptyReason.BEYOND_HORIZON,
            f"На {when:%d.%m.%Y} продажи ещё не открыты: {mode} обычно "
            f"продаётся примерно за {horizon} дней.",
            f"Попробуйте дату ближе {today + dt.timedelta(days=horizon):%d.%m.%Y}.",
            ambiguity,
        )

    used = [k for k in FILTER_KEYS if args.get(k) not in (None, False, [], "")]
    if used:
        meta = data.get("meta") if isinstance(data.get("meta"), dict) else {}
        dropped = {k: v for k, v in (meta or {}).items() if k.startswith("post_filter_dropped")}
        detail = f" (фильтры отсеяли: {dropped})" if dropped else ""
        return Diagnosis(
            EmptyReason.FILTERS_TOO_STRICT,
            f"Под заданные условия ничего не подошло{detail}.",
            f"Ослабьте фильтры: {', '.join(used)}.",
            ambiguity,
        )

    return Diagnosis(
        EmptyReason.NO_OPTIONS,
        "На эту дату рейсов по маршруту нет.",
        "Попробуйте соседние даты или другой вид транспорта.",
        ambiguity,
    )
