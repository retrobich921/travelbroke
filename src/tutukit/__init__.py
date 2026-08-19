"""tutukit — тонкая обвязка над MCP-сервером Туту.

Что даёт поверх голого HTTP:
- `compat` — чинит расхождения инструкций сервера с его же схемами;
- `client` — ретраи, лимит параллельности, статистика вызовов;
- `cache` — дисковый кэш и режим `replay` для демо без сети;
- `compact` — ужимает ответ (160 КБ -> единицы КБ) с индексом refs;
- `diagnose` — объясняет, почему список пустой.
"""

from .cache import CacheMiss, DiskCache
from .client import DEFAULT_URL, ToolCallError, TransportError, TutuError, TutuMCP
from .compact import Compacted, compact_search
from .diagnose import Diagnosis, EmptyReason, ambiguity_warning, diagnose

__all__ = [
    "DEFAULT_URL",
    "CacheMiss",
    "Compacted",
    "Diagnosis",
    "DiskCache",
    "EmptyReason",
    "ToolCallError",
    "TransportError",
    "TutuError",
    "TutuMCP",
    "ambiguity_warning",
    "compact_search",
    "diagnose",
]
