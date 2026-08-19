"""Тесты доменного слоя: разбор ответа MCP, геометрия хабов, выбор лучшего маршрута."""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import pytest

from travelbroke.cities import BY_NAME, HUBS, City, matches_name, resolve
from travelbroke.reach import (
    BASE_BUFFER_MIN,
    Connection,
    Reach,
    Variant,
    _search_pair,
    best_connection,
    build_graph,
    cheapest_paths,
    detour_ratio,
    hub_candidates,
    parse_modes_summary,
    parse_variants,
    required_buffer,
    same_station,
)


def leg(
    transport: str,
    price: int,
    *,
    departure: str | None = None,
    arrival: str | None = None,
    from_point: str | None = None,
    to_point: str | None = None,
    minutes: int = 300,
) -> Variant:
    """Короткий конструктор плеча для тестов."""
    return Variant(
        transport=transport,
        price=price,
        duration_min=minutes,
        transfers=0,
        departure_at=departure,
        arrival_at=arrival,
        departure_point=from_point,
        arrival_point=to_point,
    )


RAW = Path(__file__).resolve().parents[1] / "recon" / "raw" / "05_search_multitransport.json"


@pytest.fixture(scope="module")
def multitransport() -> dict:
    """Настоящий ответ сервера, снятый разведкой: Москва → Казань."""
    if not RAW.exists():
        pytest.skip("нет recon/raw — запусти recon/probe.py")
    return json.loads(RAW.read_text(encoding="utf-8"))["data"]


def test_parse_variants_reads_real_response(multitransport: dict) -> None:
    variants = parse_variants(multitransport)

    assert variants, "в ответе есть варианты, парсер обязан их увидеть"
    first = variants[0]
    assert first.price > 0
    assert first.duration_min > 0
    assert first.transport in {"avia", "railway", "bus", "etrain"}
    assert first.checkout_url is not None


def test_parse_variants_survives_garbage() -> None:
    """Вариант без цены или длительности пропускается, а не роняет расчёт."""
    data = {
        "variants": [
            {"transport": "bus"},
            {"transport": "bus", "price": {"amount": 900.4}, "duration_min": 300},
        ]
    }

    variants = parse_variants(data)

    assert len(variants) == 1
    assert variants[0].price == 900


def test_city_aliases_accept_translation_but_not_another_city() -> None:
    cairo = City("Cairo", 30.04, 31.23, aliases=("Каир",))
    zarqa = City("Zarqa", 32.07, 36.09, aliases=("Зарка",))

    assert matches_name(cairo, "Каир")
    assert not matches_name(zarqa, "Навои")


@pytest.mark.asyncio
async def test_search_rejects_tutu_city_substitution() -> None:
    class MCP:
        async def call(self, _tool: str, **_args: object) -> dict:
            return {
                "meta": {"from": {"name": "Москва"}, "to": {"name": "Санкт-Петербург"}},
                "variants": [{"transport": "bus", "price": {"amount": 1771}, "duration_min": 510}],
            }

    _, _, _, reason, _ = await _search_pair(
        MCP(),  # type: ignore[arg-type]
        "Москва",
        "Le Lamentin",
        dt.date(2026, 9, 13),
        ("bus",),
        None,
        expected_origin=City("Москва", 55.75, 37.62),
        expected_destination=City("Le Lamentin", 14.6, -61.0, aliases=("Ле-Ламантен",)),
    )

    assert reason == "resolved_elsewhere"


def test_parse_variants_caps_route_at_three_transfers() -> None:
    variants = parse_variants(
        {
            "variants": [
                {
                    "transport": "bus",
                    "price": {"amount": 900},
                    "duration_min": 300,
                    "segments_count": 4,
                },
                {
                    "transport": "bus",
                    "price": {"amount": 800},
                    "duration_min": 400,
                    "segments_count": 5,
                },
            ]
        }
    )

    assert [variant.transfers for variant in variants] == [3]


def test_parse_variants_keeps_actual_internal_transfer_cities() -> None:
    variants = parse_variants(
        {
            "variants": [
                {
                    "transport": "avia",
                    "price": {"amount": 59_776},
                    "duration_min": 588,
                    "segments_count": 2,
                    "legs": [
                        {
                            "from": "Нижнекамск — Бегишево (NBC)",
                            "to": "Пекин — Дасин (PKX)",
                            "segments": [
                                {
                                    "from": "Нижнекамск — Бегишево (NBC)",
                                    "to": "Москва — Шереметьево (SVO)",
                                },
                                {
                                    "from": "Москва — Домодедово (DME)",
                                    "to": "Пекин — Дасин (PKX)",
                                },
                            ],
                        }
                    ],
                }
            ]
        }
    )

    assert variants[0].waypoints == ("Нижнекамск", "Москва", "Пекин")
    assert variants[0].route == "Нижнекамск → Москва → Пекин"


