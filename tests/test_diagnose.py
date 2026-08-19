import datetime as dt

from tutukit.diagnose import EmptyReason, ambiguity_warning, diagnose

TODAY = dt.date(2026, 8, 17)
EMPTY = {"offers": [], "meta": {"total_matched": 0}}


def test_est_rezultaty():
    d = diagnose(
        "search_rail",
        {"departure_date": "2026-09-01"},
        {"offers": [{"a": 1}]},
        today=TODAY,
    )
    assert d.reason is EmptyReason.OK
    assert not d.empty


def test_data_v_proshlom():
    d = diagnose("search_avia", {"departure_date": "2020-01-01"}, EMPTY, today=TODAY)
    assert d.reason is EmptyReason.PAST_DATE
    assert "прошла" in d.message


def test_za_gorizontom_prodazh_u_kazhdogo_transporta_svoj():
    args = {"departure_date": "2026-11-15"}  # +90 дней
    assert diagnose("search_bus", args, EMPTY, today=TODAY).reason is EmptyReason.BEYOND_HORIZON
    # для авиа +90 дней — нормальный горизонт, значит причина другая
    assert diagnose("search_avia", args, EMPTY, today=TODAY).reason is EmptyReason.NO_OPTIONS


def test_slishkom_zhestkie_filtry():
    d = diagnose(
        "search_avia",
        {"departure_date": "2026-09-01", "direct_only": True, "price_max": 8000},
        EMPTY,
        today=TODAY,
    )
    assert d.reason is EmptyReason.FILTERS_TOO_STRICT
    assert "direct_only" in (d.hint or "")


def test_vyklyuchennyj_filtr_ne_schitaetsya():
    d = diagnose(
        "search_avia",
        {"departure_date": "2026-09-01", "direct_only": False},
        EMPTY,
        today=TODAY,
    )
    assert d.reason is EmptyReason.NO_OPTIONS


def test_omonim_rostov_lovitsya():
    data = {
        "offers": [{"x": 1}],
        "meta": {"to": {"name": "Ростов-на-Дону", "region": "Ростовская область"}},
    }
    warn = ambiguity_warning({"destination": "Ростов"}, data)
    assert warn and "Ростов-на-Дону" in warn


def test_sinonim_piter_ne_schitaetsya_neodnoznachnostyu():
    data = {"offers": [], "meta": {"from": {"name": "Санкт-Петербург"}}}
    assert ambiguity_warning({"origin": "Питер"}, data) is None


def test_also_named_vyvoditsya():
    data = {
        "meta": {"to": {"name": "Ростов", "also_named": ["Ростов-на-Дону"]}},
        "offers": [],
    }
    warn = ambiguity_warning({"destination": "Ростов"}, data)
    assert warn and "другие варианты" in warn
