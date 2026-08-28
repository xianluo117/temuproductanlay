type SyncIngestionTask = () => void;
type SyncIngestionErrorHandler = (error: unknown) => void;

const ingestionChains = new Map<string, Promise<void>>();

/**
 * 按店铺和同步批次串行调度数据库写入。
 * 调用方立即返回；同一批次的分页与完成事件严格按接收顺序执行。
 */
export function enqueueSyncIngestion(
  key: string,
  task: SyncIngestionTask,
  onError: SyncIngestionErrorHandler,
): void {
  const previous = ingestionChains.get(key) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(
      () =>
        new Promise<void>((resolve) => {
          setImmediate(resolve);
        }),
    )
    .then(task);

  ingestionChains.set(key, current);
  void current
    .catch(onError)
    .finally(() => {
      if (ingestionChains.get(key) === current) ingestionChains.delete(key);
    });
}
