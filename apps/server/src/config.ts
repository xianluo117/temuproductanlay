import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFile);
const serverRoot = path.resolve(currentDirectory, '..');
const workspaceRoot = path.resolve(serverRoot, '../..');

const configuredDataDirectory = process.env.DATA_DIR;
const configuredWebDirectory = process.env.WEB_DIST_DIR;

export const config = {
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 3100),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 50) * 1024 * 1024,
  imageDownloadTimeoutMs: Number(process.env.IMAGE_DOWNLOAD_TIMEOUT_MS ?? 10_000),
  sessionSecureCookie: process.env.SESSION_SECURE_COOKIE === 'true',
  workspaceRoot,
  dataDirectory: configuredDataDirectory
    ? path.resolve(serverRoot, configuredDataDirectory)
    : path.join(workspaceRoot, 'data'),
  webDistDirectory: configuredWebDirectory
    ? path.resolve(serverRoot, configuredWebDirectory)
    : path.join(workspaceRoot, 'apps/web/dist'),
};

export const paths = {
  database: path.join(config.dataDirectory, 'database', 'temu-analytics.sqlite'),
  images: path.join(config.dataDirectory, 'images'),
  imports: path.join(config.dataDirectory, 'imports'),
  backups: path.join(config.dataDirectory, 'backups'),
  temp: path.join(config.dataDirectory, 'temp'),
};
