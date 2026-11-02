import { createHash } from "node:crypto";

interface CacheStore {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  clear(): void;
}
interface Entry {
  expires: number;
  value: unknown;
}
interface Options {
  signal?: AbortSignal;
  ttl?: number;
  headers?: Record<string, string>;
  cacheable?: (data: unknown) => boolean;
}
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function createClient(store: CacheStore, fetcher: typeof fetch = fetch) {
  const pending = new Map<string, Promise<unknown>>();
  let generation = 0;
  function clear() {
    generation++;
    pending.clear();
    store.clear();
  }
  async function request<T>(url: string, options: Options = {}): Promise<T> {
    const key = createHash("sha256")
      .update(url + JSON.stringify(options.headers || {}))
      .digest("hex");
    if (options.signal?.aborted) throw new DOMException("已取消", "AbortError");
    const saved = store.get(key);
    if (saved) {
      try {
        const entry = JSON.parse(saved) as Entry;
        if (entry.expires > Date.now()) return entry.value as T;
      } catch {}
    }
    // Search requests have their own cancellation; shared detail requests finish and populate the cache.
    if (!options.signal && pending.has(key))
      return pending.get(key) as Promise<T>;
    const currentGeneration = generation;
    const operation = (async () => {
      const started = Date.now();
      const host = new URL(url).hostname;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const timeout = AbortSignal.timeout(7000);
          const signal = options.signal
            ? AbortSignal.any([timeout, options.signal])
            : timeout;
          const response = await fetcher(url, {
            signal,
            headers: {
              "User-Agent": "DramaRatings/1.0 (Raycast personal extension)",
              ...options.headers,
            },
          });
          if (!response.ok) {
            // Never print response bodies or URLs: they can contain credentials.
            const reason =
              response.status === 429
                ? "额度用完或请求过于频繁"
                : response.status === 401 || response.status === 403
                  ? "密钥或访问权限错误"
                  : "服务请求失败";
            throw new HttpError(
              response.status,
              `${reason}（HTTP ${response.status}）`,
            );
          }
          const data: unknown = await response.json();
          if (
            options.ttl &&
            generation === currentGeneration &&
            (options.cacheable?.(data) ?? true)
          )
            store.set(
              key,
              JSON.stringify({
                expires: Date.now() + options.ttl,
                value: data,
              }),
            );
          console.info(`[影视评分] ${host} ${Date.now() - started}ms`);
          return data as T;
        } catch (error) {
          if (options.signal?.aborted)
            throw new DOMException("已取消", "AbortError");
          const transient =
            error instanceof HttpError
              ? error.status >= 500
              : !(error instanceof SyntaxError);
          if (attempt === 1 || !transient) throw error;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      throw new Error("请求失败");
    })();
    if (!options.signal) pending.set(key, operation);
    try {
      return await operation;
    } finally {
      if (!options.signal && pending.get(key) === operation)
        pending.delete(key);
    }
  }
  return { request, clear };
}
