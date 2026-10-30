# FilsPay — Master Bug Registry

One canonical file per unique bug: `bug-{n}-{slug}.md`. Numbering is sequential and unique (`BUG-001` through `BUG-090`).

**Ground truth is always the code.** Tickets, ADRs, and comments are leads. They are not proof.

**Implementation update (2026-10-30):** BUG-001/002/015/016/017/029, fresh/unapplied BUG-014, local-boot BUG-058, and seed-safety BUG-054 have validated fixes; BUG-057 has code/config remediation with external credential rotation outstanding. Per-report status lines and [wave 1 validation](../implementation/wave1-validation.md) record limits. Hosted preview the same day rechecked BUG-001 and recorded runtime on still-open BUG-022, BUG-027, BUG-034, BUG-051, BUG-059, BUG-071, BUG-076, and BUG-083. New reports: [BUG-085](bug-085-dashboard-document-title-says-checkout.md), [BUG-086](bug-086-credit-reversal-uses-merchant-mdr-column.md), [BUG-088](bug-088-promotional-discount-times-100.md), [BUG-089](bug-089-admin-invite-math-random.md), and [BUG-090](bug-090-hex-compare-drops-trailing-nibble.md). The catalog and investigation counts below describe the original audit snapshot.

---

## Overview

This registry serves as the authoritative, evidence-backed master catalog of all verified software vulnerabilities, financial logic flaws, architectural discrepancies, and data integrity defects across the FilsPay ecosystem. 

All findings have been subjected to rigorous semantic deduplication, technical cross-verification, and standardization. For full details on the consolidation methodology, historical mappings, and merge justifications, see the [Bug Merge Audit Report](BUG_MERGE_AUDIT.md).

---

## Investigation Summary

| Metric | Count | Details |
|---|---|---|
| **Total Original Reports** | **88** | 72 from canonical audit + 16 from static blind spot investigation |
| **Duplicate Reports Merged** | **4** | Consolidated into canonical entries with complete evidence preservation |
| **Total Unique Bugs** | **84** | Sequentially indexed `BUG-001` through `BUG-084` |
| **Critical Severity** | **14** | Direct fund loss, auth bypass, tenant crossover, data destruction |
| **High Severity** | **44** | Cryptographic weakness, ledger drift, unauthenticated endpoints, SSRF |
| **Medium Severity** | **22** | Concurrency risks, display discrepancies, performance bottlenecks |
| **Low Severity** | **4** | UI formatting, missing migration checksums, off-by-one analytics |
| **Runtime Reproduced** | **13** | Empirically verified against live containers / database artifacts |
| **Statically Confirmed** | **71** | Verified through AST/code tracing and SQL schema analysis |
| **Unverified / Disproven** | **0** | Every canonical bug is supported by technical code evidence |

---

<!-- implementation-status:start -->
## Current fix status

Status tracks remediation; Verification records the historical audit proof. Qualified fixes retain the deployment limits in their reports. Partial findings remain open for their stated outstanding work.

| Status | Count |
|---|---|
| Fixed | 83 |
| Fixed (fresh DB) | 1 |
| Fixed (local boot) | 1 |
| Partial | 2 |
| Open | 3 |

<!-- implementation-status:end -->

## Master Bug Index

