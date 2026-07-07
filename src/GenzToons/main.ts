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
import type {
  GenzToonsSearchResultItem,
  Metadata,
  SearchMetadata,
  WebsiteCategory,
} from "./models";
// Extension network file
import { fetchText, MainInterceptor, makeUrl } from "./network";
import {
  filterSearchResults,
  parseCategoriesForHomepage,
  parseChapterPages,
  parseHomePageFeatured,
  parseHomePageTrending,
  parseLatest,
  parseMangaChapters,
  parseMangaDetail,
  parseSearch,
  parseSelectorsSearch,
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
    data: {
      candidates: GenzToonsSearchResultItem[];
      categories: Record<"genre" | "type" | "status", WebsiteCategory>;
    };
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
          categories: parseSelectorsSearch(page),
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
    switch (section.id) {
      case "featured":
        await this.ensureHomepageCache();
        return parseHomePageFeatured(this.homepageCache!.data.page, section);
      case "collections":
        await this.ensureSearchCandidateCache();
        const targetCat: Record<string, string | string[]>[] = [
          { title: "Action", id: "action" },
          { title: "Drama", id: "drama" },
          { title: "Adventure", id: "adventure" },
          { title: "Fantasy", id: "fantasy" },
          { title: "Shounen", id: "shounen" },
          { title: "Comedy", id: "comedy" },
          { title: "Regression", id: "regression" },
          { title: "Reincarnation", id: "reincarnation" },
          { title: "Martial Arts", id: "martial%20arts" },
          { title: "Supernatural", id: "supernatural" },
          { title: "System", id: "system" },
          { title: "Isekai", id: "isekai" },
          { title: "Monsters", id: "monsters" },
          { title: "School Life", id: "school%20life" },
          { title: "Magic", id: "magic" },
          { title: "Slice of Life", id: "slice%20of%20life" },
          { title: "Sports", id: "sports" },
          { title: "Time Travel", id: "time%20travel" },
          { title: "Sci-Fi", id: "sci-fi" },
          { title: "Revenge", id: "revenge" },
          { title: "Historical", id: "historical" },
          { title: "Hunter", id: "hunter" },
          { title: "Romance & Shoujo", id: ["romance", "shoujo"] },
          { title: "Murim", id: "murim" },
          { title: "Delinquents", id: "delinquents" },
          { title: "Law", id: "law" },
          { title: "Seinen", id: "seinen" },
          { title: "Medical", id: "medical" },
          { title: "Gaming", id: "gaming" },
          { title: "Political", id: "political" },
          { title: "Thriller", id: "thriller" },
          { title: "Psychological", id: "psychological" },
          { title: "Crime", id: "crime" },
          { title: "Gang", id: "gang" },
          { title: "Mystery", id: "mystery" },
          { title: "Overpowered", id: "overpowered" },
          { title: "Demons", id: "demons" },
          { title: "Apocalypse", id: "apocalypse" },
          { title: "Cultivation", id: "cultivation" },
          { title: "Shojo", id: "shojo" },
        ];
        return parseCategoriesForHomepage("genres", targetCat, true);
      case "latest":
        const RAWPageLatest = await fetchText(makeUrl(["latest"]));
        return parseLatest(RAWPageLatest, section);
      case "trending":
        await this.ensureHomepageCache();
        return parseHomePageTrending(this.homepageCache!.data.page, section);
      case "types":
        const targetCatType = [
          { id: "manhwa", title: "Manhwa" },
          { id: "manhua", title: "Manhua" },
          { id: "manga", title: "Manga" },
          { id: "mangatoon", title: "Mangatoon" },
          { id: "comic", title: "Comic" },
        ];
        await this.ensureSearchCandidateCache();
        return parseCategoriesForHomepage("types", targetCatType, false);
      case "status":
        const targetCatStatus = [
          { id: "ongoing", title: "Ongoing" },
          { id: "completed", title: "Completed" },
          { id: "dropped", title: "Dropped" },
          { id: "hiatus", title: "Hiatus" },
        ];
        await this.ensureSearchCandidateCache();
        return parseCategoriesForHomepage("status", targetCatStatus, false);
      default:
        break;
    }
    return {
      items: [],
    };
  }

  // Populates search filters in a form
  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    await this.ensureSearchCandidateCache();
    if (!this.searchCandidateCache)
      throw new Error("no CandidateCache even after this.ensureSearchCandidateCache()");

    return new GenzToonsAdvancedSearchForm(query, this.searchCandidateCache.data.categories);
  }

  // Populates search
  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    _metadata?: Metadata,
    _sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    await this.ensureSearchCandidateCache();
    const parsed = this.searchCandidateCache!.data.candidates;
    return { items: filterSearchResults(parsed, query) };
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
