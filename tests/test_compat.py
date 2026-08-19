"""Каждый тест — грабля, на которой реально падал вызов (см. MCP_RECON.md)."""

import pytest

from tutukit.compat import (
    checkout_args,
    details_args,
    normalize,
    product_type_of,
    seatmap_args,
)

RAIL_OFFER = {
    "offer_id": "abc",
    "transport": "railway",
    "details_ref": {"transport": "railway", "train_number": "742У"},
    "checkout_ref": {"transport": "railway", "train_number": "742У", "offer_hash": "h"},
}
HOTEL = {"hotel_id": 42, "hotel_geo_id": 11428448, "checkout_ref": {"hotel_alias": "x"}}


def test_search_ne_prinimaet_passengers_full():
    args, notes = normalize("search_avia", {"origin": "Москва", "passengers_full": 2})
    assert args == {"origin": "Москва", "adults": 2}
    assert notes


def test_checkout_ref_razvorachivaetsya_plosko():
    args, notes = normalize(
        "create_checkout_link",
        {"checkout_ref": {"transport": "railway", "offer_hash": "h"}},
    )
    assert args == {"transport": "railway", "offer_hash": "h"}
    assert notes


def test_checkout_ref_ne_zatiraet_yavnyj_argument():
    args, _ = normalize(
        "create_checkout_link",
        {"checkout_ref": {"offer_hash": "cheap"}, "offer_hash": "chosen"},
    )
    assert args["offer_hash"] == "chosen"


def test_u_kazhdogo_poiska_svoi_passazhirskie_polya():
    # rail знает только суммарный passengers
    args, _ = normalize("search_rail", {"origin": "Москва", "adults": 2, "children": 1})
    assert args == {"origin": "Москва", "passengers": 3}
    # avia — три отдельных поля
    args, _ = normalize("search_avia", {"adults": 2, "children": 1, "infants": 1})
    assert args == {"adults": 2, "children": 1, "infants": 1}
    # bus не знает младенцев
    args, notes = normalize("search_bus", {"adults": 1, "infants": 1})
    assert args == {"adults": 1}
    assert any("infants" in n for n in notes)
    # electrichki не знают пассажиров вовсе
    args, notes = normalize("search_etrain", {"origin": "Москва", "adults": 2})
    assert args == {"origin": "Москва"}
    assert notes


def test_product_type_hotel_ispravlyaetsya_na_hotels():
    args, notes = normalize("get_offer_details", {"product_type": "hotel", "hotel_id": 1})
    assert args["product_type"] == "hotels"
    assert notes


def test_seatmap_task_tolko_iz_enum():
    args, notes = normalize("get_rail_seatmap", {"details_ref": {}, "task": "лучшие нижние места"})
    assert "task" not in args
    assert notes
    args, notes = normalize("get_rail_seatmap", {"details_ref": {}, "task": "far_from_wc"})
    assert args["task"] == "far_from_wc"
    assert not notes


def test_details_args_beret_details_ref_a_ne_checkout_ref():
    args = details_args(RAIL_OFFER)
    assert args == {"product_type": "railway", "details_ref": RAIL_OFFER["details_ref"]}


def test_details_args_dlya_otelya():
    args = details_args(HOTEL, check_in="2026-09-01", check_out="2026-09-03", adults=2)
    assert args["product_type"] == "hotels"
    assert args["hotel_id"] == 42
    assert args["check_in"] == "2026-09-01"


def test_checkout_args_ploskie_plus_override():
    args = checkout_args(RAIL_OFFER, car_number=5, seat_numbers=[11, 12])
    assert args["train_number"] == "742У"
    assert args["car_number"] == 5


def test_seatmap_args_trebuet_details_ref():
    assert seatmap_args(RAIL_OFFER)["details_ref"] == RAIL_OFFER["details_ref"]
    with pytest.raises(ValueError):
        seatmap_args({"checkout_ref": {}})


def test_neponyatnyj_offer():
    with pytest.raises(ValueError):
        product_type_of({"foo": 1})
