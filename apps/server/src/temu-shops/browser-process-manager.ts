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
} from "./temu-shop-service.js";
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
  syncId?: number;
  pageNumber?: number;
  pageSize?: number;
  total?: number;
  totalPages?: number;
  requestBody?: Record<string, unknown>;
  httpStatus?: number;
  durationMs?: number;
  payload?: Record<string, unknown>;
  items?: Array<Record<string, unknown>>;
}

interface ManagedWorker {
  process: ChildProcessWithoutNullStreams;
  stopping: boolean;
}

const workers = new Map<number, ManagedWorker>();

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
  if (message.event === "lifecycle_page" && message.syncId) {
    storeLifecyclePage(shopId, {
      syncId: message.syncId,
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
  } else if (message.event === "lifecycle_completed" && message.syncId) {
    completeLifecycleSync(shopId, message.syncId);
  } else if (message.event === "lifecycle_failed" && message.syncId) {
    failLifecycleSync(
      shopId,
      message.syncId,
      message.message ?? "生命周期同步失败。",
    );
  } else if (message.event === "traffic_page" && message.syncId) {
    storeTrafficPage(shopId, {
      syncId: message.syncId,
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
  } else if (message.event === "traffic_completed" && message.syncId) {
    completeTrafficSync(shopId, message.syncId);
  } else if (message.event === "traffic_failed" && message.syncId) {
    failTrafficSync(
      shopId,
      message.syncId,
      message.message ?? "商品流量同步失败。",
    );
  }

  const status =
    message.status ?? (message.event === "starting" ? "STARTING" : undefined);
  if (status) {
    updateTemuShopRuntime(shopId, status, {
      ...(message.mallId === undefined ? {} : { mallId: message.mallId }),
      error:
        status === "ERROR" || status === "RISK_BLOCKED"
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
      currentUrl: message.currentUrl,
      mallId: message.mallId,
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
    },
  });
  workers.set(shopId, { process: child, stopping: false });
  updateTemuShopRuntime(shopId, "STARTING", { processId: child.pid ?? null });

  const output = readline.createInterface({ input: child.stdout });
  output.on("line", (line: string) => {
    try {
      handleWorkerMessage(shopId, JSON.parse(line) as WorkerMessage);
    } catch {
      addTemuBrowserEvent(shopId, "WORKER_OUTPUT", null, line.slice(0, 2000));
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
