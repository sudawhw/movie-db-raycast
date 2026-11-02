import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "../src/network.ts";
function setup(fetcher: typeof fetch) {
  const map = new Map<string, string>();
  return {
    map,
    client: createClient(
      {
        get: (k) => map.get(k),
        set: (k, v) => {
          map.set(k, v);
        },
        clear: () => map.clear(),
      },
      fetcher,
    ),
  };
}
test("reopening a title uses cached results without spending another request", async () => {
  let calls = 0;
  const { client, map } = setup(async () => {
    calls++;
    return Response.json({ score: 8.8 });
  });
  const options = { ttl: 10000 };
  await client.request("https://example.com/?apikey=private", options);
  await client.request("https://example.com/?apikey=private", options);
  assert.equal(calls, 1);
  assert.ok(!JSON.stringify([...map.keys()]).includes("private"));
  client.clear();
  await client.request("https://example.com/?apikey=private", options);
  assert.equal(calls, 2);
});
test("concurrent detail loads share one request", async () => {
  let calls = 0;
  const { client } = setup(async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 10));
    return Response.json({ score: 9 });
  });
  await Promise.all([
    client.request("https://example.com"),
    client.request("https://example.com"),
  ]);
  assert.equal(calls, 1);
});
test("quota and invalid key responses are not retried", async () => {
  for (const status of [401, 403, 429]) {
    let calls = 0;
    const { client } = setup(async () => {
      calls++;
      return new Response("limit", { status });
    });
    await assert.rejects(client.request("https://example.com"));
    assert.equal(calls, 1);
  }
});
test("temporary server failures retry once and can recover", async () => {
  let calls = 0;
  const { client } = setup(async () =>
    ++calls === 1
      ? new Response("unavailable", { status: 503 })
      : Response.json({ score: 9 }),
  );
  assert.deepEqual(await client.request("https://example.com"), { score: 9 });
  assert.equal(calls, 2);
});
test("business errors do not poison cache", async () => {
  let calls = 0;
  const { client } = setup(async () => {
    calls++;
    return Response.json({ code: 4030 });
  });
  const options = {
    ttl: 1000,
    cacheable: (x: unknown) => (x as { code: number }).code === 0,
  };
  await client.request("https://example.com", options);
  await client.request("https://example.com", options);
  assert.equal(calls, 2);
});
test("expired cache entries are fetched again", async () => {
  let calls = 0;
  const { client } = setup(async () => {
    calls++;
    return Response.json({ score: 9 });
  });
  await client.request("https://example.com", { ttl: 1 });
  await new Promise((r) => setTimeout(r, 5));
  await client.request("https://example.com", { ttl: 1000 });
  assert.equal(calls, 2);
});
test("replaced search is cancelled without retry", async () => {
  let calls = 0;
  const controller = new AbortController();
  const { client } = setup(async (_url, options) => {
    calls++;
    return new Promise((_resolve, reject) =>
      options!.signal!.addEventListener(
        "abort",
        () => reject(new DOMException("cancelled", "AbortError")),
        { once: true },
      ),
    );
  });
  const pending = client.request("https://example.com", {
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(calls, 1);
});

test("refresh ignores an older unfinished request", async () => {
  let finish!: (value: Response) => void;
  let calls = 0;
  const { client } = setup(async () => {
    calls++;
    if (calls === 1)
      return new Promise<Response>((r) => {
        finish = r;
      });
    return Response.json({ score: 9 });
  });
  const old = client.request("https://example.com", { ttl: 10000 });
  client.clear();
  assert.deepEqual(
    await client.request("https://example.com", { ttl: 10000 }),
    { score: 9 },
  );
  finish(Response.json({ score: 1 }));
  await old;
  assert.deepEqual(
    await client.request("https://example.com", { ttl: 10000 }),
    { score: 9 },
  );
  assert.equal(calls, 2);
});
