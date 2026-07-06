/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2025 Inkdex */

// TODO:
// - Fix exclude search
// - Add the English name to the title view
// - Add additional info to the title view
// - Make getChapterDetails only return new chapters
// - Add content settings support to search
// - Remove the content.json file and switch to cheerio

import {
  BasicRateLimiter,
  type AdvancedSearchForm,
  type Chapter,
  type ChapterDetails,
  type DiscoverSection,
  type DiscoverSectionItem,
  type ExtensionImpl,
  type Form,
  type PagedResults,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
} from "@paperback/types";

// Extension forms file
import { GenzToonsAdvancedSearchForm, SettingsForm } from "./forms";
import type { GenzToonsSearchMetadata } from "./models";
// Extension network file
import { fetchText, MainInterceptor, makeUrl } from "./network";
import { parseChapterPages, parseMangaChapters, parseMangaDetail, parseSearch } from "./parser";
import type GenzToonsConfig from "./pbconfig";

// Main extension class
export class GenzToonsExtension implements ExtensionImpl<typeof GenzToonsConfig> {
  // Implementation of the main rate limiter
  mainRateLimiter = new BasicRateLimiter("main", {
    numberOfRequests: 20,
    bufferInterval: 5,
    ignoreImages: true,
  });

  // Implementation of the main interceptor
  mainInterceptor = new MainInterceptor("main");

  // Method from the Extension interface which we implement, initializes the rate limiter, interceptor, discover sections and search filters
  async initialise(): Promise<void> {
    this.mainRateLimiter.registerInterceptor();
    this.mainInterceptor.registerInterceptor();
  }

  // Implements the settings form, check SettingsForm.ts for more info
  async getSettingsForm(): Promise<Form> {
    return new SettingsForm();
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [];
  }

  // Populates both the discover sections
  async getDiscoverSectionItems(
    _section: DiscoverSection,
    _metadata: number | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    return {
      items: [],
    };
  }

  // Populates search filters in a form
  async getAdvancedSearchForm(
    query: SearchQuery<GenzToonsSearchMetadata>,
  ): Promise<AdvancedSearchForm> {
    return new GenzToonsAdvancedSearchForm(query);
  }

  // Populates search
  async getSearchResults(
    _query: SearchQuery<GenzToonsSearchMetadata>,
    _metadata?: number,
    _sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const RAWPage = await fetchText(makeUrl(["series"]));
    const parsed = parseSearch(RAWPage);
    // console.log(JSON.stringify(parsed, null, 4));
    return parsed;
  }

  // Populates the title details
  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const RAWPage = await fetchText(makeUrl(["series", mangaId]));

    return {
      mangaId,
      mangaInfo: parseMangaDetail(RAWPage),
    } as SourceManga;
  }

  // Populates the chapter list
  async getChapters(sourceManga: SourceManga, _sinceDate?: Date): Promise<Chapter[]> {
    const RAWPage = await fetchText(makeUrl(["series", sourceManga.mangaId]));
    return parseMangaChapters(RAWPage, sourceManga);
  }

  // Populates a chapter with images
  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const RAWPage = await fetchText(makeUrl(["chapter", chapter.chapterId]));
    return parseChapterPages(RAWPage, chapter);
    // throw new Error("No title with this id exists");
  }
}

export const GenzToons = new GenzToonsExtension();
