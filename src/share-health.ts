export type ShareHealth = {
  status: "alive" | "dead" | "unknown";
  reason: string;
};
const deadMessage = (message: string) =>
  /(?:分享|链接|文件).*(?:已取消|已失效|已过期|不存在|已删除)|取消.*分享|share (?:not exist|expired|cancelled|canceled)/i.test(
    message,
  );
const unknown = (reason = "需登录或打开确认"): ShareHealth => ({
  status: "unknown",
  reason,
});
const requestOptions = () => ({ signal: AbortSignal.timeout(6000) });
export function classifyBaiduPage(html: string): ShareHealth {
  // Error strings in scripts/templates can be present on valid pages. Only trust the page title.
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  if (/链接不存在|分享已取消|分享已失效|分享已过期/.test(title))
    return { status: "dead", reason: "百度分享已取消或不存在" };
  return unknown(/提取码/.test(title) ? "需提取码确认" : "需打开页面确认");
}
async function checkBaidu(
  u: URL,
  id: string,
  fetcher: typeof fetch,
): Promise<ShareHealth> {
  const pwd = u.searchParams.get("pwd") || u.searchParams.get("password") || "";
  const page = new URL(`https://pan.baidu.com/s/${id}`);
  if (pwd) page.searchParams.set("pwd", pwd);
  const response = await fetcher(page.toString(), requestOptions());
  if (!response.ok) return unknown("百度检测受限，请打开确认");
  const pageState = classifyBaiduPage(await response.text());
  if (pageState.status === "dead") return pageState;
  if (!pwd) return pageState;
  const surl = id.startsWith("1") ? id.slice(1) : id;
  const query = new URLSearchParams({
    surl,
    channel: "chunlei",
    web: "1",
    clienttype: "0",
  });
  const verification = await fetcher(
    `https://pan.baidu.com/share/verify?${query}`,
    {
      ...requestOptions(),
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: `https://pan.baidu.com/share/init?surl=${encodeURIComponent(surl)}`,
      },
      body: new URLSearchParams({ pwd }).toString(),
    },
  );
  if (!verification.ok) return unknown("百度验证受限，请打开确认");
  const data = (await verification.json()) as {
    errno?: number;
    randsk?: string;
    err_msg?: string;
    error_msg?: string;
  };
  if (data.errno === 0 && data.randsk)
    return { status: "alive", reason: "分享及提取码已验证" };
  const error = data.err_msg || data.error_msg || "";
  if (deadMessage(error)) return { status: "dead", reason: error };
  return unknown(
    data.errno === -9 ? "提取码错误，请打开确认" : "需验证码、登录或打开确认",
  );
}
async function checkQuark(
  u: URL,
  id: string,
  fetcher: typeof fetch,
): Promise<ShareHealth> {
  const response = await fetcher(
    "https://drive-pc.quark.cn/1/clouddrive/share/sharepage/token?pr=ucpro&fr=pc",
    {
      ...requestOptions(),
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pwd_id: id,
        passcode:
          u.searchParams.get("pwd") ||
          u.searchParams.get("passcode") ||
          u.searchParams.get("password") ||
          "",
      }),
    },
  );
  // Quark can return an explicit business failure with HTTP 404. Parse the JSON first.
  if ([401, 403, 429].includes(response.status))
    return unknown("夸克检测受限，请打开确认");
  const data = (await response.json()) as {
    code?: number;
    message?: string;
    data?: { stoken?: string };
  };
  if (response.ok && data.code === 0 && data.data?.stoken)
    return { status: "alive", reason: "分享可访问" };
  if (
    data.code !== undefined &&
    data.code !== 0 &&
    deadMessage(data.message || "")
  )
    return { status: "dead", reason: data.message! };
  return unknown(
    /提取码|访问码|密码/.test(data.message || "")
      ? "提取码需确认"
      : "夸克需登录或打开确认",
  );
}
/** Only probes public sharing status; never logs in, saves, or downloads files. */
export function createShareChecker(fetcher: typeof fetch = fetch) {
  const cache = new Map<string, { expires: number; value: ShareHealth }>();
  const pending = new Map<string, Promise<ShareHealth>>();
  async function check(url: string, force = false): Promise<ShareHealth> {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return { status: "unknown", reason: "链接格式错误" };
    }
    const match = u.pathname.match(/^\/s\/([a-zA-Z0-9_-]+)\/?$/);
    const isBaidu = u.hostname === "pan.baidu.com",
      isQuark = u.hostname === "pan.quark.cn";
    if (
      u.protocol !== "https:" ||
      !match ||
      !(
        isBaidu ||
        isQuark ||
        u.hostname === "115.com" ||
        u.hostname.endsWith(".115.com") ||
        u.hostname === "115cdn.com" ||
        u.hostname.endsWith(".115cdn.com")
      )
    )
      return { status: "unknown", reason: "此网盘暂未检测" };
    const cached = cache.get(url);
    if (!force && cached && cached.expires > Date.now()) return cached.value;
    if (pending.has(url)) return pending.get(url)!;
    const task = (async (): Promise<ShareHealth> => {
      try {
        if (isBaidu) return await checkBaidu(u, match[1], fetcher);
        if (isQuark) return await checkQuark(u, match[1], fetcher);
        const query = new URLSearchParams({
          share_code: match[1],
          receive_code:
            u.searchParams.get("password") ||
            u.searchParams.get("receive_code") ||
            "",
          cid: "0",
          offset: "0",
          limit: "1",
        });
        const response = await fetcher(
          `https://webapi.115.com/share/snap?${query}`,
          { signal: AbortSignal.timeout(6000) },
        );
        if (!response.ok)
          return { status: "unknown", reason: "检测受限，请打开确认" };
        const data = (await response.json()) as {
          state?: boolean;
          error?: string;
          error_msg?: string;
          data?: { shareinfo?: unknown };
        };
        if (data.state === true && data.data?.shareinfo)
          return { status: "alive", reason: "分享可访问" };
        const error = data.error || data.error_msg || "";
        if (
          data.state === false &&
          /(?:分享|链接|文件).*(?:已取消|已失效|已过期|不存在|已删除)|取消.*分享/.test(
            error,
          )
        )
          return { status: "dead", reason: error };
        return {
          status: "unknown",
          reason: /提取码|访问码/.test(error)
            ? "提取码需确认"
            : "需登录或打开确认",
        };
      } catch {
        return { status: "unknown", reason: "检测超时或网络不可用" };
      }
    })();
    pending.set(url, task);
    try {
      const value = await task;
      cache.set(url, {
        value,
        expires: Date.now() + (value.status === "unknown" ? 30000 : 300000),
      });
      if (cache.size > 500) cache.delete(cache.keys().next().value!);
      return value;
    } finally {
      pending.delete(url);
    }
  }
  return { check };
}
export async function checkInBatches<T>(
  items: T[],
  check: (item: T) => Promise<void>,
) {
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(items.length, 4) }, async () => {
      while (index < items.length) {
        const current = items[index++];
        await check(current);
      }
    }),
  );
}
