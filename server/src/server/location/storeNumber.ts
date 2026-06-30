/**
 * Best-effort store/branch number extraction from a business website URL.
 *
 * Some chains encode the store number in their store-locator URL (e.g. The Home
 * Depot: `.../37312/743` -> store 743). Each entry is a per-domain regex whose
 * first capture group is the store number, validated against real ptiles website
 * data. A regex match is the ONLY trigger — product/homepage URLs that don't
 * match yield null — so the result is a genuine, low-false-positive guess.
 *
 * To extend: confirm a chain's store-page URL format and add a `domain -> RegExp`
 * entry whose group 1 is the store id.
 */
const STORE_URL_PATTERNS: Record<string, RegExp> = {
  "homedepot.com": /\/\d{5}\/(\d+)/, // /l/<city>/<ST>/<city>/<zip>/<store>
  "lowes.com": /\/store\/[^/]+\/(\d+)/, // /store/<ST>-<City>/<store>
  "target.com": /\/sl\/[^/]+\/(\d+)/, // /sl/<city>/<store>
  "walmart.com": /\/store\/(\d+)/, // /store/<store>-<city>-<st>
  "bestbuy.com": /-(\d+)\.html/, // .../<addr>-<store>.html
  "walgreens.com": /\/id=(\d+)/, // /locator/...-<zip>/id=<store>
  "kroger.com": /\/stores\/grocery\/.*\/(\d+)(?:\?|$)/, // /stores/grocery/.../<div>/<store>
  "kohls.com": /-(\d+)\.shtml/, // /stores/<st>/<city>-<store>.shtml
  "dollargeneral.com": /\/store-directory\/[^/]+\/[^/]+\/(\d+)/, // /store-directory/<st>/<city>/<store>
  "tractorsupply.com": /_(\d+)(?:\?|$)/, // /tsc/store_<City>-<ST>-<zip>_<store>
  "mcdonalds.com": /\/(\d+)\.html/, // /us/en-us/location/.../<store>.html
};

/**
 * Returns the store number parsed from a business website on a known chain domain,
 * or null when the URL is absent / the domain is unknown / the URL does not match
 * the chain's store-page pattern. Used only to populate optional candidate metadata
 * (store number is not part of the `loc:` key).
 */
export function storeNumberFromWebsite(url: string | undefined, domain: string): string | null {
  if (!url) return null;
  const pattern = STORE_URL_PATTERNS[domain];
  if (!pattern) return null;
  const match = url.match(pattern);
  return match ? match[1] : null;
}
