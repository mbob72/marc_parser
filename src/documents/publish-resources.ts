import { readFile, statfs } from "node:fs/promises";

const MIB = 1024n ** 2n;
const GIB = 1024n ** 3n;

export type PublicationResourceSample = {
  memoryAvailableBytes: bigint;
  diskAvailableBytes: bigint;
};
export type PublicationResourceGateOptions = {
  signal?: AbortSignal;
  workDir?: string;
  sample?: () => Promise<PublicationResourceSample>;
  softMemoryMiB?: number;
  criticalMemoryMiB?: number;
  reserveDiskGiB?: number;
  intervalMs?: number;
  progress?: (event: Record<string, unknown>) => void;
};
export type PublicationResourceGate = {
  signal: AbortSignal;
  ready(): Promise<void>;
  close(): Promise<void>;
};

/** Не допускает переполнения и неверной единицы до создания фонового таймера. */
function positiveInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw Error(`${name} must be a positive safe integer`);
  return value;
}

/** Снимает MemAvailable Linux-хоста и доступные пользователю блоки workDir.
 * Сэмплер не меняет PostgreSQL или параметры контейнера.
 * DOC-PREVIEW:/docs/bib-publication.md#resources */
async function sampleHost(workDir: string): Promise<PublicationResourceSample> {
  const [meminfo, filesystem] = await Promise.all([
    readFile("/proc/meminfo", "utf8"),
    statfs(workDir, { bigint: true }),
  ]);
  const available = /^MemAvailable:\s*(\d+)\s+kB\s*$/m.exec(meminfo);
  if (!available) throw Error("MemAvailable is unavailable");
  return {
    memoryAvailableBytes: BigInt(available[1]!) * 1024n,
    diskAvailableBytes: filesystem.bavail * filesystem.bsize,
  };
}

/** Ограничивает выдачу работы при мягком давлении и независимо от SQL отменяет
 * загрузку при критическом отсчёте или невозможности измерения ресурсов.
 * ready — общий допуск, не семафор: число SQL-исполнителей ограничивает координатор.
 * close завершает ожидания сразу, даже если подставной сэмплер ещё не ответил.
 * DOC-PREVIEW:/docs/bib-publication.md#resources */
export function createPublicationResourceGate(
  options: PublicationResourceGateOptions = {},
): PublicationResourceGate {
  const softMemoryMiB = positiveInteger(
    "softMemoryMiB",
    options.softMemoryMiB ?? 3072,
  );
  const criticalMemoryMiB = positiveInteger(
    "criticalMemoryMiB",
    options.criticalMemoryMiB ?? 2048,
  );
  const reserveDiskGiB = positiveInteger(
    "reserveDiskGiB",
    options.reserveDiskGiB ?? 150,
  );
  const intervalMs = positiveInteger("intervalMs", options.intervalMs ?? 2000);
  if (intervalMs > 60000) throw Error("intervalMs must not exceed 60000");
  if (criticalMemoryMiB > softMemoryMiB)
    throw Error("criticalMemoryMiB must not exceed softMemoryMiB");
  const limits = {
    softMemoryBytes: BigInt(softMemoryMiB) * MIB,
    criticalMemoryBytes: BigInt(criticalMemoryMiB) * MIB,
    reserveDiskBytes: BigInt(reserveDiskGiB) * GIB,
  };
  const controller = new AbortController();
  const signal = controller.signal;
  const sampler =
    options.sample ?? (() => sampleHost(options.workDir ?? process.cwd()));
  const waiters = new Set<{
    resolve: () => void;
    reject: (reason: unknown) => void;
  }>();
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let state: "unmeasured" | "ready" | "paused" = "unmeasured";

  const stopTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const rejectWaiters = (reason: unknown) => {
    for (const waiter of waiters) waiter.reject(reason);
    waiters.clear();
  };
  const onExternalAbort = () =>
    controller.abort(
      options.signal?.reason ?? Error("Publication resource gate aborted"),
    );
  const onAbort = () => {
    stopTimer();
    options.signal?.removeEventListener("abort", onExternalAbort);
    rejectWaiters(signal.reason);
  };
  signal.addEventListener("abort", onAbort, { once: true });

  // В событие попадают только пороги и числовые значения: исходная ошибка чтения
  // может содержать приватный путь, поэтому её текст наружу не передаётся.
  const emit = (
    event: string,
    sample?: PublicationResourceSample,
    reason?: string,
  ) => {
    try {
      options.progress?.({
        event,
        at: new Date().toISOString(),
        intervalMs,
        softMemoryBytes: limits.softMemoryBytes.toString(),
        criticalMemoryBytes: limits.criticalMemoryBytes.toString(),
        reserveDiskBytes: limits.reserveDiskBytes.toString(),
        ...(sample
          ? {
              memoryAvailableBytes: sample.memoryAvailableBytes.toString(),
              diskAvailableBytes: sample.diskAvailableBytes.toString(),
            }
          : {}),
        ...(reason ? { reason } : {}),
      });
    } catch {
      controller.abort(Error("Publication resource progress callback failed"));
    }
  };
  const critical = (reason: string, sample?: PublicationResourceSample) => {
    emit("resource_critical", sample, reason);
    if (!signal.aborted)
      controller.abort(Error(`Publication resource gate stopped: ${reason}`));
  };

  // Один отсчёт выполняется до выдачи первого ready; следующие идут независимо
  // от запросов исполнителей. Новый отсчёт не перекрывается с незавершённым.
  const tick = async () => {
    if (closed || signal.aborted) return;
    try {
      const sample = await sampler();
      if (closed || signal.aborted) return;
      if (
        typeof sample.memoryAvailableBytes !== "bigint" ||
        typeof sample.diskAvailableBytes !== "bigint" ||
        sample.memoryAvailableBytes < 0n ||
        sample.diskAvailableBytes < 0n
      )
        throw Error("Invalid publication resource sample");
      emit("resource_sample", sample);
      if (signal.aborted) return;
      if (sample.diskAvailableBytes < limits.reserveDiskBytes) {
        critical("disk", sample);
        return;
      }
      if (sample.memoryAvailableBytes < limits.criticalMemoryBytes) {
        critical("memory", sample);
        return;
      }
      if (sample.memoryAvailableBytes < limits.softMemoryBytes) {
        if (state !== "paused") emit("resource_pause", sample);
        state = "paused";
      } else {
        if (state === "paused") emit("resource_resume", sample);
        state = "ready";
        if (!signal.aborted) for (const waiter of waiters) waiter.resolve();
        waiters.clear();
      }
    } catch {
      if (!closed && !signal.aborted) critical("sampling_error");
    } finally {
      if (!closed && !signal.aborted) timer = setTimeout(tick, intervalMs);
    }
  };

  emit("start");
  if (!signal.aborted) {
    if (options.signal?.aborted) onExternalAbort();
    else
      options.signal?.addEventListener("abort", onExternalAbort, {
        once: true,
      });
  }
  if (!signal.aborted) void tick();

  return {
    signal,
    async ready() {
      if (closed) throw Error("Publication resource gate is closed");
      signal.throwIfAborted();
      if (state === "ready") return;
      return new Promise<void>((resolve, reject) => {
        waiters.add({ resolve, reject });
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      stopTimer();
      options.signal?.removeEventListener("abort", onExternalAbort);
      signal.removeEventListener("abort", onAbort);
      rejectWaiters(Error("Publication resource gate is closed"));
    },
  };
}
