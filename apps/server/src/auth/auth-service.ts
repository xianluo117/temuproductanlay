import type {
  AdminPasswordResetInput,
  AdminUserUpdateInput,
  AuthSession,
  ChangePasswordInput,
  LoginInput,
  RegisterInput,
  ShopAccess,
  UserAccount,
  UserRole,
} from "@temu-analytics/shared";
import { randomBytes } from "node:crypto";
import { database } from "../database/index.js";
import { hashPassword, verifyPassword } from "./password.js";

const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: UserRole;
  enabled: number;
  must_change_password: number;
  created_at: string;
  updated_at: string;
}

interface SessionRow extends UserRow {
  active_shop_profile_id: number | null;
}

interface ShopAccessRow {
  id: number;
  name: string;
  account_label: string;
  mall_id: string | null;
  enabled: number;
}

function mapUser(row: UserRow): UserAccount {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    enabled: row.enabled === 1,
    mustChangePassword: row.must_change_password === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapShop(row: ShopAccessRow): ShopAccess {
  return {
    id: row.id,
    name: row.name,
    accountLabel: row.account_label,
    mallId: row.mall_id,
    enabled: row.enabled === 1,
  };
}

function availableShops(user: UserAccount): ShopAccess[] {
  const rows =
    user.role === "admin"
      ? database
          .prepare(
            `
        SELECT id, name, account_label, mall_id, enabled
        FROM temu_shop_profiles
        ORDER BY enabled DESC, name COLLATE NOCASE, id
      `,
          )
          .all()
      : database
          .prepare(
            `
        SELECT shop.id, shop.name, shop.account_label, shop.mall_id, shop.enabled
        FROM temu_shop_profiles shop
        JOIN temu_shop_user_grants grant_item ON grant_item.shop_profile_id = shop.id
        WHERE grant_item.user_id = ? AND shop.enabled = 1
        ORDER BY shop.name COLLATE NOCASE, shop.id
      `,
          )
          .all(user.id);
  return (rows as ShopAccessRow[]).map(mapShop);
}

function normalizeUsername(username: string): string {
  const value = username.trim();
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(value)) {
    throw new Error("用户名须为 3-32 位字母、数字、下划线、点或连字符。");
  }
  return value;
}

function validatePassword(password: string): void {
  if (password.length < 8 || password.length > 128)
    throw new Error("密码长度须为 8-128 个字符。");
}

function getUserRow(id: number): UserRow {
  const row = database.prepare("SELECT * FROM users WHERE id = ?").get(id) as
    | UserRow
    | undefined;
  if (!row) throw new Error("用户不存在。");
  return row;
}

export function listUsers(): UserAccount[] {
  return (
    database
      .prepare("SELECT * FROM users ORDER BY role ASC, username COLLATE NOCASE")
      .all() as UserRow[]
  ).map(mapUser);
}

export function registerUser(input: RegisterInput): UserAccount {
  const username = normalizeUsername(input.username);
  validatePassword(input.password);
  try {
    const result = database
      .prepare(
        `
      INSERT INTO users (username, password_hash, role, enabled, must_change_password)
      VALUES (?, ?, 'user', 1, 0)
    `,
      )
      .run(username, hashPassword(input.password));
    return mapUser(getUserRow(Number(result.lastInsertRowid)));
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE"))
      throw new Error("用户名已存在。");
    throw error;
  }
}

export function authenticateUser(input: LoginInput): UserAccount {
  const username = input.username.trim();
  const row = database
    .prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE")
    .get(username) as UserRow | undefined;
  if (!row || !verifyPassword(input.password, row.password_hash))
    throw new Error("用户名或密码错误。");
  const user = mapUser(row);
  if (!user.enabled) throw new Error("账号已被停用。");
  return user;
}

