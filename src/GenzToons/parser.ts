import {
  ContentRating,
  type Chapter,
  type ChapterDetails,
  type MangaInfo,
  type PagedResults,
  type SearchResultItem,
  type SourceManga,
  type Tag,
  type TagSection,
} from "@paperback/types";
import * as cheerio from "cheerio";
import type { Element } from "domhandler";

import { CDN_URL } from "./models";

export const parseSearch = (page: string): PagedResults<SearchResultItem> => {
  const $ = cheerio.load(page);

  let results: SearchResultItem[] = [];

  const seriesElements = $("#searched_series_page").children();
  console.log("nb of series :", seriesElements.length);
  seriesElements.each((i: number, _el: Element) => {
    console.log(i);
    const el = seriesElements.eq(i);
    console.log(el);
    let sri: SearchResultItem = {
      title: el.attr("alt") ?? "",
      // TODO: fix this horendous thing
      mangaId: (el.children().first().attr("href") ?? "///").split("/")[2],
      imageUrl:
        $("button > a > div:first > div:first", el)
          .attr("style")
          ?.split("url(")[1]
          .split("); ")[0] ?? "",
    };
    results.push(sri);
    console.log("pushed", JSON.stringify(sri));
  });
  console.log("finnal length", results.length);

  return {
    items: results,
  };
};
const textToId = (text: string): string =>
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

  console.log(JSON.stringify(metaTable, null, 4));

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
  console.log(JSON.stringify(genreObj, null, 4));

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

function parseDateString(input: string): Date {
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
        break;
      case "day":
        now.setDate(now.getDate() - amount);
        break;
      case "week":
        now.setDate(now.getDate() - amount * 7);
        break;
      case "month":
        now.setMonth(now.getMonth() - amount);
        break;
      case "year":
        now.setFullYear(now.getFullYear() - amount);
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

    const pubDate = parseDateString(dateStr);

    console.log(dateStr, pubDate);
    chaps.push({
      volume: 0,
      chapNum: Number(el.attr("alt")?.trim()?.split(" ")[1] ?? 0) + 1, // "Chapter 5" -> 5
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
    pages.push(CDN_URL + pageElems.eq(i).attr("uid"));
  });

  return {
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    type: "images",
    pages: pages,
  };
};
