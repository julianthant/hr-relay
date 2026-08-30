# Answers — dashboard reporting authority — 2026-08-28

The operator answered **all recommended** on the Phase 3b status report. This ratifies options **1 A**
and **2 A** from `docs/decisions/2026-08-28-dashboard-reporting-authority.md` on the prepared
`codex/r-dcr-reporting-search` run branch.

## 1 · Stable private identity for Activity's People count — A

Use insert-only keyed pseudonym evidence: a secret-backed HMAC-SHA-256 domain, a public key-generation
id, and one immutable `(run, key generation)` row derived from the workflow's exact canonical subject
binding. Backfill the current Separations corpus only where that binding is unique. Missing,
ambiguous, mixed-generation, and incomplete-generation corpora remain unavailable by name. Never
serve a raw identifier, suffix, unkeyed digest, or secret.

## 2 · Stable fact identity for receipt-to-receipt comparison — A

Use a closed Separations comparison registry over the immutable receipt corpus. Each registered fact
has a stable id, label, disclosure posture, and exact source binding. The prior run is exactly
`retryOf` and must share workflow and item identity; exact receipts and registry matches must be
unique. The wire names `added`, `removed`, `changed`, and `withheld`; only reviewed
`safe-diagnostic/allow` values cross the boundary. Sensitive values and identifier-derived values may
be compared internally but remain withheld. OCR and later-workflow facts are unregistered until
their owning migrations review them.

These answers authorize the authority and implementation work. They do not weaken any refusal,
authorize an HR write, or allow immutable receipts to be rewritten.
