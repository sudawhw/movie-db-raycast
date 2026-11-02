import * as cheerio from "cheerio";
export const CHANNELS = [
  "Oscarono",
  "Remux4KFilm",
  "gimy115",
  "Lsp115",
  "vip115hot",
  "QukanMovie",
  "jnjy_5",
  "XiangxiuNBB",
];
export function resolveChannels(input?: string): {
  channels: string[];
  invalid: string[];
} {
  if (!input?.trim()) return { channels: [...CHANNELS], invalid: [] };
  const channels: string[] = [],
    invalid: string[] = [],
    seen = new Set<string>();
  for (const raw of input.trim().split(/[\s,，;；]+/)) {
    let username = raw;
    if (/^https?:\/\//i.test(raw)) {
      try {
        const u = new URL(raw);
        const parts = u.pathname.split("/").filter(Boolean);
        if (
          u.hostname.toLowerCase() !== "t.me" ||
          ![1, 2].includes(parts.length) ||
          (parts.length === 2 && parts[0] !== "s")
        )
          throw Error();
        username = parts.at(-1)!;
      } catch {
        invalid.push(raw);
        continue;
      }
    } else username = username.replace(/^@/, "");
    if (!/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(username)) {
      invalid.push(raw);
      continue;
    }
    if (!seen.has(username.toLowerCase())) {
      seen.add(username.toLowerCase());
      channels.push(username);
    }
  }
  return { channels, invalid };
}
export type Link = {
  type: "115" | "百度网盘" | "夸克网盘" | "待领取";
  retrieval?: "bot" | "message";
  url: string;
  messageUrl: string;
  channel: string;
  text: string;
  date: string;
};
function classify(url: string): Link["type"] | undefined {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return;
    const h = u.hostname.toLowerCase();
    if (
      h === "115.com" ||
      h.endsWith(".115.com") ||
      h === "115cdn.com" ||
      h.endsWith(".115cdn.com")
    )
      return "115";
    if (h === "pan.baidu.com") return "百度网盘";
    if (h === "pan.quark.cn") return "夸克网盘";
  } catch {}
}
export function parseChannel(
  html: string,
  channel: string,
): { links: Link[]; accessible: boolean; posts: number } {
  const $ = cheerio.load(html);
  const links: Link[] = [];
  let posts = 0;
  $(".tgme_widget_message[data-post]").each((_i, el) => {
    const node = $(el);
    const post = node.attr("data-post") || "";
    const match = post.match(/^([a-zA-Z][a-zA-Z0-9_]{4,31})\/(\d+)$/);
    if (!match) return;
    const author = node
      .find("a.tgme_widget_message_owner_name")
      .first()
      .attr("href");
    // Telegram may serve a channel's old @name under its current canonical @name.
    if (
      match[1].toLowerCase() !== channel.toLowerCase() &&
      author?.toLowerCase() !== `https://t.me/${match[1]}`.toLowerCase()
    )
      return;
    posts++;
    const message = node.find(".tgme_widget_message_text").clone();
    message.find("br").replaceWith("\n");
    const text = message
      .text()
      .replace(/[^\S\n]+/g, " ")
      .trim();
    const date = node.find("time").attr("datetime") || "";
    const urls = new Set<string>();
    node.find("a[href]").each((_j, a) => {
      const href = $(a).attr("href");
      if (href) urls.add(href);
    });
    for (const url of text.match(/https?:\/\/[^\s<>]+/g) || [])
      urls.add(url.replace(/[，。；,;）)]+$/, ""));
    let directCount = 0;
    for (const url of urls) {
      const type = classify(url);
      if (type) {
        directCount++;
        links.push({
          type,
          url,
          messageUrl: `https://t.me/${post}`,
          channel,
          text,
          date,
        });
      }
    }
    if (!directCount)
      node.find("a[href]").each((_j, a) => {
        const label = $(a).text();
        if (
          !/(?:领取资源|获取链接|获取资源|点击获取|点击跳转|下载资源)/.test(
            label,
          )
        )
          return;
        const href = $(a).attr("href") || "";
        try {
          const u = new URL(href);
          if (u.hostname !== "t.me" || u.protocol !== "https:") return;
          const bot =
            /^\/[A-Za-z][A-Za-z0-9_]*bot$/i.test(u.pathname) &&
            u.searchParams.has("start");
          const message = /^\/[A-Za-z][A-Za-z0-9_]{4,31}\/\d+$/.test(
            u.pathname,
          );
          if (bot || message)
            links.push({
              type: "待领取",
              url: href,
              messageUrl: `https://t.me/${post}`,
              channel,
              text,
              date,
              retrieval: bot ? "bot" : "message",
            });
        } catch {}
      });
  });
  return { links, posts, accessible: $(".tgme_channel_history").length > 0 };
}
export function describeRelease(text: string): {
  title: string;
  specs: string[];
} {
  const lines = text
    .split(/\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const titleLine =
    lines.find((x) => /^(?:名称|片名|标题|剧名|资源名称)\s*[:：]/.test(x)) ||
    lines.find((x) => /^[🎬📽🎞]/u.test(x)) ||
    lines[0] ||
    "";
  let title = titleLine
    .replace(/^(?:名称|片名|标题|剧名|资源名称)\s*[:：]\s*/, "")
    .replace(/^[🎬📽🎞️\s]+/u, "")
    .replace(/^[【\[](?:剧集|电影|电视剧|动漫)[】\]]\s*[:：]?\s*/, "")
    .replace(/https?:\/\/\S+/g, "")
    .trim();
  title = title
    .replace(/(?:剧情简介|剧情|简介|描述|发行时间)\s*[:：].*$/, "")
    .trim();
  title = title.slice(0, 90) || "未标明片名";
  // Technical attributes can appear in the title, hashtags, or standalone metadata lines.
  // Skip prose so numbers and incidental words in a plot are not treated as release specs.
  const technical = lines
    .filter(
      (x) =>
        x === titleLine ||
        /^(?:S\d{1,2}E?\d*|\d{3,4}p|[48]K|WEB[ ._-]?DL|REMUX)\b/i.test(x) ||
        /^(?:[📁📺🎬💬🔍📼\s]*)(?:画质|分辨率|视频|片源|规格|字幕|音轨|大小|标签|资源类型|集数|季数)\s*[:：]/u.test(
          x,
        ),
    )
    .join(" ");
  const specs: string[] = [];
  const add = (x: string | undefined) => {
    if (x && !specs.some((y) => y.toLowerCase() === x.toLowerCase()))
      specs.push(x);
  };
  const resolution = technical.match(
    /(?:\b(?:4320p|2160p|1080p|720p|8k|4k|uhd)\b|超高清|高清)/i,
  );
  add(resolution?.[0].toUpperCase());
  for (const regex of [
    /\b(?:S\d{1,2}(?:\s*[-–~至]\s*S?\d{1,2})?(?:E\d{1,3}(?:\s*[-–~至]\s*E?\d{1,3})?)?)\b/i,
    /第[一二三四五六七八九十百\d]+季(?:第[一二三四五六七八九十百\d]+集)?/,
    /(?:全\s*\d+\s*集|\d+\s*集全|(?:更新至|更至)\s*第?\s*\d+\s*集|全集|全季|完结)/i,
  ])
    add(technical.match(regex)?.[0]);
  const range = title.match(
    /[（(](?:19|20)\d{2}[）)]\s*(\d{1,3})\s*[-–~至]\s*(\d{1,3})(?=\s|$)/,
  );
  if (range) add(`${range[1]}–${range[2]}（原帖范围）`);
  const source = technical.match(
    /\b(?:REMUX|Blu[ ._-]?ray|BD[ ._-]?REMUX|WEB[ ._-]?DL|WEB[ ._-]?RIP|HDTV|UHD[ ._-]?BD|DVDRIP)\b|原盘|蓝光/i,
  );
  add(source?.[0].toUpperCase());
  const hdr = technical.match(
    /\b(?:HDR10\+?|HDR|DOLBY[ ._-]?VISION|DoVi|DV)\b|杜比视界/i,
  );
  add(hdr?.[0].toUpperCase());
  const size = technical.match(
    /(?:大小|容量|体积)\s*[:：]\s*(\d+(?:\.\d+)?\s*(?:TB|GB|MB|G|T))\b/i,
  );
  add(size?.[1]?.toUpperCase());
  return { title, specs };
}
export function releaseTitle(title: string): string {
  return title
    .replace(/[（(](?:19|20)\d{2}[）)]/g, "")
    .replace(/[【\[].*?[】\]]/g, "")
    .replace(
      /\s+(?:S\d|\d{1,3}\s*[-–~至]\s*\d{1,3}(?:\s|$)|\d{3,4}p\b|[48]K\b|DV\b|HDR\b|WEB[ ._-]?DL\b|REMUX\b).*$/i,
      "",
    )
    .trim();
}
export function titleMatchesQuery(title: string, query: string): boolean {
  const norm = (v: string) =>
    v
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[\p{P}\p{Z}\s]/gu, "");
  const name = releaseTitle(title),
    q = norm(releaseTitle(query));
  return (
    !!q &&
    (norm(name) === q ||
      (/[：:]/.test(name) && norm(name.split(/[：:]/)[0]) === q))
  );
}
export function filterResults(links: Link[], query: string): Link[] {
  return links.filter((x) =>
    titleMatchesQuery(describeRelease(x.text).title, query),
  );
}
// Only follow a public Telegram post, once. Bot interactions require Telegram login.
export async function resolvePublicEntry(entry: Link): Promise<Link[]> {
  if (entry.retrieval !== "message") return [];
  const url = new URL(entry.url);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "t.me" ||
    !/^\/[A-Za-z][A-Za-z0-9_]{4,31}\/\d+$/.test(url.pathname)
  )
    return [];
  url.search = "?embed=1";
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw Error("公开消息加载失败");
  const channel = url.pathname.split("/")[1];
  return parseChannel(await r.text(), channel)
    .links.filter(
      (x) =>
        x.type !== "待领取" && x.messageUrl === `https://t.me${url.pathname}`,
    )
    .map((x) => ({
      ...x,
      messageUrl: entry.messageUrl,
      channel: entry.channel,
      text: entry.text,
      date: entry.date,
    }));
}
export async function searchChannels(
  query: string,
  channels: string[] = CHANNELS,
): Promise<{ links: Link[]; unavailable: string[]; posts: number }> {
  const results = await Promise.allSettled(
    channels.map(async (channel) => {
      const u = new URL(`https://t.me/s/${channel}`);
      u.searchParams.set("q", query);
      const r = await fetch(u, { signal: AbortSignal.timeout(12000) });
      if (!r.ok) throw Error(`HTTP ${r.status}`);
      return { channel, ...parseChannel(await r.text(), channel) };
    }),
  );
  const links: Link[] = [];
  const unavailable: string[] = [];
  let posts = 0;
  results.forEach((r, i) => {
    if (r.status === "rejected" || !r.value.accessible)
      unavailable.push(channels[i]);
    else {
      links.push(...r.value.links);
      posts += r.value.posts;
    }
  });
  const priority = { "115": 0, 百度网盘: 1, 夸克网盘: 2, 待领取: 3 };
  const seen = new Set<string>();
  return {
    links: links
      .filter((x) => {
        if (seen.has(x.url)) return false;
        seen.add(x.url);
        return true;
      })
      .sort(
        (a, b) =>
          priority[a.type] - priority[b.type] ||
          Number(titleMatchesQuery(describeRelease(b.text).title, query)) -
            Number(titleMatchesQuery(describeRelease(a.text).title, query)) ||
          b.date.localeCompare(a.date),
      ),
    unavailable,
    posts,
  };
}
