from __future__ import annotations

import random
import time
from typing import Any

TRAFFIC_LIST_ENDPOINT = "/api/flow/analysis/list"


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
          catch { payload = { rawText: text }; }
          return {
            httpStatus: response.status,
            durationMs: Math.round(performance.now() - startedAt),
            payload,
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
    for key in ("pageItems", "list", "goodsList", "data", "records", "items"):
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


def query_all_goods(
    page: Any,
    *,
    page_size: int = 30,
    time_dimension: int = 1,
    delay_min_ms: int = 300,
    delay_max_ms: int = 800,
    progress: Any = None,
) -> list[dict[str, Any]]:
    if page_size < 1 or page_size > 200:
        raise ValueError("pageSize 必须在 1 到 200 之间。")

    pages: list[dict[str, Any]] = []
    page_number = 1
    total = 0
    total_pages = 1

    while page_number <= total_pages:
        request_body = {
            "pageSize": page_size,
            "pageNumber": page_number,
            "timeDimension": time_dimension,
        }
        response = _page_post(page, TRAFFIC_LIST_ENDPOINT, request_body)
        payload = response.get("payload")
        if response.get("httpStatus") != 200:
            raise RuntimeError(
                f"商品明细接口 HTTP {response.get('httpStatus')}，URL={response.get('currentUrl')}"
            )
        if not isinstance(payload, dict):
            raise RuntimeError("商品明细接口返回结构无效。")
        if payload.get("success") is not True or payload.get("errorCode") != 1000000:
            raise RuntimeError(
                f"商品明细接口业务失败：{payload.get('errorCode')} {payload.get('errorMsg')}"
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
        if page_number <= total_pages:
            time.sleep(random.randint(delay_min_ms, delay_max_ms) / 1000)

    return pages
