-- ebk dashboard / reporting queries — run against RDS.
-- These power whatever view you build (Metabase, a web dashboard, or a Sheet mirror).

-- 1) THE money query: callable prime leads in one area, best first
SELECT name, phone, rating, reviews, address
FROM v_callable_prime
WHERE territory_id IN (SELECT id FROM territories WHERE area = 'Gilbert')
LIMIT 100;

-- 2) Live progress dashboard (mirrors the tracker tab counters)
SELECT
  COUNT(*)                                          AS total_territories,
  COUNT(*) FILTER (WHERE status <> 'not_started')   AS harvested,
  COUNT(*) FILTER (WHERE status = 'scraped')        AS scraped,
  COUNT(*) FILTER (WHERE status = 'calling')        AS calling,
  COUNT(*) FILTER (WHERE status = 'completed')      AS completed,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status <> 'not_started') / NULLIF(COUNT(*),0), 1) AS pct_done
FROM territories;

-- 3) Lead counts by status
SELECT website_status, COUNT(*) FROM leads GROUP BY website_status ORDER BY 2 DESC;

-- 4) Prime leads by region (where to point callers)
SELECT t.region, COUNT(*) AS prime_leads
FROM leads l JOIN territories t ON t.id = l.territory_id
WHERE l.is_prime
GROUP BY t.region ORDER BY prime_leads DESC;

-- 5) Conversion: calls -> paid
SELECT
  COUNT(*)                              AS total_calls,
  COUNT(*) FILTER (WHERE paid)          AS paid,
  ROUND(100.0 * COUNT(*) FILTER (WHERE paid) / NULLIF(COUNT(*),0), 1) AS close_rate_pct
FROM calls;

-- 6) Today's follow-ups due
SELECT l.name, l.phone, c.follow_up_at, c.notes
FROM calls c JOIN leads l ON l.id = c.lead_id
WHERE c.follow_up_at::date <= CURRENT_DATE AND c.outcome = 'callback'
ORDER BY c.follow_up_at;
