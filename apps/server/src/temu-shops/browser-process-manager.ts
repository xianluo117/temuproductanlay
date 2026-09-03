import type {
  TemuBrowserRuntimeStatus,
  TemuShopProfile,
} from "@temu-analytics/shared";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import readline from "node:readline";
import { config, paths } from "../config.js";
import {
  addTemuBrowserEvent,
  getTemuShopProfile,
  resetStaleTemuBrowserRuntime,
  updateTemuShopRuntime,
  getTemuShopCredentials,
} from "./temu-shop-service.js";
import { enqueueSyncIngestion } from "./sync-ingestion-queue.js";
import {
  completeLifecycleSync,
  completeTrafficSync,
  failLifecycleSync,
  failTrafficSync,
  storeLifecyclePage,
  storeTrafficPage,
} from "./traffic-sync-service.js";

interface WorkerMessage {
  event?: string;
  status?: TemuBrowserRuntimeStatus;
  message?: string;
  mallId?: string;
  currentUrl?: string;
  loginAttempted?: boolean;
  syncId?: number;
  pageNumber?: number;
  pageSize?: number;
  total?: number;
  totalPages?: number;
  requestBody?: Record<string, unknown>;
  httpStatus?: number;
  durationMs?: number;
  payload?: Record<string, unknown>;
  responseHeaders?: Record<string, unknown>;
  endpoint?: string;
  attempt?: number;
  maxAttempts?: number;
  waitSeconds?: number;
  items?: Array<Record<string, unknown>>;
}

interface RateLimitDiagnostic extends Record<string, unknown> {
  endpoint?: string;
  requestBody?: Record<string, unknown>;
  httpStatus?: number;
  responseHeaders?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  attempt?: number;
  maxAttempts?: number;
  waitSeconds?: number;
}

interface ManagedWorker {
  process: ChildProcessWithoutNullStreams;
  stopping: boolean;
}

const workers = new Map<number, ManagedWorker>();
const latestRateLimitDiagnostics = new Map<string, RateLimitDiagnostic>();
const receivedLifecyclePages = new Map<string, number>();
const receivedTrafficPages = new Map<string, number>();

function syncIngestionKey(
  shopId: number,
  syncId: number,
  type: "lifecycle" | "traffic",
): string {
  return `${type}:${shopId}:${syncId}`;
}

function ingestionErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function rateLimitDiagnosticKey(shopId: number, syncId: number): string {
  return `${shopId}:${syncId}`;
}

function diagnosticDetails(message: WorkerMessage): RateLimitDiagnostic {
  return {
    ...(message.endpoint === undefined ? {} : { endpoint: message.endpoint }),
    ...(message.requestBody === undefined
      ? {}
      : { requestBody: message.requestBody }),
    ...(message.httpStatus === undefined
      ? {}
      : { httpStatus: message.httpStatus }),
    ...(message.responseHeaders === undefined
      ? {}
      : { responseHeaders: message.responseHeaders }),
    ...(message.payload === undefined ? {} : { payload: message.payload }),
    ...(message.attempt === undefined ? {} : { attempt: message.attempt }),
    ...(message.maxAttempts === undefined
      ? {}
      : { maxAttempts: message.maxAttempts }),
    ...(message.waitSeconds === undefined
      ? {}
      : { waitSeconds: message.waitSeconds }),
  };
}

function rateLimitFailureMessage(
  shopId: number,
  message: WorkerMessage,
  fallback: string,
): string {
  const diagnostic = latestRateLimitDiagnostics.get(
    rateLimitDiagnosticKey(shopId, message.syncId ?? 0),
  );
  const attempt = diagnostic?.attempt;
  const maxAttempts = diagnostic?.maxAttempts;
  const waitSeconds = diagnostic?.waitSeconds;
  if (!attempt || !maxAttempts || !waitSeconds) return message.message ?? fallback;
  return `${message.message ?? fallback}（HTTP 429，第 ${attempt}/${maxAttempts} 次，最后退避 ${Math.round(waitSeconds)} 秒。）`;
}

function workerArgs(profile: TemuShopProfile): string[] {
  return [
    config.browserWorkerScript,
    "--data-root",
    config.browserDataDirectory,
    "--profile-key",
    profile.profileKey,
    "--cdp-port",
    String(profile.cdpPort),
    "--fingerprint-seed",
    profile.fingerprintSeed,
    "--locale",
    profile.locale,
    "--timezone",
    profile.timezone,
    ...(profile.mallId ? ["--mall-id", profile.mallId] : []),
  ];
}

