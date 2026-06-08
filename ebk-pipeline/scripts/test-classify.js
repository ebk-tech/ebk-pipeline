/**
 * Tests the pure logic — runs with zero setup, no DB, no API key.
 *   node scripts/test-classify.js
 */
import { classifyWebsite, dedupeKey } from "../engine/classify.js";

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  (got ${JSON.stringify(got)})`);
}

// classifyWebsite
eq("blank -> no_website", classifyWebsite(""), "no_website");
eq("null -> no_website", classifyWebsite(null), "no_website");
eq("facebook -> social_only", classifyWebsite("https://facebook.com/joes"), "social_only");
eq("instagram -> social_only", classifyWebsite("http://instagram.com/joes"), "social_only");
eq("real site -> has_site", classifyWebsite("https://joesbarber.com"), "has_site");

// dedupeKey: same phone, different formatting -> same key
const a = dedupeKey({ name: "Tony's Barber", phone: "(480) 555-1234" });
const b = dedupeKey({ name: "Tonys Barber Shop", phone: "+1 480-555-1234" });
eq("same phone -> same dedupe key", a === b, true);

// no phone -> falls back to name+geo
const c = dedupeKey({ name: "Fresh Fades", phone: "", lat: 33.42, lng: -111.94 });
eq("no phone -> name slug key", c.startsWith("n:freshfades"), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
