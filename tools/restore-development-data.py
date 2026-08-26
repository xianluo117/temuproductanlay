from __future__ import annotations

import datetime as dt
import shutil
import sqlite3
from pathlib import Path

WORKSPACE = Path(__file__).resolve().parents[1]
CURRENT_DATA = WORKSPACE / "data"
SOURCE_DATA = WORKSPACE / "backup" / "data" / "data"
SNAPSHOT_ROOT = WORKSPACE / "backup" / "development-restore-snapshots"
PRESERVED_TABLES = (
    "temu_shop_profiles",
    "temu_shop_user_grants",
    "temu_browser_events",
)
RESTORED_DIRECTORIES = ("database", "images", "imports", "backups")


def copy_tree(source: Path, target: Path) -> None:
    if not source.exists():
        return
    shutil.copytree(source, target, dirs_exist_ok=True)


def preserve_temu_tables(current_database: Path, restored_database: Path) -> None:
    source = sqlite3.connect(current_database)
    target = sqlite3.connect(restored_database)
    try:
        target.execute("PRAGMA foreign_keys = OFF")
        for table in PRESERVED_TABLES:
            schema_row = source.execute(
                "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
                (table,),
            ).fetchone()
            if not schema_row or not schema_row[0]:
                continue

            target.execute(f'DROP TABLE IF EXISTS "{table}"')
            target.execute(schema_row[0])

            columns = [
                row[1]
                for row in source.execute(f'PRAGMA table_info("{table}")').fetchall()
            ]
            rows = source.execute(f'SELECT * FROM "{table}"').fetchall()
            if rows:
                column_sql = ", ".join(f'"{column}"' for column in columns)
                placeholders = ", ".join("?" for _ in columns)
                target.executemany(
                    f'INSERT INTO "{table}" ({column_sql}) VALUES ({placeholders})',
                    rows,
                )
        target.commit()
    finally:
        target.close()
        source.close()


def main() -> None:
    source_database = SOURCE_DATA / "database" / "temu-analytics.sqlite"
    current_database = CURRENT_DATA / "database" / "temu-analytics.sqlite"
    if not source_database.exists():
        raise FileNotFoundError(f"未找到恢复源数据库：{source_database}")
    if not current_database.exists():
        raise FileNotFoundError(f"未找到当前开发数据库：{current_database}")

    timestamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    snapshot = SNAPSHOT_ROOT / timestamp
    snapshot.mkdir(parents=True, exist_ok=False)
    for name in RESTORED_DIRECTORIES:
        copy_tree(CURRENT_DATA / name, snapshot / "data" / name)

    preserved_database = snapshot / "data" / "database" / "temu-analytics.sqlite"

    for name in RESTORED_DIRECTORIES:
        source = SOURCE_DATA / name
        target = CURRENT_DATA / name
        if target.exists():
            shutil.rmtree(target)
        copy_tree(source, target)

    restored_database = CURRENT_DATA / "database" / "temu-analytics.sqlite"
    preserve_temu_tables(preserved_database, restored_database)

    print(f"当前开发数据快照：{snapshot.relative_to(WORKSPACE)}")
    print(f"恢复源：{SOURCE_DATA.relative_to(WORKSPACE)}")
    print("已恢复数据库、图片、导入文件和备份，并保留当前 Temu 店铺档案。")


if __name__ == "__main__":
    main()