| ID | Bug Title | Severity | Verification | Status | Category | Report |
| :---: | --- | :---: | :---: | --- | --- | :---: |
| **BUG-001** | Merchant Login Grants Full Access Without Entering OTP | `Critical` | STATICALLY CONFIRMED | Fixed | Authentication and sessions | [BUG-001](bug-001-merchant-otp-bypass.md) |
| **BUG-002** | OTP and Session Bound to Different Merchant Allowing Cross-Tenant Takeover | `Critical` | STATICALLY CONFIRMED | Fixed | Authorization and tenant isolation | [BUG-002](bug-002-otp-sent-to-other-merchant.md) |
| **BUG-003** | Missing Merchant Ownership Validation Allows Cross-Merchant Refunds | `Critical` | STATICALLY CONFIRMED | Fixed | Authorization and tenant isolation | [BUG-003](bug-003-cross-merchant-refund.md) |
| **BUG-004** | Admin Merchant Impersonation Grants Write Access | `Critical` | RUNTIME REPRODUCED | Fixed | Authorization and tenant isolation | [BUG-004](bug-004-impersonation-grants-write-access.md) |
| **BUG-005** | Payment Link Can Be Paid After Expiry via Client submittedAt Spoofing | `Critical` | STATICALLY CONFIRMED | Fixed | Payments and payment links | [BUG-005](bug-005-payment-link-paid-after-expiry.md) |
| **BUG-006** | Payment Link Double Charging via Concurrent Reservation Reclaim | `Critical` | RUNTIME REPRODUCED | Fixed | Payments and payment links | [BUG-006](bug-006-payment-link-double-charge.md) |
| **BUG-007** | Refund Headroom Capped at Authorized Amount Instead of Captured Amount | `Critical` | STATICALLY CONFIRMED | Fixed | Refunds | [BUG-007](bug-007-refund-more-than-captured.md) |
| **BUG-008** | Concurrent Refunds Both Succeed Allowing Double Money Out | `Critical` | STATICALLY CONFIRMED | Fixed | Refunds | [BUG-008](bug-008-concurrent-refund-double-money-out.md) |
| **BUG-009** | Adjustment CSV Parser Treats BHD as 2-Decimal Currency Reducing Values by 10x | `Critical` | RUNTIME REPRODUCED | Fixed | Ledger and financial calculations | [BUG-009](bug-009-csv-import-10x-too-small.md) |
| **BUG-010** | Settlement Net Payout Computed in Float32 Causing Severe Precision Loss | `Critical` | STATICALLY CONFIRMED | Fixed | Ledger and financial calculations | [BUG-010](bug-010-net-payout-float32.md) |
| **BUG-011** | Admin Recalculate Cached Balances Reads Scheme Gross Instead of Ledger | `Critical` | STATICALLY CONFIRMED | Fixed | Admin console and controls | [BUG-011](bug-011-recalculate-balances-wrong-source.md) |
| **BUG-012** | Merchant Status Recomputation Clears Test Mode Flag Polluting Live Settlement | `Critical` | RUNTIME REPRODUCED | Fixed | Admin console and controls | [BUG-012](bug-012-recompute-statuses-clears-test-mode.md) |
| **BUG-013** | Janitor Script Deletes All Active Holds When No Expired Holds Are Found | `Critical` | RUNTIME REPRODUCED | Fixed | Database and migrations | [BUG-013](bug-013-expire-holds-deletes-every-hold.md) |
| **BUG-014** | Fresh Database Migrations Fail at 0054/0055 and View 0072 Has Broken Join Key | `Critical` | RUNTIME REPRODUCED | Fixed (fresh DB) | Database and migrations | [BUG-014](bug-014-migrations-break-fresh-database.md) |
| **BUG-015** | OTP Attempt Limit Is Racy and Resend Resets Guess Budget | `High` | STATICALLY CONFIRMED | Fixed | Authentication and sessions | [BUG-015](bug-015-otp-attempt-limit-race-and-resend-reset.md) |
| **BUG-016** | Session Token Not Rotated on OTP Promotion and Cookie Expiry Not Extended | `High` | STATICALLY CONFIRMED | Fixed | Authentication and sessions | [BUG-016](bug-016-session-token-not-rotated-on-otp.md) |
| **BUG-017** | Suspending a Merchant Does Not Revoke Active Session Tokens or API Keys | `High` | STATICALLY CONFIRMED | Fixed | Authentication and sessions | [BUG-017](bug-017-suspended-merchant-credentials-keep-working.md) |
| **BUG-018** | Payment Link Cancellation Endpoint Lacks Merchant Scoping | `High` | STATICALLY CONFIRMED | Fixed | Authorization and tenant isolation | [BUG-018](bug-018-payment-link-cancel-cross-merchant.md) |
| **BUG-019** | Reporting Scope Allows Split Merchant Parent to Query Unauthorized Child Data | `High` | STATICALLY CONFIRMED | Fixed | Authorization and tenant isolation | [BUG-019](bug-019-reporting-scope-split-child-idor.md) |
| **BUG-020** | Reporting Export Summary Endpoint Lacks Authentication Pre-Handler | `High` | STATICALLY CONFIRMED | Fixed | Authorization and tenant isolation | [BUG-020](bug-020-reporting-export-summary-unauthenticated.md) |
| **BUG-021** | Capture Idempotency Key Is Not Bound to Transaction ID Allowing Tenant Replay | `High` | STATICALLY CONFIRMED | Fixed | Authorization and tenant isolation | [BUG-021](bug-021-capture-replay-not-bound-to-transaction.md) |
| **BUG-022** | Public Payment Link Endpoint Leaks Live Merchant API Key Hash | `High` | STATICALLY CONFIRMED | Fixed | Payments and payment links | [BUG-022](bug-022-payment-link-leaks-api-key-hash.md) |
| **BUG-023** | Negotiated Fee Discount Skipped for Hosted Payment Link Captures | `High` | STATICALLY CONFIRMED | Fixed | Payments and payment links | [BUG-023](bug-023-discount-skipped-for-payment-links.md) |
| **BUG-024** | Void Operation Does Not Reverse External Acquirer Authorization Hold | `High` | STATICALLY CONFIRMED | Open | Payments and payment links | [BUG-024](bug-024-void-does-not-reverse-authorization.md) |
| **BUG-025** | Capture Ignores Hold Expiry and Succeeds Against Expired Authorizations | `High` | STATICALLY CONFIRMED | Fixed | Payments and payment links | [BUG-025](bug-025-capture-ignores-hold-expiry.md) |
| **BUG-026** | Zero-Discount Capture Events Allow Retries to Post Repeated Rebate Adjustments | `High` | STATICALLY CONFIRMED | Fixed | Payments and payment links | [BUG-026](bug-026-zero-discount-events-allow-repeated-rebates.md) |
| **BUG-027** | POST /v1/refunds Route Returns 501 Not Implemented (Unfinished Feature) | `High` | STATICALLY CONFIRMED | Fixed | Refunds | [BUG-027](bug-027-refunds-route-returns-501.md) |
| **BUG-028** | Refund with Null Reason Violates DB Constraint Leaving Idempotency Key Stuck | `High` | RUNTIME REPRODUCED | Fixed | Refunds | [BUG-028](bug-028-refund-null-reason-sticks-idempotency-key.md) |
| **BUG-029** | Insecure PRNG (Math.random) Used for OTP Generation and Payment Link Tokens | `High` | STATICALLY CONFIRMED | Fixed | Ledger and financial calculations | [BUG-029](bug-029-otp-and-payment-link-insecure-rng.md) |
| **BUG-030** | Split Payouts Drop Fractional Fils Due to Independent Banker Rounding | `High` | STATICALLY CONFIRMED | Fixed | Ledger and financial calculations | [BUG-030](bug-030-split-payout-missing-fils.md) |
| **BUG-031** | Platform Lifetime Volume Counter Uses 32-Bit Integer Overflowing at 2.1M BHD | `High` | STATICALLY CONFIRMED | Fixed | Ledger and financial calculations | [BUG-031](bug-031-platform-volume-int32-overflow.md) |
| **BUG-032** | TypeScript API Fee Calculation and Go Settlement Fee Formulas Diverge | `High` | STATICALLY CONFIRMED | Fixed | Ledger and financial calculations | [BUG-032](bug-032-ts-and-go-fee-formulas-diverge.md) |
| **BUG-033** | March Residue Sweep Script Is Non-Idempotent and Uses UTC Month Window | `High` | STATICALLY CONFIRMED | Fixed | Ledger and financial calculations | [BUG-033](bug-033-march-sweep-not-idempotent.md) |
| **BUG-034** | Scheme Export Rounds Amounts While Ledger Truncates Creating Persistent Surplus | `High` | STATICALLY CONFIRMED | Fixed | Settlement and reconciliation | [BUG-034](bug-034-scheme-export-rounding-always-over.md) |
| **BUG-035** | MDR Recalculation Rewrites Batches That Are Already Paid Out | `High` | STATICALLY CONFIRMED | Fixed | Settlement and reconciliation | [BUG-035](bug-035-mdr-recalc-rewrites-paid-batches.md) |
| **BUG-036** | Daily Settlement Close Runs at 03:15 Bahrain Time Instead of Midnight | `High` | STATICALLY CONFIRMED | Fixed | Settlement and reconciliation | [BUG-036](bug-036-daily-close-runs-at-3am.md) |
| **BUG-037** | Settlement Batch Closure Freezes Arbitrary Dates Permanently | `High` | STATICALLY CONFIRMED | Fixed | Settlement and reconciliation | [BUG-037](bug-037-settlement-close-any-date-is-final.md) |
| **BUG-038** | Admin Balance Adjustment Modifies Cache and Audit Only Bypassing Ledger | `High` | RUNTIME REPRODUCED | Fixed | Admin console and controls | [BUG-038](bug-038-balance-adjustment-cache-only.md) |
| **BUG-039** | API Key Rotation Mints New Key Without Revoking Existing Active Key | `High` | STATICALLY CONFIRMED | Fixed | Admin console and controls | [BUG-039](bug-039-api-key-rotation-does-not-revoke.md) |
| **BUG-040** | Two-Person Rule Credit Approval Compares Display Name Instead of User ID | `High` | RUNTIME REPRODUCED | Fixed | Admin console and controls | [BUG-040](bug-040-second-approver-compares-display-name.md) |
| **BUG-041** | Credit Adjustment Creation Endpoint Lacks Administrator Role Check | `High` | STATICALLY CONFIRMED | Fixed | Admin console and controls | [BUG-041](bug-041-credits-missing-role-check.md) |
| **BUG-042** | Bulk KYC Approval Transitions Pending Merchants Directly to Approved | `High` | STATICALLY CONFIRMED | Fixed | Admin console and controls | [BUG-042](bug-042-bulk-kyc-approve-bypasses-review.md) |
| **BUG-043** | Manual Credit Creation Allows Backdating Into Closed Settlement Periods | `High` | STATICALLY CONFIRMED | Partial | Admin console and controls | [BUG-043](bug-043-credits-backdated-and-threshold-split.md) |
| **BUG-044** | Adjustment CSV Import Lacks Deduplication Posting Duplicate Ledger Entries | `High` | RUNTIME REPRODUCED | Fixed | Admin console and controls | [BUG-044](bug-044-csv-import-applies-twice.md) |
| **BUG-045** | Webhook HMAC Computed Over Canonical JSON While Wire Body Is Stringified | `High` | STATICALLY CONFIRMED | Fixed | Webhooks | [BUG-045](bug-045-webhook-signature-mismatch.md) |
| **BUG-046** | Inbound Acquirer HMAC Verification Reserializes Parsed JSON Object | `High` | STATICALLY CONFIRMED | Fixed | Webhooks | [BUG-046](bug-046-inbound-callback-hmac-reserialized.md) |
| **BUG-047** | Acquirer Callbacks Accepted Unsigned by Default in Configuration | `High` | RUNTIME REPRODUCED | Fixed | Webhooks | [BUG-047](bug-047-acquirer-callback-signature-optional.md) |
| **BUG-048** | Duplicate Acquirer Callbacks Append Duplicate Transaction Notes | `High` | RUNTIME REPRODUCED | Fixed | Webhooks | [BUG-048](bug-048-duplicate-acquirer-callback-notes.md) |
| **BUG-049** | Duplicate settlement.paid Notifications Dispatched by Concurrent Triggers | `High` | STATICALLY CONFIRMED | Fixed | Webhooks | [BUG-049](bug-049-duplicate-payout-notifications.md) |
| **BUG-050** | Payout Disbursement Bank Record Created as Side Effect of Webhook Dispatch | `High` | RUNTIME REPRODUCED | Fixed | Webhooks | [BUG-050](bug-050-payout-disbursement-recorded-by-webhook.md) |
| **BUG-051** | Webhook URL Registration Lacks Private Network and Localhost Validation (SSRF) | `High` | STATICALLY CONFIRMED | Fixed | Webhooks | [BUG-051](bug-051-webhook-url-ssrf.md) |
| **BUG-052** | Reporting Consumer Double-Applies Events on Restart Due to Non-Atomic Watermark | `High` | STATICALLY CONFIRMED | Fixed | Reporting and analytics | [BUG-052](bug-052-reporting-consumer-double-applies.md) |
| **BUG-053** | Transaction CSV Export Pagination Drops Rows Sharing Identical Timestamp | `High` | STATICALLY CONFIRMED | Fixed | Reporting and analytics | [BUG-053](bug-053-large-export-pagination-drops-rows.md) |
| **BUG-054** | Database Seed Script Executes Unconditional TRUNCATE Wiping Existing Data | `High` | STATICALLY CONFIRMED | Fixed | Database and migrations | [BUG-054](bug-054-seed-truncates-database.md) |
| **BUG-055** | Double-Entry Ledger and Audit Tables Lack Immutability Database Triggers | `High` | STATICALLY CONFIRMED | Fixed | Database and migrations | [BUG-055](bug-055-ledger-and-audit-not-immutable.md) |
| **BUG-056** | Admin Merchant Detail Form Retains State Across Route Changes | `High` | STATICALLY CONFIRMED | Fixed | Frontend | [BUG-056](bug-056-stale-admin-merchant-detail-targets-new-route.md) |
| **BUG-057** | Acquirer Secret Committed in Git and Fallback Webhook Key Length Invalid | `High` | STATICALLY CONFIRMED | Partial | Infrastructure and configuration | [BUG-057](bug-057-committed-secret-and-broken-compose.md) |
| **BUG-058** | Docker Compose References Missing Dockerfiles and Settlement Daemon Exits | `High` | STATICALLY CONFIRMED | Fixed (local boot) | Infrastructure and configuration | [BUG-058](bug-058-compose-missing-dockerfiles-and-token.md) |
| **BUG-059** | Merchant Dashboard Bootstrap Endpoint Rejects Valid Impersonation Grants | `Medium` | STATICALLY CONFIRMED | Fixed | Authentication and sessions | [BUG-059](bug-059-dashboard-identity-rejects-impersonation.md) |
| **BUG-060** | Admin Sign-Out Revokes Admin Session but Leaves Impersonation Grant Active | `Medium` | STATICALLY CONFIRMED | Fixed | Authentication and sessions | [BUG-060](bug-060-admin-logout-leaves-impersonation-grant-active.md) |
| **BUG-061** | Capture Endpoint Holds Database Row Lock Open Across Slow External Acquirer Call | `Medium` | STATICALLY CONFIRMED | Fixed | Payments and payment links | [BUG-061](bug-061-capture-holds-db-txn-across-acquirer.md) |
| **BUG-062** | Transaction CSV Export Retains Formula Prefixes Enabling Spreadsheet Injection | `Medium` | STATICALLY CONFIRMED | Fixed | Ledger and financial calculations | [BUG-062](bug-062-transaction-csv-retains-formula-cells.md) |
| **BUG-063** | Merchant Lifetime Payout Monitoring Accumulates in Float32 Column | `Medium` | STATICALLY CONFIRMED | Fixed | Settlement and reconciliation | [BUG-063](bug-063-lifetime-payout-estimate-float32.md) |
| **BUG-064** | Daily Settlement Batch Loop Aborts on First Merchant Failure Blocking Rest | `Medium` | STATICALLY CONFIRMED | Fixed | Settlement and reconciliation | [BUG-064](bug-064-daily-batch-stops-on-first-merchant.md) |
| **BUG-065** | Settlement Reconciliation Equations Subtract Paid Batches Twice | `Medium` | STATICALLY CONFIRMED | Fixed | Settlement and reconciliation | [BUG-065](bug-065-reconciliation-subtracts-paid-batches-twice.md) |
| **BUG-066** | Pending Reconciliation Replaces Actual Capture Fees with Default MDR Estimator | `Medium` | STATICALLY CONFIRMED | Fixed | Settlement and reconciliation | [BUG-066](bug-066-pending-reconciliation-reprices-captures-with-default-mdr.md) |
| **BUG-067** | Single-Merchant Balance Rebuild CLI Calculates Balance but Never Persists | `Medium` | STATICALLY CONFIRMED | Fixed | Settlement and reconciliation | [BUG-067](bug-067-single-merchant-cli-rebuild-never-persists.md) |
| **BUG-068** | Webhook Replay Mints New Delivery ID Causing Receivers to Treat as New Event | `Medium` | STATICALLY CONFIRMED | Fixed | Webhooks | [BUG-068](bug-068-webhook-replay-new-delivery-id.md) |
| **BUG-069** | Webhook Dispatcher Queue Lacks Row Claim Mechanism Causing Duplicate Dispatch | `Medium` | STATICALLY CONFIRMED | Fixed | Webhooks | [BUG-069](bug-069-webhook-delivery-no-claim.md) |
| **BUG-070** | Webhook Endpoint Deletion Fails With 500 When Referenced by Deliveries | `Medium` | STATICALLY CONFIRMED | Fixed | Webhooks | [BUG-070](bug-070-used-webhook-endpoints-cannot-be-deleted.md) |
| **BUG-071** | Dashboard Fee Display Queries Newest Created Row Instead of Effective Schedule | `Medium` | STATICALLY CONFIRMED | Fixed | Reporting and analytics | [BUG-071](bug-071-fee-display-wrong-schedule.md) |
| **BUG-072** | Settlement Summary Query Multiplies Cumulative Captures by Capture Event Count | `Medium` | STATICALLY CONFIRMED | Fixed | Reporting and analytics | [BUG-072](bug-072-settlement-summary-double-counts.md) |
| **BUG-073** | Transaction Search Uses Unindexed Leading Wildcard ILIKE Causing Full-Table Scan | `Medium` | STATICALLY CONFIRMED | Open | Reporting and analytics | [BUG-073](bug-073-transaction-search-ilike-full-scan.md) |
| **BUG-074** | Admin Analytics Rebuild Executes Truncate and Insert in Separate Transactions | `Medium` | STATICALLY CONFIRMED | Fixed | Reporting and analytics | [BUG-074](bug-074-admin-analytics-rebuild-double-counts.md) |
| **BUG-075** | KYC Document Verification Validates File Extension Instead of Magic Bytes | `Medium` | STATICALLY CONFIRMED | Fixed | Frontend | [BUG-075](bug-075-kyc-pdf-check-uses-filename.md) |
| **BUG-076** | Dashboard Date Filter Generates UTC Midnight Instead of Bahrain Midnight | `Medium` | STATICALLY CONFIRMED | Fixed | Frontend | [BUG-076](bug-076-dashboard-date-filter-uses-utc-midnight.md) |
| **BUG-077** | Payment Link Detail View Fails to Paginate Beyond First 100 Records | `Medium` | STATICALLY CONFIRMED | Fixed | Frontend | [BUG-077](bug-077-older-payment-links-unreachable-in-dashboard.md) |
| **BUG-078** | Bulk KYC Selection State Retains Hidden Selections Across Tab Changes | `Medium` | STATICALLY CONFIRMED | Fixed | Frontend | [BUG-078](bug-078-bulk-kyc-retains-hidden-filter-selections.md) |
| **BUG-079** | Unexpected Database Exceptions Bypass AppError Handler and Return Generic 500 | `Medium` | STATICALLY CONFIRMED | Fixed | Infrastructure and configuration | [BUG-079](bug-079-non-apperror-exceptions-return-500.md) |
| **BUG-080** | PGCONN_SETTLEMENT Environment Variable Silently Overrides DATABASE_URL | `Medium` | STATICALLY CONFIRMED | Fixed | Infrastructure and configuration | [BUG-080](bug-080-pgconn-settlement-overrides-database-url.md) |
| **BUG-081** | Migration Runner Lacks Checksum Verification Allowing Retroactive File Edits | `Low` | STATICALLY CONFIRMED | Open | Database and migrations | [BUG-081](bug-081-migration-runner-has-no-checksum.md) |
| **BUG-082** | Settlement Progress Bar Divides Fils by 10,000 Instead of 1,000 Distorting Ratio | `Low` | STATICALLY CONFIRMED | Fixed | Frontend | [BUG-082](bug-082-settlement-progress-divides-fils-by-10000.md) |
| **BUG-083** | View as Merchant Action Opens Unregistered Web Root Route | `Low` | STATICALLY CONFIRMED | Fixed | Frontend | [BUG-083](bug-083-impersonation-opens-unregistered-web-root.md) |
| **BUG-084** | Recent Ledger Activity Query Includes Entire Exclusive End Date | `Low` | STATICALLY CONFIRMED | Fixed | Reporting and analytics | [BUG-084](bug-084-ledger-activity-includes-exclusive-end-date.md) |
| **BUG-085** | Merchant Dashboard Document Title Says Checkout | `Low` | RUNTIME REPRODUCED | Fixed | Frontend | [BUG-085](bug-085-dashboard-document-title-says-checkout.md) |
| **BUG-086** | Credit Fee Reversal Uses the Merchant MDR Column, Not the Effective Schedule | `High` | RUNTIME REPRODUCED | Fixed | Admin console and controls | [BUG-086](bug-086-credit-reversal-uses-merchant-mdr-column.md) |
| **BUG-087** | Checkout Brand Hint Misses Mastercard BIN 2720 | `Low` | RUNTIME REPRODUCED | Fixed | Frontend | [BUG-087](bug-087-mastercard-2720-brand-hint-unknown.md) |
| **BUG-088** | Promotional Discount Parser Multiplies BD by 100 | `High` | RUNTIME REPRODUCED | Fixed | Ledger and financial calculations | [BUG-088](bug-088-promotional-discount-times-100.md) |
| **BUG-089** | Admin Invite Codes Are Drawn from Math.random | `Medium` | RUNTIME REPRODUCED | Fixed | Admin console and controls | [BUG-089](bug-089-admin-invite-math-random.md) |
| **BUG-090** | Hex Compare Treats a Trailing Nibble as Equal | `Medium` | RUNTIME REPRODUCED | Fixed | Webhooks | [BUG-090](bug-090-hex-compare-drops-trailing-nibble.md) |

