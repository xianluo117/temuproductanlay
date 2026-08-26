from __future__ import annotations

from typing import Any


TEMU_LOGIN_MARKERS = ("login", "signin", "passport", "verify")


def read_mall_id(context: Any) -> str | None:
    cookies = context.cookies()
    for cookie in cookies:
        if cookie.get("name") == "mallid" and cookie.get("value"):
            return str(cookie["value"])
    return None


def inspect_session(context: Any, expected_mall_id: str | None = None) -> dict[str, Any]:
    pages = context.pages
    if not pages:
        return {"status": "ERROR", "message": "浏览器中没有可用页面。"}

    page = pages[-1]
    current_url = page.url or ""
    lowered_url = current_url.lower()
    if any(marker in lowered_url for marker in TEMU_LOGIN_MARKERS):
        return {
            "status": "LOGIN_REQUIRED",
            "message": "Temu 登录状态无效，请在可视浏览器中完成登录。",
            "currentUrl": current_url,
        }

    mall_id = read_mall_id(context)
    if not mall_id:
        return {
            "status": "LOGIN_REQUIRED",
            "message": "未读取到 mallid，请完成登录并进入卖家后台。",
            "currentUrl": current_url,
        }
    if expected_mall_id and expected_mall_id != mall_id:
        return {
            "status": "ERROR",
            "message": "当前登录店铺与档案绑定的 mallId 不一致。",
            "mallId": mall_id,
            "currentUrl": current_url,
        }

    return {
        "status": "READY",
        "message": "浏览器实例和 Temu 登录状态正常。",
        "mallId": mall_id,
        "currentUrl": current_url,
    }
