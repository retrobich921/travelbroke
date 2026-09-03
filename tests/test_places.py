"""Отбор достопримечательностей.

Проверяем `select` на фикстуре, а не на живой Википедии: тест должен падать от
ошибки в отборе, а не от того, что кто-то переписал статью про Кремль.
"""

from __future__ import annotations

from typing import Any

from travelbroke.places import MAX_PER_KIND, select


def page(
    pageid: int,
    title: str,
    description: str = "",
    *,
    lat: float = 55.75,
    lon: float = 37.62,
    length: int = 20_000,
    image: str | None = None,
) -> dict[str, Any]:
    """Страница Википедии в том виде, в каком её отдаёт geosearch."""
    return {
        "pageid": pageid,
        "title": title,
        "description": description,
        "length": length,
        "coordinates": [{"lat": lat, "lon": lon}],
        "thumbnail": {"source": image or f"https://upload.wikimedia.org/{pageid}.jpg"},
    }


def test_page_without_photo_or_coordinates_is_skipped() -> None:
    """Без фотографии показывать нечего, без координат нельзя разнести точки."""
    blind = {"pageid": 1, "title": "Без фото", "coordinates": [{"lat": 55.0, "lon": 37.0}]}
    lost = {"pageid": 2, "title": "Без координат", "thumbnail": {"source": "http://x/2.jpg"}}

    assert select([blind, lost], "Москва") == []


def test_same_photo_is_not_shown_twice() -> None:
    """Одна фотография может стоять в нескольких статьях — в подборке она одна."""
    shared = "https://upload.wikimedia.org/shared.jpg"
    pages = [
        page(1, "Первый музей", "музей", lat=55.75, lon=37.62, image=shared),
        page(2, "Второй музей", "музей", lat=55.90, lon=37.90, image=shared),
    ]

    assert len(select(pages, "Москва")) == 1


# Главное требование заказчика: не десять ракурсов одного Кремля. Объекты,
# стоящие вплотную, — это одна и та же точка города, даже если статьи разные.
def test_landmarks_standing_next_to_each_other_collapse_to_one() -> None:
    pages = [
        page(1, "Спасская башня", "башня", lat=55.7520, lon=37.6210),
        page(2, "Никольская башня", "башня", lat=55.7527, lon=37.6175),
        page(3, "Троицкая башня", "башня", lat=55.7513, lon=37.6155),
    ]

    chosen = select(pages, "Москва")

    assert len(chosen) == 1


def test_one_kind_does_not_take_over_the_whole_selection() -> None:
    """Восемь мечетей подряд — это не «что посмотреть в городе»."""
    pages = [
        page(index, f"Мечеть №{index}", "мечеть", lat=55.0 + index * 0.02, lon=37.0)
        for index in range(1, 7)
    ]
    pages += [
        page(20, "Городской парк", "парк", lat=56.0, lon=37.0),
        page(21, "Краеведческий музей", "музей", lat=56.1, lon=37.0),
    ]

    kinds = [photo.kind for photo in select(pages, "Город")]

    assert kinds.count("культовое") == MAX_PER_KIND
    assert {"природа", "музей"} <= set(kinds)


def test_significant_articles_come_first() -> None:
    """Размер статьи — прокси значимости: иначе наверх лезет Таможенный мост."""
    pages = [
        page(1, "Проходной мост", "мост", lat=55.0, lon=37.0, length=1_500),
        page(2, "Большой театр", "театр", lat=56.0, lon=37.0, length=180_000),
    ]

    assert next(photo.title for photo in select(pages, "Москва")) == "Большой театр"


def test_junk_is_filtered_out() -> None:
    """Метро, кладбища, события и организации — не достопримечательности."""
    junk = [
        page(1, "Арбатская", "станция метро"),
        page(2, "Ваганьковское кладбище", "кладбище"),
        page(3, "Падение Константинополя (1453)", "осада города"),
        page(4, "НПФ Сбербанка", "пенсионный фонд"),
        page(5, "Дубай (эмират)", "эмират в составе ОАЭ"),
    ]

    assert select(junk, "Москва") == []


def test_article_about_the_city_itself_is_not_a_landmark() -> None:
    """Статья «Пенза» — это не то, что едут смотреть в Пензе."""
    pages = [
        page(1, "Пенза", "город в России"),
        page(2, "Парк Белинского", "парк", lat=53.3, lon=45.1),
    ]

    assert [photo.title for photo in select(pages, "Пенза")] == ["Парк Белинского"]


def test_limit_is_respected() -> None:
    pages = [
        page(index, f"Музей №{index}", "музей", lat=55.0 + index * 0.05, lon=37.0)
        for index in range(1, 12)
    ]

    assert len(select(pages, "Город", limit=3)) == 3
