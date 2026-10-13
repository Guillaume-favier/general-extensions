/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { CloudflareError, type CookieStorageInterceptor } from "@paperback/types";
import * as cheerio from "cheerio";

import { DOMAIN, type ChapterItem, type ChapterPageItems, type ResultManga } from "../models";
import { fetchText } from "../network";
import { scheduleComix } from "./queue";

// comix signs its API requests and encrypts `{e:"..."}` responses inside its own
// secure bundle, so we never reimplement the rotating cipher: we capture the
// site's own axios instance (which signs + decrypts) to fetch chapter lists, hook
// `Object.prototype.items` to read a chapter's decoded page list, and hook
// `JSON.parse` for browse/search. Every request therefore flows through the
// site's own code, so it looks like normal app traffic and survives its frequent
// bundle rotations.

async function runProxiedWebView<T>(
  pageUrl: string,
  bootstrap: string,
  cookieInterceptor: CookieStorageInterceptor,
): Promise<T> {
  return scheduleComix(async () => {
    const cookies = cookieInterceptor.cookiesForUrl(`${DOMAIN}/`);
    const userAgent = await Application.getDefaultUserAgent();
    const $ = cheerio.load(await fetchText(pageUrl));

    $("head").prepend(`<script>${bootstrap}</script>`);

    const raw = await Application.executeInWebView({
      source: { html: $.html(), baseUrl: pageUrl, loadCSS: false, loadImages: false, userAgent },
      inject: `return window.__comixResult__`,
      storage: { cookies },
    });

    if (raw.result === undefined || raw.result === null) {
      throw new Error("Comix WebView returned no result");
    }
    return raw.result as T;
  });
}

// Hook `items` assignments, then run `handle(holder)` on the decoded object.
// Shared by the chapter-list and chapter-pages captures.
const CAPTURE_ITEMS = `
  var __comixDefineProperty = Object.defineProperty;
  var __comixCapture = function (holder) {
    setTimeout(function () { __comixHandle(holder); }, 0);
  };
  Object.defineProperty(Object.prototype, "items", {
    configurable: true,
    set: function (value) {
      __comixDefineProperty(this, "items", {
        value: value,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      __comixCapture(this);
    },
  });
  Object.defineProperty = function (target, key, descriptor) {
    var result = __comixDefineProperty.apply(this, arguments);
    if (key === "items" && descriptor && "value" in descriptor) __comixCapture(target);
    return result;
  };
`;

// Capture a chapter's decoded pages object and return it as JSON.
export async function pageListViaWebView(
  chapterPagePath: string,
  cookieInterceptor: CookieStorageInterceptor,
): Promise<ChapterPageItems> {
  const bootstrap = `
  (function () {
    var doneResolve;
    window.__comixResult__ = new Promise(function (resolve) { doneResolve = resolve; });

    var __comixHandle = function (holder) {
      try {
        var items = holder.items;
        if (holder.meta || !Array.isArray(items) || items.length === 0) return;
        if (!items.every(function (item) { return item && typeof item.url === "string"; })) return;
        doneResolve(JSON.stringify(holder));
      } catch (e) {}
    };

    ${CAPTURE_ITEMS}

    setTimeout(function () { doneResolve(""); }, 30000);
  })();
  `;
  const payload = await runProxiedWebView<string>(
    `${DOMAIN}${chapterPagePath}`,
    bootstrap,
    cookieInterceptor,
  );
  if (!payload) {
    console.log(`[Comix] chapter pages timed out for ${chapterPagePath}`);
    throw new Error("Comix: timed out waiting for chapter pages");
  }
  const pages = JSON.parse(payload) as ChapterPageItems;
  console.log(`[Comix] chapter pages for ${chapterPagePath}: ${pages.items.length} pages`);
  return pages;
}

// Capture the site's own `/api/v1` axios instance (it signs + decrypts for us)
// the moment it is constructed. Key off `defaults.baseURL` so the vendor's plain
// default axios instance (no baseURL) is ignored.
const BOOTSTRAP_AXIOS = `
(function () {
  var resolveAxios;
  window.__comixAxios = null;
  window.__comixAxiosReady = new Promise(function (resolve) { resolveAxios = resolve; });
  try {
    Object.defineProperty(Object.prototype, "interceptors", {
      configurable: true,
      get: function () { return this.__pbInterceptors; },
      set: function (value) {
        this.__pbInterceptors = value;
        if (
          this &&
          typeof this.get === "function" &&
          typeof this.post === "function" &&
          this.defaults &&
          typeof this.defaults.baseURL === "string" &&
          this.defaults.baseURL.indexOf("/api/v1") !== -1 &&
          !window.__comixAxios
        ) {
          window.__comixAxios = this;
          resolveAxios(this);
        }
      },
    });
  } catch (e) {}
})();
`;

