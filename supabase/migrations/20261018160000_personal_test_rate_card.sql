-- Internal quote for personal ES tests: $0 connection and $0.10 per started minute.
-- This is not a provider tariff or a guarantee of actual carrier/inference costs.
INSERT INTO rate_cards (
  version,
  country,
  connection_fee_micros,
  started_minute_fee_micros,
  active
)
SELECT
  'personal-test-es-2026-10-18',
  'ES',
  0,
  100000,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM rate_cards WHERE country = 'ES' AND active
)
ON CONFLICT DO NOTHING;
