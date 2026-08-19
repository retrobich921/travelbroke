"""Проверки HTTP-слоя, которые не требуют живого MCP-сервера."""

import pytest

from travelbroke import api


@pytest.mark.asyncio
async def test_avia_checkout_keeps_all_passengers(monkeypatch: pytest.MonkeyPatch) -> None:
    """Конкретный авиабилет не должен открываться в корзине на одного взрослого."""

    class MCP:
        async def call(self, tool: str, **args: object) -> dict[str, str]:
            assert tool == "create_checkout_link"
            assert args["passengers_full"] == 3
            assert args["passengers_child"] == 0
            assert args["passengers_infant"] == 0
            return {"kind": "deeplink", "checkout_url": "https://mtp-deeplink.tutu.ru/ticket"}

    monkeypatch.setattr(api.app.state, "mcp", MCP(), raising=False)
    response = await api.checkout(
        api.CheckoutRequest(
            checkout_ref={"transport": "avia", "passengers_full": 1},
            passengers=3,
        )
    )

    assert response.url == "https://mtp-deeplink.tutu.ru/ticket"
    assert response.kind == "deeplink"
