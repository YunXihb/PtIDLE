/**
 * 轻量级内存缓存工具（T-FIX: 消除 5 个 service 重复手写的 5 分钟缓存）
 *
 * 用法：
 *   const cache = createCache<CardTemplate[]>(5 * 60 * 1000);
 *   const data = await cache.getOrLoad(() => query(...));
 *   cache.clear();
 */
export function createCache<T>(ttlMs: number) {
  let data: T | null = null;
  let timestamp = 0;

  return {
    /**
     * 取缓存；命中且未过期返回缓存，否则调用 loader 并缓存
     */
    async getOrLoad(loader: () => Promise<T>): Promise<T> {
      const now = Date.now();
      if (data !== null && now - timestamp < ttlMs) {
        return data;
      }
      const fresh = await loader();
      data = fresh;
      timestamp = now;
      return fresh;
    },

    /** 命中（未过期）且有值 */
    isFresh(): boolean {
      return data !== null && Date.now() - timestamp < ttlMs;
    },

    /** 清空缓存 */
    clear(): void {
      data = null;
      timestamp = 0;
    },
  };
}