def test_zero_price_is_not_treated_as_a_free_ticket() -> None:
    """Электрички могут вернуть расписание, но не вернуть стоимость."""
    variants = parse_variants(
        {"variants": [{"transport": "etrain", "price": {"amount": 0}, "duration_min": 204}]}
    )

    assert len(variants) == 1  # расписание и переход в Туту не теряем
    assert not variants[0].has_known_price
    assert Reach(city=City("Ижевск", 56.85, 53.2), direct=variants[0]).best_price is None

    prices, _ = parse_modes_summary(
        {"meta": {"modes_summary": {"etrain": {"min_price": 0, "min_duration_min": 204}}}}
    )
    assert prices == {}


def test_parse_variants_never_uses_generic_search_as_checkout() -> None:
    """Кнопка покупки не должна молча превращаться в общий поиск Туту."""
    variants = parse_variants(
        {
            "variants": [
                {
                    "transport": "bus",
                    "price": {"amount": 900},
                    "duration_min": 300,
                    "search_results_url": "https://www.tutu.ru/bus/search/",
                }
            ]
        }
    )

    assert variants[0].checkout_url is None


def test_parse_modes_summary(multitransport: dict) -> None:
    prices, minutes = parse_modes_summary(multitransport)

    assert prices, "meta.modes_summary есть в ответе"
    assert all(isinstance(price, int) and price > 0 for price in prices.values())
    assert all(isinstance(value, int) and value > 0 for value in minutes.values())


def test_parse_modes_summary_tolerates_missing_meta() -> None:
    assert parse_modes_summary({"variants": []}) == ({}, {})
    assert parse_modes_summary({"meta": {"modes_summary": "чепуха"}}) == ({}, {})


def test_detour_ratio_prefers_hub_on_the_way() -> None:
    moscow, tula, sochi = BY_NAME["Москва"], BY_NAME["Тула"], BY_NAME["Сочи"]
    piter = BY_NAME["Санкт-Петербург"]

    # Тула лежит между Москвой и Сочи, Петербург — в противоположной стороне.
    assert detour_ratio(moscow, tula, sochi) < detour_ratio(moscow, piter, sochi)


def test_hub_candidates_drops_far_hubs() -> None:
    moscow, sochi = BY_NAME["Москва"], BY_NAME["Сочи"]

    candidates = hub_candidates(moscow, sochi, HUBS)

    names = [hub.name for hub in candidates]
    assert "Санкт-Петербург" not in names
    assert "Москва" not in names and "Сочи" not in names


def test_best_price_prefers_cheaper_composite_route() -> None:
    target = City("Сочи", 43.5855, 39.7231)
    direct = leg("railway", 6800, minutes=1440)
    connection = Connection(
        first=leg("bus", 2200, minutes=900),
        second=leg("etrain", 1700, minutes=300),
        wait_min=120,
        required_min=120,
    )
    reach = Reach(city=target, direct=direct, via=BY_NAME["Ростов-на-Дону"], connection=connection)

    assert reach.best_price == 3900
    assert reach.beats_direct_by == 2900
    # Время пересадки входит в общую длительность, а не теряется между плечами.
    assert connection.duration_min == 900 + 120 + 300


def test_beats_direct_by_is_none_when_composite_is_worse() -> None:
    target = City("Сочи", 43.5855, 39.7231)
    direct = leg("railway", 3000, minutes=1440)
    connection = Connection(
        first=leg("bus", 2500, minutes=900),
        second=leg("etrain", 2500, minutes=300),
        wait_min=90,
        required_min=60,
    )
    reach = Reach(city=target, direct=direct, via=BY_NAME["Тула"], connection=connection)

    assert reach.best_price == 3000
    assert reach.beats_direct_by is None


def test_required_buffer_grows_for_flights_and_station_change() -> None:
    same = leg("railway", 100, to_point="Казань (2060500)")
    next_same = leg("railway", 100, from_point="Казань (2060500)")
    assert required_buffer(same, next_same) == BASE_BUFFER_MIN

    other = leg("railway", 100, from_point="Казань-2 (2060501)")
    assert required_buffer(same, other) == BASE_BUFFER_MIN + 60

    flight = leg("avia", 100, from_point="Казань (2060500)")
    assert required_buffer(same, flight) == BASE_BUFFER_MIN + 90


def test_same_station_assumes_worst_without_data() -> None:
    """Нет названий станций — считаем их разными и закладываем лишний час."""
    assert not same_station(leg("railway", 100), leg("bus", 100))


