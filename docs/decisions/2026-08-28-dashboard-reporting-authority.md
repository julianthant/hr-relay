# Decisions — dashboard reporting authority — 2026-08-28

_Answer positionally: `1 A, 2 A + "note"`, or `all recommended`. Unanswered items stay open._

## Verified run boundary

R-DCR has merged and reviewed DCR3 cross-date search, DCR4's Separations search surface, and DCR5's
evidenced XLSX export. The serialized run gates are green: typecheck, lint, 3,543 coverage tests,
239 parity tests, roadmap freshness, and descriptor-manifest freshness. DCR1 and DCR6 are held
because their required identity contracts do not exist; neither is an implementation-only gap.
The run-specific coordinator board is close-only and therefore remains untouched.

## 1 · Stable private identity for Activity's People count

**Situation.** DCR1 must count distinct people from durable redacted identity without publishing a
full identifier or a suffix. Current Separations receipts retain the subject EID only as
`direct-identifier/last4`; the existing `digest` transform is an unkeyed SHA-256 and an EID-sized
dictionary can reverse it. The prepared DCR1 branch correctly reports the People axis as unavailable
for the real corpus rather than counting suffixes or fabricated test digests.

**Options.**

- **A.** Ratify insert-only keyed pseudonym evidence — add a dedicated secret-backed HMAC-SHA-256
  domain, a public key-generation id, and an insert-only `(run, key generation)` evidence row that
  records the exact workflow subject selector plus the pseudonym, never the source identifier.
  Backfill the current Separations corpus only from each workflow's exact canonical subject binding;
  missing or ambiguous bindings remain unavailable. Rotation adds a new generation and a report
  refuses mixed/incomplete generations. This meets DCR1 now, but adds a secret, schema/migration,
  backfill command, rotation rules, and privacy review.
- **B.** Ratify the same keyed pseudonym only for newly derived receipts — no historical backfill and
  less migration machinery, but the current populated day remains unavailable, so DCR1 and R-DCR
  cannot satisfy their acceptance criteria now.
- **C.** Return the People axis to later scope — keep the honest unavailable arm and merge none of
  the prepared DCR1 feature until a future authority decision. This avoids new identity storage, but
  explicitly leaves D282/DCR1 incomplete.

**Recommendation.** **A** — it is the only option that serves the current corpus without making an
enumerable identifier digest or rewriting immutable receipts.

**Notes.** _(your notes here)_

## 2 · Stable fact identity for receipt-to-receipt comparison

**Situation.** DCR6 has an exact current receipt and a singular `retryOf` link, but receipt entry ids
include the receipt id and therefore cannot join facts across runs. No contract validates that the
prior run is the same logical item, assigns stable cross-receipt fact identities, or decides which
before/after values may be shown. Implementing a tuple ad hoc would invent the authority the strict
comparison is supposed to enforce.

**Options.**

- **A.** Ratify a closed Separations comparison registry over existing receipts — each registered
  fact gets a stable id, label, and disclosure posture bound to its exact collection, source kind,
  task/node id, and field path. The prior run is exactly `retryOf` and must exist with the same
  workflow and `itemId`; both exact receipts must be unique. Missing/duplicate registry matches
  refuse. The wire has explicit `added`, `removed`, `changed`, and `withheld` arms; only
  `safe-diagnostic/allow` values may cross, while direct identifiers, suffixes, sensitive HR values,
  and their digests are compared internally but withheld. OCR scopes are not registered. This works
  for the current corpus, but every later workflow must add reviewed registry dispositions.
- **B.** Add explicit `stableFactId` and disclosure posture to a new receipt composition — the
  strongest producer-owned model, but immutable existing receipts cannot be changed, so the current
  corpus stays unavailable unless a separate, reviewed backfill authority is also designed.
- **C.** Defer DCR6 — leave the existing per-run reuse rows and two separately openable receipts as
  the truthful surface. This avoids inferred identity, but R-DCR cannot close its field-level diff
  requirement.

**Recommendation.** **A** — a closed current-corpus registry makes the authority explicit and
reviewable without mutating receipts or importing OCR/future-workflow semantics.

**Notes.** _(your notes here)_
