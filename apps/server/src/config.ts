import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFile);
const serverRoot = path.resolve(currentDirectory, "..");
const workspaceRoot = path.resolve(serverRoot, "../..");

const configuredDataDirectory = process.env.DATA_DIR;
const configuredWebDirectory = process.env.WEB_DIST_DIR;
const configuredBrowserDataDirectory = process.env.BROWSER_DATA_DIR;
const configuredZhihouWorkerScript = process.env.ZHIHOU_WORKER_SCRIPT;

export const config = {
  host: process.env.HOST ?? "0.0.0.0",
  port: Number(process.env.PORT ?? 3100),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 50) * 1024 * 1024,
  imageDownloadTimeoutMs: Number(
    process.env.IMAGE_DOWNLOAD_TIMEOUT_MS ?? 10_000,
  ),
  sessionSecureCookie: process.env.SESSION_SECURE_COOKIE === "true",
  workspaceRoot,
  dataDirectory: configuredDataDirectory
    ? path.resolve(serverRoot, configuredDataDirectory)
    : path.join(workspaceRoot, "data"),
  webDistDirectory: configuredWebDirectory
    ? path.resolve(serverRoot, configuredWebDirectory)
    : path.join(workspaceRoot, "apps/web/dist"),
  browserDataDirectory: configuredBrowserDataDirectory
    ? path.resolve(serverRoot, configuredBrowserDataDirectory)
    : path.join(
        configuredDataDirectory
          ? path.resolve(serverRoot, configuredDataDirectory)
          : path.join(workspaceRoot, "data"),
        "browser",
      ),
  browserWorkerPython: process.env.BROWSER_WORKER_PYTHON ?? "python",
  browserWorkerScript: process.env.BROWSER_WORKER_SCRIPT
    ? path.resolve(serverRoot, process.env.BROWSER_WORKER_SCRIPT)
    : path.join(workspaceRoot, "apps/browser-worker/worker.py"),
  zhihouWorkerPython:
    process.env.ZHIHOU_WORKER_PYTHON ??
    process.env.BROWSER_WORKER_PYTHON ??
    "python",
  zhihouWorkerScript: configuredZhihouWorkerScript
    ? path.resolve(serverRoot, configuredZhihouWorkerScript)
    : path.join(workspaceRoot, "apps/browser-worker/zhihou_worker.py"),
  zhihouCredentialKey: process.env.ZHIHOU_CREDENTIAL_KEY ?? "",
  zhihouRequestTimeoutMs: Number(process.env.ZHIHOU_REQUEST_TIMEOUT_MS ?? 30_000),
  zhihouLoginMaxAttempts: Number(process.env.ZHIHOU_LOGIN_MAX_ATTEMPTS ?? 8),
};

export const paths = {
  database: path.join(
    config.dataDirectory,
    "database",
    "temu-analytics.sqlite",
  ),
  images: path.join(config.dataDirectory, "images"),
  imports: path.join(config.dataDirectory, "imports"),
  backups: path.join(config.dataDirectory, "backups"),
  temp: path.join(config.dataDirectory, "temp"),
  browserProfiles: path.join(config.browserDataDirectory, "profiles"),
  browserRecords: path.join(config.browserDataDirectory, "records"),
  browserRuntime: path.join(config.browserDataDirectory, "runtime"),
  zhihouCredentialKey: path.join(
    config.dataDirectory,
    "security",
    "zhihou-credential.key",
  ),
};
