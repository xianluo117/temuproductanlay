from __future__ import annotations

import random
import time
from collections.abc import Callable
from email.utils import parsedate_to_datetime
from typing import Any

TRAFFIC_LIST_ENDPOINT = "/api/flow/analysis/list"
LIFECYCLE_LIST_ENDPOINT = "/api/kiana/mms/robin/searchForSemiSupplier"
PUBLISHED_STATUS = [12]
MIN_REQUEST_INTERVAL_MS = 5_000
MIN_REQUEST_INTERVAL_JITTER_MS = 2_000
MAX_RATE_LIMIT_ATTEMPTS = 5
RATE_LIMIT_BASE_DELAY_SECONDS = 30
RATE_LIMIT_MAX_DELAY_SECONDS = 15 * 60
_last_temu_request_at = 0.0


def _page_post(page: Any, path: str, body: dict[str, Any]) -> dict[str, Any]:
    return page.evaluate(
        """
        async ({ path, body }) => {
          const mallid = document.cookie
            .split('; ')
            .find((item) => item.startsWith('mallid='))
            ?.split('=')[1] || '';
          const startedAt = performance.now();
          const response = await fetch(path, {
            method: 'POST',
            credentials: 'include',
            headers: {
              'content-type': 'application/json',
              'mallid': mallid,
            },
            body: JSON.stringify(body),
          });
          const text = await response.text();
          let payload;
          try { payload = JSON.parse(text); }
          catch { payload = { rawText: text.slice(0, 2000) }; }
          return {
            httpStatus: response.status,
            durationMs: Math.round(performance.now() - startedAt),
            payload,
            responseHeaders: {
              retryAfter: response.headers.get('retry-after'),
              requestId: response.headers.get('x-request-id') || response.headers.get('request-id'),
            },
            currentUrl: location.href,
            mallId: mallid,
          };
        }
        """,
        {"path": path, "body": body},
    )


def _result_items(result: Any) -> list[dict[str, Any]]:
    if not isinstance(result, dict):
        return []
    for key in ("dataList", "pageItems", "list", "goodsList", "data", "records", "items"):
        value = result.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    return []


def _total(result: Any, fallback: int) -> int:
    if not isinstance(result, dict):
        return fallback
    for key in ("total", "totalCount", "count"):
        value = result.get(key)
        if isinstance(value, (int, float)):
            return max(0, int(value))
        if isinstance(value, str) and value.isdigit():
            return int(value)
    return fallback


def retry_after_seconds(value: Any, now: Callable[[], float] = time.time) -> float | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        try:
            return max(0.0, parsedate_to_datetime(value).timestamp() - now())
        except (TypeError, ValueError, IndexError, OverflowError):
            return None


def rate_limit_delay_seconds(attempt: int, retry_after: Any = None) -> float:
    header_delay = retry_after_seconds(retry_after)
    if header_delay is not None:
        return min(RATE_LIMIT_MAX_DELAY_SECONDS, max(1.0, header_delay))
    exponential_delay = RATE_LIMIT_BASE_DELAY_SECONDS * (2 ** (attempt - 1))
    jitter = random.uniform(0, min(15.0, exponential_delay * 0.15))
    return min(RATE_LIMIT_MAX_DELAY_SECONDS, exponential_delay + jitter)


