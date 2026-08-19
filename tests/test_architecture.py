"""Слои проверяются, а не декларируются.

`docs/ARCHITECTURE.md` обещает строгое направление зависимостей: HTTP → домен →
интеграция, и ни одной стрелки обратно. Обещание в документе живёт ровно до
первого «сейчас быстро импортну и потом вынесу». Эти тесты читают исходники и
падают в CI, если слой полез не туда, — так правило остаётся правдой само.
"""

from __future__ import annotations

import ast
from collections.abc import Iterator
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src"

WEB_FRAMEWORK_PACKAGES = frozenset({"fastapi", "starlette", "uvicorn", "pydantic"})
"""Всё, что делает модуль частью HTTP-слоя."""


def _modules(package: str) -> Iterator[tuple[Path, ast.Module]]:
    """Разобранные исходники пакета вместе с путями — для внятных сообщений."""
    for path in sorted((SRC / package).rglob("*.py")):
        yield path, ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


def _imported_roots(tree: ast.Module) -> set[str]:
    """Корневые пакеты всех импортов модуля.

    Относительные импорты (`from . import x`) пропускаем: они по определению
    не пересекают границу пакета, а значит и слоя.
    """
    roots: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            roots.update(alias.name.split(".", 1)[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            roots.add(node.module.split(".", 1)[0])
    return roots


def test_integration_layer_does_not_know_about_the_domain() -> None:
    """`tutukit` — переиспользуемая обвязка над MCP Туту, а не часть продукта.

    Она ничего не знает ни про города-кандидаты, ни про бюджеты. Как только
    `tutukit` импортирует `travelbroke`, её нельзя будет забрать в другой
    проект, а именно это оправдывает её существование отдельным пакетом.
    """
    for path, tree in _modules("tutukit"):
        assert "travelbroke" not in _imported_roots(tree), (
            f"{path.name} тянет доменный слой: обвязка над MCP должна быть независимой"
        )


def test_domain_layer_does_not_know_about_http() -> None:
    """Домен считает маршруты и не должен знать, кто его вызвал.

    Без этого правила расчёт нельзя запустить из скрипта прогрева, из теста или
    из будущей очереди задач, не подняв заодно веб-приложение.
    """
    for path, tree in _modules("travelbroke"):
        if path.name == "api.py":
            continue  # сам HTTP-слой — ему фреймворк как раз положен
        leaked = _imported_roots(tree) & WEB_FRAMEWORK_PACKAGES
        assert not leaked, (
            f"{path.name} тянет веб-фреймворк {sorted(leaked)}: домен обязан быть без HTTP"
        )


def test_http_layer_holds_no_business_logic() -> None:
    """`api.py` — тонкий фасад: валидация, вызов домена, сериализация.

    Признак сползания логики в контроллеры — импорт вычислительных библиотек
    напрямую в HTTP-слое. Считать маршруты должен домен, а не обработчик.
    """
    tree = ast.parse((SRC / "travelbroke" / "api.py").read_text(encoding="utf-8"))
    assert "networkx" not in _imported_roots(tree), (
        "графовые расчёты просочились в HTTP-слой — их место в travelbroke.reach"
    )


def test_every_module_is_documented() -> None:
    """У каждого модуля есть docstring: это первое, что читает и человек, и AI-проверка."""
    undocumented = [
        path.name
        for package in ("travelbroke", "tutukit")
        for path, tree in _modules(package)
        if path.name != "__main__.py" and not ast.get_docstring(tree)
    ]
    assert not undocumented, f"модули без docstring: {undocumented}"


def test_public_functions_are_documented() -> None:
    """Публичные функции и классы объясняют себя сами.

    Приватные (`_helper`) пропускаем намеренно: требовать docstring от каждой
    трёхстрочной вспомогательной функции — это шум, а не документация.
    """
    undocumented: list[str] = []
    for package in ("travelbroke", "tutukit"):
        for path, tree in _modules(package):
            for node in tree.body:
                if not isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef):
                    continue
                if node.name.startswith("_"):
                    continue
                if not ast.get_docstring(node):
                    undocumented.append(f"{path.name}:{node.name}")
    assert not undocumented, f"публичные объекты без docstring: {undocumented}"
