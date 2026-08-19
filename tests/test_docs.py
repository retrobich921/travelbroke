"""Документация проверяется так же, как код.

Битая ссылка и разъехавшееся число живут в репозитории месяцами, потому что
никто не перечитывает документацию целиком. CI перечитывает.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

LINK = re.compile(r"\[[^\]]*\]\(([^)]+)\)")
EXTERNAL = ("http://", "https://", "mailto:")

DOC_GLOBS = ("*.md", "docs/**/*.md", "deploy/*.md", "web/*.md")


def _documents() -> list[Path]:
    return sorted({path for glob in DOC_GLOBS for path in ROOT.glob(glob)})


def test_documents_exist() -> None:
    """Защита от самого теста: если документы переехали, он не должен молча проходить."""
    names = {path.name for path in _documents()}
    assert {"README.md", "ARCHITECTURE.md", "USER_GUIDE.md", "CONTRIBUTING.md"} <= names


def test_no_broken_relative_links() -> None:
    """Каждая относительная ссылка ведёт в существующий файл."""
    broken: list[str] = []
    for document in _documents():
        for match in LINK.finditer(document.read_text(encoding="utf-8")):
            link = match.group(1).split("#")[0].strip()
            if not link or link.startswith(EXTERNAL):
                continue
            if not (document.parent / link).resolve().exists():
                broken.append(f"{document.relative_to(ROOT).as_posix()} -> {link}")
    assert not broken, f"битые ссылки в документации: {broken}"


def test_readme_points_to_the_docs_index() -> None:
    """С README можно дойти до остальной документации, не зная структуры каталогов."""
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    assert "docs/ARCHITECTURE.md" in readme
    assert "CONTRIBUTING.md" in readme