def test_best_connection_rejects_impossible_transfer() -> None:
    first = leg(
        "railway",
        1000,
        arrival="2026-09-01T12:00:00+03:00",
        to_point="Казань (2060500)",
    )
    too_soon = leg(
        "railway",
        500,
        departure="2026-09-01T12:30:00+03:00",
        from_point="Казань (2060500)",
    )

    assert best_connection([first], [too_soon]) is None


def test_best_connection_picks_cheapest_feasible_pair() -> None:
    first = leg(
        "railway",
        1000,
        arrival="2026-09-01T12:00:00+03:00",
        to_point="Казань (2060500)",
    )
    too_soon = leg(
        "railway", 300, departure="2026-09-01T12:30:00+03:00", from_point="Казань (2060500)"
    )
    feasible = leg(
        "railway", 800, departure="2026-09-01T14:00:00+03:00", from_point="Казань (2060500)"
    )

    found = best_connection([first], [too_soon, feasible])

    assert found is not None
    assert found.second is feasible
    assert found.wait_min == 120
    assert found.required_min == BASE_BUFFER_MIN
    assert not found.overnight


def test_best_connection_marks_overnight_wait() -> None:
    first = leg("railway", 1000, arrival="2026-09-01T22:00:00+03:00", to_point="Казань (2060500)")
    morning = leg(
        "railway", 700, departure="2026-09-02T09:00:00+03:00", from_point="Казань (2060500)"
    )

    found = best_connection([first], [morning])

    assert found is not None
    assert found.overnight


def test_graph_finds_cheapest_path_through_hub() -> None:
    moscow = BY_NAME["Москва"]
    sochi = City("Сочи", 43.5855, 39.7231)
    reaches = [
        Reach(
            city=sochi,
            direct=leg("railway", 6800, minutes=1440),
            via=BY_NAME["Ростов-на-Дону"],
            connection=Connection(
                first=leg("bus", 2200, minutes=900),
                second=leg("etrain", 1700, minutes=300),
                wait_min=120,
                required_min=120,
            ),
        )
    ]

    graph = build_graph(moscow, reaches)
    paths = cheapest_paths(graph, moscow.name)

    cost, route = paths["Сочи"]
    assert cost == 3900
    assert route == ["Москва", "Ростов-на-Дону", "Сочи"]


def test_resolve_accepts_slug_and_name() -> None:
    assert resolve("Москва") is BY_NAME["Москва"]
    assert resolve("санкт-петербург") is BY_NAME["Санкт-Петербург"]
    assert resolve("Нью-Йорк") is None


def test_destinations_search_the_whole_world_by_default() -> None:
    """Обычный поиск смешивает свою страну и заграницу, галочка оставляет заграницу."""
    from travelbroke.cities import ABROAD_QUOTA, destinations

    chelny = BY_NAME["Набережные Челны"]

    everywhere = destinations(chelny)
    abroad = destinations(chelny, abroad_only=True)

    countries = {city.country for city in everywhere}
    assert "Россия" in countries, "по своей стране ехать всегда есть куда"
    assert len(countries) > 1, "без галочки ищем по всему миру, а не по своему региону"
    foreign = sum(1 for city in everywhere if city.country != "Россия")
    assert foreign >= ABROAD_QUOTA, "заграница не должна вытесняться ближайшими соседями"

    assert abroad and all(city.country != "Россия" for city in abroad)
    assert "Москва" not in {city.name for city in abroad}


def test_destinations_capped_for_far_origins() -> None:
    """Из Дубая не считаем весь мир: остаются ближайшие кандидаты."""
    from travelbroke.cities import MAX_DESTINATIONS, destinations

    assert len(destinations(BY_NAME["Дубай"], abroad_only=True)) <= MAX_DESTINATIONS


def test_destinations_include_long_haul_regions() -> None:
    """Мир не должен сводиться к России и ближней Европе."""
    from travelbroke.cities import country_id, destinations, global_catalog

    continents = {city.country_code: continent for city, continent in global_catalog()}
    pool = destinations(BY_NAME["Москва"])
    regions = {continents.get(country_id(city)) for city in pool}

    assert {"AF", "NA", "SA", "OC"} <= regions
    assert {"EG", "US", "BR", "AU"} <= {country_id(city) for city in pool}


def test_major_hubs_are_checked_first() -> None:
    """По прямой между Челнами и Стамбулом лежит Ростов, а рейсы идут через Москву."""
    candidates = hub_candidates(BY_NAME["Набережные Челны"], BY_NAME["Стамбул"], HUBS)

    assert candidates[0].name == "Москва"