function buildChapterListInject(mangaId: string): string {
  const id = JSON.stringify(mangaId);
  return `
return (async function () {
  var deadline = Date.now() + 45000;
  while (!window.__comixAxios && Date.now() < deadline) {
    await new Promise(function (r) { setTimeout(r, 100); });
  }
  var axios = window.__comixAxios;
  if (!axios) return JSON.stringify({ ok: false, status: 503, error: "axios instance not found" });

  var path = "/manga/" + ${id} + "/chapters";
  var chapters = [];
  var page = 1;
  var lastPage = 1;
  try {
    while (page <= lastPage && page <= 1000) {
      var resp = await axios.get(path, { params: { page: page, limit: 100, "order[number]": "desc" } });
      var data = resp.data || {};
      chapters = chapters.concat(data.items || []);
      var meta = data.meta || {};
      lastPage = meta.lastPage || page;
      page = page + 1;
    }
    return JSON.stringify({ ok: true, items: chapters });
  } catch (e) {
    var resp2 = e && e.response;
    return JSON.stringify({
      ok: false,
      status: resp2 && resp2.status,
      error: String((e && e.message) || e),
    });
  }
})();
`;
}

// Load a manga's full chapter list by driving the site's own axios instance
// directly (limit 100 per page), which is far fewer requests than the app's own
// `?page=` UI pagination (20 per page) that the WebView capture relied on.
export async function chapterListViaWebView(
  mangaId: string,
  cookieInterceptor: CookieStorageInterceptor,
): Promise<ChapterItem[]> {
  return scheduleComix(async () => {
    const cookies = cookieInterceptor.cookiesForUrl(`${DOMAIN}/`);
    const userAgent = await Application.getDefaultUserAgent();
    const pageUrl = `${DOMAIN}/title/${mangaId}`;

    const $ = cheerio.load(await fetchText(pageUrl));
    $("head").prepend(`<script>${BOOTSTRAP_AXIOS}</script>`);

    const raw = await Application.executeInWebView({
      source: { html: $.html(), baseUrl: pageUrl, loadCSS: false, loadImages: false, userAgent },
      inject: buildChapterListInject(mangaId),
      storage: { cookies },
    });

    const text = raw.result;
    if (typeof text !== "string") {
      throw new Error(`Comix WebView returned unexpected result: ${JSON.stringify(text)}`);
    }
    const result = JSON.parse(text) as
      | { ok: true; items: ChapterItem[] }
      | { ok: false; status?: number; error: string };

    if (!result.ok) {
      const status = result.status;
      console.log(
        `[Comix] chapter list failed for ${mangaId} (HTTP ${status ?? "?"}): ${result.error}`,
      );
      if (status === 403 || status === 404 || status === 429 || status === 503) {
        throw new CloudflareError({
          url: DOMAIN,
          method: "GET",
          headers: { "user-agent": await Application.getDefaultUserAgent() },
        });
      }
      throw new Error(`Comix chapter list failed for ${mangaId}: ${result.error}`);
    }

    console.log(`[Comix] chapter list for ${mangaId}: ${result.items.length} chapters`);
    return result.items;
  });
}

// `/browse` serves an empty shell and loads its list via an encrypted XHR, so
// run the bundle and capture the decrypted `{result:{items,meta}}` off
// JSON.parse. `&page=N` in the URL selects the page; one capture per call.
export async function browseViaWebView(
  browseUrl: string,
  cookieInterceptor: CookieStorageInterceptor,
): Promise<ResultManga> {
  const bootstrap = `
    (function () {
      var doneResolve;
      window.__comixResult__ = new Promise(function (r) {
        doneResolve = r;
      });
      var done = false;
      function finish(val) {
        if (done) return;
        done = true;
        doneResolve(val);
      }
      var orig = JSON.parse;
      JSON.parse = new Proxy(orig, {
        apply: function (t, a, args) {
          var parsed = Reflect.apply(t, a, args);
          try {
            var result = parsed && parsed.result;
            if (
              result &&
              Array.isArray(result.items) &&
              result.items.length > 0 &&
              result.items[0] &&
              result.items[0].hid !== undefined
            ) {
              finish({ items: result.items, meta: result.meta || result.pagination || null });
            }
          } catch {}
          return parsed;
        },
      });
      setTimeout(function () {
        finish(null);
      }, 20000);
    })();
  `;
  const result = await runProxiedWebView<ResultManga | null>(
    browseUrl,
    bootstrap,
    cookieInterceptor,
  );
  if (!result) {
    console.log(`[Comix] browse timed out for ${browseUrl}`);
    throw new Error("Comix browseViaWebView: timed out waiting for browse JSON");
  }
  return result;
}
