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
  DiscoverSectionType,
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
import type { GenzToonsSearchMetadata, GenzToonsSearchResultItem, Metadata } from "./models";
// Extension network file
import { fetchText, MainInterceptor, makeUrl } from "./network";
import {
  parseChapterPages,
  parseHomePageFeatured,
  parseHomePageTrending,
  parseLatest,
  parseMangaChapters,
  parseMangaDetail,
  parseSearch,
} from "./parser";
import type GenzToonsConfig from "./pbconfig";

const CANDIDATES_CACHE_TTL = 5 * 60 * 1000;
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

  private searchCandidateCache: {
    data: { candidates: GenzToonsSearchResultItem[] };
    timestamp: number;
  } | null = null;

  private isSearchCacheValid(): boolean {
    return (
      !!this.searchCandidateCache &&
      Date.now() - this.searchCandidateCache.timestamp < CANDIDATES_CACHE_TTL
    );
  }

  private async ensureSearchCandidateCache() {
    if (!this.isSearchCacheValid()) {
      const page = await fetchText(makeUrl(["series"]));
      this.searchCandidateCache = {
        timestamp: Date.now(),
        data: {
          candidates: parseSearch(page),
        },
      };
    }
  }

  private homepageCache: {
    data: { page: string };
    timestamp: number;
  } | null = null;

  private isHomepageCacheValid(): boolean {
    return !!this.homepageCache && Date.now() - this.homepageCache.timestamp < CANDIDATES_CACHE_TTL;
  }

  private async ensureHomepageCache() {
    if (!this.isHomepageCacheValid()) {
      const page = await fetchText(makeUrl([]));
      this.homepageCache = {
        timestamp: Date.now(),
        data: {
          page,
        },
      };
    }
  }

  // Implements the settings form, check SettingsForm.ts for more info
  async getSettingsForm(): Promise<Form> {
    return new SettingsForm();
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      {
        id: "featured",
        title: "Featured",
        type: DiscoverSectionType.featured,
      },
      {
        id: "collections",
        title: "Collections",
        type: DiscoverSectionType.genres,
      },
      {
        id: "latest",
        title: "Latest",
        type: DiscoverSectionType.chapterUpdates,
      },
      {
        id: "trending",
        title: "Trending",
        type: DiscoverSectionType.prominentCarousel,
      },
      {
        id: "types",
        title: "Formats",
        type: DiscoverSectionType.genres,
      },
      {
        id: "status",
        title: "Status",
        type: DiscoverSectionType.genres,
      },
    ];
  }

  // Populates both the discover sections
  async getDiscoverSectionItems(
    section: DiscoverSection,
    _metadata?: Metadata,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    await this.ensureHomepageCache();
    switch (section.id) {
      case "featured":
        return parseHomePageFeatured(this.homepageCache!.data.page, section);
      case "latest":
        const RAWPageLatest = await fetchText(makeUrl(["latest"]));
        return parseLatest(RAWPageLatest, section);
      case "trending":
        return parseHomePageTrending(this.homepageCache!.data.page, section);

      default:
        break;
    }
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

  private normalizeSearchText(value: string): string {
    return value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  private isTokenMatch(titleToken: string, queryToken: string): boolean {
    if (!queryToken) return false;
    if (queryToken.length === 1) {
      return titleToken.startsWith(queryToken);
    }

    return (
      titleToken === queryToken ||
      titleToken.startsWith(queryToken) ||
      queryToken.startsWith(titleToken)
    );
  }

  private getSearchMatchScore(title: string, query: string): number {
    const normalizedTitle = this.normalizeSearchText(title);
    const normalizedQuery = this.normalizeSearchText(query);

    if (!normalizedQuery) return 0;
    if (normalizedTitle === normalizedQuery) return 10000;
    if (normalizedTitle.includes(normalizedQuery)) return 9000 + normalizedTitle.length;

    const titleTokens = normalizedTitle.split(/\s+/).filter(Boolean);
    const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);

    if (queryTokens.length === 0) return 0;

    const matchedTokens = queryTokens.filter((token) =>
      titleTokens.some((titleToken) => this.isTokenMatch(titleToken, token)),
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
  }

  // Populates search
  async getSearchResults(
    query: SearchQuery<GenzToonsSearchMetadata>,
    _metadata?: Metadata,
    _sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    await this.ensureSearchCandidateCache();
    const parsed = this.searchCandidateCache!.data.candidates;
    const searchTerm = query.title?.trim() ?? "";

    if (!searchTerm) return { items: parsed };

    const isExclude = query.metadata?.mode === "exclude";
    const filtered = parsed
      .map((item) => ({
        item,
        score: this.getSearchMatchScore(item.title ?? "", searchTerm),
      }))
      .filter(({ score }) => (isExclude ? score === 0 : score > 0))
      .sort((a, b) => b.score - a.score)
      .map(({ item }) => item);

    return { items: filtered };
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
