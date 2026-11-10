import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("uses the installed Next cache with force-dynamic, bounded keys and immediate tag expiry", () => {
  // An isolated Node process loads Next's real AsyncLocalStorage and cache code,
  // not the unit double. Only the incremental storage and database read are fake.
  const output = execFileSync(process.execPath, ["-e", `
    globalThis.AsyncLocalStorage = require('node:async_hooks').AsyncLocalStorage;
    const assert = require('node:assert/strict');
    const { unstable_cache, revalidateTag } = require('next/cache');
    const { workAsyncStorage } = require('next/dist/server/app-render/work-async-storage.external');
    const { workUnitAsyncStorage } = require('next/dist/server/app-render/work-unit-async-storage.external');
    const entries = new Map(); let now = 30001; let reads = 0;
    const incrementalCache = {
      generateSimpleCacheKey: async key => key,
      get: async key => {
        const entry = entries.get(key);
        return entry ? { value: entry.value, isStale: now - entry.at >= 30000 } : null;
      },
      set: async (key, value, options) => { entries.set(key, { value, tags: options.tags, at: now }); },
    };
    async function request(fn) {
      const store = { route: '/r/test', forceDynamic: true, incrementalCache };
      return workAsyncStorage.run(store, () => workUnitAsyncStorage.run({
        type: 'request', phase: 'action', url: { pathname: '/r/test', search: '' },
      }, async () => {
        const result = await fn();
        await Promise.all(Object.values(store.pendingRevalidates || {}));
        for (const tag of store.pendingRevalidatedTags || []) {
          for (const [key, entry] of entries) if (entry.tags.includes(tag)) entries.delete(key);
        }
        return result;
      }));
    }
    const bounded = id => unstable_cache(async (id, bucket) => ({ id, read: ++reads }), ['public-menu-v1', 'contents'], {
      tags: ['public-menu:' + id], revalidate: 30,
    })(id, Math.floor(now / 30000));
    (async () => {
      const first = await request(() => bounded('a'));
      assert.deepEqual(await request(() => bounded('a')), first);
      assert.equal(reads, 1); // force-dynamic did not disable unstable_cache.
      now = 59999; assert.deepEqual(await request(() => bounded('a')), first);
      now = 60000; assert.notDeepEqual(await request(() => bounded('a')), first);
      const other = await request(() => bounded('b'));
      await request(() => revalidateTag('public-menu:a'));
      assert.deepEqual(await request(() => bounded('b')), other);
      const before = reads; await request(() => bounded('a')); assert.equal(reads, before + 1);
      console.log('ok');
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `], { encoding: "utf8", timeout: 10_000 });
  expect(output.trim()).toBe("ok");
});
