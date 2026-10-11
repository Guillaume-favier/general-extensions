/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  BasicRateLimiter,
  ContentRating,
  CookieStorageInterceptor,
  DiscoverSectionType,
  type AdvancedSearchForm,
  type Chapter,
  type ChapterDetails,
  type Cookie,
  type DiscoverSection,
  type DiscoverSectionItem,
  type ExtensionImpl,
  type Form,
  type PagedResults,
  type Request,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
} from "@paperback/types";

import { ComixAdvancedSearchForm } from "./forms/search";
import { ComixSettingsForm, getDiscoverySectionsOrder } from "./forms/settings";
import {
  API_BASE,
  DOMAIN,
  type ChapterItem,
  type ChapterPages,
  type Metadata,
  type ResultManga,
  type SearchMetadata,
} from "./models";
import { apiUrl, ComixInterceptor, fetchSignedJson, fetchText } from "./network";
import { parseChapterDetails, parseChapters, parseMangaDetails, parseMangaList } from "./parsers";
import type ComixConfig from "./pbconfig";
import {
  defaultSearchMetadata,
  ensureFilters,
  filters,
  getContentRating,
  getHiddenDemographics,
  getHiddenGenres,
  getShowOnlyTypes,
  getYear,
  horizontalChapterSections,
  horizontalRecentSection,
  horizontalTrendingSections,
  pickTags,
  useYearFilter,
} from "./utils/filters";

