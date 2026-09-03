"""Графики для питча TravelBroke.

Источники данных:
- Росстат, выборочное наблюдение за апрель 2025 (95 400 организаций, 28,4 млн
  работников) — распределение работников по размерам начисленной зарплаты.
- Опрос финтех-группы «Займер», лето 2026 (3 000+ респондентов) — бюджет
  отпуска, доля не поехавших и структура направлений.

Запуск:
    uv run --with matplotlib --with numpy --with scipy python scripts/make_pitch_charts.py
"""

from __future__ import annotations

import math
from pathlib import Path

import matplotlib as mpl
import matplotlib.pyplot as plt
import numpy as np
from scipy.interpolate import PchipInterpolator

OUT = Path(__file__).resolve().parent.parent / "docs" / "img"


# --- палитра проекта (OKLCH -> sRGB), чтобы слайды совпадали с интерфейсом ---


def oklch(light: float, chroma: float, hue_deg: float) -> str:
    """OKLCH в hex sRGB. light в долях (0..1), hue в градусах."""
    h = math.radians(hue_deg)
    a, b = chroma * math.cos(h), chroma * math.sin(h)

    l_ = light + 0.3963377774 * a + 0.2158037573 * b
    m_ = light - 0.1055613458 * a - 0.0638541728 * b
    s_ = light - 0.0894841775 * a - 1.2914855480 * b
    l3, m3, s3 = l_**3, m_**3, s_**3

    rgb = (
        +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
        -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
        -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3,
    )

    def gamma(c: float) -> int:
        c = max(0.0, min(1.0, c))
        c = 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055
        return round(max(0.0, min(1.0, c)) * 255)

    return "#{:02x}{:02x}{:02x}".format(*(gamma(c) for c in rgb))


# Светлая тема: те же тона, но шаги подобраны под белую подложку.
# Пара HERO/ACCENT проверена валидатором палитры: контраст к фону >= 3:1,
# CVD-разделение 34.2 (deutan), нормальное зрение 38.4.
BG = "#ffffff"  # подложка
PANEL = "#ffffff"  # плита
INK = oklch(0.22, 0.020, 277)  # основной текст
MUTED = oklch(0.52, 0.020, 277)  # вторичный текст
LINE = oklch(0.90, 0.010, 277)  # волосяная линейка
HERO = oklch(0.62, 0.160, 128)  # зелёный — главные числа
ACCENT = oklch(0.52, 0.220, 283)  # фиолет — акцент

mpl.rcParams.update(
    {
        "figure.facecolor": BG,
        "axes.facecolor": BG,
        "savefig.facecolor": BG,
        "text.color": INK,
        "axes.labelcolor": MUTED,
        "xtick.color": MUTED,
        "ytick.color": MUTED,
        "axes.edgecolor": LINE,
        "font.family": ["Onest", "Segoe UI", "DejaVu Sans"],
        "font.size": 15,
        "axes.spines.top": False,
        "axes.spines.right": False,
        "figure.dpi": 160,
    }
)


def _frame(ax: plt.Axes) -> None:
    ax.grid(axis="y", color=LINE, linewidth=0.8, alpha=0.55)
    ax.set_axisbelow(True)
    ax.tick_params(length=0)
    for side in ("left", "bottom"):
        ax.spines[side].set_linewidth(0.8)


# --- график 1: плотность распределения зарплат -------------------------------

# Росстат, апрель 2025. Границы диапазонов в тыс. руб. и доля работников, %.
BUCKETS: list[tuple[float, float, float]] = [
    (0.0, 22.4, 2.6),
    (22.4, 40.0, 15.2),
    (40.0, 60.0, 20.2),
    (60.0, 80.0, 17.0),
    (80.0, 100.0, 13.1),
    (100.0, 150.0, 17.2),
    (150.0, 200.0, 6.9),
    (200.0, 400.0, 6.3),
    (400.0, 600.0, 1.5),  # верхняя граница открыта, срезана для масштаба
]


