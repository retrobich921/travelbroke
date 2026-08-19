# Как работать с кодом TravelBroke

## Требования

- Python 3.12+ и [uv](https://docs.astral.sh/uv/) — зависимости и venv только через него.
- Node 22+ — фронтенд.
- Docker (необязательно) — для проверки боевой сборки целиком.

## Поднять проект

```powershell
uv sync                                        # бэкенд строго по uv.lock
uv run uvicorn travelbroke.api:app --reload    # http://127.0.0.1:8000

cd web
npm ci                                         # фронтенд строго по package-lock.json
npm run dev                                    # http://localhost:5173
```

Дев-сервер Vite проксирует `/api` на `127.0.0.1:8000`, поэтому фронтенд и бэкенд
поднимаются независимо. Интерактивная схема API — на `/docs`.

Ключи и регистрация не нужны: MCP Туту открыт, а координаты берутся из локальной
базы GeoNames.

## Проверить перед коммитом

```powershell
uv run ruff check . ; uv run ruff format .     # линт и формат
uv run mypy src                                # типы, strict
uv run pytest -q                               # 66 тестов

cd web
npm run lint                                   # oxlint
npm test                                       # vitest, 18 тестов
npm run build                                  # tsc -b + vite build
```

Ровно это гоняет CI (`.github/workflows/ci.yml`). Зелёный локальный прогон
означает зелёный пайплайн.

## Правила, которые держит не человек, а CI

`tests/test_architecture.py` разбирает исходники и падает, если нарушено
направление зависимостей или пропал docstring у публичного объекта. Это не
бюрократия: без него слои разъезжаются в первый же спешный вечер. Подробности —
в [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

`tests/test_reach.py` сверяет числа из README с тем, что реально считает код.
Продукт продаётся тем, что не показывает цену без подтверждения Туту, — тогда и
в собственной документации завышенных цифр быть не может.

## Соглашения

**Кэш MCP.** По умолчанию `record`: промах идёт в сеть, ответ ложится в
`.mcp_cache/`. Для работы без сети — `TB_CACHE_MODE=replay`. Каталог в
`.gitignore` и в репозиторий не попадает.

**Переменные окружения.**

| Имя | По умолчанию | Зачем |
|---|---|---|
| `TB_CACHE_DIR` | `.mcp_cache` | Где лежит кэш ответов MCP |
| `TB_CACHE_MODE` | `record` | `record` · `replay` · `off` |
| `TB_CACHE_TTL_S` | 7 дней | Сколько живёт запись кэша |

**Стиль.** Python — ruff, длина строки 100, аннотации у публичных функций.
TypeScript — строгий режим, без `any`. Комментарии и docstring на русском:
объясняют «почему», а не пересказывают код.

**Коммиты.** Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`),
тело — что и зачем. Один логический блок — один коммит.

**Ветки.** Задача — отдельная ветка от актуального `main`, перед PR — rebase,
линт и тесты зелёные локально.

## Структура

```
src/travelbroke/     домен: HTTP-фасад, веер запросов, граф маршрутов, справочник
src/tutukit/         обвязка над MCP Туту: compat, client, cache, compact, diagnose
tests/               pytest: разбор ответов, домен, контракт API, границы слоёв
web/                 фронтенд: Vite + React + TypeScript + MapLibre, vitest
docs/                архитектура, ADR, руководство пользователя, факты для питча
recon/               одноразовые скрипты разведки MCP и сырые ответы
deploy/              Caddy и инструкции по выкладке
```

Что где лежит и почему — в [docs/README.md](docs/README.md).
