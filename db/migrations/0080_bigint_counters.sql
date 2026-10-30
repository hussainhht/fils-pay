-- Platform lifetime volume (0049) was INTEGER, which overflows at
-- 2,147,483,647 fils. The merchant lifetime payout estimate (0040) was
-- REAL, which cannot represent every fils past 2^24. Both counters are
-- integer fils.

ALTER TABLE platform_stats
    ALTER COLUMN total_processed_fils TYPE BIGINT;

ALTER TABLE merchants
    ALTER COLUMN lifetime_net_payout_monitoring_estimate TYPE BIGINT
    USING ROUND(lifetime_net_payout_monitoring_estimate)::bigint;
