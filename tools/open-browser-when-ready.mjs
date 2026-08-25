import { execFile } from 'node:child_process';

const targetUrl = 'http://127.0.0.1:3100';
const healthUrl = `${targetUrl}/api/health`;
const timeoutAt = Date.now() + 60_000;

async function isReady() {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

while (Date.now() < timeoutAt) {
  if (await isReady()) {
    execFile('cmd.exe', ['/c', 'start', '', targetUrl], { windowsHide: true, detached: true });
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

console.error('服务在 60 秒内未就绪，请检查启动窗口中的错误。');
process.exit(1);
