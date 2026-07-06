/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2025 Inkdex */

import type { Tag } from "@paperback/types";

export const DOMAIN = "https://genztoons.org";

export const CDN_URL = "https://cdn.meowing.org/uploads/";

export const MODE_OPTIONS: Tag[] = [
  { id: "include", title: "Include" },
  { id: "exclude", title: "Exclude" },
];

export type GenzToonsSearchMetadata = {
  mode?: "include" | "exclude";
};
