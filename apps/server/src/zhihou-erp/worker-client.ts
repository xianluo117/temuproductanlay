import { spawn } from "node:child_process";
import { config } from "../config.js";

interface WorkerErrorPayload {
  code?: string;
  message?: string;
}

interface WorkerEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: WorkerErrorPayload;
}

export interface ZhihouWorkerOrderItem {
  externalItemKey: string;
  zhihouSku: string;
  productName: string | null;
  color: string | null;
  size: string | null;
  quantity: number;
  specificationImageUrl: string | null;
  mainImageUrl: string | null;
}

export interface ZhihouWorkerOrder {
  erpOrderId: string | null;
  orderNo: string;
  storeName: string | null;
  countryCode: string | null;
  submittedAt: string | null;
  items: ZhihouWorkerOrderItem[];
}

export interface ZhihouPendingOrdersResult {
  pageCount: number;
  orders: ZhihouWorkerOrder[];
}

export interface ZhihouWorkerLoginResult {
  success: boolean;
  account: string;
  message: string;
}

export class ZhihouWorkerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function safeErrorMessage(message: string | undefined): string {
  const value = message?.trim() ?? "";
  if (!value) return "智猴协议工作器执行失败。";
  return value.slice(0, 500);
}

export function runZhihouWorker<T>(input: {
  action: "test_login" | "sync_pending_orders";
  account: string;
  password: string;
}): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      config.zhihouWorkerPython,
      [config.zhihouWorkerScript],
      {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONIOENCODING: "utf-8",
          PYTHONUTF8: "1",
          ZHIHOU_LOGIN_MAX_ATTEMPTS: String(config.zhihouLoginMaxAttempts),
        },
      },
    );
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (operation: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      operation();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(() =>
        reject(new ZhihouWorkerError("TIMEOUT", "智猴协议请求超时。")),
      );
    }, Math.max(config.zhihouRequestTimeoutMs * 20, 120_000));

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 100 * 1024 * 1024) child.kill();
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-4_000);
    });
    child.on("error", (error) => {
      finish(() =>
        reject(
          new ZhihouWorkerError(
            "START_FAILED",
            `无法启动智猴协议工作器: ${error.message}`,
          ),
        ),
      );
    });
    child.on("close", (code) => {
      finish(() => {
        const outputLine = stdout
          .trim()
          .split(/\r?\n/)
          .filter(Boolean)
          .at(-1);
        if (!outputLine) {
          reject(
            new ZhihouWorkerError(
              "EMPTY_OUTPUT",
              stderr
                ? "智猴协议工作器未返回有效结果，请检查 Python 依赖。"
                : "智猴协议工作器未返回结果。",
            ),
          );
          return;
        }
        try {
          const envelope = JSON.parse(outputLine) as WorkerEnvelope<T>;
          if (envelope.ok && envelope.data !== undefined) {
            resolve(envelope.data);
            return;
          }
          reject(
            new ZhihouWorkerError(
              envelope.error?.code ?? "WORKER_ERROR",
              safeErrorMessage(envelope.error?.message),
            ),
          );
        } catch {
          reject(
            new ZhihouWorkerError(
              "INVALID_OUTPUT",
              code === 0
                ? "智猴协议工作器返回格式无效。"
                : "智猴协议工作器执行失败，请检查运行环境。",
            ),
          );
        }
      });
    });

    child.stdin.end(
      JSON.stringify({
        ...input,
        timeoutMs: config.zhihouRequestTimeoutMs,
        maxAttempts: config.zhihouLoginMaxAttempts,
      }),
    );
  });
}
