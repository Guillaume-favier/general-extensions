/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

/* Comix encrypted-API response decryption (x-enc 2).
 *
 * Extracted offline from the site's secure-*.js bundle by acepilot147's
 * crypto-pipeline (acepilot147/pb-extensions, experiment/crypto-pipeline):
 * the bundle is booted in a sandbox and the table is read out through a
 * JSON-digit oracle, so no VM internals are needed and the extraction
 * survives the per-deploy renaming.
 *
 *   ct = [h0, h1, body...]; off = ((h0 << 8) | h1) % K.length
 *   pt[i] = body[i] ^ K[(off + i) % K.length]
 *
 * Bundle ID: m9v-live (kid "m9v.") — verified byte-exact against the live
 * bundle and against a real captured {"e":"..."} chapter payload.
 *
 * comix re-keys whenever secure-*.js rotates (the `_` token prefix moves with
 * it, e.g. 6l1. -> m9v.), at which point KEY_B64 goes stale and must be
 * re-extracted; only the constants are bundle-specific, the algorithm above
 * is stable.
 *
 * Vendored from that generator's output: the only hand edits are the
 * Array.from allocations (unicorn/no-new-array) and repo formatting.
 */

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function b64Decode(s: string): number[] {
  const lookup: number[] = Array.from({ length: 128 }, () => -1);
  for (let i = 0; i < 64; i++) lookup[B64_CHARS.charCodeAt(i)] = i;
  const normalized = s.replace(/-/g, "+").replace(/_/g, "/");
  const out: number[] = [];
  let buf = 0,
    bits = 0;
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized.charCodeAt(i);
    if (c === 61) break; // '='
    const v = lookup[c] ?? -1;
    if (v < 0) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return out;
}

const X_ENC = "2";
const KEY_B64 =
  "CuQouU7RlI7ELf5xlm2VXqGAoXueinFDfFjtZ2heWcupmq11joxzjiThB3NtY8UK350arWLpyBelEc0SVbElNze4UB+r89FDyyPREHT16xLUq+RbVdHNpd4eiZsjslhfHup9EU7CW3APt4VsZbbbDpdqBSP5f/Ua+BHmzwlvnbOrnEmgtRa1XRn+M3qhoSIxVRi0mzcdNTXKHmU/PnPGXrmV894Ok4QqlA+JZq3r9+sYh1xzPBEUROIXqn6qtwEuF+D/AvtEeLIyArbcYpmK/RJQEuq2+SonYl+ZjpPwpjWnUNEs5oMJ+2m4JblyupiLENhlo4an0oFKhj+IdupCaSn6EIwJxHBeNQQWxS6Hfne2jxi2u3ofPHLb5o2/jTIS+N2mxcTdMoXF5hPvRWcZ/X0/Guj7eueJpy+nFIOpPgScB5/Tzfj87mjdgCaae5KB12BQaHeQpiL3PStzZCQh5Hei7y6K2nPCBLLQWAftOMItFmwDUU52l1cdew9mdwyX927VukqfBI+lUziQbWdoi3AzeS2n0hYZmeGEMkek+BX0BLE0NvyCcNOWP3YuO/uOHbS5fWmfP6vEfDwd2V/cjTU7ALIcbPuxhsdt5fopQQIdO5c9X/8Cyqe/SIf1WneNjQZ/U3RIrwv98pdScD/7r+28VatrixxF42DUZyUKZ0JEGZC9a4xpqzu302MkjAgDysWAUXY2oPvlmSJKoKBTNXDKlG2RU24ScE8gXHXXPSO+g+1SX1H21NKkZIfzpZjpqpeAg02vJZQXaB8T49f9v8Aha7+uh0Lnzo3lqQfcj9ymDOjIJ0uGbvaOCuvjExRUg0p87o38xoGUnzaoK9AuPiS9AZbzehmLka40Qs2OQFGby/NjGcnDRwdnHUV6oOARvQc8Qxyi/s5PawlgO3w4x5VzsRuA2MOH/q94pNQdE90ZhvXUWWOx3G3smXq5QoSux4E7QZlnsMtF4KYmicI1gDx9daKg5NTS1akfl5K4ODKb7MjfHcyh7rQQsPZj4pyz0ifSHv8YMhmpJKpG/UUaGnv4WvqPcoPNUjnhSaCXVwLe4UUmZsqbJexFh2430+AAxUi4Kw5wrF7UAo/qwG7Y3JknRNDf3/lG1pC/aFcYoQWzUWF6rCpj3ZdBIhvV9AFp9PDK525nT7jRVwP2mOChPSOjxtDz/RIKvUmucyR5lp+wAGNVa6Cpg8paosB0JfivQhhCBAB+6OIIyTI1H+6706f7uneK5hja94GPnWppBFckCsJ52spKYj1Jh0onduDjj3iWY0Df11YyP9GOuCENJ1URa6ygW+7vy7rs/hSG4i/paCc43PNaHc3Y+4y86BcKyrVRr+62mMO0C+zojTpfwA==";
