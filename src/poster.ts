import { createHash } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const pending = new Map<string, Promise<string>>();
/** Fetch Douban posters with the same referer as their subject page. */
export async function loadPoster(
  source: string,
  directory: string,
): Promise<string> {
  if (!source.startsWith("https://")) return source;
  const url = new URL(source);
  if (!url.hostname.endsWith(".doubanio.com")) return source;
  const path = join(
    directory,
    createHash("sha256").update(source).digest("hex") + ".jpg",
  );
  try {
    const saved = await stat(path);
    if (Date.now() - saved.mtimeMs < 7 * 86400000) return path;
  } catch {}
  const existing = pending.get(path);
  if (existing) return existing;
  const operation = (async () => {
    const response = await fetch(source, {
      signal: AbortSignal.timeout(8000),
      headers: {
        Referer: "https://movie.douban.com/",
        "User-Agent": "Mozilla/5.0",
      },
    });
    if (
      !response.ok ||
      !response.headers.get("content-type")?.startsWith("image/")
    )
      throw Error("海报下载失败");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 8 * 1024 * 1024 || bytes.length < 100)
      throw Error("海报大小异常");
    await mkdir(directory, { recursive: true });
    await writeFile(path, bytes);
    return path;
  })();
  pending.set(path, operation);
  try {
    return await operation;
  } finally {
    pending.delete(path);
  }
}
