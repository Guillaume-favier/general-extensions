/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2025 Inkdex */

import type { JSONObject, SearchResultItem, Tag } from "@paperback/types";

export const DOMAIN = "https://genztoons.org";

export const CDN_URL = "https://cdn.meowing.org/uploads/";

/** Pagination cursor for Paperback's PagedResults. */
export interface Metadata extends JSONObject {
  page: number;
}

export interface GenzToonsSearchResultMetadata {
  slug?: string;
  tags: string[];
  type?: string;
  status?: string;
}

export interface GenzToonsSearchResultItem extends SearchResultItem {
  metadata?: GenzToonsSearchResultMetadata;
}

export const MODE_OPTIONS: Tag[] = [
  { id: "include", title: "Include" },
  { id: "exclude", title: "Exclude" },
];

export interface WebsiteCategoryTag {
  value: string;
  displayName: string;
}
export interface WebsiteCategory {
  type: string;
  placeholder: string;
  multi: boolean;
  removable: boolean;
  toggle: boolean;
  observer: boolean;
  search_id: string;
  url_value: boolean;
  items: WebsiteCategoryTag[];
}

// FlameComics has no server search endpoint — search is done client-side by
// aggregating the list endpoints and filtering locally. SearchMetadata holds
// the user's advanced-search choices.

export type SearchMetadata = {
  genres?: { [id: string]: "included" | "excluded" }; // genre id (lowercased slug) → state
  genresMode?: "or" | "and"; // combine genres as any (OR) or all (AND)
  types?: string[];
  status?: string[];
};

export type OptionItem = {
  value: string;
  id: string;
};

/** Available option lists for each advanced-search field. */
export class GenzToonsFilter {
  genres: OptionItem[] = [];
  types: OptionItem[] = [];
  status: OptionItem[] = [];
}
