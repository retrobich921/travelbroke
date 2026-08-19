"""Дисковый кэш ответов MCP + режим replay для демо без сети.

Зачем: 60 команд весь день бьют в один сервер, а на питчинге 20-го демо не должно
зависеть от того, жив ли mcp.tutu.ru. Режим `replay` играет записанные ответы.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, cast

log = logging.getLogger(__name__)

CacheMode = Literal["off", "record", "replay"]


class CacheMiss(RuntimeError):
    """В режиме replay ответа нет — сеть трогать нельзя."""


@dataclass(slots=True)
class DiskCache:
    root: Path
    ttl_s: float = 6 * 3600
    mode: CacheMode = "record"

    def __post_init__(self) -> None:
        self.root = Path(self.root)
        if self.mode != "off":
            self.root.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def key(tool: str, args: dict[str, Any]) -> str:
        blob = json.dumps({"tool": tool, "args": args}, sort_keys=True, ensure_ascii=False)
        return hashlib.sha256(blob.encode()).hexdigest()[:20]

    def _path(self, tool: str, args: dict[str, Any]) -> Path:
        return self.root / tool / f"{self.key(tool, args)}.json"

    def get(self, tool: str, args: dict[str, Any]) -> dict[str, Any] | None:
        if self.mode == "off":
            return None
        path = self._path(tool, args)
        if not path.exists():
            if self.mode == "replay":
                raise CacheMiss(f"{tool}: нет записи для этих аргументов ({path.name})")
            return None
        entry = json.loads(path.read_text(encoding="utf-8"))
        age = time.time() - entry["ts"]
        if self.mode == "record" and age > self.ttl_s:
            log.debug("cache stale: %s (%.0f мин)", tool, age / 60)
            return None
        log.debug("cache hit: %s (%.0f мин)", tool, age / 60)
        return cast(dict[str, Any], entry["data"])

    def put(self, tool: str, args: dict[str, Any], data: dict[str, Any]) -> None:
        if self.mode != "record":
            return
        path = self._path(tool, args)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(
                {"ts": time.time(), "tool": tool, "args": args, "data": data},
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

    def stats(self) -> dict[str, int]:
        if self.mode == "off" or not self.root.exists():
            return {}
        return {
            d.name: len(list(d.glob("*.json"))) for d in sorted(self.root.iterdir()) if d.is_dir()
        }
