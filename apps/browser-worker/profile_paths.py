from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ProfilePaths:
    profile_dir: Path
    record_dir: Path


def resolve_profile_paths(data_root: str, profile_key: str) -> ProfilePaths:
    root = Path(data_root).resolve()
    normalized = profile_key.replace("\\", "/").strip("/")
    parts = normalized.split("/")
    if len(parts) != 2 or parts[0] != "temu" or not parts[1].startswith("shop_"):
        raise ValueError("无效的 Profile key。")

    profile_dir = (root / "profiles" / normalized).resolve()
    record_dir = (root / "records" / normalized).resolve()
    profiles_root = (root / "profiles").resolve()
    records_root = (root / "records").resolve()
    if profiles_root not in profile_dir.parents or records_root not in record_dir.parents:
        raise ValueError("Profile 路径越界。")

    profile_dir.mkdir(parents=True, exist_ok=True)
    record_dir.mkdir(parents=True, exist_ok=True)
    return ProfilePaths(profile_dir=profile_dir, record_dir=record_dir)
