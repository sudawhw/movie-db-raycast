import { test } from "node:test";
import assert from "node:assert/strict";
import { parseChannel } from "../src/telegram.ts";
const fixture = `<section class="tgme_channel_history"><div class="tgme_widget_message" data-post="gimy115/123"><div class="tgme_widget_message_text">电影示例 <a href="https://115.com/s/abc">115</a> <a href="https://pan.baidu.com/s/xyz">百度</a> <a href="https://pan.quark.cn/s/test">夸克</a> <a href="https://evil.test/115.com">伪装</a></div><time datetime="2026-01-01T00:00:00Z"></time></div></section>`;
test("extracts supported links with their original channel and message", () => {
  const r = parseChannel(fixture, "gimy115");
  assert.equal(r.posts, 1);
  assert.deepEqual(
    r.links.map((x) => x.type),
    ["115", "百度网盘", "夸克网盘"],
  );
  assert.equal(r.links[0].messageUrl, "https://t.me/gimy115/123");
});
test("reports unavailable channel pages and ignores unrelated posts", () => {
  assert.equal(
    parseChannel("<h1>Open in Telegram</h1>", "gimy115").accessible,
    false,
  );
  assert.equal(parseChannel(fixture, "OtherChannel").links.length, 0);
});

test("extracts title and verifiable release facts, excludes plot", async () => {
  const { describeRelease } = await import("../src/telegram.ts");
  assert.deepEqual(
    describeRelease(
      "名称: 小城良方【4K】【WEB-DL】S01E03\n剧情简介: 一位导演在1080p之前拍摄。\n📁大小: 8.5 GB",
    ),
    {
      title: "小城良方【4K】【WEB-DL】S01E03",
      specs: ["4K", "S01E03", "WEB-DL", "8.5 GB"],
    },
  );
  assert.deepEqual(
    describeRelease(
      "名称: 底线\n发行时间: 2022-09-19\n剧情简介: 讲述4K的故事\n📁大小: 188.48G",
    ),
    { title: "底线", specs: ["188.48G"] },
  );
});
test("query matches the title instead of unrelated plot", async () => {
  const { titleMatchesQuery } = await import("../src/telegram.ts");
  assert.equal(titleMatchesQuery("小城良方 S01", "小城良方"), true);
  assert.equal(titleMatchesQuery("去有风的地方", "小城良方"), false);
});

test("default channels include the newly requested source", async () => {
  const { resolveChannels } = await import("../src/telegram.ts");
  assert.ok(resolveChannels(undefined).channels.includes("XiangxiuNBB"));
  assert.equal(resolveChannels("").channels.length, 8);
});
test("channel settings accept names and Telegram URLs, deduplicate and reject invalid entries", async () => {
  const { resolveChannels } = await import("../src/telegram.ts");
  assert.deepEqual(
    resolveChannels(
      "@XiangxiuNBB,https://t.me/s/gimy115，@xiangxiunbb;https://example.com/bad;../bad",
    ),
    {
      channels: ["XiangxiuNBB", "gimy115"],
      invalid: ["https://example.com/bad", "../bad"],
    },
  );
  assert.deepEqual(resolveChannels("@bad"), {
    channels: [],
    invalid: ["@bad"],
  });
});
test("searches only configured channels", async () => {
  const { searchChannels } = await import("../src/telegram.ts");
  const orig = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async (input) => {
    urls.push(String(input));
    return new Response('<section class="tgme_channel_history"></section>');
  };
  try {
    const result = await searchChannels("电影", ["XiangxiuNBB"]);
    assert.equal(urls.length, 1);
    assert.match(urls[0], /t\.me\/s\/XiangxiuNBB/);
    assert.deepEqual(result.unavailable, []);
  } finally {
    globalThis.fetch = orig;
  }
});

test("accepts canonical channel names when the configured name is an alias", async () => {
  const html =
    '<section class="tgme_channel_history"><div class="tgme_widget_message" data-post="kfcfoodcourt/123"><a class="tgme_widget_message_owner_name" href="https://t.me/kfcfoodcourt">频道</a><div class="tgme_widget_message_text">名称: 示例 <a href="https://115.com/s/test">资源</a></div></div></section>';
  const result = parseChannel(html, "XiangxiuNBB");
  assert.equal(result.posts, 1);
  assert.equal(result.links[0].channel, "XiangxiuNBB");
  assert.equal(result.links[0].messageUrl, "https://t.me/kfcfoodcourt/123");
});

test("strict result filter rejects plot-only matches and sequels", async () => {
  const { filterResults, titleMatchesQuery } =
    await import("../src/telegram.ts");
  const base = {
    type: "115" as const,
    url: "https://115.com/s/a",
    messageUrl: "https://t.me/gimy115/1",
    channel: "gimy115",
    date: "2026-01-01",
  };
  const result = filterResults(
    [
      { ...base, text: "名称: 小城良方 (2026) 1-14" },
      { ...base, text: "名称: 去有风的地方\n描述: 推荐小城良方" },
      { ...base, text: "名称: 小城良方2 (2027)" },
    ],
    "小城良方",
  );
  assert.equal(result.length, 1);
  assert.equal(
    titleMatchesQuery("复仇者联盟4：终局之战 (2019)", "复仇者联盟4"),
    true,
  );
});
test("bot claim buttons are exposed as claim entries and not fabricated direct links", () => {
  const html =
    '<section class="tgme_channel_history"><div class="tgme_widget_message" data-post="gimy115/888"><div class="tgme_widget_message_text">[剧集]：小城良方 (2026)<br>S01E22<br>4K WEB-DL HDR10</div><a class="tgme_widget_message_inline_button" href="https://t.me/gimy110bot?start=claim_abc">领取资源</a><a href="https://t.me/adbot?start=vip">开通VIP</a></div></section>';
  const r = parseChannel(html, "gimy115");
  assert.equal(r.links.length, 1);
  assert.equal(r.links[0].type, "待领取");
  assert.equal(r.links[0].retrieval, "bot");
});
test("public message entry can be followed once to extract its drive link", async () => {
  const { resolvePublicEntry } = await import("../src/telegram.ts");
  const orig = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      '<div class="tgme_widget_message" data-post="otherchan/8"><div class="tgme_widget_message_text">资源 <a href="https://115.com/s/real">点击获取</a></div></div>',
    );
  try {
    const result = await resolvePublicEntry({
      type: "待领取",
      retrieval: "message",
      url: "https://t.me/otherchan/8",
      messageUrl: "https://t.me/gimy115/1",
      text: "名称: 小城良方",
      channel: "gimy115",
      date: "",
    });
    assert.equal(result[0].url, "https://115.com/s/real");
    assert.equal(result[0].messageUrl, "https://t.me/gimy115/1");
  } finally {
    globalThis.fetch = orig;
  }
});
