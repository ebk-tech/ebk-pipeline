/** Pure, dependency-free helpers. Unit-tested in scripts/test-classify.js */

export function classifyWebsite(url) {
  const w = (url || "").trim();
  if (!w) return "no_website";
  if (/facebook\.com|instagram\.com|yelp\.com|linktr\.ee|business\.site|m\.facebook/i.test(w))
    return "social_only";
  return "has_site";
}

/** Normalize to a dedupe key: phone digits if usable, else name+area slug. */
export function dedupeKey(biz) {
  const digits = (biz.phone || "").replace(/[^\d]/g, "").replace(/^1/, "");
  if (digits.length >= 7) return "p:" + digits;
  const nameSlug = (biz.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const geo = biz.lat != null ? ":" + biz.lat.toFixed(2) + "," + (biz.lng ?? 0).toFixed(2) : "";
  return "n:" + nameSlug + geo;
}