def salary_chart() -> None:
    # доля делится на ширину диапазона: иначе широкий «200-400» врал бы вверх
    mids = np.array([(lo + hi) / 2 for lo, hi, _ in BUCKETS])
    density = np.array([share / (hi - lo) * 10 for lo, hi, share in BUCKETS])

    curve = PchipInterpolator(mids, density)
    xs = np.linspace(0, 300, 900)
    ys = np.clip(curve(xs), 0, None)

    fig, ax = plt.subplots(figsize=(12.8, 6.4))

    below = xs <= 100
    ax.fill_between(xs[below], ys[below], color=HERO, alpha=0.22, linewidth=0)
    ax.fill_between(xs[~below], ys[~below], color=ACCENT, alpha=0.14, linewidth=0)
    ax.plot(xs, ys, color=HERO, linewidth=2.4, solid_capstyle="round")

    ax.axvline(100, color=MUTED, linewidth=1.2, linestyle=(0, (4, 4)))

    ax.annotate(
        "68% работников\nполучают меньше 100 000 ₽",
        xy=(44, 6.4),
        color=INK,
        fontsize=18,
        fontweight="bold",
        ha="center",
        linespacing=1.45,
    )
    ax.annotate(
        "самая частая зарплата — 40–60 тысяч",
        xy=(50, 10.1),
        xytext=(122, 11.0),
        color=MUTED,
        fontsize=14,
        arrowprops={
            "arrowstyle": "-",
            "color": MUTED,
            "linewidth": 1.0,
            "connectionstyle": "arc3,rad=-0.18",
        },
    )
    ax.annotate("32%", xy=(150, 1.0), color=ACCENT, fontsize=16, fontweight="bold")
    ax.annotate("100 тыс.", xy=(103, 11.4), color=MUTED, fontsize=13)

    ax.set_xlim(0, 300)
    ax.set_ylim(0, 12.2)
    ax.set_xticks([0, 50, 100, 150, 200, 250, 300])
    ax.set_xticklabels(["0", "50", "100", "150", "200", "250", "300"])
    ax.set_xlabel("зарплата, тыс. ₽", labelpad=10)
    ax.set_yticks([])
    ax.spines["left"].set_visible(False)
    _frame(ax)
    ax.grid(False)

    fig.text(
        0.075,
        0.925,
        "Сколько зарабатывают россияне",
        color=INK,
        fontsize=27,
        fontweight="bold",
        va="top",
    )
    fig.text(
        0.075,
        0.855,
        "распределение работников по размеру зарплаты",
        color=MUTED,
        fontsize=15,
        va="top",
    )
    fig.text(
        0.075,
        0.075,
        "Росстат, апрель 2025 · 28,4 млн работников в 95 400 организациях.\n"
        "Высота кривой — доля работников на каждые 10 тыс. ₽; хвост выше 300 тыс. срезан.",
        color=MUTED,
        fontsize=11.5,
        va="top",
        linespacing=1.5,
    )

    fig.subplots_adjust(left=0.075, right=0.975, top=0.78, bottom=0.22)
    fig.savefig(OUT / "salary_distribution.png")
    plt.close(fig)


# --- график 2: бюджет отпуска -------------------------------------------------

# Опрос финтех-группы «Займер», лето 2026, более 3 000 респондентов.
BUDGET = [("до 50", 50), ("50–100", 34), ("100–200", 11), ("более 200", 5)]


def budget_chart() -> None:
    labels = [name for name, _ in BUDGET]
    shares = [share for _, share in BUDGET]
    colors = [HERO, HERO, ACCENT, ACCENT]

    fig, ax = plt.subplots(figsize=(12.8, 6.4))
    bars = ax.bar(labels, shares, width=0.42, color=colors, zorder=3)

    for rect, share in zip(bars, shares, strict=True):
        ax.annotate(
            f"{share}%",
            xy=(rect.get_x() + rect.get_width() / 2, share),
            xytext=(0, 10),
            textcoords="offset points",
            ha="center",
            color=INK,
            fontsize=21,
            fontweight="bold",
        )

    # скоба над двумя первыми столбцами: 84% укладываются в 100 тысяч
    ax.plot([0, 0, 1, 1], [60, 63, 63, 60], color=MUTED, linewidth=1.2, clip_on=False)
    ax.annotate(
        "84% укладываются в 100 000 ₽",
        xy=(0.5, 65),
        ha="center",
        color=INK,
        fontsize=19,
        fontweight="bold",
    )

    ax.set_ylim(0, 78)
    ax.set_yticks([0, 20, 40, 60])
    ax.set_yticklabels(["0", "20", "40", "60%"])
    ax.set_xlabel("бюджет поездки, тыс. ₽", labelpad=10)
    _frame(ax)

    fig.text(
        0.075,
        0.925,
        "Сколько люди готовы потратить на отпуск",
        color=INK,
        fontsize=27,
        fontweight="bold",
        va="top",
    )
    fig.text(
        0.075,
        0.855,
        "планируемый бюджет летней поездки, доля опрошенных",
        color=MUTED,
        fontsize=15,
        va="top",
    )
    fig.text(
        0.075,
        0.075,
        "Опрос финтех-группы «Займер», лето 2026, более 3 000 респондентов.\n"
        "В том же опросе: 27% хотели бы отдохнуть, но не могут себе позволить.",
        color=MUTED,
        fontsize=11.5,
        va="top",
        linespacing=1.5,
    )

    fig.subplots_adjust(left=0.075, right=0.975, top=0.78, bottom=0.22)
    fig.savefig(OUT / "vacation_budget.png")
    plt.close(fig)


# --- график 3: куда на самом деле едут ---------------------------------------

