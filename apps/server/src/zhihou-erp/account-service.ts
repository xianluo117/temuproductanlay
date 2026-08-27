import type {
  ZhihouAccount,
  ZhihouAccountInput,
  ZhihouLoginTestResult,
} from "@temu-analytics/shared";
import { database } from "../database/index.js";
import {
  decryptZhihouPassword,
  encryptZhihouPassword,
} from "./credential-crypto.js";
import {
  runZhihouWorker,
  type ZhihouWorkerLoginResult,
} from "./worker-client.js";

interface AccountRow {
  id: number;
  account: string;
  password_ciphertext: string;
  enabled: number;
  last_test_status: ZhihouAccount["lastTestStatus"];
  last_tested_at: string | null;
  last_test_error: string | null;
  created_at: string;
  updated_at: string;
}

function accountRow(): AccountRow | undefined {
  return database
    .prepare("SELECT * FROM zhihou_erp_accounts WHERE id = 1")
    .get() as AccountRow | undefined;
}

function mapAccount(row: AccountRow): ZhihouAccount {
  return {
    id: row.id,
    account: row.account,
    enabled: Boolean(row.enabled),
    hasPassword: Boolean(row.password_ciphertext),
    lastTestStatus: row.last_test_status,
    lastTestedAt: row.last_tested_at,
    lastTestError: row.last_test_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getZhihouAccount(): ZhihouAccount | null {
  const row = accountRow();
  return row ? mapAccount(row) : null;
}

export function saveZhihouAccount(input: ZhihouAccountInput): ZhihouAccount {
  const current = accountRow();
  const passwordCiphertext = input.password
    ? encryptZhihouPassword(input.password)
    : current?.password_ciphertext;
  if (!passwordCiphertext) throw new Error("首次配置智猴账号时必须填写密码。");
  database
    .prepare(
      `INSERT INTO zhihou_erp_accounts
        (id, account, password_ciphertext, enabled, last_test_status,
         last_tested_at, last_test_error, created_at, updated_at)
       VALUES (1, ?, ?, ?, 'untested', NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         account = excluded.account,
         password_ciphertext = excluded.password_ciphertext,
         enabled = excluded.enabled,
         last_test_status = CASE
           WHEN zhihou_erp_accounts.account <> excluded.account
             OR zhihou_erp_accounts.password_ciphertext <> excluded.password_ciphertext
           THEN 'untested' ELSE zhihou_erp_accounts.last_test_status END,
         last_tested_at = CASE
           WHEN zhihou_erp_accounts.account <> excluded.account
             OR zhihou_erp_accounts.password_ciphertext <> excluded.password_ciphertext
           THEN NULL ELSE zhihou_erp_accounts.last_tested_at END,
         last_test_error = CASE
           WHEN zhihou_erp_accounts.account <> excluded.account
             OR zhihou_erp_accounts.password_ciphertext <> excluded.password_ciphertext
           THEN NULL ELSE zhihou_erp_accounts.last_test_error END,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .run(input.account.trim(), passwordCiphertext, Number(input.enabled));
  return getZhihouAccount()!;
}

export function getZhihouCredentials(options: {
  requireEnabled?: boolean;
} = {}): { account: string; password: string } {
  const row = accountRow();
  if (!row) throw new Error("尚未配置智猴 ERP 账号。");
  if (options.requireEnabled !== false && !row.enabled)
    throw new Error("智猴 ERP 账号已停用。");
  return {
    account: row.account,
    password: decryptZhihouPassword(row.password_ciphertext),
  };
}

function updateTestResult(status: "success" | "failed", error: string | null): void {
  database
    .prepare(
      `UPDATE zhihou_erp_accounts SET
         last_test_status = ?, last_tested_at = CURRENT_TIMESTAMP,
         last_test_error = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = 1`,
    )
    .run(status, error?.slice(0, 500) ?? null);
}

export async function testZhihouAccount(): Promise<ZhihouLoginTestResult> {
  const credentials = getZhihouCredentials({ requireEnabled: false });
  try {
    const result = await runZhihouWorker<ZhihouWorkerLoginResult>({
      action: "test_login",
      ...credentials,
    });
    updateTestResult("success", null);
    return {
      success: true,
      account: credentials.account,
      testedAt: new Date().toISOString(),
      message: result.message || "智猴 ERP 登录验证成功。",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "智猴 ERP 登录验证失败。";
    updateTestResult("failed", message);
    throw new Error(message);
  }
}
