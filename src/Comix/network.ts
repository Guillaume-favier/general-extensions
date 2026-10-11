/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

import { API_BASE, DOMAIN } from "./models";
import { decryptImage, readEncHeaders } from "./utils/decryptImage";
import { descrambleImage, readScrambleHeaders } from "./utils/descramble";
import { fastDecryptComixPayload } from "./utils/fastDecrypt";
import { fastGenerateHash } from "./utils/fastSigner";

export class ComixInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    return {
      ...request,
      headers: {
        ...request.headers,
        "user-agent": await Application.getDefaultUserAgent(),
      },
    };
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    if (response.headers?.["cf-mitigated"] === "challenge") {
      throw new CloudflareError({
        url: DOMAIN,
        method: "GET",
        headers: {
          "user-agent": await Application.getDefaultUserAgent(),
        },
      });
    }

    // Page images are tile-shuffled (X-Scramble-*) or byte-XOR'd (X-Enc-*) — the
    // site mixes both. Key off headers (a scrambled prefix defeats mime-sniffing).
    const scrambleParams = readScrambleHeaders(response.headers);
    if (scrambleParams) {
      try {
        return await descrambleImage(data, scrambleParams, response.mimeType ?? "image/webp");
      } catch (error) {
        console.log(
          `[Comix] descramble failed for ${request.url} (algo=${scrambleParams.algo} seed=${scrambleParams.seed}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return data;
      }
    }

    const encParams = readEncHeaders(response.headers);
    if (encParams) {
      try {
        return decryptImage(data, encParams);
      } catch (error) {
        console.log(
          `[Comix] image decrypt failed for ${request.url}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return data;
      }
    }

    return data;
  }
}

export async function fetchText(url: string): Promise<string> {
  const [, buffer] = await Application.scheduleRequest({ url, method: "GET" });
  return Application.arrayBufferToUTF8String(buffer);
}

// ---------------------------------------------------------------------------
// Native API access (signed + encrypted-response decoding).
//
// comix signs /api/v1 requests with a per-path HMAC `_=` token and may encrypt
// the response body into `{ e: "<base64>" }` (x-enc 2) — both keyed by the
// rotating secure-*.js bundle. The algorithms below are extracted offline from
// that bundle (see experiment/crypto-pipeline in the reference repo); when the
// site rotates, the constants in utils/fastSigner.ts / utils/fastDecrypt.ts
// must be regenerated.
// ---------------------------------------------------------------------------

// Paths the bundle's request interceptor signs: everything under /manga and
// individual /chapters/{id}. The token covers the path plus the canonicalized
// query string; passing a full URL to fastGenerateHash handles both.
const SIGNED_PATTERNS: RegExp[] = [/^\/manga(?:\/|$)/, /^\/chapters\/[^/]+/];

function isSignedPath(path: string): boolean {
  return SIGNED_PATTERNS.some((re) => re.test(path));
}

export function signUrl(url: string): string {
  const path = url
    .replace(/^https?:\/\/[^/]+/, "")
    .replace(/^\/api\/v1/, "")
    .split("?")[0]!;
  if (!isSignedPath(path)) return url;
  const token = fastGenerateHash(url);
  if (!token) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}_=${token}`;
}

/** Parse a /api/v1 response body, decrypting `{e:"…"}` envelopes when present. */
export function decodeComixResponse<T>(
  text: string,
  headers: Record<string, string>,
): { status: string; result?: T; message?: string } {
  const json = JSON.parse(text ?? "{}") as Record<string, unknown>;
  if (json && typeof json === "object" && typeof json["e"] === "string") {
    const decrypted = fastDecryptComixPayload("", json, headers) as {
      status?: string;
      result?: T;
    };
    if (
      decrypted &&
      typeof decrypted === "object" &&
      "result" in decrypted &&
      decrypted.status === "ok"
    ) {
      return { status: "ok", result: decrypted.result };
    }
    return { status: "ok", result: decrypted as T };
  }
  return json as { status: string; result?: T; message?: string };
}

/**
 * GET a signed comix /api/v1 URL and return its decoded `result`. Throws a
 * CloudflareError when the server responds with a challenge page so the app's
 * bypass flow re-runs; throws on non-2xx statuses and non-"ok" API states.
 */
export async function fetchSignedJson<T>(fullUrl: string): Promise<T> {
  const signedUrl = signUrl(fullUrl);
  const [response, buffer] = await Application.scheduleRequest({
    url: signedUrl,
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Requested-With": "XMLHttpRequest",
      Referer: `${DOMAIN}/`,
    },
  });

  const text = Application.arrayBufferToUTF8String(buffer);
  if (response.status < 200 || response.status >= 300 || text.trimStart().startsWith("<")) {
    const preview = text.trim().slice(0, 200).replace(/\s+/g, " ");
    if (response.status === 403 || response.status === 503) {
      throw new CloudflareError({
        url: signedUrl,
        method: "GET",
        headers: { "user-agent": await Application.getDefaultUserAgent() },
      });
    }
    throw new Error(`Comix HTTP ${response.status} for ${fullUrl}: ${preview || "(empty body)"}`);
  }

  const decoded = decodeComixResponse<T>(text, response.headers);
  if (decoded.status !== "ok") {
    throw new Error(`Comix API ${decoded.status ?? "error"}: ${decoded.message ?? "no message"}`);
  }
  return decoded.result as T;
}

/** Build a signed /api/v1 URL from a path and raw query pairs. */
export function apiUrl(path: string, query: Record<string, string | string[]>): string {
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      for (const item of value)
        pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(item)}`);
    } else {
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
  }
  const base = `${API_BASE}${path}`;
  return pairs.length > 0 ? `${base}?${pairs.join("&")}` : base;
}
