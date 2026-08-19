"""Асинхронный клиент MCP-сервера Туту (streamable HTTP, без авторизации)."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Self, cast

import httpx

from .cache import CacheMiss, DiskCache
from .compat import normalize

log = logging.getLogger(__name__)

DEFAULT_URL = "https://mcp.tutu.ru/mcp"
# худшее замеренное время одиночного вызова — 13.2 с (см. MCP_RECON.md)
DEFAULT_TIMEOUT = 25.0


class TutuError(Exception):
    """Базовая ошибка работы с MCP Туту."""


class ToolCallError(TutuError):
    """Сервер принял запрос, но инструмент вернул ошибку (валидация, резолв гео)."""

    def __init__(self, tool: str, message: str) -> None:
        super().__init__(f"{tool}: {message}")
        self.tool = tool
        self.message = message


class TransportError(TutuError):
    """Сеть, таймаут, 5xx — повторяемая ошибка."""


@dataclass(slots=True)
class CallStat:
    """Учёт одного вызова MCP: чем он был и во что обошёлся.

    По этим записям считается и строка «N запросов к Туту, M из кэша» в
    интерфейсе, и полоса расчёта на стартовом экране.
    """

    tool: str
    elapsed_s: float
    size_b: int
    cached: bool


@dataclass(slots=True)
class TutuMCP:
    """Один вызов = `await mcp.call("search_rail", origin=..., destination=...)`.

    Делает три вещи, которых нет в голом HTTP: чинит известные грабли аргументов
    (`compat.normalize`), ретраит транспортные сбои и кэширует ответы на диск.
    """

    url: str = DEFAULT_URL
    timeout: float = DEFAULT_TIMEOUT
    retries: int = 2
    concurrency: int = 6
    cache: DiskCache | None = None
    stats: list[CallStat] = field(default_factory=list)
    _client: httpx.AsyncClient | None = field(default=None, init=False, repr=False)
    _sem: asyncio.Semaphore | None = field(default=None, init=False, repr=False)
    _id: int = field(default=0, init=False, repr=False)

    async def __aenter__(self) -> Self:
        self._client = httpx.AsyncClient(
            timeout=self.timeout,
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream",
            },
        )
        self._sem = asyncio.Semaphore(self.concurrency)
        return self

    async def __aexit__(self, *exc: object) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def call(self, tool: str, **args: Any) -> dict[str, Any]:
        """Вызов инструмента. Возвращает распакованный payload (не MCP-обёртку)."""
        args, notes = normalize(tool, args)
        for note in notes:
            log.info("compat %s: %s", tool, note)

        if self.cache is not None:
            hit = self.cache.get(tool, args)
            if hit is not None:
                self.stats.append(CallStat(tool, 0.0, len(json.dumps(hit)), True))
                return hit

        payload = await self._rpc("tools/call", {"name": tool, "arguments": args})
        data = _unwrap(tool, payload)
        if self.cache is not None:
            self.cache.put(tool, args, data)
        return data

    async def list_tools(self) -> list[dict[str, Any]]:
        payload = await self._rpc("tools/list", {})
        return cast(list[dict[str, Any]], payload.get("result", {}).get("tools", []))

    async def fetch_resource(self, uri: str) -> dict[str, Any]:
        return await self.call("fetch_resource", uri=uri)

    async def _rpc(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        if self._client is None or self._sem is None:
            raise TutuError("клиент не открыт: используй `async with TutuMCP() as mcp`")
        self._id += 1
        body = {"jsonrpc": "2.0", "id": self._id, "method": method, "params": params}
        tool = str(params.get("name", method))

        last: Exception | None = None
        for attempt in range(self.retries + 1):
            t0 = time.perf_counter()
            try:
                async with self._sem:
                    resp = await self._client.post(self.url, json=body)
                if resp.status_code >= 500:
                    raise TransportError(f"{resp.status_code} от сервера")
                resp.raise_for_status()
                data = _parse(resp.text)
                dt = time.perf_counter() - t0
                self.stats.append(CallStat(tool, dt, len(resp.content), False))
                log.debug("%s: %.2fs, %d КБ", tool, dt, len(resp.content) // 1024)
                return data
            except (httpx.HTTPError, TransportError) as e:
                last = e
                if attempt < self.retries:
                    delay = 0.5 * 2**attempt
                    log.warning("%s: %s, повтор через %.1fs", tool, e, delay)
                    await asyncio.sleep(delay)
        raise TransportError(f"{tool}: {last}") from last

    def report(self) -> str:
        """Однострочная сводка по вызовам — для лога и для демо."""
        if not self.stats:
            return "вызовов не было"
        live = [s for s in self.stats if not s.cached]
        cached = len(self.stats) - len(live)
        total_kb = sum(s.size_b for s in self.stats) // 1024
        slowest = max(live, key=lambda s: s.elapsed_s, default=None)
        tail = f", медленнее всех {slowest.tool} {slowest.elapsed_s:.1f}s" if slowest else ""
        return f"вызовов {len(self.stats)} (из кэша {cached}), {total_kb} КБ{tail}"


def _parse(text: str) -> dict[str, Any]:
    """JSON или SSE-кадры (сервер вправе ответить и так, и так)."""
    stripped = text.lstrip()
    if stripped.startswith(("event:", "data:")):
        chunks = [ln[5:].strip() for ln in text.splitlines() if ln.startswith("data:")]
        text = chunks[-1] if chunks else text
    try:
        return cast(dict[str, Any], json.loads(text))
    except json.JSONDecodeError as e:
        raise TutuError(f"не разобрал ответ: {text[:200]}") from e


def _unwrap(tool: str, payload: dict[str, Any]) -> dict[str, Any]:
    """MCP-обёртка -> полезная нагрузка."""
    if "error" in payload:
        raise ToolCallError(tool, str(payload["error"].get("message", payload["error"])))
    result = payload.get("result", {})
    if result.get("isError"):
        text = (result.get("content") or [{}])[0].get("text", "неизвестная ошибка")
        raise ToolCallError(tool, text)
    if "structuredContent" in result:
        return cast(dict[str, Any], result["structuredContent"])
    blocks = result.get("content") or []
    if blocks and blocks[0].get("type") == "text":
        raw = blocks[0]["text"]
        try:
            return cast(dict[str, Any], json.loads(raw))
        except json.JSONDecodeError:
            return {"text": raw}
    return cast(dict[str, Any], result)


__all__ = [
    "DEFAULT_URL",
    "CacheMiss",
    "CallStat",
    "DiskCache",
    "ToolCallError",
    "TransportError",
    "TutuError",
    "TutuMCP",
]
