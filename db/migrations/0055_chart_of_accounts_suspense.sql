-- Additional suspense accounts for future reconciliation lanes.

-- Like scheme_rounding_residue (0007), these are clearing assets pending
-- reconciliation, not a separate account kind named "suspense".
INSERT INTO chart_of_accounts (id, name, kind)
VALUES
  ('fx_rounding_difference', 'FX Rounding Difference', 'asset'),
  ('chargeback_suspense', 'Chargeback Suspense', 'asset')
ON CONFLICT (id) DO NOTHING;
