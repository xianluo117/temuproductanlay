import type {
  TemuBrowserEvent,
  TemuBrowserRuntimeStatus,
  TemuShopProfile,
  TemuShopProfileCreateInput,
  TemuShopProfileUpdateInput,
} from "@temu-analytics/shared";
import { nanoid } from "nanoid";
import { database } from "../database/index.js";

interface ShopRow {
  id: number;
  name: string;
  account_label: string;
  profile_key: string;
  mall_id: string | null;
  cdp_port: number;
  fingerprint_seed: string;
  locale: string;
  timezone: string;
  enabled: number;
  runtime_status: TemuBrowserRuntimeStatus;
  process_id: number | null;
  last_started_at: string | null;
  last_checked_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  id: number;
  shop_profile_id: number;
  event_type: string;
  status: TemuBrowserRuntimeStatus | null;
  message: string | null;
  details_json: string | null;
  created_at: string;
}

function grantedUsers(shopId: number): TemuShopProfile["grantedUsers"] {
  return database
    .prepare(
      `
    SELECT u.id, u.username
    FROM temu_shop_user_grants grant_item
    JOIN users u ON u.id = grant_item.user_id
    WHERE grant_item.shop_profile_id = ?
    ORDER BY u.username COLLATE NOCASE
  `,
    )
    .all(shopId) as TemuShopProfile["grantedUsers"];
}

function mapShop(row: ShopRow): TemuShopProfile {
  return {
    id: row.id,
    name: row.name,
    accountLabel: row.account_label,
    profileKey: row.profile_key,
    mallId: row.mall_id,
    cdpPort: row.cdp_port,
    fingerprintSeed: row.fingerprint_seed,
    locale: row.locale,
    timezone: row.timezone,
    enabled: Boolean(row.enabled),
    runtimeStatus: row.runtime_status,
    processId: row.process_id,
    lastStartedAt: row.last_started_at,
    lastCheckedAt: row.last_checked_at,
    lastSuccessAt: row.last_success_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    grantedUsers: grantedUsers(row.id),
  };
}

export function listTemuShopProfiles(): TemuShopProfile[] {
  const rows = database
    .prepare(
      "SELECT * FROM temu_shop_profiles ORDER BY name COLLATE NOCASE, id",
    )
    .all() as ShopRow[];
  return rows.map(mapShop);
}

export function getTemuShopProfile(id: number): TemuShopProfile {
  const row = database
    .prepare("SELECT * FROM temu_shop_profiles WHERE id = ?")
    .get(id) as ShopRow | undefined;
  if (!row) throw new Error("店铺档案不存在。");
  return mapShop(row);
}

function nextCdpPort(): number {
  const used = new Set(
    (
      database
        .prepare("SELECT cdp_port FROM temu_shop_profiles")
        .all() as Array<{ cdp_port: number }>
    ).map((row) => row.cdp_port),
  );
  for (let port = 9242; port <= 9999; port += 1)
    if (!used.has(port)) return port;
  throw new Error("没有可分配的 CDP 端口。");
}

function replaceGrants(shopId: number, userIds: number[]): void {
  const uniqueIds = [...new Set(userIds)];
  if (uniqueIds.length > 0) {
    const placeholders = uniqueIds.map(() => "?").join(",");
    const count = database
      .prepare(
        `SELECT COUNT(*) AS count FROM users WHERE id IN (${placeholders})`,
      )
      .get(...uniqueIds) as { count: number };
    if (count.count !== uniqueIds.length)
      throw new Error("授权用户中包含不存在的账号。");
  }
  database
    .prepare("DELETE FROM temu_shop_user_grants WHERE shop_profile_id = ?")
    .run(shopId);
  const insert = database.prepare(
    "INSERT INTO temu_shop_user_grants (shop_profile_id, user_id) VALUES (?, ?)",
  );
  for (const userId of uniqueIds) insert.run(shopId, userId);
}