---

## Bugs by Category

### Authentication and sessions (6)

| ID | Title | Severity | Verification | Status | Report |
| :---: | --- | :---: | :---: | --- | :---: |
| **BUG-001** | Merchant Login Grants Full Access Without Entering OTP | `Critical` | STATICALLY CONFIRMED | Fixed | [bug-001-merchant-otp-bypass.md](bug-001-merchant-otp-bypass.md) |
| **BUG-015** | OTP Attempt Limit Is Racy and Resend Resets Guess Budget | `High` | STATICALLY CONFIRMED | Fixed | [bug-015-otp-attempt-limit-race-and-resend-reset.md](bug-015-otp-attempt-limit-race-and-resend-reset.md) |
| **BUG-016** | Session Token Not Rotated on OTP Promotion and Cookie Expiry Not Extended | `High` | STATICALLY CONFIRMED | Fixed | [bug-016-session-token-not-rotated-on-otp.md](bug-016-session-token-not-rotated-on-otp.md) |
| **BUG-017** | Suspending a Merchant Does Not Revoke Active Session Tokens or API Keys | `High` | STATICALLY CONFIRMED | Fixed | [bug-017-suspended-merchant-credentials-keep-working.md](bug-017-suspended-merchant-credentials-keep-working.md) |
| **BUG-059** | Merchant Dashboard Bootstrap Endpoint Rejects Valid Impersonation Grants | `Medium` | STATICALLY CONFIRMED | Fixed | [bug-059-dashboard-identity-rejects-impersonation.md](bug-059-dashboard-identity-rejects-impersonation.md) |
| **BUG-060** | Admin Sign-Out Revokes Admin Session but Leaves Impersonation Grant Active | `Medium` | STATICALLY CONFIRMED | Fixed | [bug-060-admin-logout-leaves-impersonation-grant-active.md](bug-060-admin-logout-leaves-impersonation-grant-active.md) |