DESTINATIONS = [
    ("дача", 33),
    ("активный отдых", 22),
    ("к родственникам", 17),
    ("пляжные курорты", 15),
    ("туризм по России", 7),
    ("за границу", 6),
]


def destinations_chart() -> None:
    labels = [name for name, _ in DESTINATIONS][::-1]
    shares = [share for _, share in DESTINATIONS][::-1]
    # дача и «к родственникам» — то, что выбирают не от хорошей жизни
    colors = [ACCENT if name in ("дача", "к родственникам") else LINE for name in labels]

    fig, ax = plt.subplots(figsize=(12.8, 6.4))
    bars = ax.barh(labels, shares, height=0.5, color=colors, zorder=3)

    for rect, share in zip(bars, shares, strict=True):
        ax.annotate(
            f"{share}%",
            xy=(share, rect.get_y() + rect.get_height() / 2),
            xytext=(10, 0),
            textcoords="offset points",
            va="center",
            color=INK,
            fontsize=18,
            fontweight="bold",
        )

    ax.set_xlim(0, 41)
    ax.set_xticks([])
    ax.grid(False)
    ax.spines["bottom"].set_visible(False)
    ax.tick_params(axis="y", labelsize=17)

    ax.annotate(
        "половина отпусков —\nдача и родственники",
        xy=(25.5, 1.7),
        color=ACCENT,
        fontsize=17,
        fontweight="bold",
        linespacing=1.5,
    )

    fig.text(
        0.075,
        0.925,
        "Куда люди едут в отпуск на самом деле",
        color=INK,
        fontsize=27,
        fontweight="bold",
        va="top",
    )
    fig.text(0.075, 0.855, "доля опрошенных, лето 2026", color=MUTED, fontsize=15, va="top")
    fig.text(
        0.075,
        0.075,
        "Опрос финтех-группы «Займер», лето 2026, более 3 000 респондентов.",
        color=MUTED,
        fontsize=11.5,
        va="top",
        linespacing=1.5,
    )

    fig.subplots_adjust(left=0.20, right=0.975, top=0.78, bottom=0.22)
    fig.savefig(OUT / "vacation_destinations.png")
    plt.close(fig)


# --- график 4: слепое пятно «куда вообще можно» -------------------------------


def unknown_map_chart() -> None:
    """Карта: один проверенный город против всего каталога вслепую."""
    from travelbroke.cities import global_catalog

    cities = [c for c, _ in global_catalog()]
    lons = np.array([c.lon for c in cities])
    lats = np.array([c.lat for c in cities])

    def find(name: str):
        for c in cities:
            if c.name == name or name in c.aliases:
                return c
        return None

    origin = find("Moscow") or find("Москва")
    known = find("Sochi") or find("Сочи")

    fig, ax = plt.subplots(figsize=(12.8, 6.4))
    ax.scatter(lons, lats, s=9, color=oklch(0.80, 0.012, 277), linewidths=0, zorder=2)

    for city, color, label, dy in (
        (origin, INK, "ты здесь", 6),
        (known, ACCENT, "единственный город,\nкоторый ты проверил", 7),
    ):
        if city is None:
            continue
        ax.scatter(
            [city.lon], [city.lat], s=170, color=color, zorder=4, edgecolors=BG, linewidths=2
        )
        ax.annotate(
            label,
            xy=(city.lon, city.lat),
            xytext=(city.lon + 6, city.lat + dy),
            color=color,
            fontsize=15,
            fontweight="bold",
            linespacing=1.4,
            arrowprops={"arrowstyle": "-", "color": color, "linewidth": 1.2},
            zorder=5,
        )

    ax.set_xlim(-25, 190)
    ax.set_ylim(-45, 82)
    ax.set_xticks([])
    ax.set_yticks([])
    for side in ("left", "bottom"):
        ax.spines[side].set_visible(False)
    ax.grid(False)

    fig.text(
        0.075,
        0.925,
        "Проблема не в цене. Проблема в том, что ты не знаешь куда",
        color=INK,
        fontsize=25,
        fontweight="bold",
        va="top",
    )
    fig.text(
        0.075,
        0.855,
        "3 393 города в каталоге. Проверить их руками невозможно — поиск просит назвать один",
        color=MUTED,
        fontsize=15,
        va="top",
    )

    ax.annotate(
        "3 392 города,\nо которых ты ничего не знаешь",
        xy=(-20, -28),
        color=MUTED,
        fontsize=17,
        linespacing=1.5,
    )

    fig.subplots_adjust(left=0.03, right=0.97, top=0.80, bottom=0.05)
    fig.savefig(OUT / "unknown_map.png")
    plt.close(fig)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    salary_chart()
    budget_chart()
    destinations_chart()
    unknown_map_chart()
    print(f"saved to {OUT}")
