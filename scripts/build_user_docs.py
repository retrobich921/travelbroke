"""Собирает руководство пользователя в одну самодостаточную HTML-страницу.

Судьи открывают документацию по ссылке, а не клонируют репозиторий, поэтому
Markdown нужно отдать как обычный сайт. Страница получается без внешних
зависимостей: стили внутри, шрифты — системные, ни одного запроса наружу.
Значит, она откроется и с плохой сети, и когда угодно после хакатона.

Запуск:

    uv run --with markdown python scripts/build_user_docs.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "USER_GUIDE.md"
TARGET = ROOT / "deploy" / "docs" / "index.html"

TITLE = "TravelBroke — руководство пользователя"
DESCRIPTION = "Ты на мели. Мы всё равно тебя увезём. Как пользоваться картой досягаемости."

STYLE = """
:root {
  --bg: oklch(14.5% 0.028 277);
  --panel: oklch(19% 0.03 277);
  --ink: oklch(96% 0.012 277);
  --muted: oklch(70.5% 0.03 283);
  --line: oklch(31% 0.035 277);
  --lime: oklch(93.4% 0.223 122.3);
  --violet: oklch(66% 0.2 283);
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body { overflow-x: clip; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 16px/1.65 "Onest", "Segoe UI", system-ui, sans-serif;
  -webkit-text-size-adjust: 100%;
}
.band {
  background: oklch(29% 0.155 284);
  border-bottom: 1px solid var(--line);
  padding: 28px 20px;
}
.wrap { max-width: 46rem; margin: 0 auto; padding: 0 20px; }
.band .wrap { padding: 0; }
.brand {
  font-weight: 800;
  font-size: 1.25rem;
  letter-spacing: -0.05em;
  text-decoration: none;
  color: var(--ink);
}
.brand span { color: var(--lime); }
.tagline { margin: 10px 0 0; color: oklch(81% 0.05 288); }
main { padding: 32px 0 72px; }
h1 { font-size: 1.9rem; line-height: 1.15; letter-spacing: -0.03em; margin: 0 0 8px; }
h2 {
  font-size: 1.3rem;
  letter-spacing: -0.02em;
  margin: 40px 0 12px;
  padding-top: 20px;
  border-top: 1px solid var(--line);
}
h3 { font-size: 1.05rem; margin: 26px 0 8px; }
p, li { color: oklch(88% 0.02 280); }
a { color: var(--lime); text-decoration-thickness: 1px; text-underline-offset: 2px; }
a:hover { color: var(--ink); }
strong { color: var(--ink); }
code {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.86em;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 1px 5px;
}
pre {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 14px 16px;
  overflow-x: auto;
}
pre code { background: none; border: 0; padding: 0; }
blockquote {
  margin: 20px 0;
  padding: 2px 0 2px 16px;
  border-left: 2px solid var(--lime);
  color: var(--muted);
}
table { width: 100%; border-collapse: collapse; margin: 18px 0; display: block; overflow-x: auto; }
th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--line); }
th { color: var(--muted); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; }
hr { border: 0; border-top: 1px solid var(--line); margin: 32px 0; }
/* В Markdown разделы уже отбиты «---», а h2 рисует свою линию — убираем вторую. */
hr + h2 { border-top: 0; padding-top: 0; margin-top: 24px; }
ol, ul { padding-left: 22px; }
li { margin: 5px 0; }
footer {
  border-top: 1px solid var(--line);
  padding: 22px 0 40px;
  color: var(--muted);
  font-size: 0.85rem;
}
footer a { color: var(--muted); }
@media (max-width: 640px) {
  body { font-size: 15px; }
  h1 { font-size: 1.5rem; }
}
"""

PAGE = """<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="description" content="{description}">
<title>{title}</title>
<style>{style}</style>
</head>
<body>
<div class="band">
  <div class="wrap">
    <a class="brand" href="{app_url}">Travel<span>Broke</span></a>
    <p class="tagline">Руководство пользователя</p>
  </div>
</div>
<main class="wrap">
{body}
</main>
<div class="wrap">
  <footer>
    <a href="{app_url}">Открыть TravelBroke</a> ·
    <a href="{repo_url}">Исходный код и техническая документация</a>
  </footer>
</div>
</body>
</html>
"""

APP_URL = "http://79.137.248.221:7777/"
REPO_URL = "https://github.com/retrobich921/travelbroke"


def _slug(text: str) -> str:
    """Якорь в том же виде, в каком его делает GitHub, — оглавление уже на него ссылается."""
    cleaned = re.sub(r"[^\w\s-]", "", text.strip().lower(), flags=re.UNICODE)
    return re.sub(r"[\s]+", "-", cleaned)


def render(markdown_text: str) -> str:
    """Markdown в HTML с якорями у заголовков."""
    import markdown

    html = markdown.markdown(
        markdown_text,
        extensions=["tables", "fenced_code", "sane_lists", "toc"],
        extension_configs={"toc": {"slugify": lambda value, _sep: _slug(value)}},
    )
    # Первый заголовок дублирует шапку страницы — убираем, чтобы не двоилось.
    return re.sub(r"^<h1[^>]*>.*?</h1>\s*", "", html, count=1, flags=re.S)


def main() -> int:
    """Собирает страницу и кладёт её туда, откуда её отдаёт nginx."""
    if not SOURCE.exists():
        print(f"нет исходника: {SOURCE}", file=sys.stderr)
        return 1

    body = render(SOURCE.read_text(encoding="utf-8"))
    page = PAGE.format(
        title=TITLE,
        description=DESCRIPTION,
        style=STYLE,
        body=body,
        app_url=APP_URL,
        repo_url=REPO_URL,
    )
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(page, encoding="utf-8")
    print(f"собрано: {TARGET.relative_to(ROOT)} ({len(page) // 1024} КБ)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
