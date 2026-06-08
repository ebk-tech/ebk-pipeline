# ebk Lead Pipeline — self-hosted

Full self-hosted lead engine: pulls businesses from Google Places, stores them in
your AWS RDS Postgres, and feeds callers a ranked list of **prime leads** (good
rating + no website). Local model server (DGX) handles the concierge AI layer.

## ⚠️ Read this first — staged build

This project is **built complete but runs idle until you add the Google Places key.**
That was a deliberate choice (build now, key later). Concretely:

- `node scripts/test-classify.js` works **right now** — pure logic, no key, no DB.
- The engine starts and serves `/health` without a key, but `/harvest` returns a
  clear "key not set" message until `GOOGLE_PLACES_KEY` is filled in.
- **Nothing populates the database until the key exists.** This is expected, not a bug.
  The Google key is the front door; everything downstream waits on it.

## Architecture

```
Google Places API   ← the only piece needing a key (the data source)
        │
        ▼
  Engine (Mac mini #1)   ── fetch, dedupe, classify no-website ──┐
        │                                                         │
        ▼                                                         │
  AWS RDS Postgres  ← SOURCE OF TRUTH (leads, calls, territories) │
        │                                                         │
        ├──► Dashboard / Sheet mirror (read-only view)            │
        │                                                         │
  Concierge AI (DGX)  ←── parses call replies, drafts follow-ups ─┘
        (OFF critical path — pipeline runs without it)
```

Why these choices (from the design simulation):
- **RDS not DynamoDB:** the core query "prime leads in Gilbert not yet called, by
  rating" is one SQL line in Postgres; in Dynamo it needs a secondary index and still
  can't sort cleanly.
- **DB-level dedupe:** `leads.dedupe_key` has a UNIQUE constraint, so the engine can
  run twice without creating duplicates — the UPSERT just updates.
- **DGX off critical path:** fetching/deduping/flagging is deterministic DB work; no
  LLM needed to make leads appear. The DGX earns its place on the concierge layer later.
- **Sheet is a mirror, not the store:** two writers (engine + callers) corrupt a Sheet
  and hit API quotas. RDS owns the data; the Sheet just displays it.

## Setup order

1. **RDS:** create a Postgres instance. Run the schema:
   ```
   psql "$DATABASE_URL" -f db/schema.sql
   ```
2. **Config:** `cp config/.env.example .env` and fill in RDS_* values.
   Leave `GOOGLE_PLACES_KEY` blank for now if you don't have it yet.
3. **Install + seed:**
   ```
   npm install
   node scripts/seed-territories.js     # fills the 15 x ~70 territory grid
   ```
4. **Engine (Mac mini #1):**
   ```
   npm run engine        # serves on :8080
   curl localhost:8080/health
   ```
   With no key, health shows `key_present: false` and the engine waits.
5. **When you get the key:** add `GOOGLE_PLACES_KEY` to `.env`, restart the engine, then:
   ```
   curl -X POST localhost:8080/harvest -H 'content-type: application/json' \
        -d '{"niche":"Barber shops","area":"Gilbert","region":"AZ - Phoenix Metro"}'
   # or harvest every not_started territory:
   curl -X POST localhost:8080/run-queue
   ```
   Leads now appear in RDS automatically. That's the "show up by themselves" outcome.
6. **Concierge (DGX, optional):** install Ollama, pull a model, then:
   ```
   npm run concierge     # serves on :8090
   ```

## Keeping it running
- Use `pm2` or a `launchd` plist on the Mac mini so the engine restarts on reboot.
- Lock the Google key to the mini's IP in Google Cloud Console, and set a budget cap
  + quota so it physically cannot bill you beyond the free tier.

## Files
- `db/schema.sql` — tables, dedupe constraint, the callable-prime view
- `engine/` — `engine.js` (fetch+upsert), `classify.js` (pure helpers), `server.js` (HTTP+queue)
- `model-server/concierge.js` — DGX local-model server (off critical path)
- `scripts/seed-territories.js` — populate the grid · `test-classify.js` — logic tests
- `dashboard/queries.sql` — ready-to-use reporting queries
- `config/.env.example` — all config

## Tested
`node scripts/test-classify.js` → 7/7 pass (classify + dedupe). All server files
syntax-checked. DB/API paths can't be exercised here without live RDS + key, so
verify those after step 5.