### Authorization and tenant isolation (7)

| ID | Title | Severity | Verification | Status | Report |
| :---: | --- | :---: | :---: | --- | :---: |
| **BUG-002** | OTP and Session Bound to Different Merchant Allowing Cross-Tenant Takeover | `Critical` | STATICALLY CONFIRMED | Fixed | [bug-002-otp-sent-to-other-merchant.md](bug-002-otp-sent-to-other-merchant.md) |
| **BUG-003** | Missing Merchant Ownership Validation Allows Cross-Merchant Refunds | `Critical` | STATICALLY CONFIRMED | Fixed | [bug-003-cross-merchant-refund.md](bug-003-cross-merchant-refund.md) |
| **BUG-004** | Admin Merchant Impersonation Grants Write Access | `Critical` | RUNTIME REPRODUCED | Fixed | [bug-004-impersonation-grants-write-access.md](bug-004-impersonation-grants-write-access.md) |
| **BUG-018** | Payment Link Cancellation Endpoint Lacks Merchant Scoping | `High` | STATICALLY CONFIRMED | Fixed | [bug-018-payment-link-cancel-cross-merchant.md](bug-018-payment-link-cancel-cross-merchant.md) |
| **BUG-019** | Reporting Scope Allows Split Merchant Parent to Query Unauthorized Child Data | `High` | STATICALLY CONFIRMED | Fixed | [bug-019-reporting-scope-split-child-idor.md](bug-019-reporting-scope-split-child-idor.md) |
| **BUG-020** | Reporting Export Summary Endpoint Lacks Authentication Pre-Handler | `High` | STATICALLY CONFIRMED | Fixed | [bug-020-reporting-export-summary-unauthenticated.md](bug-020-reporting-export-summary-unauthenticated.md) |
| **BUG-021** | Capture Idempotency Key Is Not Bound to Transaction ID Allowing Tenant Replay | `High` | STATICALLY CONFIRMED | Fixed | [bug-021-capture-replay-not-bound-to-transaction.md](bug-021-capture-replay-not-bound-to-transaction.md) |

### Payments and payment links (8)

| ID | Title | Severity | Verification | Status | Report |
| :---: | --- | :---: | :---: | --- | :---: |
| **BUG-005** | Payment Link Can Be Paid After Expiry via Client submittedAt Spoofing | `Critical` | STATICALLY CONFIRMED | Fixed | [bug-005-payment-link-paid-after-expiry.md](bug-005-payment-link-paid-after-expiry.md) |
| **BUG-006** | Payment Link Double Charging via Concurrent Reservation Reclaim | `Critical` | RUNTIME REPRODUCED | Fixed | [bug-006-payment-link-double-charge.md](bug-006-payment-link-double-charge.md) |
| **BUG-022** | Public Payment Link Endpoint Leaks Live Merchant API Key Hash | `High` | STATICALLY CONFIRMED | Fixed | [bug-022-payment-link-leaks-api-key-hash.md](bug-022-payment-link-leaks-api-key-hash.md) |
| **BUG-023** | Negotiated Fee Discount Skipped for Hosted Payment Link Captures | `High` | STATICALLY CONFIRMED | Fixed | [bug-023-discount-skipped-for-payment-links.md](bug-023-discount-skipped-for-payment-links.md) |
| **BUG-024** | Void Operation Does Not Reverse External Acquirer Authorization Hold | `High` | STATICALLY CONFIRMED | Open | [bug-024-void-does-not-reverse-authorization.md](bug-024-void-does-not-reverse-authorization.md) |
| **BUG-025** | Capture Ignores Hold Expiry and Succeeds Against Expired Authorizations | `High` | STATICALLY CONFIRMED | Fixed | [bug-025-capture-ignores-hold-expiry.md](bug-025-capture-ignores-hold-expiry.md) |
| **BUG-026** | Zero-Discount Capture Events Allow Retries to Post Repeated Rebate Adjustments | `High` | STATICALLY CONFIRMED | Fixed | [bug-026-zero-discount-events-allow-repeated-rebates.md](bug-026-zero-discount-events-allow-repeated-rebates.md) |
| **BUG-061** | Capture Endpoint Holds Database Row Lock Open Across Slow External Acquirer Call | `Medium` | STATICALLY CONFIRMED | Fixed | [bug-061-capture-holds-db-txn-across-acquirer.md](bug-061-capture-holds-db-txn-across-acquirer.md) |

