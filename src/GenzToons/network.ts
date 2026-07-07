/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2025 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  URL,
  type Request,
  type Response,
} from "@paperback/types";

import { DOMAIN } from "./models";

// Intercepts all the requests and responses and allows you to make changes to them
export class MainInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    return {
      ...request,
      headers: {
        ...request.headers,
        referer: `${DOMAIN}/`,
        "user-agent": await Application.getDefaultUserAgent(),
      },
    };
  }

  override async interceptResponse(
    _request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    if (response.headers?.["cf-mitigated"] === "challenge") {
      throw new CloudflareError({
        url: DOMAIN,
        method: "GET",
        headers: { "user-agent": await Application.getDefaultUserAgent() },
      });
    }
    return data;
  }
}

export async function fetchText(url: string): Promise<string> {
  const [resp, buffer] = await Application.scheduleRequest({ url, method: "GET" });
  if (resp.status == 404) console.error("Error 404:", resp.url);

  return Application.arrayBufferToUTF8String(buffer);
}

export function makeUrl(segments: string[], query?: Record<string, string | string[]>): string {
  const url = new URL(DOMAIN);
  segments.forEach((segment) => {
    url.addPathComponent(segment);
  });
  // if there isn't any "/"" at the end of the query, it redirect to the http url with a "/" then https with a "/"
  // And because requests from iOS cannot be in http it causes an error
  url.path += "/";
  for (const [key, value] of Object.entries(query ?? {})) {
    url.setQueryItem(key, value);
  }
  return url.toString();
}
