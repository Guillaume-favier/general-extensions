import {
  ContentRating,
  type Chapter,
  type ChapterDetails,
  type DiscoverSection,
  type DiscoverSectionItem,
  type MangaInfo,
  type PagedResults,
  type SearchQuery,
  type SourceManga,
  type Tag,
  type TagSection,
} from "@paperback/types";
import * as cheerio from "cheerio";
import type { Element } from "domhandler";

import {
  CDN_URL,
  type GenzToonsSearchResultItem,
  type GenzToonsSearchResultMetadata,
  type SearchMetadata,
  type WebsiteCategory,
} from "./models";
import { parseLooseJson } from "./parseLooseJson";

export const parseSelectorsSearch = (page: string): Record<string, WebsiteCategory> => {
  const $ = cheerio.load(page);
  const script = $("div.grid.grid-cols-2.gap-2").next("script").toString();
  let res: Record<string, WebsiteCategory> = {};
  const firstSplice = script.split("initializeDropdownMenu(");
  for (const part of firstSplice) {
    if (!part.startsWith("{")) continue;
    const obj = parseLooseJson(part.split(");")[0]) as unknown as WebsiteCategory;
    if (obj["type"]) res[obj["type"]] = obj;
  }
  return res;
};

export const parseSearch = (page: string): GenzToonsSearchResultItem[] => {
  const $ = cheerio.load(page);
  let results: GenzToonsSearchResultItem[] = [];

  const seriesElements = $("#searched_series_page").children();
  seriesElements.each((i: number, _el: Element) => {
    const el = seriesElements.eq(i);
    let sri: GenzToonsSearchResultItem = {
      title: el.attr("alt") ?? "",
      // TODO: fix this horendous thing
      mangaId: (el.children().first().attr("href") ?? "///").split("/")[2],
      imageUrl:
        $("button > a > div:first > div:first", el)
          .attr("style")
          ?.split("url(")[1]
          .split("); ")[0] ?? "",
      metadata: {
        slug: el.attr("id")?.trim(),
        tags: JSON.parse(el.attr("tags")?.trim() ?? "[]"),
        type: el.attr("data-type")?.trim(),
        status: el.attr("data-status")?.trim(),
      } as GenzToonsSearchResultMetadata,
    };
    results.push(sri);
  });
  return results;
};

const textCache = new Map<string, string>();

const normalizeSearchText = (value: string | undefined): string => {
  if (!value) return "";

  const cached = textCache.get(value);
  if (cached !== undefined) return cached;

  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  textCache.set(value, normalized);
  return normalized;
};

const isTokenMatch = (titleToken: string, queryToken: string): boolean => {
  if (!queryToken) return false;
  if (queryToken.length === 1) {
    return titleToken.startsWith(queryToken);
  }

  return (
    titleToken === queryToken ||
    titleToken.startsWith(queryToken) ||
    queryToken.startsWith(titleToken)
  );
};

const getSearchMatchScore = (title: string, query: string): number => {
  const normalizedTitle = normalizeSearchText(title);
  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedQuery) return 0;
  if (normalizedTitle === normalizedQuery) return 10000;
  if (normalizedTitle.includes(normalizedQuery)) return 9000 + normalizedTitle.length;

  const titleTokens = normalizedTitle.split(/\s+/).filter(Boolean);
  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);

  if (queryTokens.length === 0) return 0;

  const matchedTokens = queryTokens.filter((token) =>
    titleTokens.some((titleToken) => isTokenMatch(titleToken, token)),
  );

  if (matchedTokens.length !== queryTokens.length) return 0;

  const exactWordMatches = matchedTokens.filter((token) =>
    titleTokens.some((titleToken) => titleToken === token),
  ).length;
  const startsWithMatches = matchedTokens.filter((token) =>
    titleTokens.some((titleToken) => titleToken.startsWith(token)),
  ).length;

  let score = matchedTokens.length * 200 + exactWordMatches * 120 + startsWithMatches * 40;

  if (normalizedTitle.startsWith(queryTokens[0])) {
    score += 300;
  }

  return score;
};

