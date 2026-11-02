import { test } from "node:test";
import assert from "node:assert/strict";
import { createShareChecker, checkInBatches } from "../src/share-health.ts";
const url = "https://115cdn.com/s/abc123?password=abcd";
test("cancelled share is removed and normal share is available", async () => {
  for (const [data, status] of [
    [{ state: false, error: "分享已取消" }, "dead"],
    [{ state: true, data: { shareinfo: { share_title: "test" } } }, "alive"],
  ] as const) {
    const checker = createShareChecker(async () => Response.json(data));
    assert.equal((await checker.check(url)).status, status);
  }
});
test("incorrect password, login, rate limits, timeout stay unknown", async () => {
  for (const error of ["访问码错误", "请登录", "请求频繁"]) {
    const c = createShareChecker(async () =>
      Response.json({ state: false, error }),
    );
    assert.equal((await c.check(url)).status, "unknown");
  }
  const c = createShareChecker(async () => {
    throw Error("timeout");
  });
  assert.equal((await c.check(url)).status, "unknown");
});
test("does not issue requests to arbitrary share domains", async () => {
  let calls = 0;
  const c = createShareChecker(async () => {
    calls++;
    return Response.json({});
  });
  await c.check("https://115cdn.com.evil.test/s/abc123");
  await c.check("https://pan.baidu.com.evil.test/s/abc");
  assert.equal(calls, 0);
});
test("successful checks are cached and manual recheck bypasses cache", async () => {
  let calls = 0;
  const c = createShareChecker(async () => {
    calls++;
    return Response.json({ state: false, error: "分享已取消" });
  });
  await c.check(url);
  await c.check(url);
  assert.equal(calls, 1);
  await c.check(url, true);
  assert.equal(calls, 2);
});
test("no more than four shares are checked at once", async () => {
  let active = 0,
    max = 0,
    total = 0;
  await checkInBatches([1, 2, 3, 4, 5, 6, 7], async () => {
    active++;
    max = Math.max(max, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    total++;
  });
  assert.equal(total, 7);
  assert.ok(max <= 4);
});

test("Baidu detects a cancelled page but not error wording inside scripts", async () => {
  const { classifyBaiduPage } = await import("../src/share-health.ts");
  assert.equal(
    classifyBaiduPage("<title>百度网盘-链接不存在</title>").status,
    "dead",
  );
  assert.equal(
    classifyBaiduPage(
      '<title>百度网盘 请输入提取码</title><script>"分享已取消"</script>',
    ).status,
    "unknown",
  );
});
test("Baidu verifies the existing extraction code without logging into an account", async () => {
  const calls: { url: string; body?: BodyInit | null }[] = [];
  const c = createShareChecker(async (input, options) => {
    calls.push({ url: String(input), body: options?.body });
    return calls.length === 1
      ? new Response("<title>百度网盘 请输入提取码</title>")
      : Response.json({ errno: 0, randsk: "temporary-share-token" });
  });
  assert.equal(
    (await c.check("https://pan.baidu.com/s/1Example?pwd=abcd")).status,
    "alive",
  );
  assert.equal(new URL(calls[1].url).searchParams.get("surl"), "Example");
  assert.equal(calls[1].body, "pwd=abcd");
});
test("Baidu never treats a missing or wrong code as a dead share", async () => {
  let calls = 0;
  const c = createShareChecker(async () => {
    calls++;
    return new Response("<title>百度网盘 请输入提取码</title>");
  });
  assert.equal(
    (await c.check("https://pan.baidu.com/s/1Example")).status,
    "unknown",
  );
  assert.equal(calls, 1);
  let n = 0;
  const wrong = createShareChecker(async () =>
    ++n === 1
      ? new Response("<title>百度网盘</title>")
      : Response.json({ errno: -9 }),
  );
  assert.equal(
    (await wrong.check("https://pan.baidu.com/s/1Example?pwd=wrong")).status,
    "unknown",
  );
});
test("Quark reads explicit cancellation even when the HTTP response is 404", async () => {
  const c = createShareChecker(async () =>
    Response.json(
      { code: 41012, message: "好友已取消了分享" },
      { status: 404 },
    ),
  );
  assert.equal(
    (await c.check("https://pan.quark.cn/s/123456abcdef")).status,
    "dead",
  );
});
test("Quark accepts valid guest shares but keeps auth and password errors unknown", async () => {
  const c = createShareChecker(async () =>
    Response.json({ code: 0, data: { stoken: "temporary-token" } }),
  );
  assert.equal(
    (await c.check("https://pan.quark.cn/s/123456abcdef")).status,
    "alive",
  );
  for (const message of ["提取码错误", "需要登录", "访问受限"]) {
    const c = createShareChecker(async () =>
      Response.json({ code: 400, message }),
    );
    assert.equal(
      (await c.check("https://pan.quark.cn/s/123456abcdef")).status,
      "unknown",
    );
  }
  const limited = createShareChecker(async () =>
    Response.json(
      { code: 41012, message: "好友已取消了分享" },
      { status: 429 },
    ),
  );
  assert.equal(
    (await limited.check("https://pan.quark.cn/s/123456abcdef")).status,
    "unknown",
  );
});
