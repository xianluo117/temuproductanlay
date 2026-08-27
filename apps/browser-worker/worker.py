from __future__ import annotations

import argparse
import json
import signal
import sys
import threading
from typing import Any

from browser_factory import BrowserSession, close_browser, open_persistent_browser
from profile_paths import resolve_profile_paths
from session_health import inspect_session
from traffic_query import query_all_goods, query_published_lifecycle

TEMU_HOME = "https://agentseller-us.temu.com/main/flux-analysis"
LIFECYCLE_HOME = "https://agentseller.temu.com/newon/product-select"


def emit(event: str, **payload: Any) -> None:
    print(json.dumps({"event": event, **payload}, ensure_ascii=False), flush=True)


def run() -> int:
    parser = argparse.ArgumentParser(description="CloakBrowser Temu profile worker")
    parser.add_argument("--data-root", required=True)
    parser.add_argument("--profile-key", required=True)
    parser.add_argument("--cdp-port", required=True, type=int)
    parser.add_argument("--fingerprint-seed", required=True)
    parser.add_argument("--locale", default="zh-CN")
    parser.add_argument("--timezone", default="Asia/Shanghai")
    parser.add_argument("--mall-id")
    parser.add_argument("--headless", action="store_true")
    args = parser.parse_args()

    paths = resolve_profile_paths(args.data_root, args.profile_key)
    session: BrowserSession | None = None
    stopping = threading.Event()

    def stop_handler(_signum: int, _frame: Any) -> None:
        stopping.set()

    signal.signal(signal.SIGINT, stop_handler)
    signal.signal(signal.SIGTERM, stop_handler)

    try:
        emit("starting", message="正在启动 CloakBrowser；若浏览器二进制尚未安装，首次下载可能需要数分钟。")
        session = open_persistent_browser(
            paths,
            cdp_port=args.cdp_port,
            fingerprint_seed=args.fingerprint_seed,
            locale=args.locale,
            timezone=args.timezone,
            headless=args.headless,
        )
        page = session.context.pages[0] if session.context.pages else session.context.new_page()
        page.goto(TEMU_HOME, wait_until="domcontentloaded", timeout=120_000)
        health = inspect_session(session.context, args.mall_id)
        emit("ready", **health)

        while not stopping.is_set():
            line = sys.stdin.readline()
            if not line:
                stopping.wait(0.5)
                continue
            try:
                command = json.loads(line)
            except json.JSONDecodeError:
                emit("command_error", message="Worker 收到无效 JSON 命令。")
                continue
            action = command.get("action")
            if action == "health":
                emit("health", **inspect_session(session.context, args.mall_id))
            elif action == "sync_traffic_goods":
                health = inspect_session(session.context, args.mall_id)
                if health.get("status") != "READY":
                    emit("traffic_failed", syncId=command.get("syncId"), **health)
                    continue
                emit("traffic_started", syncId=command.get("syncId"))
                try:
                    pages = query_all_goods(
                        page,
                        page_size=int(command.get("pageSize", 30)),
                        time_dimension=int(command.get("timeDimension", 1)),
                        progress=lambda item: emit(
                            "traffic_page",
                            syncId=command.get("syncId"),
                            **item,
                        ),
                    )
                    emit(
                        "traffic_completed",
                        syncId=command.get("syncId"),
                        totalPages=len(pages),
                        totalItems=sum(len(item["items"]) for item in pages),
                    )
                except Exception as error:  # noqa: BLE001
                    emit(
                        "traffic_failed",
                        syncId=command.get("syncId"),
                        status="ERROR",
                        message=str(error),
                    )
            elif action == "sync_lifecycle":
                health = inspect_session(session.context, args.mall_id)
                if health.get("status") != "READY":
                    emit("lifecycle_failed", syncId=command.get("syncId"), **health)
                    continue
                emit("lifecycle_started", syncId=command.get("syncId"))
                try:
                    page.goto(LIFECYCLE_HOME, wait_until="domcontentloaded", timeout=120_000)
                    pages = query_published_lifecycle(
                        page,
                        page_size=int(command.get("pageSize", 50)),
                        progress=lambda item: emit(
                            "lifecycle_page",
                            syncId=command.get("syncId"),
                            **item,
                        ),
                    )
                    emit(
                        "lifecycle_completed",
                        syncId=command.get("syncId"),
                        totalPages=len(pages),
                        totalItems=sum(len(item["items"]) for item in pages),
                    )
                except Exception as error:  # noqa: BLE001
                    emit(
                        "lifecycle_failed",
                        syncId=command.get("syncId"),
                        status="ERROR",
                        message=str(error),
                    )
            elif action == "stop":
                stopping.set()
            else:
                emit("command_error", message=f"未知命令: {action}")
    except Exception as error:  # noqa: BLE001
        emit("fatal", status="ERROR", message=str(error))
        return 1
    finally:
        if session is not None:
            try:
                close_browser(session)
            except Exception as error:  # noqa: BLE001
                emit("close_error", message=str(error))
        emit("stopped", status="STOPPED", message="浏览器实例已停止。")
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
