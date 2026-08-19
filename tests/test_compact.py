import json
from pathlib import Path

import pytest

from tutukit.compact import compact_search

RAW = Path(__file__).resolve().parents[1] / "recon" / "raw"

OFFER = {
    "offer_id": "abc",
    "transport": "railway",
    "price": {"amount": 1140.98, "currency": "RUB"},
    "duration_min": 345,
    "carriers": ["ФПК"],
    "segments_count": 1,
    "departure_at": "2026-09-01T06:00:00+03:00",
    "arrival_at": "2026-09-01T11:45:00+03:00",
    "legs": [
        {
            "from": "Москва — Курская",
            "to": "Санкт-Петербург",
            "segments": [{"x": "y" * 500}],
        }
    ],
    "review_summary": {"rating": 9.6, "texts": [{"text": "z" * 2000}]},
    "fares": {"count": 20, "price_from": 1140.98, "seat_categories": ["купе"]},
    "details_ref": {"train_number": "742У", "junk": "j" * 1000},
    "checkout_ref": {"offer_hash": "h"},
}


def test_tyazheloe_uhodit_v_refs_a_ne_v_view():
    small = compact_search({"offers": [OFFER], "meta": {"total_matched": 46, "has_more": True}})
    assert small.after_b < small.before_b / 3
    body = json.dumps(small.view, ensure_ascii=False)
    assert "details_ref" not in body and "checkout_ref" not in body
    assert small.refs["abc"]["details_ref"]["train_number"] == "742У"


def test_klyuchevye_polya_ostayutsya():
    row = compact_search({"offers": [OFFER]}).view["offers"][0]
    assert row["price"] == "1140.98 RUB"  # цену не округляем
    assert row["transfers"] == 0
    assert row["rating"] == 9.6
    assert row["route"] == "Москва — Курская → Санкт-Петербург"
    assert row["fares"]["seat_categories"] == ["купе"]


def test_limit_rezhet_spisok():
    small = compact_search({"offers": [OFFER | {"offer_id": str(i)} for i in range(10)]}, limit=3)
    assert len(small.view["offers"]) == 3
    assert len(small.refs) == 3
    assert "shown" in small.view


def test_otel_cena_pomechena_kak_itog_za_period():
    hotel = {
        "hotel_id": 42,
        "name": "Отель",
        "stars": 4,
        "rating": 8.9,
        "review_count": 120,
        "best_offer": {
            "room_name": "Стандарт",
            "price": {"amount": 11980.0, "currency": "RUB"},
            "price_basis": "stay_total",
            "free_cancellation": True,
        },
        "checkout_ref": {"hotel_alias": "x"},
    }
    row = compact_search({"hotels": [hotel]}).view["hotels"][0]
    assert row["price_stay_total"] == "11980.0 RUB"
    assert row["free_cancellation"] is True


def test_bez_spiska_vozvrashchaem_kak_est():
    data = {"kind": "deeplink", "checkout_url": "https://..."}
    assert compact_search(data).view == data


@pytest.mark.parametrize(
    "name",
    ["01_search_rail.json", "04_search_hotels.json", "05_search_multitransport.json"],
)
def test_na_realnyh_otvetah_servera(name):
    """Проверка на сырых ответах разведки: жмём в разы, refs не теряем."""
    path = RAW / name
    if not path.exists():
        pytest.skip("нет recon/raw — запусти recon/probe.py")
    data = json.loads(path.read_text(encoding="utf-8"))["data"]
    small = compact_search(data)
    assert small.ratio < 0.35
    assert small.refs
