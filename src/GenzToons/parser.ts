import {
  ContentRating,
  type MangaInfo,
  type PagedResults,
  type SearchResultItem,
  type SourceManga,
} from "@paperback/types";
import * as cheerio from "cheerio";
import type { Element } from "domhandler";

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

export const parseMangaDetail = (page: string): MangaInfo => {
  console.log("start parsing");
  const $ = cheerio.load(page);
  console.log("loaded");

  let altTitles: string[] = [];
  const altTitlesElem = $("div.grid.flex-wrap.gap-2.w-full.mb-2.opacity-80").children();
  if (altTitlesElem.length > 0) {
    const list = altTitlesElem.first().children();
    list.each((i: number) => {
      altTitles.push(list.eq(i).text().trim());
    });
  }

  return {
    thumbnailUrl: $('meta[property="og:image"]').attr("content")?.trim() ?? "",
    synopsis:
      $('meta[property="og:description"]')
        .attr("content")
        ?.trim()
        ?.split(" - A Standard scanlation")[0] ?? "",
    primaryTitle: $('meta[property="og:title"]').attr("content")?.trim() ?? "",
    secondaryTitles: [],
    contentRating: ContentRating.EVERYONE,
    contentType: "comic",
    // status?: string,
    // artist?: string,
    // author?: string,
    // bannerUrl?: string,
    // rating?: number,
    // tagGroups?: TagSection[],
    // artworkUrls?: string[],
    // additionalInfo?: Record<string, string>,
    shareUrl: $('meta[property="og:url"]').attr("content")?.trim() ?? "",
  };
};