export function createSession(userId: number): { id: string; expiresAt: Date } {
  const id = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
  const user = mapUser(getUserRow(userId));
  const firstShop = availableShops(user)[0];
  if (!firstShop) throw new Error("当前用户没有可访问的店铺。");
  database
    .prepare(
      `
    INSERT INTO sessions (id, user_id, active_owner_id, active_shop_profile_id, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `,
    )
    .run(id, userId, userId, firstShop.id, expiresAt.toISOString());
  return { id, expiresAt };
}

export function deleteSession(id: string): void {
  database.prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

export function getSession(id: string): AuthSession | null {
  const row = database
    .prepare(
      `
    SELECT u.*, s.active_shop_profile_id
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ? AND julianday(s.expires_at) > julianday(CURRENT_TIMESTAMP)
  `,
    )
    .get(id) as SessionRow | undefined;
  if (!row || row.enabled !== 1) {
    if (row) deleteSession(id);
    return null;
  }
  const user = mapUser(row);
  const shops = availableShops(user);
  if (shops.length === 0) {
    deleteSession(id);
    return null;
  }
  const activeShop =
    shops.find((shop) => shop.id === row.active_shop_profile_id) ?? shops[0]!;
  if (activeShop.id !== row.active_shop_profile_id) {
    database
      .prepare("UPDATE sessions SET active_shop_profile_id = ? WHERE id = ?")
      .run(activeShop.id, id);
  }
  database
    .prepare(
      "UPDATE sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?",
    )
    .run(id);
  return { user, activeShop, availableShops: shops };
}

export function setActiveShop(
  sessionId: string,
  actor: UserAccount,
  shopId: number,
): AuthSession {
  const allowed = availableShops(actor).some((shop) => shop.id === shopId);
  if (!allowed) throw new Error("无权切换到该店铺。");
  database
    .prepare(
      "UPDATE sessions SET active_shop_profile_id = ?, last_seen_at = CURRENT_TIMESTAMP WHERE id = ?",
    )
    .run(shopId, sessionId);
  const session = getSession(sessionId);
  if (!session) throw new Error("登录会话已失效。");
  return session;
}

export function changePassword(
  userId: number,
  input: ChangePasswordInput,
): void {
  validatePassword(input.newPassword);
  const row = getUserRow(userId);
  if (!verifyPassword(input.currentPassword, row.password_hash))
    throw new Error("当前密码错误。");
  if (input.currentPassword === input.newPassword)
    throw new Error("新密码不能与当前密码相同。");
  database
    .prepare(
      `
    UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `,
    )
    .run(hashPassword(input.newPassword), userId);
  database.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

function enabledAdminCount(excludingId?: number): number {
  const sql = excludingId
    ? "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND enabled = 1 AND id <> ?"
    : "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND enabled = 1";
  const row = (
    excludingId
      ? database.prepare(sql).get(excludingId)
      : database.prepare(sql).get()
  ) as { count: number };
  return row.count;
}

export function updateUser(
  actorId: number,
  userId: number,
  input: AdminUserUpdateInput,
): UserAccount {
  const current = mapUser(getUserRow(userId));
  const role = input.role ?? current.role;
  const enabled = input.enabled ?? current.enabled;
  if (
    current.role === "admin" &&
    current.enabled &&
    (role !== "admin" || !enabled) &&
    enabledAdminCount(userId) === 0
  ) {
    throw new Error("系统必须保留至少一个已启用的管理员。");
  }
  if (actorId === userId && !enabled) throw new Error("不能停用当前登录账号。");
  database
    .prepare(
      `UPDATE users SET role = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    )
    .run(role, enabled ? 1 : 0, userId);
  if (!enabled)
    database.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  return mapUser(getUserRow(userId));
}

export function resetUserPassword(
  userId: number,
  input: AdminPasswordResetInput,
): void {
  validatePassword(input.newPassword);
  getUserRow(userId);
  database
    .prepare(
      `
    UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `,
    )
    .run(hashPassword(input.newPassword), userId);
  database.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}
