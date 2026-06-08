-- ebk lead pipeline — RDS Postgres schema
-- Source of truth for the whole system. Engine writes leads; callers update calls.
-- DB-level dedupe constraint guarantees no duplicate business even if the engine runs twice.

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- for gen_random_uuid()

-- ---------- territories: the niche x area grid (mirrors the tracker tab) ----------
CREATE TABLE IF NOT EXISTS territories (
    id           SERIAL PRIMARY KEY,
    region       TEXT NOT NULL,            -- e.g. 'AZ - Phoenix Metro'
    area         TEXT NOT NULL,            -- e.g. 'Gilbert'
    niche        TEXT NOT NULL,            -- e.g. 'Barber shops'
    status       TEXT NOT NULL DEFAULT 'not_started'
                 CHECK (status IN ('not_started','scraped','calling','completed')),
    last_run_at  TIMESTAMPTZ,
    UNIQUE (area, niche)
);

-- ---------- leads: one row per business, deduped ----------
CREATE TABLE IF NOT EXISTS leads (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dedupe_key    TEXT NOT NULL,           -- normalized phone, else name+area
    name          TEXT NOT NULL,
    phone         TEXT,
    website       TEXT,                    -- empty/null = no website
    website_status TEXT NOT NULL DEFAULT 'unknown'
                  CHECK (website_status IN ('no_website','social_only','has_site','unknown')),
    rating        NUMERIC(2,1),
    reviews       INTEGER DEFAULT 0,
    category      TEXT,
    address       TEXT,
    lat           DOUBLE PRECISION,
    lng           DOUBLE PRECISION,
    source        TEXT NOT NULL DEFAULT 'google',   -- google | yelp | merged
    territory_id  INTEGER REFERENCES territories(id),
    is_prime      BOOLEAN GENERATED ALWAYS AS
                  (website_status = 'no_website' AND rating IS NOT NULL AND rating >= 4.0) STORED,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- THE dedupe guarantee: engine cannot insert the same business twice
    CONSTRAINT uq_leads_dedupe UNIQUE (dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_leads_prime   ON leads (is_prime) WHERE is_prime = TRUE;
CREATE INDEX IF NOT EXISTS idx_leads_terr    ON leads (territory_id);
CREATE INDEX IF NOT EXISTS idx_leads_status  ON leads (website_status);
CREATE INDEX IF NOT EXISTS idx_leads_rating  ON leads (rating DESC);

-- ---------- calls: outcome log, one row per call attempt ----------
CREATE TABLE IF NOT EXISTS calls (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id     UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    caller      TEXT,                      -- who dialed
    outcome     TEXT NOT NULL DEFAULT 'no_answer'
                CHECK (outcome IN ('no_answer','callback','not_interested','yes_paid','yes_pending','wrong_number')),
    paid        BOOLEAN NOT NULL DEFAULT FALSE,
    pay_code    TEXT,                      -- the 5-digit ebk.tech/pay code
    notes       TEXT,
    follow_up_at TIMESTAMPTZ,
    called_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calls_lead    ON calls (lead_id);
CREATE INDEX IF NOT EXISTS idx_calls_outcome ON calls (outcome);

-- ---------- the query the simulation tested: prime leads in an area, not yet called ----------
-- (kept here as documentation / a view you can SELECT * FROM)
CREATE OR REPLACE VIEW v_callable_prime AS
SELECT l.*
FROM leads l
LEFT JOIN calls c ON c.lead_id = l.id
WHERE l.is_prime = TRUE
  AND l.phone IS NOT NULL
  AND c.id IS NULL                         -- never called
ORDER BY l.rating DESC, l.reviews DESC;

-- auto-update updated_at
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_leads_touch ON leads;
CREATE TRIGGER trg_leads_touch BEFORE UPDATE ON leads
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
