/**
 * ebk lead engine — runs on Mac mini #1, 24/7.
 * Given a niche + territory, pulls businesses from Google Places (New),
 * classifies website status, and UPSERTs into RDS. Idempotent: safe to re-run.
 *
 * API-ONLY. Never scrapes. Sits dark (logs a clear message) until GOOGLE_PLACES_KEY is set.
 */
import pg from "pg";
import { classifyWebsite, dedupeKey } from "./classify.js";

const { Pool } = pg;
const pool = new Pool({
  host: process.env.RDS_HOST,
  port: Number(process.env.RDS_PORT || 5432),
  database: process.env.RDS_DB || "ebk",
  user: process.env.RDS_USER,
  password: process.env.RDS_PASSWORD,
  ssl: process.env.RDS_SSL === "false" ? false : { rejectUnauthorized: false },
});

const GOOGLE_KEY = process.env.GOOGLE_PLACES_KEY || "";

async function fetchGoogle(textQuery, want = 60) {
  if (!GOOGLE_KEY) {
    throw new Error(
      "GOOGLE_PLACES_KEY is not set. The engine is built and ready, but cannot pull " +
      "leads until the key is added (see config/.env.example). This is the expected " +
      "state until Phase 0 is done."
    );
  }
  const out = [];
  let pageToken = null, page = 0;
  do {
    const body = pageToken ? { textQuery, pageToken } : { textQuery };
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_KEY,
        "X-Goog-FieldMask":
          "places.displayName,places.formattedAddress,places.nationalPhoneNumber," +
          "places.websiteUri,places.rating,places.userRatingCount," +
          "places.primaryTypeDisplayName,places.location,nextPageToken",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("Google Places error " + res.status + ": " + (await res.text()).slice(0, 200));
    const data = await res.json();
    for (const p of data.places || []) {
      out.push({
        name: p.displayName?.text || "",
        addr: p.formattedAddress || "",
        phone: p.nationalPhoneNumber || "",
        website: p.websiteUri || "",
        rating: p.rating ?? null,
        reviews: p.userRatingCount ?? 0,
        category: p.primaryTypeDisplayName?.text || "",
        lat: p.location?.latitude ?? null,
        lng: p.location?.longitude ?? null,
      });
    }
    pageToken = data.nextPageToken || null;
    page++;
    if (pageToken && out.length < want) await new Promise((r) => setTimeout(r, 1700));
  } while (pageToken && out.length < want && page < 3);
  return out.slice(0, want);
}

/** UPSERT one lead. ON CONFLICT(dedupe_key) updates only if we have better data. */
async function upsertLead(client, biz, territoryId) {
  const key = dedupeKey(biz);
  const status = classifyWebsite(biz.website);
  const q = `
    INSERT INTO leads (dedupe_key,name,phone,website,website_status,rating,reviews,category,address,lat,lng,source,territory_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'google',$12)
    ON CONFLICT (dedupe_key) DO UPDATE SET
      website        = COALESCE(NULLIF(EXCLUDED.website,''), leads.website),
      website_status = CASE WHEN EXCLUDED.website_status <> 'no_website'
                            THEN EXCLUDED.website_status ELSE leads.website_status END,
      rating         = COALESCE(EXCLUDED.rating, leads.rating),
      reviews        = GREATEST(EXCLUDED.reviews, leads.reviews),
      phone          = COALESCE(NULLIF(EXCLUDED.phone,''), leads.phone),
      updated_at     = now()
    RETURNING (xmax = 0) AS inserted;`;
  const vals = [key, biz.name, biz.phone, biz.website, status, biz.rating,
                biz.reviews, biz.category, biz.addr, biz.lat, biz.lng, territoryId];
  const r = await client.query(q, vals);
  return r.rows[0].inserted; // true = new, false = updated existing
}

/** Run one niche x area harvest end-to-end. */
export async function harvest(niche, area, region = null) {
  const textQuery = `${niche} in ${area}`;
  console.log(`[engine] harvesting: ${textQuery}`);
  const businesses = await fetchGoogle(textQuery);

  const client = await pool.connect();
  let added = 0, updated = 0;
  try {
    await client.query("BEGIN");
    // ensure territory row
    const t = await client.query(
      `INSERT INTO territories (region,area,niche,status,last_run_at)
       VALUES ($1,$2,$3,'scraped',now())
       ON CONFLICT (area,niche) DO UPDATE SET status='scraped', last_run_at=now()
       RETURNING id`,
      [region || "unspecified", area, niche]
    );
    const territoryId = t.rows[0].id;
    for (const biz of businesses) {
      if (!biz.name) continue;
      const inserted = await upsertLead(client, biz, territoryId);
      inserted ? added++ : updated++;
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  console.log(`[engine] ${textQuery}: ${added} new, ${updated} updated (${businesses.length} pulled)`);
  return { query: textQuery, pulled: businesses.length, added, updated };
}

export { pool };
