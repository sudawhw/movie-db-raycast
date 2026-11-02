export interface LookupItem {
  title: string;
  sub_title?: string;
  year?: string;
  episode?: string;
}
export interface Candidate {
  id: number;
  media_type?: string;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
}
interface Translation {
  iso_639_1: string;
  iso_3166_1: string;
  data?: { overview?: string };
}
interface Person {
  name: string;
  character?: string;
  job?: string;
  department?: string;
}
export interface Metadata extends Candidate {
  overview?: string;
  poster_path?: string;
  runtime?: number;
  episode_run_time?: number[];
  genres?: { name: string }[];
  production_countries?: { name: string }[];
  created_by?: { name: string }[];
  imdb_id?: string;
  external_ids?: { imdb_id?: string };
  credits?: { cast?: Person[]; crew?: Person[] };
  translations?: { translations?: Translation[] };
}
export interface TmdbResult {
  id: number;
  kind: "movie" | "tv";
  title: string;
  year: string;
  imdbId?: string;
  overview: string;
  overviewLanguage: string;
  poster?: string;
  cast: Person[];
  directors: string[];
  writers: string[];
  genres: string;
  runtime: string;
  country: string;
}
export type Request = <T>(
  url: string,
  headers?: Record<string, string>,
) => Promise<T>;
const normalize = (x: string) =>
  x
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{Z}\s]/gu, "");
const unique = (names: string[]) => [...new Set(names)];

export function selectCandidate(
  results: Candidate[],
  item: LookupItem,
): Candidate | undefined {
  // A season's year can differ from the show's first air date. Do not guess in that case.
  if (!item.year) return;
  const names = [item.title, item.sub_title]
    .filter((x): x is string => !!x)
    .map(normalize);
  const matches = results.filter(
    (x) =>
      (x.media_type === "movie" || x.media_type === "tv") &&
      (!item.episode || x.media_type === "tv") &&
      (x.release_date || x.first_air_date)?.slice(0, 4) === item.year &&
      [x.title, x.name, x.original_title, x.original_name].some(
        (name) => name && names.includes(normalize(name)),
      ),
  );
  const deduped = [
    ...new Map(matches.map((x) => [`${x.media_type}:${x.id}`, x])).values(),
  ];
  return deduped.length === 1 ? deduped[0] : undefined;
}
export function chooseOverview(data: Metadata): {
  text: string;
  language: string;
} {
  const translations = data.translations?.translations || [];
  for (const region of ["CN", "TW", "HK"]) {
    const text = translations
      .find((x) => x.iso_639_1 === "zh" && x.iso_3166_1 === region)
      ?.data?.overview?.trim();
    if (text && /\p{Script=Han}/u.test(text))
      return { text, language: region === "CN" ? "简体中文" : "繁体中文" };
  }
  const overview = data.overview?.trim();
  if (overview && /\p{Script=Han}/u.test(overview))
    return { text: overview, language: "中文" };
  const english = translations
    .find((x) => x.iso_639_1 === "en")
    ?.data?.overview?.trim();
  return { text: english || overview || "", language: "英文 / 原文" };
}
export function normalizeMetadata(
  data: Metadata,
  kind: "movie" | "tv",
): TmdbResult {
  const overview = chooseOverview(data);
  const minutes = data.runtime || data.episode_run_time?.find((x) => x > 0);
  const crew = data.credits?.crew || [];
  return {
    id: data.id,
    kind,
    title: data.title || data.name || "",
    year: (data.release_date || data.first_air_date || "").slice(0, 4),
    imdbId: data.imdb_id || data.external_ids?.imdb_id,
    overview: overview.text,
    overviewLanguage: overview.language,
    poster: data.poster_path
      ? `https://image.tmdb.org/t/p/w342${data.poster_path}`
      : undefined,
    cast: (data.credits?.cast || []).slice(0, 12),
    directors: unique(
      crew.filter((x) => x.job === "Director").map((x) => x.name),
    ),
    writers: unique([
      ...crew
        .filter((x) =>
          ["Writer", "Screenplay", "Teleplay"].includes(x.job || ""),
        )
        .map((x) => x.name),
      ...(data.created_by || []).map((x) => x.name),
    ]),
    genres: (data.genres || []).map((x) => x.name).join(" / "),
    runtime: minutes ? `${minutes} 分钟${kind === "tv" ? " / 集" : ""}` : "",
    country: (data.production_countries || []).map((x) => x.name).join(" / "),
  };
}
export async function fetchTmdb(
  item: LookupItem,
  credential: string,
  request: Request,
  imdbId?: string,
): Promise<TmdbResult> {
  const secret = credential.trim().replace(/^Bearer\s+/i, "");
  const isKey = /^[a-f\d]{32}$/i.test(secret);
  const headers: Record<string, string> = isKey
    ? {}
    : { Authorization: `Bearer ${secret}` };
  const api = <T>(path: string, params: Record<string, string> = {}) => {
    const query = new URLSearchParams({ language: "zh-CN", ...params });
    if (isKey) query.set("api_key", secret);
    return request<T>(`https://api.themoviedb.org/3/${path}?${query}`, headers);
  };
  let candidate: Candidate | undefined;
  if (imdbId) {
    const found = await api<{
      movie_results?: Candidate[];
      tv_results?: Candidate[];
    }>(`find/${imdbId}`, { external_source: "imdb_id" });
    const all = [
      ...(found.movie_results || []).map((x) => ({
        ...x,
        media_type: "movie",
      })),
      ...(found.tv_results || []).map((x) => ({ ...x, media_type: "tv" })),
    ];
    if (all.length === 1) candidate = all[0];
  } else {
    const found = await api<{ results?: Candidate[] }>("search/multi", {
      query: item.title,
      include_adult: "false",
    });
    candidate = selectCandidate(found.results || [], item);
  }
  if (!candidate) throw Error("未找到唯一匹配的 TMDB 作品，请核对片名与年份");
  const kind = candidate.media_type as "movie" | "tv";
  const data = await api<Metadata>(`${kind}/${candidate.id}`, {
    append_to_response: "credits,translations,external_ids",
  });
  const result = normalizeMetadata(data, kind);
  if (imdbId && result.imdbId && result.imdbId !== imdbId)
    throw Error("TMDB 关联 ID 不一致，已停止加载");
  return result;
}