const normalizeOptionValue = (value: string | undefined): string => {
  if (!value) return "";

  try {
    return normalizeSearchText(decodeURIComponent(value));
  } catch {
    return normalizeSearchText(value);
  }
};

type NormalizedMetadataFilters = {
  genres: Array<{ id: string; state: "included" | "excluded" }>;
  genresMode: "or" | "and";
  types: string[];
  statuses: string[];
};

const buildNormalizedMetadataFilters = (
  metadata: SearchMetadata | undefined,
): NormalizedMetadataFilters => ({
  genres: Object.entries(metadata?.genres ?? {})
    .map(([genreId, state]) => ({
      id: normalizeOptionValue(genreId),
      state: state as "included" | "excluded",
    }))
    .filter(({ id }) => id.length > 0),
  genresMode: metadata?.genresMode === "and" ? "and" : "or",
  types: (metadata?.types ?? []).map((type) => normalizeOptionValue(type)).filter(Boolean),
  statuses: (metadata?.status ?? []).map((status) => normalizeOptionValue(status)).filter(Boolean),
});

const matchesMetadataFilters = (
  item: GenzToonsSearchResultItem,
  filters: NormalizedMetadataFilters,
): boolean => {
  const itemGenres = new Set(
    (item.metadata?.tags ?? []).map((tag) => normalizeOptionValue(tag)).filter(Boolean),
  );

  const includedGenres = filters.genres.filter(({ state }) => state === "included");
  const excludedGenres = filters.genres.filter(({ state }) => state === "excluded");

  if (includedGenres.length > 0) {
    const hasIncludedMatch =
      filters.genresMode === "and"
        ? includedGenres.every(({ id }) => itemGenres.has(id))
        : includedGenres.some(({ id }) => itemGenres.has(id));

    if (!hasIncludedMatch) return false;
  }

  for (const { id, state } of excludedGenres) {
    const hasGenre = itemGenres.has(id);
    if (state === "excluded" && hasGenre) return false;
  }

  if (filters.types.length > 0) {
    const itemType = normalizeOptionValue(item.metadata?.type);
    if (!filters.types.includes(itemType)) return false;
  }

  if (filters.statuses.length > 0) {
    const itemStatus = normalizeOptionValue(item.metadata?.status);
    if (!filters.statuses.includes(itemStatus)) return false;
  }

  return true;
};

export const filterSearchResults = (
  items: GenzToonsSearchResultItem[],
  query: SearchQuery<SearchMetadata>,
): GenzToonsSearchResultItem[] => {
  const searchTerm = typeof query.title === "string" ? query.title.trim() : "";
  const metadata = query.metadata as
    | (SearchMetadata & { mode?: "include" | "exclude" })
    | undefined;
  const hasTitleQuery = searchTerm.length > 0;
  const isExclude = metadata?.mode === "exclude";
  const filters = buildNormalizedMetadataFilters(metadata);

  if (!hasTitleQuery) {
    return items.filter((item) => matchesMetadataFilters(item, filters));
  }

  const scoredItems: Array<{ item: GenzToonsSearchResultItem; score: number }> = [];

  for (const item of items) {
    if (!matchesMetadataFilters(item, filters)) continue;

    const score = getSearchMatchScore(item.title ?? "", searchTerm);
    if (isExclude ? score === 0 : score > 0) {
      scoredItems.push({ item, score });
    }
  }

  return scoredItems.sort((a, b) => b.score - a.score).map(({ item }) => item);
};