export function createTemuShopProfile(
  input: TemuShopProfileCreateInput,
): TemuShopProfile {
  const create = database.transaction(() => {
    const profileKey = `temu/shop_${nanoid(12).toLowerCase()}`;
    const result = database
      .prepare(
        `
      INSERT INTO temu_shop_profiles (
        name, account_label, profile_key, cdp_port, fingerprint_seed, locale, timezone, enabled
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        input.name.trim(),
        input.accountLabel.trim(),
        profileKey,
        nextCdpPort(),
        nanoid(32),
        input.locale ?? "zh-CN",
        input.timezone ?? "Asia/Shanghai",
        input.enabled === false ? 0 : 1,
      );
    const id = Number(result.lastInsertRowid);
    replaceGrants(id, input.grantedUserIds ?? []);
    addTemuBrowserEvent(id, "PROFILE_CREATED", "STOPPED", "店铺档案已创建。", {
      profileKey,
    });
    return id;
  });
  return getTemuShopProfile(create());
}

export function updateTemuShopProfile(
  id: number,
  input: TemuShopProfileUpdateInput,
): TemuShopProfile {
  const current = getTemuShopProfile(id);
  database
    .prepare(
      `
    UPDATE temu_shop_profiles SET
      name = ?, account_label = ?, locale = ?, timezone = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `,
    )
    .run(
      input.name?.trim() ?? current.name,
      input.accountLabel?.trim() ?? current.accountLabel,
      input.locale ?? current.locale,
      input.timezone ?? current.timezone,
      input.enabled === undefined
        ? Number(current.enabled)
        : Number(input.enabled),
      id,
    );
  addTemuBrowserEvent(
    id,
    "PROFILE_UPDATED",
    current.runtimeStatus,
    "店铺档案配置已更新。",
  );
  return getTemuShopProfile(id);
}

export function updateTemuShopGrants(
  id: number,
  userIds: number[],
): TemuShopProfile {
  getTemuShopProfile(id);
  database.transaction(() => replaceGrants(id, userIds))();
  addTemuBrowserEvent(
    id,
    "GRANTS_UPDATED",
    getTemuShopProfile(id).runtimeStatus,
    "店铺数据查看授权已更新。",
    { userIds },
  );
  return getTemuShopProfile(id);
}

export function deleteTemuShopProfile(id: number): void {
  const profile = getTemuShopProfile(id);
  if (profile.runtimeStatus !== "STOPPED")
    throw new Error("浏览器实例停止后才能删除店铺档案。");
  database.prepare("DELETE FROM temu_shop_profiles WHERE id = ?").run(id);
}

export function updateTemuShopRuntime(
  id: number,
  status: TemuBrowserRuntimeStatus,
  values: {
    processId?: number | null;
    mallId?: string | null;
    error?: string | null;
    success?: boolean;
  } = {},
): TemuShopProfile {
  getTemuShopProfile(id);
  database
    .prepare(
      `
    UPDATE temu_shop_profiles SET
      runtime_status = ?, process_id = COALESCE(?, process_id),
      mall_id = COALESCE(?, mall_id), last_error = ?,
      last_started_at = CASE WHEN ? = 'STARTING' THEN CURRENT_TIMESTAMP ELSE last_started_at END,
      last_checked_at = CASE WHEN ? IN ('READY', 'LOGIN_REQUIRED', 'RISK_BLOCKED', 'ERROR') THEN CURRENT_TIMESTAMP ELSE last_checked_at END,
      last_success_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE last_success_at END,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `,
    )
    .run(
      status,
      values.processId === undefined ? null : values.processId,
      values.mallId ?? null,
      values.error ?? null,
      status,
      status,
      Number(values.success === true),
      id,
    );
  if (values.processId === null)
    database
      .prepare("UPDATE temu_shop_profiles SET process_id = NULL WHERE id = ?")
      .run(id);
  return getTemuShopProfile(id);
}

export function addTemuBrowserEvent(
  shopId: number,
  eventType: string,
  status: TemuBrowserRuntimeStatus | null,
  message: string | null,
  details?: Record<string, unknown>,
): void {
  database
    .prepare(
      `
    INSERT INTO temu_browser_events (shop_profile_id, event_type, status, message, details_json)
    VALUES (?, ?, ?, ?, ?)
  `,
    )
    .run(
      shopId,
      eventType,
      status,
      message,
      details ? JSON.stringify(details) : null,
    );
}

export function listTemuBrowserEvents(shopId: number): TemuBrowserEvent[] {
  getTemuShopProfile(shopId);
  const rows = database
    .prepare(
      `
    SELECT * FROM temu_browser_events WHERE shop_profile_id = ? ORDER BY created_at DESC, id DESC LIMIT 200
  `,
    )
    .all(shopId) as EventRow[];
  return rows.map((row) => ({
    id: row.id,
    shopProfileId: row.shop_profile_id,
    eventType: row.event_type,
    status: row.status,
    message: row.message,
    details: row.details_json
      ? (JSON.parse(row.details_json) as Record<string, unknown>)
      : null,
    createdAt: row.created_at,
  }));
}

export function resetStaleTemuBrowserRuntime(): void {
  database
    .prepare(
      `
    UPDATE temu_shop_profiles SET runtime_status = 'STOPPED', process_id = NULL,
      last_error = CASE WHEN runtime_status = 'STOPPED' THEN last_error ELSE '服务重启，已清理旧浏览器运行状态。' END,
      updated_at = CURRENT_TIMESTAMP
  `,
    )
    .run();
}
