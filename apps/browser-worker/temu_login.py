from __future__ import annotations

from typing import Any


SELLER_CENTER_PREFIX = "https://seller.kuajingmaihuo.com/"


def _is_auth_url(url: str) -> bool:
    return "/auth/" in (url or "").lower()


def _find_page(context: Any, previous_pages: list[Any]) -> Any:
    pages = context.pages
    for page in pages:
        if page not in previous_pages and page.url.startswith(SELLER_CENTER_PREFIX):
            return page
    for page in reversed(pages):
        if page.url.startswith(SELLER_CENTER_PREFIX):
            return page
    return pages[-1] if pages else None


def _wait_after_authorize(
    context: Any,
    login_page: Any,
    original_url: str,
) -> dict[str, Any]:
    """等待登录页刷新、跳转或关闭；Temu 成功时通常会关闭该窗口。"""
    for _ in range(60):
        pages = context.pages
        login_page_closed = login_page not in pages
        current_url = login_page.url or "" if not login_page_closed else ""
        mall_id = read_mall_id(context)
        if login_page_closed:
            if mall_id:
                remaining_urls = [page.url or "" for page in pages]
                current_url = next(
                    (
                        url
                        for url in reversed(remaining_urls)
                        if url and not _is_auth_url(url)
                    ),
                    original_url,
                )
                return {
                    "status": "READY",
                    "message": "Temu 授权登录成功，登录窗口已关闭。",
                    "currentUrl": current_url,
                    "mallId": mall_id,
                    "loginAttempted": True,
                }
        elif (not _is_auth_url(current_url)) and not _has_login_form(login_page):
            return {
                "status": "READY",
                "message": "Temu 授权登录成功。",
                "currentUrl": current_url,
                "mallId": mall_id,
                "loginAttempted": True,
            }
        login_page.wait_for_timeout(500)

    current_url = login_page.url or original_url if login_page in context.pages else original_url
    return {
        "status": "LOGIN_REQUIRED",
        "message": "授权登录后登录窗口未关闭或页面未完成跳转，可能需要验证码、二次验证或账号密码校验；浏览器已保留。",
        "currentUrl": current_url,
        "loginAttempted": True,
    }


def _merchant_center_button(page: Any) -> Any:
    button = page.locator('[class^="authentication_goto__"]').first
    if button.count() > 0:
        return button
    return page.get_by_text("商家中心", exact=True).last


def _has_login_form(page: Any) -> bool:
    return page.locator("#usernameId, #userEmailId").count() > 0


def _wait_for_login_page(context: Any, auth_page: Any, previous_pages: list[Any]) -> Any:
    for _ in range(60):
        pages = context.pages
        candidates = [
            page for page in pages
            if page is not auth_page or not _is_auth_url(page.url or "")
        ]
        for page in reversed(candidates):
            if _has_login_form(page):
                return page
        auth_page.wait_for_timeout(500)
    return None


def _fill_login_form(page: Any, account: str, password: str) -> None:
    if "@" in account:
        email_tab = page.get_by_text("邮箱登录", exact=True)
        email_tab.wait_for(state="visible", timeout=15_000)
        email_tab.click(timeout=15_000)
        page.locator("#userEmailId").fill(account, timeout=15_000)
    else:
        page.locator("#usernameId").fill(account, timeout=15_000)
    page.locator("#passwordId").fill(password, timeout=15_000)

    checkbox = page.locator('input[type="checkbox"]').first
    if not checkbox.is_checked():
        # 原生 checkbox 不可见，只点击其专用勾选框容器，避免点击协议文字或协议链接。
        agreement_box = page.locator(
            'div[data-testid="beast-core-checkbox-checkIcon"]'
        ).first
        agreement_box.wait_for(state="visible", timeout=15_000)
        agreement_box.click(timeout=15_000)
        if not checkbox.is_checked():
            raise RuntimeError("协议勾选框点击后仍未选中。")


def login_from_auth_page(
    context: Any,
    auth_page: Any,
    account: str | None,
    password: str | None,
) -> dict[str, Any]:
    if not account or not password:
        return {
            "status": "LOGIN_REQUIRED",
            "message": "当前页面需要登录，但店铺尚未配置完整的 Temu 账号密码。",
            "currentUrl": auth_page.url or "",
            "loginAttempted": False,
        }

    original_url = auth_page.url or ""
    previous_pages = list(context.pages)
    try:
        merchant_button = _merchant_center_button(auth_page)
        if merchant_button.count() == 0:
            return {
                "status": "LOGIN_REQUIRED",
                "message": "当前认证页面未找到“商家中心”入口，浏览器已保留。",
                "currentUrl": original_url,
                "loginAttempted": False,
            }
        merchant_button.scroll_into_view_if_needed(timeout=10_000)
        merchant_button.click(timeout=20_000, no_wait_after=True)

        try:
            auth_page.wait_for_url(lambda url: not _is_auth_url(url), timeout=5_000)
        except Exception:  # noqa: BLE001
            pass

        page = _wait_for_login_page(context, auth_page, previous_pages)
        if page is None:
            return {
                "status": "LOGIN_REQUIRED",
                "message": "点击商家中心后未打开登录页面；浏览器已保留。",
                "currentUrl": auth_page.url or original_url,
                "loginAttempted": True,
            }

        page.wait_for_load_state("domcontentloaded", timeout=30_000)
        if not _has_login_form(page):
            return {
                "status": "LOGIN_REQUIRED",
                "message": "点击商家中心后未出现账号登录表单，浏览器已保留。",
                "currentUrl": page.url or original_url,
                "loginAttempted": True,
            }
        if "/auth/" in (page.url or "").lower():
            return {
                "status": "LOGIN_REQUIRED",
                "message": "点击商家中心后仍停留在认证入口，未进入账号登录表单；浏览器已保留。",
                "currentUrl": page.url or original_url,
                "loginAttempted": True,
            }
        _fill_login_form(page, account, password)
        # humanized resolver 不支持 get_by_role，使用页面可见文本定位授权按钮。
        authorize_button = page.get_by_text("授权登录", exact=True).last
        authorize_button.wait_for(state="visible", timeout=15_000)
        authorize_button.click(timeout=20_000, no_wait_after=True)
        return _wait_after_authorize(context, page, original_url)
    except Exception as error:  # noqa: BLE001
        return {
            "status": "LOGIN_REQUIRED",
            "message": f"Temu 自动登录失败：{error}；浏览器已保留。",
            "currentUrl": auth_page.url or original_url,
            "loginAttempted": True,
        }