function handleWorkerMessage(shopId: number, message: WorkerMessage): void {
  if (
    (message.event === "lifecycle_rate_limited" ||
      message.event === "traffic_rate_limited") &&
    message.syncId
  ) {
    const diagnostic = diagnosticDetails(message);
    latestRateLimitDiagnostics.set(
      rateLimitDiagnosticKey(shopId, message.syncId),
      diagnostic,
    );
    addTemuBrowserEvent(
      shopId,
      `WORKER_${String(message.event).toUpperCase()}`,
      null,
      `Temu HTTP 429；第 ${message.attempt ?? "?"}/${message.maxAttempts ?? "?"} 次退避 ${Math.round(message.waitSeconds ?? 0)} 秒。`,
      diagnostic,
    );
    return;
  }
  if (message.event === "lifecycle_page" && message.syncId) {
    const syncId = message.syncId;
    const syncKey = rateLimitDiagnosticKey(shopId, syncId);
    enqueueSyncIngestion(
      syncIngestionKey(shopId, syncId, "lifecycle"),
      () => {
        storeLifecyclePage(shopId, {
          syncId,
          pageNumber: message.pageNumber ?? 1,
          pageSize: message.pageSize ?? 50,
          total: message.total ?? 0,
          totalPages: message.totalPages ?? 1,
          requestBody: message.requestBody ?? {},
          httpStatus: message.httpStatus ?? 0,
          durationMs: message.durationMs ?? 0,
          payload: message.payload ?? {},
          items: message.items ?? [],
        });
        receivedLifecyclePages.set(
          syncKey,
          Math.max(
            receivedLifecyclePages.get(syncKey) ?? 0,
            message.pageNumber ?? 0,
          ),
        );
      },
      (error) => {
        receivedLifecyclePages.delete(syncKey);
        failLifecycleSync(
          shopId,
          syncId,
          `生命周期分页异步写入失败：${ingestionErrorMessage(error, "未知错误")}`,
        );
      },
    );
  } else if (message.event === "lifecycle_completed" && message.syncId) {
    const syncId = message.syncId;
    const syncKey = rateLimitDiagnosticKey(shopId, syncId);
    latestRateLimitDiagnostics.delete(syncKey);
    enqueueSyncIngestion(
      syncIngestionKey(shopId, syncId, "lifecycle"),
      () => {
        const receivedPages = receivedLifecyclePages.get(syncKey) ?? 0;
        receivedLifecyclePages.delete(syncKey);
        if (receivedPages === 0) {
          failLifecycleSync(
            shopId,
            syncId,
            "生命周期 Worker 未发送可解析的分页数据，已阻止将空结果标记为完成。",
          );
          return;
        }
        completeLifecycleSync(shopId, syncId);
      },
      (error) => {
        receivedLifecyclePages.delete(syncKey);
        failLifecycleSync(
          shopId,
          syncId,
          `生命周期完成后处理失败：${ingestionErrorMessage(error, "未知错误")}`,
        );
      },
    );
  } else if (message.event === "lifecycle_failed" && message.syncId) {
    const syncId = message.syncId;
    const syncKey = rateLimitDiagnosticKey(shopId, syncId);
    enqueueSyncIngestion(
      syncIngestionKey(shopId, syncId, "lifecycle"),
      () => {
        receivedLifecyclePages.delete(syncKey);
        failLifecycleSync(
          shopId,
          syncId,
          rateLimitFailureMessage(shopId, message, "生命周期同步失败。"),
        );
      },
      (error) =>
        addTemuBrowserEvent(
          shopId,
          "LIFECYCLE_FAILURE_WRITE_FAILED",
          "ERROR",
          ingestionErrorMessage(error, "生命周期失败状态写入失败。"),
        ),
    );
  } else if (message.event === "traffic_page" && message.syncId) {
    const syncId = message.syncId;
    const syncKey = rateLimitDiagnosticKey(shopId, syncId);
    enqueueSyncIngestion(
      syncIngestionKey(shopId, syncId, "traffic"),
      () => {
        storeTrafficPage(shopId, {
          syncId,
          pageNumber: message.pageNumber ?? 1,
          pageSize: message.pageSize ?? 30,
          total: message.total ?? 0,
          totalPages: message.totalPages ?? 1,
          requestBody: message.requestBody ?? {},
          httpStatus: message.httpStatus ?? 0,
          durationMs: message.durationMs ?? 0,
          payload: message.payload ?? {},
          items: message.items ?? [],
        });
        receivedTrafficPages.set(
          syncKey,
          Math.max(receivedTrafficPages.get(syncKey) ?? 0, message.pageNumber ?? 0),
        );
      },
      (error) => {
        receivedTrafficPages.delete(syncKey);
        failTrafficSync(
          shopId,
          syncId,
          `商品流量分页异步写入失败：${ingestionErrorMessage(error, "未知错误")}`,
        );
      },
    );
  } else if (message.event === "traffic_completed" && message.syncId) {
    const syncId = message.syncId;
    const syncKey = rateLimitDiagnosticKey(shopId, syncId);
    latestRateLimitDiagnostics.delete(syncKey);
    enqueueSyncIngestion(
      syncIngestionKey(shopId, syncId, "traffic"),
      () => {
        const receivedPages = receivedTrafficPages.get(syncKey) ?? 0;
        receivedTrafficPages.delete(syncKey);
        if (receivedPages === 0) {
          failTrafficSync(
            shopId,
            syncId,
            "商品流量 Worker 未发送可解析的分页数据，已阻止将空结果标记为完成。",
          );
          return;
        }
        completeTrafficSync(shopId, syncId);
      },
      (error) => {
        receivedTrafficPages.delete(syncKey);
        failTrafficSync(
          shopId,
          syncId,
          `商品流量完成后处理失败：${ingestionErrorMessage(error, "未知错误")}`,
        );
      },
    );
  } else if (message.event === "traffic_failed" && message.syncId) {
    const syncId = message.syncId;
    const syncKey = rateLimitDiagnosticKey(shopId, syncId);
    enqueueSyncIngestion(
      syncIngestionKey(shopId, syncId, "traffic"),
      () => {
        receivedTrafficPages.delete(syncKey);
        failTrafficSync(
          shopId,
          syncId,
          rateLimitFailureMessage(shopId, message, "商品流量同步失败。"),
        );
      },
      (error) =>
        addTemuBrowserEvent(
          shopId,
          "TRAFFIC_FAILURE_WRITE_FAILED",
          "ERROR",
          ingestionErrorMessage(error, "商品流量失败状态写入失败。"),
        ),
    );
  }

  const status =
    message.status ?? (message.event === "starting" ? "STARTING" : undefined);
  if (status) {
    updateTemuShopRuntime(shopId, status, {
      ...(message.mallId === undefined ? {} : { mallId: message.mallId }),
      error:
        status === "ERROR" ||
        status === "RISK_BLOCKED" ||
        status === "LOGIN_REQUIRED"
          ? (message.message ?? null)
          : null,
      success: status === "READY",
    });
  }
  addTemuBrowserEvent(
    shopId,
    `WORKER_${String(message.event ?? "MESSAGE").toUpperCase()}`,
    status ?? null,
    message.message ?? null,
    {
      ...(message.currentUrl === undefined ? {} : { currentUrl: message.currentUrl }),
      ...(message.mallId === undefined ? {} : { mallId: message.mallId }),
      ...(message.loginAttempted === undefined
        ? {}
        : { loginAttempted: message.loginAttempted }),
    },
  );
}