let KEY: number[] | null = null;

// Manual UTF-8 decode (JavaScriptCore-safe; no TextDecoder dependency).
function utf8Decode(bytes: number[]): string {
  let out = "";
  let i = 0;
  const n = bytes.length;
  while (i < n) {
    const b = bytes[i++]! & 0xff;
    if (b < 0x80) {
      out += String.fromCharCode(b);
    } else if (b < 0xe0) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++]! & 0x3f));
    } else if (b < 0xf0) {
      const b1 = bytes[i++]! & 0x3f,
        b2 = bytes[i++]! & 0x3f;
      out += String.fromCharCode(((b & 0x0f) << 12) | (b1 << 6) | b2);
    } else {
      const b1 = bytes[i++]! & 0x3f,
        b2 = bytes[i++]! & 0x3f,
        b3 = bytes[i++]! & 0x3f;
      let cp = ((b & 0x07) << 18) | (b1 << 12) | (b2 << 6) | b3;
      cp -= 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    }
  }
  return out;
}

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(headers ?? {})) out[key.toLowerCase()] = String(headers[key]);
  return out;
}

/**
 * Decrypt a comix.to encrypted API envelope ({ e: "<base64>" }) to its parsed
 * result. Pass-through when the payload is not encrypted. Mirrors the bundle's
 * response interceptor, including the { status: "ok", result } unwrap.
 * Throws on an x-enc version this build doesn't know, so a cipher rotation
 * surfaces as a clear error instead of a silently-undecoded {e}.
 */
export function fastDecryptComixPayload(
  rawPath: string,
  payload: any,
  headers: Record<string, string> = {},
): any {
  void rawPath;
  if (!(payload && typeof payload === "object" && typeof payload.e === "string")) return payload;
  const h = normalizeHeaders(headers);
  if (h["x-enc"] && h["x-enc"] !== X_ENC) {
    throw new Error(
      "Comix x-enc " +
        h["x-enc"] +
        " is not supported (expected " +
        X_ENC +
        ") - the response cipher rotated; rerun the crypto pipeline",
    );
  }

  const key = KEY ?? (KEY = b64Decode(KEY_B64));
  const ct = b64Decode(payload.e);
  const n = key.length;
  let k = ct.length >= 2 ? ((ct[0]! << 8) | ct[1]!) % n : 0;
  const pt: number[] = Array.from({ length: Math.max(0, ct.length - 2) }, () => 0);
  for (let i = 0; i < pt.length; i++) {
    pt[i] = ct[i + 2]! ^ key[k]!;
    if (++k === n) k = 0;
  }

  const parsed = JSON.parse(utf8Decode(pt));
  return parsed && typeof parsed === "object" && parsed.status === "ok" && "result" in parsed
    ? parsed.result
    : parsed;
}
