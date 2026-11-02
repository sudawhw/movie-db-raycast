import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fetchTmdb,
  selectCandidate,
  chooseOverview,
  normalizeMetadata,
  type Request,
} from "../src/tmdb.ts";
const fixture = {
  id: 299534,
  title: "复仇者联盟4：终局之战",
  release_date: "2019-04-24",
  imdb_id: "tt4154796",
  poster_path: "/poster.jpg",
  overview: "",
  runtime: 181,
  credits: {
    cast: [{ name: "Robert Downey Jr.", character: "Tony Stark" }],
    crew: [{ name: "Anthony Russo", job: "Director" }],
  },
  translations: {
    translations: [
      { iso_639_1: "zh", iso_3166_1: "TW", data: { overview: "繁體中文簡介" } },
      { iso_639_1: "zh", iso_3166_1: "CN", data: { overview: "简体中文简介" } },
    ],
  },
};
test("Chinese overview prefers simplified then traditional; empty translations do not hide overview", () => {
  assert.equal(chooseOverview(fixture).text, "简体中文简介");
  assert.equal(
    chooseOverview({
      ...fixture,
      translations: {
        translations: fixture.translations.translations.slice(0, 1),
      },
    }).language,
    "繁体中文",
  );
  assert.equal(
    chooseOverview({ id: 1, overview: "中文简介" }).text,
    "中文简介",
  );
  assert.equal(
    chooseOverview({ id: 1, overview: "English synopsis" }).language,
    "英文 / 原文",
  );
});
test("title fallback rejects wrong year and ambiguous candidates", () => {
  const item = { title: "人世间", year: "2022", episode: "58" };
  assert.equal(
    selectCandidate(
      [
        {
          id: 1,
          name: "人世间",
          media_type: "tv",
          first_air_date: "2022-01-28",
        },
      ],
      item,
    )?.id,
    1,
  );
  assert.equal(
    selectCandidate(
      [
        {
          id: 1,
          name: "人世间",
          media_type: "tv",
          first_air_date: "2020-01-28",
        },
      ],
      item,
    ),
    undefined,
  );
  assert.equal(
    selectCandidate(
      [
        {
          id: 1,
          title: "人世间",
          media_type: "movie",
          release_date: "2022-01-28",
        },
      ],
      item,
    ),
    undefined,
  );
  assert.equal(
    selectCandidate(
      [1, 2].map((id) => ({
        id,
        name: "人世间",
        media_type: "tv",
        first_air_date: "2022-01-28",
      })),
      item,
    ),
    undefined,
  );
});
test("read token uses header and IMDb ID, with metadata combined in one details request", async () => {
  const calls: { url: URL; headers?: Record<string, string> }[] = [];
  const request: Request = async <T>(
    url: string,
    headers?: Record<string, string>,
  ) => {
    calls.push({ url: new URL(url), headers });
    return (
      calls.length === 1 ? { movie_results: [{ id: 299534 }] } : fixture
    ) as T;
  };
  const data = await fetchTmdb(
    { title: "复仇者联盟4", year: "2019" },
    "Bearer personal-token",
    request,
    "tt4154796",
  );
  assert.equal(data.overview, "简体中文简介");
  assert.equal(data.directors[0], "Anthony Russo");
  assert.equal(data.poster, "https://image.tmdb.org/t/p/w342/poster.jpg");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].headers?.Authorization, "Bearer personal-token");
  assert.equal(calls[0].url.searchParams.get("api_key"), null);
  assert.equal(calls[0].url.pathname, "/3/find/tt4154796");
  assert.equal(
    calls[1].url.searchParams.get("append_to_response"),
    "credits,translations,external_ids",
  );
});
test("32 character API key uses v3 authentication and strict title matching", async () => {
  const urls: URL[] = [];
  const key = "a".repeat(32);
  const request: Request = async <T>(url: string) => {
    urls.push(new URL(url));
    return (
      urls.length === 1
        ? {
            results: [
              {
                id: 299534,
                title: "复仇者联盟4",
                media_type: "movie",
                release_date: "2019-04-24",
              },
            ],
          }
        : fixture
    ) as T;
  };
  await fetchTmdb({ title: "复仇者联盟4", year: "2019" }, key, request);
  assert.equal(urls[0].pathname, "/3/search/multi");
  assert.ok(urls.every((x) => x.searchParams.get("api_key") === key));
});
test("unmatched titles never fetch details for a guessed film", async () => {
  let calls = 0;
  const request: Request = async <T>() => {
    calls++;
    return { results: [] } as T;
  };
  await assert.rejects(
    fetchTmdb({ title: "未知片名", year: "2026" }, "token", request),
    /未找到唯一匹配/,
  );
  assert.equal(calls, 1);
});
test("mismatched external IMDb ID is rejected", async () => {
  let calls = 0;
  const request: Request = async <T>() =>
    (++calls === 1
      ? { movie_results: [{ id: 299534 }] }
      : { ...fixture, imdb_id: "tt9999999" }) as T;
  await assert.rejects(
    fetchTmdb({ title: "复仇者联盟4" }, "token", request, "tt4154796"),
    /ID 不一致/,
  );
});
test("TV metadata uses creator, per episode runtime and external IDs", () => {
  const data = normalizeMetadata(
    {
      id: 1,
      name: "人世间",
      episode_run_time: [45],
      created_by: [{ name: "主创" }],
      external_ids: { imdb_id: "tt17506764" },
    },
    "tv",
  );
  assert.equal(data.runtime, "45 分钟 / 集");
  assert.equal(data.imdbId, "tt17506764");
  assert.equal(data.writers[0], "主创");
});