export const textToId = (text: string): string =>
  encodeURIComponent(text).replace(
    /[!'()*~]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );

export const parseMangaDetail = (page: string): MangaInfo => {
  const $ = cheerio.load(page);

  let altTitles: string[] = [];
  const altTitlesElem = $("div.grid.flex-wrap.gap-2.w-full.mb-2.opacity-80").children();
  if (altTitlesElem.length > 0) {
    const list = altTitlesElem.first().children();
    list.each((i: number) => {
      altTitles.push(list.eq(i).text().trim());
    });
  }

  let metaTable: Record<string, string> = {};
  const metaTableElems = $("div.grid.gap-4 > div.w-full.flex.gap-3.flex-wrap").children();

  metaTableElems.each((i: number) => {
    const el = metaTableElems.eq(i);
    const name = $("span", el).text().trim();
    if (!name) return;

    metaTable[name] = el.children().last().text().trim();
  });

  // console.log(JSON.stringify(metaTable, null, 4));

  let genres: Tag[] = [];
  const genresElems = $(
    "div.w-full.grid.gap-2 > div.grid.gap-4 > div.flex.flex-wrap.gap-3.justify-start.items-start.-mb-2 > div.gap-1",
  ).children();
  genresElems.each((i: number) => {
    const el = genresElems.eq(i);
    genres.push({
      id: textToId(el.attr("href")?.trim().split("?genre=")[1] ?? ""),
      title: el.attr("alt")?.trim() ?? "",
    });
  });
  const genreObj: TagSection = {
    id: "genre",
    title: "Genres",
    tags: genres,
  };
  // console.log(JSON.stringify(genreObj, null, 4));

  const image = $('meta[property="og:image"]').attr("content")?.trim();
  const slug: string = image?.split("/uploads/")[1] ?? "";
  return {
    thumbnailUrl: image ?? "",
    synopsis:
      $('meta[property="og:description"]')
        .attr("content")
        ?.trim()
        ?.split(" - A Standard scanlation")[0] ?? "",
    primaryTitle: $('meta[property="og:title"]').attr("content")?.trim() ?? "",
    secondaryTitles: [],
    contentRating: ContentRating.EVERYONE,
    contentType: "comic",
    status: metaTable["Status"] ?? undefined,
    artist: metaTable["Artist"] ?? undefined,
    author: metaTable["Author"] ?? undefined,
    // bannerUrl?: string,
    // rating?: number,
    tagGroups: [genreObj],
    // artworkUrls?: string[],
    additionalInfo: slug == "" ? { slug } : undefined,
    shareUrl: $('meta[property="og:url"]').attr("content")?.trim() ?? "",
  };
};

function parseDateString(input: string, optimiseRelative = true): Date {
  const trimmed = input.trim();

  // Match relative formats: "5 days ago", "22 hours ago", "11 minutes ago"
  const relativeMatch = trimmed.match(
    /^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i,
  );

  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2].toLowerCase();
    const now = new Date();

    switch (unit) {
      case "second":
        now.setSeconds(now.getSeconds() - amount);
        break;
      case "minute":
        now.setMinutes(now.getMinutes() - amount);
        break;
      case "hour":
        now.setHours(now.getHours() - amount);
        if (optimiseRelative) now.setMinutes(0);
        break;
      case "day":
        now.setDate(now.getDate() - amount);
        if (optimiseRelative) {
          now.setMinutes(0);
          now.setHours(0);
        }
        break;
    }

    return now;
  }

  // Otherwise, treat as an absolute date string: "Jun 22, 2026"
  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) console.warn(`Unable to parse date string: "${input}"`);

  return parsed;
}

export const parseMangaChapters = (page: string, sourceManga: SourceManga): Chapter[] => {
  let chaps: Chapter[] = [];
  const $ = cheerio.load(page);

  const chaptersElems = $("div#chapters").children();
  chaptersElems.each((i: number) => {
    const el = chaptersElems.eq(i);

    const imagecontainer = $("div > div:first > div:last", el).children();
    if (imagecontainer.length >= 2) {
      console.log(
        `Chapter ${Number(el.attr("alt")?.trim()?.split(" ")[1] ?? 0)} is a payed chapter and won't be displayed`,
      );
      return;
    }

    const dateStr = $("span", el).parent().children("div").children().first().text().trim();
    const pubDate = parseDateString(dateStr, false);

    chaps.push({
      volume: 0,
      chapNum: Number(el.attr("alt")?.trim()?.split(" ")[1] ?? 0), // "Chapter 5" -> 5
      chapterId: el.attr("href")?.trim()?.split("/")[2] ?? "", // "/chapter/6518be2bf4d-654d878d338/" -> "6518be2bf4d-654d878d338"
      publishDate: pubDate,
      sourceManga,
      langCode: "en",
    });
  });

  return chaps;
};