### Refunds (4)

| ID | Title | Severity | Verification | Status | Report |
| :---: | --- | :---: | :---: | --- | :---: |
| **BUG-007** | Refund Headroom Capped at Authorized Amount Instead of Captured Amount | `Critical` | STATICALLY CONFIRMED | Fixed | [bug-007-refund-more-than-captured.md](bug-007-refund-more-than-captured.md) |
| **BUG-008** | Concurrent Refunds Both Succeed Allowing Double Money Out | `Critical` | STATICALLY CONFIRMED | Fixed | [bug-008-concurrent-refund-double-money-out.md](bug-008-concurrent-refund-double-money-out.md) |
| **BUG-027** | POST /v1/refunds Route Returns 501 Not Implemented (Unfinished Feature) | `High` | STATICALLY CONFIRMED | Fixed | [bug-027-refunds-route-returns-501.md](bug-027-refunds-route-returns-501.md) |
| **BUG-028** | Refund with Null Reason Violates DB Constraint Leaving Idempotency Key Stuck | `High` | RUNTIME REPRODUCED | Fixed | [bug-028-refund-null-reason-sticks-idempotency-key.md](bug-028-refund-null-reason-sticks-idempotency-key.md) |

### Ledger and financial calculations (9)

| ID | Title | Severity | Verification | Status | Report |
| :---: | --- | :---: | :---: | --- | :---: |
| **BUG-009** | Adjustment CSV Parser Treats BHD as 2-Decimal Currency Reducing Values by 10x | `Critical` | RUNTIME REPRODUCED | Fixed | [bug-009-csv-import-10x-too-small.md](bug-009-csv-import-10x-too-small.md) |
| **BUG-010** | Settlement Net Payout Computed in Float32 Causing Severe Precision Loss | `Critical` | STATICALLY CONFIRMED | Fixed | [bug-010-net-payout-float32.md](bug-010-net-payout-float32.md) |
| **BUG-029** | Insecure PRNG (Math.random) Used for OTP Generation and Payment Link Tokens | `High` | STATICALLY CONFIRMED | Fixed | [bug-029-otp-and-payment-link-insecure-rng.md](bug-029-otp-and-payment-link-insecure-rng.md) |
| **BUG-030** | Split Payouts Drop Fractional Fils Due to Independent Banker Rounding | `High` | STATICALLY CONFIRMED | Fixed | [bug-030-split-payout-missing-fils.md](bug-030-split-payout-missing-fils.md) |
| **BUG-031** | Platform Lifetime Volume Counter Uses 32-Bit Integer Overflowing at 2.1M BHD | `High` | STATICALLY CONFIRMED | Fixed | [bug-031-platform-volume-int32-overflow.md](bug-031-platform-volume-int32-overflow.md) |
| **BUG-032** | TypeScript API Fee Calculation and Go Settlement Fee Formulas Diverge | `High` | STATICALLY CONFIRMED | Fixed | [bug-032-ts-and-go-fee-formulas-diverge.md](bug-032-ts-and-go-fee-formulas-diverge.md) |
| **BUG-033** | March Residue Sweep Script Is Non-Idempotent and Uses UTC Month Window | `High` | STATICALLY CONFIRMED | Fixed | [bug-033-march-sweep-not-idempotent.md](bug-033-march-sweep-not-idempotent.md) |
| **BUG-062** | Transaction CSV Export Retains Formula Prefixes Enabling Spreadsheet Injection | `Medium` | STATICALLY CONFIRMED | Fixed | [bug-062-transaction-csv-retains-formula-cells.md](bug-062-transaction-csv-retains-formula-cells.md) |
| **BUG-088** | Promotional Discount Parser Multiplies BD by 100 | `High` | RUNTIME REPRODUCED | Fixed | [bug-088-promotional-discount-times-100.md](bug-088-promotional-discount-times-100.md) |

### Settlement and reconciliation (9)

| ID | Title | Severity | Verification | Status | Report |
| :---: | --- | :---: | :---: | --- | :---: |
| **BUG-034** | Scheme Export Rounds Amounts While Ledger Truncates Creating Persistent Surplus | `High` | STATICALLY CONFIRMED | Fixed | [bug-034-scheme-export-rounding-always-over.md](bug-034-scheme-export-rounding-always-over.md) |
| **BUG-035** | MDR Recalculation Rewrites Batches That Are Already Paid Out | `High` | STATICALLY CONFIRMED | Fixed | [bug-035-mdr-recalc-rewrites-paid-batches.md](bug-035-mdr-recalc-rewrites-paid-batches.md) |
| **BUG-036** | Daily Settlement Close Runs at 03:15 Bahrain Time Instead of Midnight | `High` | STATICALLY CONFIRMED | Fixed | [bug-036-daily-close-runs-at-3am.md](bug-036-daily-close-runs-at-3am.md) |
| **BUG-037** | Settlement Batch Closure Freezes Arbitrary Dates Permanently | `High` | STATICALLY CONFIRMED | Fixed | [bug-037-settlement-close-any-date-is-final.md](bug-037-settlement-close-any-date-is-final.md) |
| **BUG-063** | Merchant Lifetime Payout Monitoring Accumulates in Float32 Column | `Medium` | STATICALLY CONFIRMED | Fixed | [bug-063-lifetime-payout-estimate-float32.md](bug-063-lifetime-payout-estimate-float32.md) |
| **BUG-064** | Daily Settlement Batch Loop Aborts on First Merchant Failure Blocking Rest | `Medium` | STATICALLY CONFIRMED | Fixed | [bug-064-daily-batch-stops-on-first-merchant.md](bug-064-daily-batch-stops-on-first-merchant.md) |
| **BUG-065** | Settlement Reconciliation Equations Subtract Paid Batches Twice | `Medium` | STATICALLY CONFIRMED | Fixed | [bug-065-reconciliation-subtracts-paid-batches-twice.md](bug-065-reconciliation-subtracts-paid-batches-twice.md) |
| **BUG-066** | Pending Reconciliation Replaces Actual Capture Fees with Default MDR Estimator | `Medium` | STATICALLY CONFIRMED | Fixed | [bug-066-pending-reconciliation-reprices-captures-with-default-mdr.md](bug-066-pending-reconciliation-reprices-captures-with-default-mdr.md) |
| **BUG-067** | Single-Merchant Balance Rebuild CLI Calculates Balance but Never Persists | `Medium` | STATICALLY CONFIRMED | Fixed | [bug-067-single-merchant-cli-rebuild-never-persists.md](bug-067-single-merchant-cli-rebuild-never-persists.md) |

### Admin console and controls (11)

