import {
  Action,
  ActionPanel,
  getPreferenceValues,
  Icon,
  List,
  Detail,
  Cache,
  environment,
  openExtensionPreferences,
  showToast,
  Toast,
  open,
} from "@raycast/api";
import { useEffect, useState } from "react";
import { translate } from "./i18n";
const tr = (s: string) =>
  translate(s, getPreferenceValues<{ language?: string }>().language || "en");
import { createClient } from "./network";
import {
  searchChannels,
  resolveChannels,
  filterResults,
  releaseTitle,
  resolvePublicEntry,
  describeRelease,
  titleMatchesQuery,
  type Link,
} from "./telegram";
import {
  createShareChecker,
  checkInBatches,
  type ShareHealth,
} from "./share-health";
const shareChecker = createShareChecker();
import { fetchTmdb, type TmdbResult } from "./tmdb";
import { loadPoster } from "./poster";
import { join } from "node:path";
const posterDirectory = join(environment.supportPath, "posters");
const client = createClient(new Cache());
const HOUR = 60 * 60 * 1000;
type Item = {
  id: string;
  title: string;
  sub_title?: string;
  year?: string;
  url: string;
  img?: string;
  episode?: string;
};
type Omdb = {
  Response: string;
  Error?: string;
  Title?: string;
  Year?: string;
  imdbID?: string;
  imdbRating?: string;
  Director?: string;
  Actors?: string;
  Writer?: string;
  Genre?: string;
  Plot?: string;
  Runtime?: string;
  Country?: string;
  Poster?: string;
  Ratings?: { Source: string; Value: string }[];
};
type Douban = {
  code: number;
  msg: string;
  data?: {
    score?: string;
    director?: string;
    actor?: string;
    genre?: string;
    duration?: string;
    description?: string;
    summary?: string;
    intro?: string;
  };
};
async function request<T>(
  url: string,
  headers: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<T> {
  const host = new URL(url).hostname;
  const ttl =
    host.includes("wikipedia") || host.includes("wikidata")
      ? 7 * 24 * HOUR
      : host === "movie.douban.com"
        ? 5 * 60 * 1000
        : 6 * HOUR;
  return client.request<T>(url, {
    headers,
    signal,
    ttl,
    cacheable: (value) => {
      if (!value || (Array.isArray(value) && value.length === 0)) return false;
      const x = value as { Response?: string; code?: number };
      return x.Response !== "False" && (x.code === undefined || x.code === 0);
    },
  });
}
async function findImdbId(item: Item): Promise<string | undefined> {
  const params = new URLSearchParams({
    action: "query",
    prop: "pageprops",
    titles: [
      item.title,
      `${item.title} (电视剧)`,
      `${item.title} (電影)`,
      `${item.title} (电影)`,
    ].join("|"),
    format: "json",
    redirects: "1",
  });
  const wiki = await request<{
    query?: {
      pages?: Record<string, { pageprops?: { wikibase_item?: string } }>;
    };
  }>(`https://zh.wikipedia.org/w/api.php?${params}`);
  const entities = Object.values(wiki.query?.pages || {})
    .map((p) => p.pageprops?.wikibase_item)
    .filter((id): id is string => !!id && /^Q\d+$/.test(id));
  type Claim = { mainsnak?: { datavalue?: { value?: unknown } } };
  if (!entities.length) return;
  const params2 = new URLSearchParams({
    action: "wbgetentities",
    ids: [...new Set(entities)].join("|"),
    props: "claims",
    format: "json",
  });
  const data = await request<{
    entities: Record<string, { claims?: Record<string, Claim[]> }>;
  }>(`https://www.wikidata.org/w/api.php?${params2}`);
  for (const entity of Object.values(data.entities)) {
    const values = (key: string) =>
      entity.claims?.[key]?.map((x) => x.mainsnak?.datavalue?.value) || [];
    if (values("P4529").includes(item.id)) {
      const id = values("P345").find(
        (x): x is string => typeof x === "string" && /^tt\d+$/.test(x),
      );
      if (id) return id;
    }
  }

  return;
}
function AboutSources() {
  const logo = join(environment.assetsPath, "tmdb.svg");
  return (
    <Detail
      navigationTitle={tr("资料来源")}
      markdown={tr(
        `### 影视评分速查\n\n海报、中文简介和演职员资料优先使用 TMDB，豆瓣评分通过 ApiZero 获取，IMDb 与烂番茄评分由 OMDb 提供。\n\n![TMDB](<${logo}?raycast-width=100>)\n\nThis product uses the TMDB API but is not endorsed or certified by TMDB.\n\n[The Movie Database](https://www.themoviedb.org) · [申请 TMDB 密钥](https://www.themoviedb.org/settings/api)\n\nTMDB 支持 API Key 或 API Read Access Token，申请后填入扩展设置即可。`,
      )}
    />
  );
}
function ChannelSearch({ title }: { title: string }) {
  const { telegramChannels } = getPreferenceValues<{
    telegramChannels?: string;
  }>();
  const { channels, invalid } = resolveChannels(telegramChannels);
  const [query, setQuery] = useState(title);
  const [showAll, setShowAll] = useState(false);
  const [health, setHealth] = useState<Record<string, ShareHealth>>({});
  const [checking, setChecking] = useState(false);
  const [rows, setRows] = useState<Link[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    if (!query.trim()) {
      setRows([]);
      setBusy(false);
      return;
    }
    if (!channels.length) {
      setRows([]);
      setBusy(false);
      setMessage("频道配置无效，请打开扩展设置修改");
      return;
    }
    setBusy(true);
    setRows([]);
    setHealth({});
    setChecking(false);
    setMessage("");
    const timer = setTimeout(() => {
      searchChannels(query.trim(), channels)
        .then(async (result) => {
          if (!active) return;
          const candidates = filterResults(result.links, query)
            .filter((x) => x.retrieval === "message")
            .slice(0, 8);
          const resolved = await Promise.all(
            candidates.map(async (x) => {
              try {
                return { entry: x, links: await resolvePublicEntry(x) };
              } catch {
                return { entry: x, links: [] };
              }
            }),
          );
          if (!active) return;
          const replaced = new Set(
            resolved.filter((x) => x.links.length).map((x) => x.entry.url),
          );
          const all = [
            ...result.links.filter((x) => !replaced.has(x.url)),
            ...resolved.flatMap((x) => x.links),
          ];
          const seen = new Set<string>();
          setRows(
            all.filter((x) => {
              if (seen.has(x.url)) return false;
              seen.add(x.url);
              return true;
            }),
          );
          setMessage(
            `${result.posts} 条公开消息 · ${result.links.length} 个入口${result.unavailable.length ? ` · 无法公开读取：${result.unavailable.map((x) => `@${x}`).join("、")}` : ""}${invalid.length ? ` · 频道格式有误：${invalid.join("、")}` : ""}`,
          );
          const candidatesToCheck = filterResults(all, query).filter(
            (x) => x.type !== "待领取",
          );
          setChecking(candidatesToCheck.length > 0);
          void checkInBatches(candidatesToCheck, async (row) => {
            if (!active) return;
            const value = await shareChecker.check(row.url);
            if (active) setHealth((prev) => ({ ...prev, [row.url]: value }));
          }).finally(() => {
            if (active) setChecking(false);
          });
        })
        .catch(() => {
          if (active) setMessage("检索失败，请检查 Telegram 网络连接");
        })
        .finally(() => {
          if (active) setBusy(false);
        });
    }, 500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, telegramChannels]);
  const expired = rows.filter((x) => health[x.url]?.status === "dead").length;
  const visibleRows = (
    showAll
      ? rows
      : filterResults(rows, query).filter(
          (x) => health[x.url]?.status !== "dead",
        )
  )
    .slice()
    .sort(
      (a, b) =>
        Number(health[b.url]?.status === "alive") -
        Number(health[a.url]?.status === "alive"),
    );
  const hidden = rows.length - filterResults(rows, query).length;
  return (
    <List
      isLoading={busy || checking}
      onSearchTextChange={setQuery}
      searchText={query}
      throttle={false}
      searchBarAccessory={
        <List.Dropdown
          tooltip={tr("结果筛选")}
          value={showAll ? "all" : "exact"}
          onChange={(x) => setShowAll(x === "all")}
        >
          <List.Dropdown.Item title={tr("仅片名匹配")} value="exact" />
          <List.Dropdown.Item title={tr("显示全部（含失效）")} value="all" />
        </List.Dropdown>
      }
      searchBarPlaceholder={tr("搜索频道中的影片名称")}
    >
      <List.EmptyView
        icon={Icon.MagnifyingGlass}
        title={tr(busy ? "正在搜索公开频道…" : "未找到片名匹配的资源")}
        description={tr(
          `${hidden ? `已剔除 ${hidden} 条无关结果。` : ""}${expired ? `已隐藏 ${expired} 条失效链接。` : ""}${message || "可在操作菜单中打开频道，使用 Telegram 内搜索"}`,
        )}
        actions={
          <ActionPanel>
            <Action
              title={tr("管理搜索频道")}
              icon={Icon.Gear}
              onAction={openExtensionPreferences}
            />
            {channels.map((c) => (
              <Action.OpenInBrowser
                key={c}
                title={tr(`搜索 @${c}`)}
                url={`https://t.me/s/${c}?${new URLSearchParams({ q: query })}`}
              />
            ))}
          </ActionPanel>
        }
      />
      {["115", "百度网盘", "夸克网盘", "待领取"].map((type) => {
        const group = visibleRows.filter((x) => x.type === type);
        return group.length ? (
          <List.Section
            key={type}
            title={tr(type === "待领取" ? "需要领取链接" : type)}
            subtitle={tr(
              `${group.length} 条${!showAll && hidden ? ` · 已剔除 ${hidden} 条无关结果` : ""}${expired ? ` · ${showAll ? "含" : "已隐藏"} ${expired} 条失效` : ""}${checking ? " · 正在验链" : ""}`,
            )}
          >
            {group.map((row, i) => (
              <List.Item
                key={`${row.url}-${i}`}
                icon={Icon.Link}
                title={releaseTitle(describeRelease(row.text).title)}
                subtitle={
                  [
                    ...describeRelease(row.text).specs,
                    ...(row.type === "待领取"
                      ? [
                          row.retrieval === "bot"
                            ? "需 Telegram 机器人领取"
                            : "需打开获取页",
                        ]
                      : []),
                  ]
                    .map(tr)
                    .join(" · ") || tr("规格未标明")
                }
                accessories={[
                  ...(!titleMatchesQuery(describeRelease(row.text).title, query)
                    ? [{ text: tr("正文匹配") }]
                    : []),
                  {
                    text: tr(
                      health[row.url]?.status === "alive"
                        ? "可访问"
                        : health[row.url]?.status === "dead"
                          ? "已失效"
                          : row.type !== "待领取" && !health[row.url]
                            ? "检测中"
                            : row.type === "待领取"
                              ? "需领取"
                              : "待确认",
                    ),
                    tooltip: tr(health[row.url]?.reason || "未确认分享状态"),
                  },
                  { text: `@${row.channel}` },
                  { text: row.date.slice(0, 10) },
                ]}
                actions={
                  <ActionPanel>
                    {row.type !== "待领取" ? (
                      <Action
                        title={tr(`打开 ${row.type} 链接`)}
                        icon={Icon.Globe}
                        onAction={async () => {
                          const value = await shareChecker.check(row.url);
                          setHealth((prev) => ({ ...prev, [row.url]: value }));
                          if (value.status === "dead") {
                            await showToast({
                              style: Toast.Style.Failure,
                              title: tr("分享已失效，已从结果中移除"),
                            });
                            return;
                          }
                          await open(row.url);
                        }}
                      />
                    ) : (
                      <Action.OpenInBrowser
                        title={tr(
                          type === "待领取"
                            ? "打开领取入口"
                            : `打开 ${type} 链接`,
                        )}
                        url={row.url}
                      />
                    )}
                    {row.type !== "待领取" && (
                      <Action
                        title={tr("重新检测链接")}
                        icon={Icon.ArrowClockwise}
                        onAction={async () => {
                          const value = await shareChecker.check(row.url, true);
                          setHealth((prev) => ({ ...prev, [row.url]: value }));
                          await showToast({
                            style:
                              value.status === "dead"
                                ? Toast.Style.Failure
                                : Toast.Style.Success,
                            title: tr(value.reason),
                          });
                        }}
                      />
                    )}
                    {row.retrieval === "message" && (
                      <Action
                        title={tr("尝试获取网盘直链")}
                        icon={Icon.Download}
                        onAction={async () => {
                          try {
                            const links = await resolvePublicEntry(row);
                            if (links.length)
                              setRows((current) => [
                                ...links,
                                ...current.filter((x) => x.url !== row.url),
                              ]);
                            else
                              await showToast({
                                style: Toast.Style.Failure,
                                title: tr("公开页面未提供直链，请打开领取入口"),
                              });
                          } catch {
                            await showToast({
                              style: Toast.Style.Failure,
                              title: tr("获取失败，请打开领取入口"),
                            });
                          }
                        }}
                      />
                    )}
                    <Action.OpenInBrowser
                      title={tr("查看频道原消息")}
                      url={row.messageUrl}
                    />
                    <Action
                      title={tr("管理搜索频道")}
                      icon={Icon.Gear}
                      onAction={openExtensionPreferences}
                    />
                    <Action.CopyToClipboard
                      title={tr("复制网盘链接")}
                      content={row.url}
                    />
                  </ActionPanel>
                }
              />
            ))}
          </List.Section>
        ) : null;
      })}
    </List>
  );
}
function Ratings({ item }: { item: Item }) {
  const [revision, setRevision] = useState(0);
  const [posterPath, setPosterPath] = useState("");
  useEffect(() => {
    let active = true;
    setPosterPath("");
    if (item.img)
      loadPoster(item.img, posterDirectory)
        .then((path) => {
          if (active) setPosterPath(path);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [item.img]);
  const [score, setScore] = useState("查询中…");
  const [details, setDetails] = useState<Douban["data"]>();
  const [data, setData] = useState<Omdb>();
  const [status, setStatus] = useState("查询中…");
  const [tmdb, setTmdb] = useState<TmdbResult>();
  const [tmdbStatus, setTmdbStatus] = useState("");
  const { omdbKey, doubanKey, fallbackUrl, tmdbKey } = getPreferenceValues<{
    omdbKey?: string;
    doubanKey?: string;
    fallbackUrl?: string;
    tmdbKey?: string;
  }>();
  useEffect(() => {
    let active = true;
    setScore("查询中…");
    setStatus("查询中…");
    setData(undefined);
    setDetails(undefined);
    setTmdb(undefined);
    setTmdbStatus(
      tmdbKey ? "正在加载 TMDB 资料…" : "填写 TMDB 密钥以启用中文资料",
    );
    (async () => {
      const errors: string[] = [];
      try {
        const x = await request<Douban>(
          `https://v1.apizero.cn/api/douban-movie?id=${encodeURIComponent(item.id)}`,
          doubanKey ? { Authorization: `Bearer ${doubanKey}` } : {},
        );
        if (x.code === 0 && x.data && active) setDetails(x.data);
        if (x.code === 0 && x.data?.score) {
          if (active) {
            setDetails(x.data);
            setScore(`${x.data.score} / 10`);
          }
          return;
        }
        errors.push(x.msg || "暂无评分");
      } catch (e) {
        errors.push(`ApiZero ${e instanceof Error ? e.message : "不可用"}`);
      }
      if (fallbackUrl) {
        try {
          const url = fallbackUrl.replace("{id}", encodeURIComponent(item.id));
          if (!url.startsWith("https://") || !fallbackUrl.includes("{id}"))
            throw Error("备用接口地址须为 HTTPS 且包含 {id}");
          const x = await request<{
            score?: string | number;
            data?: { score?: string | number };
          }>(url);
          const value = x.data?.score ?? x.score;
          if (
            value !== undefined &&
            value !== null &&
            String(value).trim() !== ""
          ) {
            if (active) setScore(`${value} / 10 · 备用接口`);
            return;
          }
          errors.push("备用接口未返回评分");
        } catch {
          errors.push("备用接口不可用");
        }
      }
      try {
        const r = await fetch(`https://movie.douban.com/subject/${item.id}/`, {
          signal: AbortSignal.timeout(10000),
          headers: { "User-Agent": "Mozilla/5.0" },
        });
        if (!r.ok) throw Error();
        const html = await r.text();
        const value = html.match(
          /property=["']v:average["'][^>]*>\s*([\d.]+)/,
        )?.[1];
        if (value) {
          if (active) setScore(`${value} / 10 · 豆瓣网页`);
          return;
        }
        errors.push("豆瓣网页受限或无评分");
      } catch {
        errors.push("豆瓣网页不可用");
      }
      if (active) setScore(`无法获取：${errors.join("；")}`);
    })();
    const association =
      omdbKey || tmdbKey
        ? findImdbId(item).catch(() => undefined)
        : Promise.resolve(undefined);
    const metadata = (async () => {
      if (!tmdbKey) return;
      try {
        const id = await association;
        const result = await fetchTmdb(item, tmdbKey, request, id);
        if (active) {
          setTmdb(result);
          setTmdbStatus("");
        }
        return result;
      } catch (e) {
        if (active)
          setTmdbStatus(e instanceof Error ? e.message : "TMDB 资料加载失败");
      }
    })();
    if (!omdbKey) setStatus("请填写 OMDb API Key");
    else
      (async () => {
        let imdbId = await association;
        if (!imdbId && tmdbKey) imdbId = (await metadata)?.imdbId;
        if (!active) return;
        const name = item.sub_title?.trim();
        if (!imdbId && (!name || !/[a-zA-Z]/.test(name))) {
          setStatus("未找到可靠对应条目");
          return;
        }
        const p = imdbId
          ? new URLSearchParams({ apikey: omdbKey, i: imdbId, plot: "full" })
          : new URLSearchParams({ apikey: omdbKey, t: name!, plot: "full" });
        if (!imdbId && item.year) p.set("y", item.year);
        try {
          const x = await request<Omdb>(`https://www.omdbapi.com/?${p}`);
          if (active) {
            if (
              x.Response === "True" &&
              (imdbId || !item.year || x.Year?.slice(0, 4) === item.year)
            ) {
              setData(x);
              setStatus("");
            } else setStatus("OMDb 未收录或未匹配");
          }
        } catch {
          if (active) setStatus("OMDb 请求失败，请检查密钥或网络");
        }
      })();
    return () => {
      active = false;
    };
  }, [item.id, omdbKey, doubanKey, fallbackUrl, tmdbKey, revision]);
  const rt = data?.Ratings?.find((x) => x.Source === "Rotten Tomatoes")?.Value;
  const q = encodeURIComponent(item.sub_title || item.title);
  const actions = (
    <ActionPanel>
      <Action.Push
        title={tr("搜索网盘资源")}
        icon={Icon.MagnifyingGlass}
        target={<ChannelSearch title={item.title.split(/[：:]/)[0].trim()} />}
      />
      <Action
        title={tr("打开扩展设置")}
        icon={Icon.Gear}
        onAction={openExtensionPreferences}
      />
      {tmdb && (
        <Action.OpenInBrowser
          title={tr("打开 TMDB")}
          url={`https://www.themoviedb.org/${tmdb.kind}/${tmdb.id}`}
        />
      )}
      <Action.Push
        title={tr("资料来源与说明")}
        icon={Icon.Info}
        target={<AboutSources />}
      />
      <Action
        title={tr("刷新评分与资料")}
        icon={Icon.ArrowClockwise}
        onAction={() => {
          client.clear();
          setRevision((x) => x + 1);
        }}
      />
      <Action.OpenInBrowser title={tr("打开豆瓣")} url={item.url} />
      <Action.OpenInBrowser
        title={tr("打开 IMDb")}
        url={
          data?.imdbID
            ? `https://www.imdb.com/title/${data.imdbID}/`
            : `https://www.imdb.com/find/?q=${q}`
        }
      />
      <Action.OpenInBrowser
        title={tr("搜索烂番茄")}
        url={`https://www.rottentomatoes.com/search?search=${q}`}
      />
    </ActionPanel>
  );
  const imdb =
    data?.imdbRating && data.imdbRating !== "N/A"
      ? `${data.imdbRating} / 10`
      : data?.Ratings?.find((x) => x.Source === "Internet Movie Database")
          ?.Value || (data ? "OMDb 暂无评分" : status);
  const rotten = data ? rt || "OMDb 暂无评分" : status;
  const poster =
    tmdb?.poster ||
    posterPath ||
    (data?.Poster && data.Poster !== "N/A" ? data.Poster : "");
  const safe = (x?: string) =>
    x && x !== "N/A" ? x.replace(/[\r\n]+/g, " ") : tr("暂无");
  const escape = (x: string) => x.replace(/[\\`*_{}\[\]<>|]/g, "\\$&");
  const doubanOverview = [
    details?.summary,
    details?.description,
    details?.intro,
  ].find((x) => x?.trim() && x !== "N/A");
  const chineseDouban =
    doubanOverview && /\p{Script=Han}/u.test(doubanOverview)
      ? doubanOverview
      : undefined;
  const chineseTmdb =
    tmdb?.overview && tmdb.overviewLanguage !== "英文 / 原文"
      ? tmdb.overview
      : undefined;
  const overview =
    chineseDouban ||
    chineseTmdb ||
    doubanOverview ||
    tmdb?.overview ||
    (data?.Plot !== "N/A" ? data?.Plot : undefined);
  const overviewSource = chineseDouban
    ? "豆瓣 · ApiZero"
    : chineseTmdb
      ? `TMDB · ${tmdb?.overviewLanguage}`
      : doubanOverview
        ? "豆瓣 · ApiZero"
        : tmdb?.overview
          ? `TMDB · ${tmdb.overviewLanguage}`
          : overview
            ? "OMDb · 英文"
            : "暂无简介";
  const badge = (file: string, label: string) =>
    `![${label}](<${join(environment.assetsPath, file)}?raycast-width=14&raycast-height=14>) ${label}`;
  const compact = (text: string) =>
    text === "查询中…"
      ? "加载中"
      : text.includes(" / 10") || /^\d+(?:\.\d+)?%$/.test(text)
        ? text.split(" · ")[0]
        : "—";
  const issues = [
    !score.includes(" / 10") && score !== "查询中…" ? `豆瓣：${score}` : "",
    !data && status !== "查询中…" ? `IMDb / 烂番茄：${status}` : "",
    tmdbStatus,
  ].filter(Boolean);
  const metadataLine = [item.sub_title, item.year]
    .filter(Boolean)
    .map((x) => escape(x!))
    .join(" · ");
  const posterCell = poster
    ? `![海报](<${poster}${poster.includes("?") ? "&" : "?"}raycast-width=140&raycast-height=210>)`
    : "暂无海报";
  const scoreCell = `**${escape(item.title)}**<br>${metadataLine}<br><br>${badge("douban.png", tr("豆瓣"))} **${tr(compact(score))}**<br>${badge("imdb.png", "IMDb")} **${tr(compact(imdb))}**<br>${badge("tomato.png", tr("烂番茄"))} **${tr(compact(rotten))}**`;
  const markdown = `| ${posterCell} | ${scoreCell} |\n| :---: | :--- |\n\n**${tr("剧情简介")}**\n\n${overview ? escape(overview) : tr("暂无简介，资料加载完成后会显示在这里。")}\n\n${tr("来源：")}${tr(overviewSource)}${issues.length ? `\n\n${issues.map((x) => escape(tr(x))).join("\n\n")}` : ""}`;
  const actors = tmdb?.cast.slice(0, 6) || [];
  const directors =
    details?.director || tmdb?.directors.join(" / ") || data?.Director;
  return (
    <Detail
      navigationTitle={item.title}
      isLoading={
        score === "查询中…" ||
        status === "查询中…" ||
        tmdbStatus === "正在加载 TMDB 资料…"
      }
      markdown={markdown}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title={tr("导演")} text={safe(directors)} />
          {actors.length ? (
            <Detail.Metadata.TagList title={tr("主演")}>
              {actors.map((actor, index) => (
                <Detail.Metadata.TagList.Item key={index} text={actor.name} />
              ))}
            </Detail.Metadata.TagList>
          ) : (
            <Detail.Metadata.Label
              title={tr("主演")}
              text={safe(details?.actor || data?.Actors)}
            />
          )}
          <Detail.Metadata.Label
            title={tr("编剧 / 主创")}
            text={safe(tmdb?.writers.join(" / ") || data?.Writer)}
          />
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label
            title={tr("类型")}
            text={safe(tmdb?.genres || details?.genre || data?.Genre)}
          />
          <Detail.Metadata.Label
            title={tr("时长")}
            text={tr(safe(tmdb?.runtime || details?.duration || data?.Runtime))}
          />
          <Detail.Metadata.Label
            title={tr("地区")}
            text={safe(tmdb?.country || data?.Country)}
          />
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label
            title={tr("简介来源")}
            text={tr(overviewSource)}
          />
          {data && (
            <Detail.Metadata.Link
              title={tr("IMDb 匹配")}
              text={`${data.Title} (${data.Year})`}
              target={`https://www.imdb.com/title/${data.imdbID}/`}
            />
          )}
          {tmdb && (
            <Detail.Metadata.Link
              title={tr("资料来源")}
              text={`TMDB · ${tmdb.title}`}
              target={`https://www.themoviedb.org/${tmdb.kind}/${tmdb.id}`}
            />
          )}
          <Detail.Metadata.Label
            title={tr("评分来源")}
            text={tr("豆瓣：ApiZero / 备用源；IMDb、烂番茄：OMDb")}
          />
          <Detail.Metadata.Label
            title={tr("匹配提示")}
            text={tr("豆瓣单季与其他平台整剧可能不同")}
          />
        </Detail.Metadata>
      }
      actions={actions}
    />
  );
}
export default function Command() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!q.trim()) {
      setItems([]);
      setLoading(false);
      setError("");
      return;
    }
    let active = true;
    const controller = new AbortController();
    setItems([]);
    setError("");
    setLoading(true);
    const timer = setTimeout(() => {
      request<Item[]>(
        `https://movie.douban.com/j/subject_suggest?${new URLSearchParams({ q: q.trim() })}`,
        {},
        controller.signal,
      )
        .then((x) => {
          if (active) {
            setItems(x);
            setError("");
            for (const item of x.slice(0, 10)) {
              if (item.img)
                loadPoster(item.img, posterDirectory)
                  .then((path) => {
                    if (active)
                      setItems((current) =>
                        current.map((row) =>
                          row.id === item.id ? { ...row, img: path } : row,
                        ),
                      );
                  })
                  .catch(() => {});
            }
          }
        })
        .catch((e: unknown) => {
          if (!active) return;
          console.error(
            "[影视评分] 豆瓣搜索失败",
            e instanceof Error ? `${e.name}: ${e.message}` : "未知错误",
          );
          if (active) {
            setItems([]);
            setError(
              `豆瓣搜索失败：${e instanceof Error ? e.message : "未知错误"}，请重试`,
            );
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 350);
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [q]);
  return (
    <List
      isLoading={loading}
      actions={
        <ActionPanel>
          <Action
            title={tr("打开扩展设置")}
            icon={Icon.Gear}
            onAction={openExtensionPreferences}
          />
          <Action.Push title={tr("资料来源与说明")} target={<AboutSources />} />
        </ActionPanel>
      }
      onSearchTextChange={setQ}
      throttle={false}
      searchBarPlaceholder={tr("输入中文或英文片名，选择条目后按回车")}
    >
      <List.EmptyView
        icon={Icon.MagnifyingGlass}
        title={tr(
          error ||
            (loading
              ? "正在搜索…"
              : q
                ? "没有找到结果"
                : "输入影视名称开始搜索"),
        )}
      />
      {items.map((x) => (
        <List.Item
          key={x.id}
          icon={{ source: x.img || Icon.FilmStrip, fallback: Icon.FilmStrip }}
          title={x.title}
          subtitle={x.sub_title || ""}
          accessories={x.year ? [{ text: x.year }] : []}
          actions={
            <ActionPanel>
              <Action.Push
                title={tr("查询三站评分")}
                target={<Ratings item={x} />}
              />
              <Action.OpenInBrowser title={tr("打开豆瓣")} url={x.url} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
