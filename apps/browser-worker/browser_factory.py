from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from cloakbrowser import launch_persistent_context

from profile_paths import ProfilePaths


@dataclass(frozen=True)
class BrowserSession:
    context: Any
    paths: ProfilePaths


def open_persistent_browser(
    paths: ProfilePaths,
    *,
    cdp_port: int,
    fingerprint_seed: str,
    locale: str,
    timezone: str,
    headless: bool,
) -> BrowserSession:
    if not 1024 <= cdp_port <= 65535:
        raise ValueError("CDP 端口必须在 1024 到 65535 之间。")

    context = launch_persistent_context(
        str(paths.profile_dir),
        headless=headless,
        humanize=True,
        locale=locale,
        timezone=timezone,
        args=[
            f"--fingerprint={fingerprint_seed}",
            "--remote-debugging-address=127.0.0.1",
            f"--remote-debugging-port={cdp_port}",
        ],
    )
    return BrowserSession(context=context, paths=paths)


def close_browser(session: BrowserSession) -> None:
    try:
        session.context.storage_state(path=str(session.paths.record_dir / "storage-state.json"))
        if session.context.pages:
            session.context.pages[-1].screenshot(
                path=str(session.paths.record_dir / "last-page.png"),
                full_page=True,
            )
    finally:
        session.context.close()
