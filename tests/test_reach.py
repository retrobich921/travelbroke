"""Тесты доменного слоя: разбор ответа MCP, геометрия хабов, выбор лучшего маршрута."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from travelbroke.cities import BY_NAME, HUBS, City, resolve
from travelbroke.reach import (
    Reach,
    Variant,
    build_graph,
    cheapest_paths,
    detour_ratio,
    hub_candidates,
    parse_modes_summary,
    parse_variants,
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


def test_parse_modes_summary(multitransport: dict) -> None:
    summary = parse_modes_summary(multitransport)

    assert summary, "meta.modes_summary есть в ответе"
    assert all(isinstance(price, int) and price > 0 for price in summary.values())


def test_parse_modes_summary_tolerates_missing_meta() -> None:
    assert parse_modes_summary({"variants": []}) == {}
    assert parse_modes_summary({"meta": {"modes_summary": "чепуха"}}) == {}


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
    direct = Variant(transport="railway", price=6800, duration_min=1440, transfers=0)
    legs = (
        Variant(transport="bus", price=2200, duration_min=900, transfers=0),
        Variant(transport="etrain", price=1700, duration_min=300, transfers=0),
    )
    reach = Reach(city=target, direct=direct, via=BY_NAME["Ростов-на-Дону"], via_legs=legs)

    assert reach.best_price == 3900
    assert reach.beats_direct_by == 2900


def test_beats_direct_by_is_none_when_composite_is_worse() -> None:
    target = City("Сочи", 43.5855, 39.7231)
    direct = Variant(transport="railway", price=3000, duration_min=1440, transfers=0)
    legs = (
        Variant(transport="bus", price=2500, duration_min=900, transfers=0),
        Variant(transport="etrain", price=2500, duration_min=300, transfers=0),
    )
    reach = Reach(city=target, direct=direct, via=BY_NAME["Тула"], via_legs=legs)

    assert reach.best_price == 3000
    assert reach.beats_direct_by is None


def test_graph_finds_cheapest_path_through_hub() -> None:
    moscow = BY_NAME["Москва"]
    sochi = City("Сочи", 43.5855, 39.7231)
    reaches = [
        Reach(
            city=sochi,
            direct=Variant(transport="railway", price=6800, duration_min=1440, transfers=0),
            via=BY_NAME["Ростов-на-Дону"],
            via_legs=(
                Variant(transport="bus", price=2200, duration_min=900, transfers=0),
                Variant(transport="etrain", price=1700, duration_min=300, transfers=0),
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