export const parseChapterPages = (page: string, chapter: Chapter): ChapterDetails => {
  const $ = cheerio.load(page);

  let pages: string[] = [];
  const pageElems = $("div#pages").children();
  pageElems.each((i: number) => {
    const uid = pageElems.eq(i).attr("uid");
    if (uid) pages.push(CDN_URL + uid);
  });

  return {
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    type: "images",
    pages: pages,
  };
};

export const parseHomePageFeatured = (
  page: string,
  _section?: DiscoverSection,
): PagedResults<DiscoverSectionItem> => {
  const $ = cheerio.load(page);
  const ulList = $("div.grid.relative.z-10.w-full").first().parent().parent().children();

  let items: DiscoverSectionItem[] = [];
  ulList.each((i: number) => {
    const el = ulList.eq(i);
    items.push({
      type: "featuredCarouselItem",
      mangaId: el.attr("href")?.trim().split("/")[2] ?? "",
      title: el.attr("title")?.trim() ?? "",
      imageUrl: el.children().first().attr("style")?.split("url(")[1]?.split("&w=640")[0] ?? "",
    });
  });

  return { items };
};

export const parseLatest = (
  page: string,
  _section?: DiscoverSection,
): PagedResults<DiscoverSectionItem> => {
  const $ = cheerio.load(page);
  let items: DiscoverSectionItem[] = [];

  const latestEls = $("div.grid-cols-1.gap-4").children();
  latestEls.each((i: number) => {
    const el = latestEls.eq(i);
    const chaptersBlock = el.children().last().children().last().children();
    let latestEl = chaptersBlock.last().children().first();

    items.push({
      type: "chapterUpdatesCarouselItem",
      mangaId: el.children().first().attr("href")?.trim().split("/")[2] ?? "",
      chapterId: latestEl.attr("href")?.trim().split("/")[2] ?? "",
      imageUrl:
        el.children().first().attr("style")?.trim()?.split(":url(")[1]?.split("&w=250)")[0] ?? "",
      title: el.children().first().attr("alt")?.trim() ?? "",
      subtitle: latestEl.attr("title"),
      publishDate: parseDateString(latestEl.attr("d")?.trim() ?? ""),
    });
  });

  return { items };
};

export const parseHomePageTrending = (
  page: string,
  _section?: DiscoverSection,
): PagedResults<DiscoverSectionItem> => {
  let items: DiscoverSectionItem[] = [];
  const $ = cheerio.load(page);
  const trendingElements = $("#latest").next().children().last().children().first().children();
  trendingElements.each((i: number) => {
    const els = trendingElements.eq(i);
    const imageElm = els.children().first().children().first().children().first();
    const image = imageElm.attr("style")?.split("url(")[1]?.split("&w=600);")[0];

    items.push({
      type: "prominentCarouselItem",
      mangaId: els.children().first().attr("href")?.split("/")[2] ?? "",
      imageUrl: image ?? "",
      title: els.attr("alt") ?? "",
    });
  });

  return { items };
};

export const parseCategoriesForHomepage = (
  catId: string,
  targetsCat: Record<string, string | string[]>[],
  triState = false,
): PagedResults<DiscoverSectionItem> => {
  let items: DiscoverSectionItem[] = [];
  targetsCat.forEach((target: Record<string, string | string[]>) => {
    const targets = Array.isArray(target.id) ? target.id : [target.id];
    const metadataValue = triState
      ? Object.fromEntries(targets.map((id) => [id, "included" as const]))
      : targets;

    const sq: SearchQuery<SearchMetadata> = {
      title: "",
      metadata: {
        [catId]: metadataValue,
        genresMode: "or",
      } as SearchMetadata,
    };

    items.push({
      type: "genresCarouselItem",
      name: target.title,
      searchQuery: sq,
    } as DiscoverSectionItem);
  });

  return { items };
};