export function initializeTemuBrowserManager(): void {
  for (const directory of [
    paths.browserProfiles,
    paths.browserRecords,
    paths.browserRuntime,
  ]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  resetStaleTemuBrowserRuntime();
}

export function startTemuBrowser(shopId: number): TemuShopProfile {
  const profile = getTemuShopProfile(shopId);
  if (!profile.enabled) throw new Error("店铺档案已停用。");
  if (workers.has(shopId)) throw new Error("该店铺浏览器实例已在运行。");
  if (!fs.existsSync(config.browserWorkerScript))
    throw new Error("未找到 CloakBrowser Worker 脚本。");

  const credentials = getTemuShopCredentials(shopId);
  updateTemuShopRuntime(shopId, "STARTING", { error: null });
  addTemuBrowserEvent(
    shopId,
    "START_REQUESTED",
    "STARTING",
    "管理员请求启动可视浏览器。",
  );
  const child = spawn(config.browserWorkerPython, workerArgs(profile), {
    cwd: config.workspaceRoot,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: false,
    env: {
      ...process.env,
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
      ...(credentials
        ? {
            TEMU_LOGIN_ACCOUNT: credentials.account,
            TEMU_LOGIN_PASSWORD: credentials.password,
          }
        : {}),
    },
  });
  workers.set(shopId, { process: child, stopping: false });
  updateTemuShopRuntime(shopId, "STARTING", { processId: child.pid ?? null });

  const output = readline.createInterface({ input: child.stdout });
  output.on("line", (line: string) => {
    let message: WorkerMessage;
    try {
      message = JSON.parse(line) as WorkerMessage;
    } catch (error) {
      addTemuBrowserEvent(
        shopId,
        "WORKER_OUTPUT_INVALID_JSON",
        null,
        error instanceof Error ? error.message : "Worker 输出不是有效 JSON。",
        { outputPreview: line.slice(0, 2000) },
      );
      return;
    }
    try {
      handleWorkerMessage(shopId, message);
    } catch (error) {
      addTemuBrowserEvent(
        shopId,
        "WORKER_MESSAGE_HANDLER_FAILED",
        "ERROR",
        ingestionErrorMessage(error, "Worker 消息处理失败。"),
        { event: message.event, syncId: message.syncId },
      );
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    addTemuBrowserEvent(
      shopId,
      "WORKER_STDERR",
      null,
      chunk.toString("utf8").slice(0, 2000),
    );
  });
  child.on("error", (error: Error) => {
    workers.delete(shopId);
    updateTemuShopRuntime(shopId, "ERROR", {
      processId: null,
      error: error.message,
    });
    addTemuBrowserEvent(shopId, "WORKER_SPAWN_ERROR", "ERROR", error.message);
  });
  child.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
    const managed = workers.get(shopId);
    workers.delete(shopId);
    const expected = managed?.stopping === true;
    updateTemuShopRuntime(
      shopId,
      expected ? "STOPPED" : code === 0 ? "STOPPED" : "ERROR",
      {
        processId: null,
        error:
          expected || code === 0
            ? null
            : `Worker 异常退出，code=${code ?? "null"} signal=${signal ?? "null"}`,
      },
    );
    addTemuBrowserEvent(
      shopId,
      "WORKER_EXITED",
      expected || code === 0 ? "STOPPED" : "ERROR",
      "浏览器 Worker 已退出。",
      { code, signal },
    );
  });

  return getTemuShopProfile(shopId);
}