class ComixExtension implements ExtensionImpl<typeof ComixConfig> {
  private globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 1,
    ignoreImages: true,
  });
  private mainInterceptor = new ComixInterceptor("main");
  private cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });

  async initialise(): Promise<void> {
    this.globalRateLimiter.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.mainInterceptor.registerInterceptor();
  }

  async cloudflareBypassCompleted(
    _request: Request,
    cookies: Cookie[],
    _localStorage: Record<string, string>,
  ): Promise<void> {
    for (const cookie of cookies) {
      if (cookie.name == "cf_clearance") {
        this.cookieStorageInterceptor.setCookie(cookie);
      }
    }
  }

  async getSettingsForm(): Promise<Form> {
    await ensureFilters();
    return new ComixSettingsForm();
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    const chapterType = (horizontal: boolean) =>
      horizontal ? DiscoverSectionType.simpleCarousel : DiscoverSectionType.chapterUpdates;
    const yearSuffix = useYearFilter() ? ` of ${getYear()}` : "";
    const sections: Record<string, DiscoverSection> = {
      popular: { id: "popular", title: "Popular", type: DiscoverSectionType.featured },
      follow: {
        id: "follow",
        title: "Most Follows New Comics",
        type: DiscoverSectionType.prominentCarousel,
      },
      recent: {
        id: "recent",
        title: "Recently Added",
        type: chapterType(horizontalRecentSection()),
      },
      trending_manga: {
        id: "trending_manga",
        title: `Trending Manga${yearSuffix}`,
        type: chapterType(horizontalTrendingSections()),
      },
      trending_wt: {
        id: "trending_wt",
        title: `Trending WebToons${yearSuffix}`,
        type: chapterType(horizontalTrendingSections()),
      },
      completed: { id: "completed", title: "Completed", type: DiscoverSectionType.simpleCarousel },
      updatesHot: {
        id: "updatesHot",
        title: "Latest Updates (HOT)",
        type: chapterType(horizontalChapterSections()),
      },
      updatesNew: {
        id: "updatesNew",
        title: "Latest Updates (NEW)",
        type: chapterType(horizontalChapterSections()),
      },
      genresSection: {
        id: "genresSection",
        title: "Best of genres",
        type: DiscoverSectionType.genres,
      },
    };
    return getDiscoverySectionsOrder()
      .map((section) => sections[section.id])
      .filter((section) => section !== undefined);
  }

  // `/api/v1/manga/top` (trending/follows + days window) has no `/browse`-equivalent
  // ordering, so popular/follow map to the closest browse orderings on `/manga`.
  private browseQuery(sectionId: string, page: number) {
    const hidden = [...getHiddenGenres(), ...getHiddenDemographics()];
    const types = getShowOnlyTypes();
    const common = {
      page: page.toString(),
      ...(hidden.length > 0 && { "genres_ex[]": hidden }),
      ...(types.length > 0 && { "types[]": types }),
    };
    const trending = {
      "order[views_30d]": "desc",
      ...(useYearFilter() && { "release_year[from]": getYear().toString() }),
    };
    const sections: Record<string, Record<string, string | string[]>> = {
      popular: { "order[score]": "desc" },
      follow: { "order[follows_total]": "desc" },
      recent: { "order[created_at]": "desc" },
      completed: { "order[chapter_updated_at]": "desc", "statuses[]": "finished" },
      updatesHot: { "order[chapter_updated_at]": "desc", scope: "hot" },
      updatesNew: { "order[chapter_updated_at]": "desc" },
      trending_manga: { ...trending, "types[]": "manga" },
      trending_wt: { ...trending, "types[]": ["manhwa", "manhua"] },
    };
    const section = sections[sectionId];
    return section && { ...common, ...section };
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === "genresSection") {
      await ensureFilters();
      const hidden = getHiddenGenres();
      return {
        items: filters.genres
          .filter((genre) => !hidden.includes(genre.id))
          .map((genre) => ({
            type: "genresCarouselItem",
            name: genre.title,
            searchQuery: { title: "", metadata: defaultSearchMetadata(genre.id) },
            contentRating: genre.title === "Adult" ? ContentRating.ADULT : ContentRating.EVERYONE,
          })),
      };
    }
    const page = metadata?.page ?? 1;
    const query = this.browseQuery(section.id, page);
    if (!query) return { items: [] };
    const result = await fetchSignedJson<ResultManga>(apiUrl("/manga", { ...query, limit: "20" }));
    const items = parseMangaList(result).map((item): DiscoverSectionItem => {
      const { publishDate, subtitle, supertitle, summary, infoItems, metadata: _, ...base } = item;
      switch (section.type) {
        case DiscoverSectionType.featured:
          return { type: "featuredCarouselItem", ...base, supertitle, summary, infoItems };
        case DiscoverSectionType.prominentCarousel:
          return { type: "prominentCarouselItem", ...base, subtitle };
        case DiscoverSectionType.chapterUpdates:
          return {
            type: "chapterUpdatesCarouselItem",
            ...base,
            chapterId: base.mangaId,
            subtitle,
            publishDate,
          };
        default:
          return { type: "simpleCarouselItem", ...base, subtitle };
      }
    });
    const hasNext = result.meta?.hasNext ?? items.length > 0;
    return { items, metadata: hasNext ? { page: page + 1 } : undefined };
  }

  async getSearchResults(
    searchQuery: SearchQuery<SearchMetadata>,
    metadata: Metadata | undefined,
    sortingOption: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const meta = searchQuery.metadata ?? defaultSearchMetadata();
    const page = metadata?.page ?? 1;
    const [sortBy, orderBy] = sortingOption.id.split("#")[0].split("$");
    const query: Record<string, string | string[]> = {
      page: page.toString(),
      [`order[${sortBy}]`]: orderBy,
      genres_mode: meta.mode ?? ["and"],
      content_rating: (meta.contentRating ?? getContentRating()).join(","),
    };
    if (meta.minChap) {
      query.min_chap = meta.minChap.toString();
    }
    if (searchQuery.title.length > 1) {
      query.keyword = searchQuery.title;
    }
    const tagQueries = {
      "genres_in[]": pickTags("included", meta.genres, meta.formats),
      "genres_ex[]": pickTags("excluded", meta.genres, meta.formats),
      "types[]": pickTags("included", meta.types),
      "demographics[]": pickTags("included", meta.demographic),
      "statuses[]": pickTags("included", meta.status),
    };
    for (const [key, values] of Object.entries(tagQueries)) {
      if (values.length > 0) query[key] = values;
    }
    const result = await fetchSignedJson<ResultManga>(apiUrl("/manga", { ...query, limit: "20" }));
    const items = parseMangaList(result).map(({ publishDate: _, ...item }) => item);
    const hasNext = result.meta?.hasNext ?? items.length > 0;
    return { items, metadata: hasNext ? { page: page + 1 } : undefined };
  }

  async getAdvancedSearchForm(
    searchQuery: SearchQuery<SearchMetadata>,
  ): Promise<AdvancedSearchForm> {
    await ensureFilters();
    searchQuery.metadata ??= defaultSearchMetadata();
    return new ComixAdvancedSearchForm(searchQuery);
  }

  // Ids carry a #title/#empty suffix so a remembered selection from the other
  // mode never matches; getSearchResults strips everything after "#".
  async getSortingOptions(query: SearchQuery<SearchMetadata>): Promise<SortingOption[]> {
    const idSuffix = query.title.length > 1 ? "#title" : "";
    const sortingOptions: SortingOption[] = [
      { id: "chapter_updated_at$asc" + idSuffix, label: "Update Date ↑" },
      { id: "chapter_updated_at$desc" + idSuffix, label: "Update Date ↓" },
      { id: "created_at$asc" + idSuffix, label: "Created Date ↑" },
      { id: "created_at$desc" + idSuffix, label: "Created Date ↓" },
      { id: "title$asc" + idSuffix, label: "Title ↑" },
      { id: "title$desc" + idSuffix, label: "Title ↓" },
      { id: "year$asc" + idSuffix, label: "Year ↑" },
      { id: "year$desc" + idSuffix, label: "Year ↓" },
      { id: "score$asc" + idSuffix, label: "Average Score ↑" },
      { id: "score$desc" + idSuffix, label: "Average Score ↓" },
      { id: "views_total$asc" + idSuffix, label: "Total Views ↑" },
      { id: "views_total$desc" + idSuffix, label: "Total Views ↓" },
      { id: "follows_total$asc" + idSuffix, label: "Most Follows ↑" },
      { id: "follows_total$desc" + idSuffix, label: "Most Follows ↓" },
      { id: "views_7d$asc" + idSuffix, label: "Most Views 7 Days ↑" },
      { id: "views_7d$desc" + idSuffix, label: "Most Views 7 Days ↓" },
      { id: "views_30d$asc" + idSuffix, label: "Most Views 1 Month ↑" },
      { id: "views_30d$desc" + idSuffix, label: "Most Views 1 Month ↓" },
      { id: "views_90d$asc" + idSuffix, label: "Most Views 3 Month ↑" },
      { id: "views_90d$desc" + idSuffix, label: "Most Views 3 Month ↓" },
    ];
    if (query.title.length > 1) {
      sortingOptions.unshift({ id: "relevance$desc" + idSuffix, label: "Best Match" });
    } else {
      sortingOptions.unshift({ id: "chapter_updated_at$desc#empty", label: "Any" });
    }
    return sortingOptions;
  }

  // Details still server-render their data into `<script id="initial-data">`, so
  // fetch the HTML and let the parser extract it no signing/decrypt needed here.
  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    return parseMangaDetails(mangaId, await fetchText(`${DOMAIN}/title/${mangaId}`));
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const mangaId = sourceManga.mangaId;
    const fetchPage = (page: number) =>
      fetchSignedJson<{ items: ChapterItem[]; meta?: { lastPage?: number } }>(
        apiUrl(`/manga/${mangaId}/chapters`, {
          page: page.toString(),
          limit: "100",
          "order[number]": "desc",
        }),
      );

    const firstResult = await fetchPage(1);
    const lastPage = firstResult.meta?.lastPage ?? 1;
    const restResults =
      lastPage > 1
        ? await Promise.all(Array.from({ length: lastPage - 1 }, (_, i) => fetchPage(i + 2)))
        : [];
    const items = [...firstResult.items, ...restResults.flatMap((r) => r.items)];
    return parseChapters(sourceManga, items);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const pages = await fetchSignedJson<ChapterPages>(`${API_BASE}/chapters/${chapter.chapterId}`);
    return parseChapterDetails(chapter.chapterId, { status: "ok", result: pages });
  }
}

export const Comix = new ComixExtension();