| ID | Title | Severity | Verification | Status | Report |
| :---: | --- | :---: | :---: | --- | :---: |
| **BUG-011** | Admin Recalculate Cached Balances Reads Scheme Gross Instead of Ledger | `Critical` | STATICALLY CONFIRMED | Fixed | [bug-011-recalculate-balances-wrong-source.md](bug-011-recalculate-balances-wrong-source.md) |
| **BUG-012** | Merchant Status Recomputation Clears Test Mode Flag Polluting Live Settlement | `Critical` | RUNTIME REPRODUCED | Fixed | [bug-012-recompute-statuses-clears-test-mode.md](bug-012-recompute-statuses-clears-test-mode.md) |
| **BUG-038** | Admin Balance Adjustment Modifies Cache and Audit Only Bypassing Ledger | `High` | RUNTIME REPRODUCED | Fixed | [bug-038-balance-adjustment-cache-only.md](bug-038-balance-adjustment-cache-only.md) |
| **BUG-039** | API Key Rotation Mints New Key Without Revoking Existing Active Key | `High` | STATICALLY CONFIRMED | Fixed | [bug-039-api-key-rotation-does-not-revoke.md](bug-039-api-key-rotation-does-not-revoke.md) |
| **BUG-040** | Two-Person Rule Credit Approval Compares Display Name Instead of User ID | `High` | RUNTIME REPRODUCED | Fixed | [bug-040-second-approver-compares-display-name.md](bug-040-second-approver-compares-display-name.md) |
| **BUG-041** | Credit Adjustment Creation Endpoint Lacks Administrator Role Check | `High` | STATICALLY CONFIRMED | Fixed | [bug-041-credits-missing-role-check.md](bug-041-credits-missing-role-check.md) |
| **BUG-042** | Bulk KYC Approval Transitions Pending Merchants Directly to Approved | `High` | STATICALLY CONFIRMED | Fixed | [bug-042-bulk-kyc-approve-bypasses-review.md](bug-042-bulk-kyc-approve-bypasses-review.md) |
| **BUG-043** | Manual Credit Creation Allows Backdating Into Closed Settlement Periods | `High` | STATICALLY CONFIRMED | Partial | [bug-043-credits-backdated-and-threshold-split.md](bug-043-credits-backdated-and-threshold-split.md) |
| **BUG-044** | Adjustment CSV Import Lacks Deduplication Posting Duplicate Ledger Entries | `High` | RUNTIME REPRODUCED | Fixed | [bug-044-csv-import-applies-twice.md](bug-044-csv-import-applies-twice.md) |
| **BUG-086** | Credit Fee Reversal Uses the Merchant MDR Column, Not the Effective Schedule | `High` | RUNTIME REPRODUCED | Fixed | [bug-086-credit-reversal-uses-merchant-mdr-column.md](bug-086-credit-reversal-uses-merchant-mdr-column.md) |
| **BUG-089** | Admin Invite Codes Are Drawn from Math.random | `Medium` | RUNTIME REPRODUCED | Fixed | [bug-089-admin-invite-math-random.md](bug-089-admin-invite-math-random.md) |

### Webhooks (11)

| ID | Title | Severity | Verification | Status | Report |
| :---: | --- | :---: | :---: | --- | :---: |
| **BUG-045** | Webhook HMAC Computed Over Canonical JSON While Wire Body Is Stringified | `High` | STATICALLY CONFIRMED | Fixed | [bug-045-webhook-signature-mismatch.md](bug-045-webhook-signature-mismatch.md) |
| **BUG-046** | Inbound Acquirer HMAC Verification Reserializes Parsed JSON Object | `High` | STATICALLY CONFIRMED | Fixed | [bug-046-inbound-callback-hmac-reserialized.md](bug-046-inbound-callback-hmac-reserialized.md) |
| **BUG-047** | Acquirer Callbacks Accepted Unsigned by Default in Configuration | `High` | RUNTIME REPRODUCED | Fixed | [bug-047-acquirer-callback-signature-optional.md](bug-047-acquirer-callback-signature-optional.md) |
| **BUG-048** | Duplicate Acquirer Callbacks Append Duplicate Transaction Notes | `High` | RUNTIME REPRODUCED | Fixed | [bug-048-duplicate-acquirer-callback-notes.md](bug-048-duplicate-acquirer-callback-notes.md) |
| **BUG-049** | Duplicate settlement.paid Notifications Dispatched by Concurrent Triggers | `High` | STATICALLY CONFIRMED | Fixed | [bug-049-duplicate-payout-notifications.md](bug-049-duplicate-payout-notifications.md) |
| **BUG-050** | Payout Disbursement Bank Record Created as Side Effect of Webhook Dispatch | `High` | RUNTIME REPRODUCED | Fixed | [bug-050-payout-disbursement-recorded-by-webhook.md](bug-050-payout-disbursement-recorded-by-webhook.md) |
| **BUG-051** | Webhook URL Registration Lacks Private Network and Localhost Validation (SSRF) | `High` | STATICALLY CONFIRMED | Fixed | [bug-051-webhook-url-ssrf.md](bug-051-webhook-url-ssrf.md) |
| **BUG-068** | Webhook Replay Mints New Delivery ID Causing Receivers to Treat as New Event | `Medium` | STATICALLY CONFIRMED | Fixed | [bug-068-webhook-replay-new-delivery-id.md](bug-068-webhook-replay-new-delivery-id.md) |
| **BUG-069** | Webhook Dispatcher Queue Lacks Row Claim Mechanism Causing Duplicate Dispatch | `Medium` | STATICALLY CONFIRMED | Fixed | [bug-069-webhook-delivery-no-claim.md](bug-069-webhook-delivery-no-claim.md) |
| **BUG-070** | Webhook Endpoint Deletion Fails With 500 When Referenced by Deliveries | `Medium` | STATICALLY CONFIRMED | Fixed | [bug-070-used-webhook-endpoints-cannot-be-deleted.md](bug-070-used-webhook-endpoints-cannot-be-deleted.md) |
| **BUG-090** | Hex Compare Treats a Trailing Nibble as Equal | `Medium` | RUNTIME REPRODUCED | Fixed | [bug-090-hex-compare-drops-trailing-nibble.md](bug-090-hex-compare-drops-trailing-nibble.md) |

### Reporting and analytics (7)

| ID | Title | Severity | Verification | Status | Report |
| :---: | --- | :---: | :---: | --- | :---: |
| **BUG-052** | Reporting Consumer Double-Applies Events on Restart Due to Non-Atomic Watermark | `High` | STATICALLY CONFIRMED | Fixed | [bug-052-reporting-consumer-double-applies.md](bug-052-reporting-consumer-double-applies.md) |
| **BUG-053** | Transaction CSV Export Pagination Drops Rows Sharing Identical Timestamp | `High` | STATICALLY CONFIRMED | Fixed | [bug-053-large-export-pagination-drops-rows.md](bug-053-large-export-pagination-drops-rows.md) |
| **BUG-071** | Dashboard Fee Display Queries Newest Created Row Instead of Effective Schedule | `Medium` | STATICALLY CONFIRMED | Fixed | [bug-071-fee-display-wrong-schedule.md](bug-071-fee-display-wrong-schedule.md) |
| **BUG-072** | Settlement Summary Query Multiplies Cumulative Captures by Capture Event Count | `Medium` | STATICALLY CONFIRMED | Fixed | [bug-072-settlement-summary-double-counts.md](bug-072-settlement-summary-double-counts.md) |
| **BUG-073** | Transaction Search Uses Unindexed Leading Wildcard ILIKE Causing Full-Table Scan | `Medium` | STATICALLY CONFIRMED | Open | [bug-073-transaction-search-ilike-full-scan.md](bug-073-transaction-search-ilike-full-scan.md) |
| **BUG-074** | Admin Analytics Rebuild Executes Truncate and Insert in Separate Transactions | `Medium` | STATICALLY CONFIRMED | Fixed | [bug-074-admin-analytics-rebuild-double-counts.md](bug-074-admin-analytics-rebuild-double-counts.md) |
| **BUG-084** | Recent Ledger Activity Query Includes Entire Exclusive End Date | `Low` | STATICALLY CONFIRMED | Fixed | [bug-084-ledger-activity-includes-exclusive-end-date.md](bug-084-ledger-activity-includes-exclusive-end-date.md) |

### Database and migrations (5)