def _diagnostic_payload(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {"type": type(payload).__name__}
    summary: dict[str, Any] = {}
    for key in ("success", "errorCode", "errorMsg", "message", "rawText"):
        value = payload.get(key)
        if value is not None:
            summary[key] = str(value)[:500] if key in ("errorMsg", "message", "rawText") else value
    return summary


def _query_page_with_retry(
    page: Any,
    *,
    endpoint: str,
    request_body: dict[str, Any],
    progress: Any,
    sync_kind: str,
    rate_limit_event: str,
) -> dict[str, Any]:
    global _last_temu_request_at
    required_interval_ms = MIN_REQUEST_INTERVAL_MS + random.uniform(
        0, MIN_REQUEST_INTERVAL_JITTER_MS
    )
    elapsed_ms = (
        (time.monotonic() - _last_temu_request_at) * 1000
        if _last_temu_request_at
        else required_interval_ms
    )
    if elapsed_ms < required_interval_ms:
        time.sleep((required_interval_ms - elapsed_ms) / 1000)

    for attempt in range(1, MAX_RATE_LIMIT_ATTEMPTS + 1):
        response = _page_post(page, endpoint, request_body)
        _last_temu_request_at = time.monotonic()
        if response.get("httpStatus") != 429:
            return response

        headers = response.get("responseHeaders")
        retry_after = headers.get("retryAfter") if isinstance(headers, dict) else None
        wait_seconds = rate_limit_delay_seconds(attempt, retry_after)
        diagnostic = {
            "event": rate_limit_event,
            "endpoint": endpoint,
            "requestBody": request_body,
            "attempt": attempt,
            "maxAttempts": MAX_RATE_LIMIT_ATTEMPTS,
            "waitSeconds": round(wait_seconds, 2),
            "httpStatus": 429,
            "responseHeaders": headers if isinstance(headers, dict) else {},
            "payload": _diagnostic_payload(response.get("payload")),
        }
        if progress is not None:
            progress(diagnostic)
        if attempt == MAX_RATE_LIMIT_ATTEMPTS:
            raise RuntimeError(
                f"{sync_kind}接口 HTTP 429；已在 {MAX_RATE_LIMIT_ATTEMPTS} 次请求后停止，"
                f"最后建议等待 {wait_seconds:.0f} 秒后重试。"
            )
        time.sleep(wait_seconds)

    raise RuntimeError(f"{sync_kind}接口重试流程异常终止。")


def _query_all_pages(
    page: Any,
    *,
    endpoint: str,
    page_size: int,
    page_key: str,
    fixed_filter: dict[str, Any],
    progress: Any,
    sync_kind: str,
    rate_limit_event: str,
) -> list[dict[str, Any]]:
    pages: list[dict[str, Any]] = []
    page_number = 1
    total_pages = 1
    while page_number <= total_pages:
        request_body = {"pageSize": page_size, page_key: page_number, **fixed_filter}
        response = _query_page_with_retry(
            page,
            endpoint=endpoint,
            request_body=request_body,
            progress=progress,
            sync_kind=sync_kind,
            rate_limit_event=rate_limit_event,
        )
        payload = response.get("payload")
        if response.get("httpStatus") != 200:
            raise RuntimeError(
                f"{sync_kind}接口 HTTP {response.get('httpStatus')}，URL={response.get('currentUrl')}"
            )
        if not isinstance(payload, dict):
            raise RuntimeError(f"{sync_kind}接口返回结构无效。")
        if payload.get("success") is not True or payload.get("errorCode") != 1000000:
            raise RuntimeError(
                f"{sync_kind}接口业务失败：{payload.get('errorCode')} {payload.get('errorMsg')}"
            )

        result = payload.get("result")
        items = _result_items(result)
        total = _total(result, len(items))
        total_pages = max(1, (total + page_size - 1) // page_size)
        record = {
            "pageNumber": page_number,
            "pageSize": page_size,
            "total": total,
            "totalPages": total_pages,
            "requestBody": request_body,
            "httpStatus": response.get("httpStatus"),
            "durationMs": response.get("durationMs"),
            "mallId": response.get("mallId"),
            "currentUrl": response.get("currentUrl"),
            "payload": payload,
            "items": items,
        }
        pages.append(record)
        if progress is not None:
            progress(record)
        page_number += 1

    return pages


def query_all_goods(
    page: Any,
    *,
    page_size: int = 30,
    time_dimension: int = 1,
    progress: Any = None,
) -> list[dict[str, Any]]:
    if page_size < 1 or page_size > 200:
        raise ValueError("pageSize 必须在 1 到 200 之间。")
    return _query_all_pages(
        page,
        endpoint=TRAFFIC_LIST_ENDPOINT,
        page_size=page_size,
        page_key="pageNumber",
        fixed_filter={"timeDimension": time_dimension},
        progress=progress,
        sync_kind="商品明细",
        rate_limit_event="traffic_rate_limited",
    )


def query_published_lifecycle(
    page: Any,
    *,
    page_size: int = 50,
    progress: Any = None,
) -> list[dict[str, Any]]:
    if page_size < 1 or page_size > 100:
        raise ValueError("生命周期 pageSize 必须在 1 到 100 之间。")
    return _query_all_pages(
        page,
        endpoint=LIFECYCLE_LIST_ENDPOINT,
        page_size=page_size,
        page_key="pageNum",
        fixed_filter={
            "secondarySelectStatusList": PUBLISHED_STATUS.copy(),
            "supplierTodoTypeList": [],
        },
        progress=progress,
        sync_kind="生命周期主列表",
        rate_limit_event="lifecycle_rate_limited",
    )
