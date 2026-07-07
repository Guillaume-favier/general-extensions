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

export type GenzToonsSearchMetadata = {
  mode?: "include" | "exclude";
};