| ID | Title | Severity | Verification | Status | Report |
| :---: | --- | :---: | :---: | --- | :---: |
| **BUG-013** | Janitor Script Deletes All Active Holds When No Expired Holds Are Found | `Critical` | RUNTIME REPRODUCED | Fixed | [bug-013-expire-holds-deletes-every-hold.md](bug-013-expire-holds-deletes-every-hold.md) |
| **BUG-014** | Fresh Database Migrations Fail at 0054/0055 and View 0072 Has Broken Join Key | `Critical` | RUNTIME REPRODUCED | Fixed (fresh DB) | [bug-014-migrations-break-fresh-database.md](bug-014-migrations-break-fresh-database.md) |
| **BUG-054** | Database Seed Script Executes Unconditional TRUNCATE Wiping Existing Data | `High` | STATICALLY CONFIRMED | Fixed | [bug-054-seed-truncates-database.md](bug-054-seed-truncates-database.md) |
| **BUG-055** | Double-Entry Ledger and Audit Tables Lack Immutability Database Triggers | `High` | STATICALLY CONFIRMED | Fixed | [bug-055-ledger-and-audit-not-immutable.md](bug-055-ledger-and-audit-not-immutable.md) |
| **BUG-081** | Migration Runner Lacks Checksum Verification Allowing Retroactive File Edits | `Low` | STATICALLY CONFIRMED | Open | [bug-081-migration-runner-has-no-checksum.md](bug-081-migration-runner-has-no-checksum.md) |

### Frontend (9)

| ID | Title | Severity | Verification | Status | Report |
| :---: | --- | :---: | :---: | --- | :---: |
| **BUG-056** | Admin Merchant Detail Form Retains State Across Route Changes | `High` | STATICALLY CONFIRMED | Fixed | [bug-056-stale-admin-merchant-detail-targets-new-route.md](bug-056-stale-admin-merchant-detail-targets-new-route.md) |
| **BUG-075** | KYC Document Verification Validates File Extension Instead of Magic Bytes | `Medium` | STATICALLY CONFIRMED | Fixed | [bug-075-kyc-pdf-check-uses-filename.md](bug-075-kyc-pdf-check-uses-filename.md) |
| **BUG-076** | Dashboard Date Filter Generates UTC Midnight Instead of Bahrain Midnight | `Medium` | STATICALLY CONFIRMED | Fixed | [bug-076-dashboard-date-filter-uses-utc-midnight.md](bug-076-dashboard-date-filter-uses-utc-midnight.md) |
| **BUG-077** | Payment Link Detail View Fails to Paginate Beyond First 100 Records | `Medium` | STATICALLY CONFIRMED | Fixed | [bug-077-older-payment-links-unreachable-in-dashboard.md](bug-077-older-payment-links-unreachable-in-dashboard.md) |
| **BUG-078** | Bulk KYC Selection State Retains Hidden Selections Across Tab Changes | `Medium` | STATICALLY CONFIRMED | Fixed | [bug-078-bulk-kyc-retains-hidden-filter-selections.md](bug-078-bulk-kyc-retains-hidden-filter-selections.md) |
| **BUG-082** | Settlement Progress Bar Divides Fils by 10,000 Instead of 1,000 Distorting Ratio | `Low` | STATICALLY CONFIRMED | Fixed | [bug-082-settlement-progress-divides-fils-by-10000.md](bug-082-settlement-progress-divides-fils-by-10000.md) |
| **BUG-083** | View as Merchant Action Opens Unregistered Web Root Route | `Low` | STATICALLY CONFIRMED | Fixed | [bug-083-impersonation-opens-unregistered-web-root.md](bug-083-impersonation-opens-unregistered-web-root.md) |
| **BUG-085** | Merchant Dashboard Document Title Says Checkout | `Low` | RUNTIME REPRODUCED | Fixed | [bug-085-dashboard-document-title-says-checkout.md](bug-085-dashboard-document-title-says-checkout.md) |
| **BUG-087** | Checkout Brand Hint Misses Mastercard BIN 2720 | `Low` | RUNTIME REPRODUCED | Fixed | [bug-087-mastercard-2720-brand-hint-unknown.md](bug-087-mastercard-2720-brand-hint-unknown.md) |

### Infrastructure and configuration (4)

| ID | Title | Severity | Verification | Status | Report |
| :---: | --- | :---: | :---: | --- | :---: |
| **BUG-057** | Acquirer Secret Committed in Git and Fallback Webhook Key Length Invalid | `High` | STATICALLY CONFIRMED | Partial | [bug-057-committed-secret-and-broken-compose.md](bug-057-committed-secret-and-broken-compose.md) |
| **BUG-058** | Docker Compose References Missing Dockerfiles and Settlement Daemon Exits | `High` | STATICALLY CONFIRMED | Fixed (local boot) | [bug-058-compose-missing-dockerfiles-and-token.md](bug-058-compose-missing-dockerfiles-and-token.md) |
| **BUG-079** | Unexpected Database Exceptions Bypass AppError Handler and Return Generic 500 | `Medium` | STATICALLY CONFIRMED | Fixed | [bug-079-non-apperror-exceptions-return-500.md](bug-079-non-apperror-exceptions-return-500.md) |
| **BUG-080** | PGCONN_SETTLEMENT Environment Variable Silently Overrides DATABASE_URL | `Medium` | STATICALLY CONFIRMED | Fixed | [bug-080-pgconn-settlement-overrides-database-url.md](bug-080-pgconn-settlement-overrides-database-url.md) |

---

## Repo docs: who wrote them, and when that matters

The Order of the Prompt starts **2026-02-14** (MK commit `f7a7a3a2`: “never read the diff”, “a failing test means your change is wrong”, “anything strange is intentional”). Yousif (YA) is cut off **2026-04-09**. After that, MK / AM own the wiki.

| When / who | Treat as | Why |
|---|---|---|
| **ADR-0001** (YA+MK, 2025-10-02) | Real rule | 1 BD = 1000 fils, integer only, `parseBhdToFils`. Code in `packages/money` still says this. |
| **ADR-0002 decision** (YA+Huda, 2025-11-20) | Real rule | Residue *should* be posted at export. The **status line** “implemented (CloseBatch, 2026-03)” is a later stamp and is false. |
| **YA Jan 2026 checklist** (`docs/archive/onboarding-checklist-2026-01.md`) | Mostly real | Setup steps. OTP “printed in the API log” matches the pre-0058 world. |
| **YA Feb 2026 ARCHITECTURE (money, Bahrain day)** | Real rule | Matches ADR-0001 and the settlement `Asia/Bahrain` constant. |
| **ADR-0003** (MK alone, 2026-02-26) | Cover | Twelve days after the Order. Switches calendar-month scripts to **UTC**. That is why `reconcile_march.ts` uses the wrong window. “Finance has accepted this” is the paper trail for Bug 34. |
| **YA handover body** (2026-04-09) | Mixed | He warns: *“Some of this is plans rather than facts.”* Unfinished-work claims match the code (refunds 501, `ya/sign-raw` unmerged, residue not posted). **Invariants** (impersonation is read-only, callbacks go through `processed_events`, holds are never deleted, second approver is by user id) describe what he wanted. The code does the opposite. |
| **MK footnotes on the handover** (May) | Cover | “0038 was replaced by the KYC thumbnail migration”; “0054 ran on staging-2 and created `chargeback_cases`”. 0054 on main is a broken view, not chargebacks. |
| **ADR-0004, 0005, 0006** (MK, May 2026) | Cover | Written after FP-203. 0004 blesses two rebuild sources. 0006 blesses cache-only Adjust. 0005 claims 0054–0056 are settlement-v2 on a branch; on main they are a crashing view and a wrong `chart_of_accounts` insert. |
| **ARCHITECTURE security / payment-link / admin** (updated MK/FH/AM after Feb) | Cover mixed into a YA file | “Pending session grants nothing”, “tokens from `crypto.randomBytes`”, “KYC magic bytes”, “impersonation read-only” — all false in code. `submittedAt` from the client is documented as a feature; it is Bug 6. |
| **ADMIN.md** (signed “YA / MK merged drafts”) | Cover | “None of it can break the books.” Bulk KYC “only `under_review`”, rotate “issues a new key”, Adjust “journaled”, re-run “always safe”. Code contradicts every one of those. |
| **ONBOARDING.md** (MK Nov 2025, FH/AM Jun–Jul) | Cover | “When a comment, a doc and the code disagree, the tests are the tie-breaker” is Order rule 3. |
| **Postmortem 2026-05-14** (FH draft, **MK review**) | Cover | Blames duplicate acquirer callbacks and says `processed_events` shipped. The captures are 60–70 s apart (reservation timeout). `processed_events` does not exist. |
| **Eng sync 2026-06-02 / FP-203 review 2026-09-17** | Witness, not truth | FH/AM record MK saying the bug is fixed or “no money moved”. AM’s pushback (“different outbox event ids”) is the useful line. |
| **Agent files** (`Evidence/old-agints-instration/`) | Decoy | MK Aug–Sep 2026. 1 BD = 100 cents, `Math.random` is fine, `packages/money` is frozen, do not fix the 501. |