export function syncTemuLifecycle(shopId: number, syncId: number): void {
  const managed = workers.get(shopId);
  if (!managed || managed.process.killed) throw new Error("浏览器实例未运行。");
  const profile = getTemuShopProfile(shopId);
  if (profile.runtimeStatus !== "READY")
    throw new Error("浏览器会话未就绪，请先检查会话。");
  managed.process.stdin.write(
    `${JSON.stringify({
      action: "sync_lifecycle",
      syncId,
      pageSize: 50,
      secondarySelectStatusList: [12],
      supplierTodoTypeList: [],
    })}\n`,
  );
  addTemuBrowserEvent(
    shopId,
    "LIFECYCLE_SYNC_REQUESTED",
    profile.runtimeStatus,
    "已发送已发布到站点生命周期同步任务。",
    { syncId, secondarySelectStatusList: [12] },
  );
}

export function syncTemuTrafficGoods(shopId: number, syncId: number): void {
  const managed = workers.get(shopId);
  if (!managed || managed.process.killed) throw new Error("浏览器实例未运行。");
  const profile = getTemuShopProfile(shopId);
  if (profile.runtimeStatus !== "READY")
    throw new Error("浏览器会话未就绪，请先检查会话。");
  managed.process.stdin.write(
    `${JSON.stringify({
      action: "sync_traffic_goods",
      syncId,
      pageSize: 30,
      timeDimension: 1,
    })}\n`,
  );
  addTemuBrowserEvent(
    shopId,
    "TRAFFIC_SYNC_REQUESTED",
    profile.runtimeStatus,
    "已发送商品流量同步任务。",
    { syncId },
  );
}

export function healthCheckTemuBrowser(shopId: number): TemuShopProfile {
  const managed = workers.get(shopId);
  if (!managed || managed.process.killed) {
    updateTemuShopRuntime(shopId, "STOPPED", {
      processId: null,
      error: "浏览器实例未运行。",
    });
    throw new Error("浏览器实例未运行。");
  }
  managed.process.stdin.write(`${JSON.stringify({ action: "health" })}\n`);
  addTemuBrowserEvent(
    shopId,
    "HEALTH_REQUESTED",
    getTemuShopProfile(shopId).runtimeStatus,
    "已发送会话健康检查。",
  );
  return getTemuShopProfile(shopId);
}

export function stopTemuBrowser(shopId: number): TemuShopProfile {
  const managed = workers.get(shopId);
  if (!managed)
    return updateTemuShopRuntime(shopId, "STOPPED", {
      processId: null,
      error: null,
    });
  managed.stopping = true;
  managed.process.stdin.write(`${JSON.stringify({ action: "stop" })}\n`);
  addTemuBrowserEvent(
    shopId,
    "STOP_REQUESTED",
    getTemuShopProfile(shopId).runtimeStatus,
    "管理员请求停止浏览器。",
  );
  setTimeout(() => {
    if (!managed.process.killed) managed.process.kill();
  }, 10_000).unref();
  return getTemuShopProfile(shopId);
}

export function stopAllTemuBrowsers(): void {
  for (const [shopId, managed] of workers) {
    managed.stopping = true;
    managed.process.stdin.write(`${JSON.stringify({ action: "stop" })}\n`);
    addTemuBrowserEvent(
      shopId,
      "SERVER_SHUTDOWN",
      null,
      "服务关闭，正在停止浏览器实例。",
    );
  }
}
