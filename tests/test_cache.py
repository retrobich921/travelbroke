import pytest

from tutukit.cache import CacheMiss, DiskCache

ARGS = {"origin": "Москва", "destination": "Казань"}
DATA = {"offers": [{"offer_id": "1"}]}


def test_zapis_i_chtenie(tmp_path):
    cache = DiskCache(tmp_path)
    assert cache.get("search_rail", ARGS) is None
    cache.put("search_rail", ARGS, DATA)
    assert cache.get("search_rail", ARGS) == DATA


def test_klyuch_ne_zavisit_ot_poryadka_argumentov(tmp_path):
    cache = DiskCache(tmp_path)
    cache.put("search_rail", ARGS, DATA)
    assert cache.get("search_rail", {"destination": "Казань", "origin": "Москва"}) == DATA


def test_raznye_argumenty_raznye_zapisi(tmp_path):
    cache = DiskCache(tmp_path)
    cache.put("search_rail", ARGS, DATA)
    assert cache.get("search_rail", ARGS | {"adults": 2}) is None


def test_protuhshee_ne_otdaetsya(tmp_path):
    cache = DiskCache(tmp_path, ttl_s=-1)
    cache.put("search_rail", ARGS, DATA)
    assert cache.get("search_rail", ARGS) is None


def test_replay_igraet_staroe_ignoriruya_ttl(tmp_path):
    DiskCache(tmp_path).put("search_rail", ARGS, DATA)
    replay = DiskCache(tmp_path, ttl_s=-1, mode="replay")
    assert replay.get("search_rail", ARGS) == DATA


def test_replay_bez_zapisi_padaet_a_ne_lezet_v_set(tmp_path):
    replay = DiskCache(tmp_path, mode="replay")
    with pytest.raises(CacheMiss):
        replay.get("search_avia", ARGS)


def test_rezhim_off_nichego_ne_pishet(tmp_path):
    cache = DiskCache(tmp_path, mode="off")
    cache.put("search_rail", ARGS, DATA)
    assert cache.get("search_rail", ARGS) is None
    assert cache.stats() == {}