**Rule of thumb:** YA before February 2026, and ADR-0001, are the design. YA in April is telling you what is unfinished *and* what he hoped was already true. MK after the Order, especially after April, is often documenting the bug as a decision. Fatima’s tickets and group-chat lines in the case file are symptoms; they keep matching the code.

---

## Clue → Canonical Bug Mapping

The following table maps clues from the evidence pack (support tickets, audit notes, stickers, chat transcripts) to their canonical bug reports:

| Clue | Canonical Bug(s) |
|---|---|
| Login works without OTP | [BUG-001](bug-001-merchant-otp-bypass.md) |
| OTP sent to another merchant | [BUG-002](bug-002-otp-sent-to-other-merchant.md) |
| OTP implementation / Math.random | [BUG-015](bug-015-otp-attempt-limit-race-and-resend-reset.md), [BUG-016](bug-016-session-token-not-rotated-on-otp.md), [BUG-029](bug-029-otp-and-payment-link-insecure-rng.md) |
| FP-187 payment link paid after expiry | [BUG-005](bug-005-payment-link-paid-after-expiry.md) |
| INCIDENT 2026-05-14 double charge | [BUG-006](bug-006-payment-link-double-charge.md) |
| Cancel B's link from A's dashboard | [BUG-018](bug-018-payment-link-cancel-cross-merchant.md) |
| Refund more than charged | [BUG-007](bug-007-refund-more-than-captured.md) |
| FP-209 concurrent refund | [BUG-008](bug-008-concurrent-refund-double-money-out.md) |
| FP-300 unfinished feature | [BUG-027](bug-027-refunds-route-returns-501.md) |
| Scheme statement always over | [BUG-034](bug-034-scheme-export-rounding-always-over.md) |
| March sweep not idempotent | [BUG-033](bug-033-march-sweep-not-idempotent.md) |
| Split payouts a few fils short | [BUG-030](bug-030-split-payout-missing-fils.md) |
| Recalculate balances 135K → 7K / FP-203 | [BUG-011](bug-011-recalculate-balances-wrong-source.md), [BUG-038](bug-038-balance-adjustment-cache-only.md) |
| MDR recalc rewrites paid batches | [BUG-035](bug-035-mdr-recalc-rewrites-paid-batches.md) |
| Dashboard 245 bps vs charged 225 | [BUG-032](bug-032-ts-and-go-fee-formulas-diverge.md), [BUG-071](bug-071-fee-display-wrong-schedule.md) |
| CSV 4.75 → 0.475 and 4.755 → 4.750 | [BUG-009](bug-009-csv-import-10x-too-small.md) |
| Daily close at 3am | [BUG-036](bug-036-daily-close-runs-at-3am.md) |
| Lifetime payout estimate drift | [BUG-063](bug-063-lifetime-payout-estimate-float32.md) |
| Test merchants in real settlement | [BUG-012](bug-012-recompute-statuses-clears-test-mode.md) |
| FP-240 webhook signatures rejected | [BUG-045](bug-045-webhook-signature-mismatch.md), [BUG-046](bug-046-inbound-callback-hmac-reserialized.md) |
| FP-201 duplicate callback notes | [BUG-048](bug-048-duplicate-acquirer-callback-notes.md) |
| INCIDENT 2026-08-21 duplicate payout notices | [BUG-049](bug-049-duplicate-payout-notifications.md), [BUG-050](bug-050-payout-disbursement-recorded-by-webhook.md), [BUG-068](bug-068-webhook-replay-new-delivery-id.md) |
| Admin role checks / key rotation | [BUG-039](bug-039-api-key-rotation-does-not-revoke.md), [BUG-040](bug-040-second-approver-compares-display-name.md), [BUG-041](bug-041-credits-missing-role-check.md), [BUG-004](bug-004-impersonation-grants-write-access.md) |
| Large export pagination drops rows | [BUG-053](bug-053-large-export-pagination-drops-rows.md) |
| Slow reporting query | [BUG-072](bug-072-settlement-summary-double-counts.md), [BUG-073](bug-073-transaction-search-ilike-full-scan.md) |
| Abandoned migrations / Dilmune | [BUG-014](bug-014-migrations-break-fresh-database.md) |
| ya/sign-raw | [BUG-045](bug-045-webhook-signature-mismatch.md) |

---

## Bug Reporting and Evidence Standards

Future findings added to this registry must comply with the following standards:

### Standard Report Structure
Every report must follow the standardized 17-section structure:
1. Summary
2. Classification (Severity, Confidence, Verification Status, Category, Affected Component, Reachability, Original Contributors / Sources)
3. Root Cause
4. Affected Files and Functions
5. Expected Behavior
6. Actual Behavior
7. Trigger Conditions
8. Technical Evidence
9. Runtime Evidence
10. Security / Financial / Functional Impact
11. Safe Reproduction
12. Related Findings
13. Documentation Contradictions
14. Recommended Remediation
15. Remaining Questions and Limitations
16. Original Reports Merged
17. Evidence References

### Severity Definitions
- **Critical**: Remote unauthenticated access, authentication bypass, unauthorized cross-tenant data/fund modification, double charging, silent data loss, ledger divergence.
- **High**: Cryptographic PRNG predictability, unauthenticated internal endpoints, unauthorized role escalation, financial formula discrepancies, SSRF, non-idempotent financial adjustments.
- **Medium**: Concurrency race windows without immediate fund loss, secondary reporting over-counts, lack of cleanup on cascade delete, unhandled non-AppError exceptions.
- **Low**: Visual UI rendering ratios, lack of checksum validation in migrations, inclusive end-date edge cases.

### Verification Classifications
- **RUNTIME REPRODUCED**: Defect executed and verified in an isolated test harness or recorded in execution artifacts (`Evidence/runtime-artifacts/`).
- **STATICALLY CONFIRMED**: Line-by-line source code inspection and SQL schema verification prove the behavior is reachable and present in the codebase.
- **PARTIALLY SUPPORTED**: Code suggests defect, but external dependencies or dormant conditions leave runtime behavior unverified.
- **SUSPECTED**: Theoretical vulnerability requiring further verification.
- **BLOCKED**: Underlying defect exists but is currently unreachable due to upstream failure (e.g. 501 route or migration stop).

---

## Deduplication Policy

1. **One Root Cause = One Canonical Report**: If two reports document the same underlying code defect or failure mode, they must be consolidated into a single canonical bug report. All distinct evidence, code snippets, and reproduction artifacts from both reports must be merged without loss.
2. **Related but Distinct Defects**: Defects affecting the same feature or file that stem from different underlying root causes (e.g. payment link expiry vs payment link double charging) must remain distinct bugs.
3. **Traceability**: All merges must be logged in [`BUG_MERGE_AUDIT.md`](BUG_MERGE_AUDIT.md) with exact source file tracking.

---

## Naming Convention

- **Format**: `bug-{{XXX}}-{{descriptive-slug}}.md`
- **Numbering**: Exactly three digits (`001`, `002`, ...), sequential and unique.
- **Filename Slug**: Lowercase kebab-case matching the canonical title.
- **Header**: `# BUG-XXX — Title`

---

## How to Add a New Bug

1. Ensure the defect has been verified against the actual codebase.
2. Check existing entries in the Master Bug Index to prevent duplicates.
3. Assign the next available sequential ID (`BUG-091`).
4. Follow the 17-section template.
5. Add an entry to the Master Bug Index and the relevant Category section in this `Readme.md`.

---

## Legacy Bug ID Mapping

For complete mappings between original bug numbers, blind-spot findings, and canonical IDs, refer to the [Bug Merge Audit Report](BUG_MERGE_AUDIT.md).
