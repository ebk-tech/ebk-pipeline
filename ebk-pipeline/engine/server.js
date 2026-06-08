/**
 * Engine HTTP server + scheduler. Runs on the Mac mini.
 * - POST /harvest {niche, area, region}  → run one harvest now
 * - POST /run-queue                        → harvest all 'not_started' territories
 * - GET  /health                           → liveness + whether the key is present
 *
 * Start: node engine/server.js   (see config/.env.example for required vars)
 */
import http from "node:http";
import { harvest, pool } from "./engine.js";

const PORT = Number(process.env.ENGINE_PORT || 8080);
const KEY_PRESENT = Boolean(process.env.GOOGLE_PLACES_KEY);

function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}
async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString() || "{}"); }
  catch { return {}; }
}

// Harvest every not_started territory, paced to respect API rate limits.
async function runQueue() {
  const { rows } = await pool.query(
    "SELECT region, area, niche FROM territories WHERE status = 'not_started'"
  );
  const results = [];
  for (const t of rows) {
    try {
      results.push(await harvest(t.niche, t.area, t.region));
      await new Promise((r) => setTimeout(r, 2500)); // pacing
    } catch (e) {
      results.push({ query: `${t.niche} in ${t.area}`, error: String(e.message) });
    }
  }
  return results;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      return json(res, 200, {
        ok: true,
        key_present: KEY_PRESENT,
        note: KEY_PRESENT ? "engine live" : "engine up but idle — GOOGLE_PLACES_KEY not set",
      });
    }
    if (req.method === "POST" && req.url === "/harvest") {
      const { niche, area, region } = await body(req);
      if (!niche || !area) return json(res, 400, { error: "need niche and area" });
      return json(res, 200, await harvest(niche, area, region));
    }
    if (req.method === "POST" && req.url === "/run-queue") {
      return json(res, 200, { results: await runQueue() });
    }
    json(res, 404, { error: "not found" });
  } catch (e) {
    json(res, 500, { error: String(e.message) });
  }
});

server.listen(PORT, () => {
  console.log(`[engine] listening on :${PORT}  | key present: ${KEY_PRESENT}`);
  if (!KEY_PRESENT) console.log("[engine] NOTE: idle until GOOGLE_PLACES_KEY is set. This is expected for now.");
});
