# DCC4 independent Tests review

Reviewer `sup_luna`, agent `01a0530e-519e-74d1-a283-5db01dca047a`, high, read-only;
`/review` Tests + `/tdd judge`. Target tree `c6ee685216ddba8fa604fc145346c05fa5889bb6`.
Eight store/schema/test paths checked against baseline `13175b13`.

`tests/unit/server/explorer-override-store.test.ts:287` **medium** — combined fsync+close failure
is covered but single-failure arms are not; add fsync-only and close-only cases with exact
cause/claim behavior. Supervisor verified and assigned within the confirmed public-store seam.

`src/domain/dashboard/explorer-edit.ts:116` **medium** — retained dormant v19 schemas/fingerprint
derivations lack valid/invalid fixtures through public authority boot validation. Add historical
valid and malformed fingerprint/lifecycle evidence without reactivating write repositories.
Awaiting coordinator confirmation of that bounded preservation-validation seam.

Coordinator subsequently confirmed this exact preservation seam: existing PUBLIC boot/validation
registry over temporary databases only; original valid historical fingerprint/lifecycle rows
accepted, malformed rows refused. No original SQL/digest edit, active outbox commands/repositories,
database conversion or live HR. Sole writer assigned sequential proof; independent Tests/Security
follow-up remains required.

Count: 2 · Worst: medium. Neither finding is yet closed. No gates or edits by reviewer.

## Withdrawn finding (kept for audit)

Reviewer initially alleged `mockReset()` at test lines40–42 makes later fsync/close mocks no-ops.
Supervisor checked installed `node_modules/@vitest/spy/dist/index.js:151–156,179–188`:
`vi.fn(actual)` sets `resetToMockImplementation: true`, and reset restores that initial actual
implementation. Reviewer rechecked and explicitly withdrew the finding (Count 0 for that claim).
No mock change is required; no descriptor leak was demonstrated. Installed Vitest is 4.1.10.

## Independent follow-up — e7a9c02ddfacd23c0e0115c31abec8c8f03b2b64

Same reviewer: both remaining medium gaps **CLOSED**; mockReset finding remains **WITHDRAWN**.
Count: 0 open · Worst: none. Store test:150–254 now pins fsync-only/close-only primary causes,
closed descriptors, retained claims and real-unlink cold-reopen refusal/recovery. SQLite test:529–581
crosses public `AuthorityDatabase.open` and read-only inspection with valid literal historical records
and malformed fingerprints/lifecycle rows in TEMP databases. No retired-command compatibility claim;
original v19 SQL/digest remains. Startup real-port tests directly prove read blocking, exact replay
and fatal divergent evidence. No gates or mutation by reviewer. New performance/effect repairs after
e7 need separate final-delta review and do not inherit this test acceptance automatically.

## Independent final follow-up — 202a63983e4c843e426a5db1d8851a0fb2b33bc7

Same `sup_luna` reviewer independently accepted the final request/effect delta. Count: 0 open ·
Worst: none. compose-real-port tests140–180 use real HTTP, SQLite BEGIN IMMEDIATE, directory
fsync and file reads to reject per-row admission and cross-request caching. Tests186–267 land
real claim/override bytes after actual COMMIT: the current request retains its admitted view and
the next request re-admits/refuses. Store tests150–168 prove recursively immutable snapshots
across real file replacement; tests309–330 reject foreign dependency effects and preserve both
claim and override bytes. Previous gaps remain closed and the reset finding remains withdrawn.
Reviewer ran no gates or edits; historical envelope-compatibility limitation is unchanged.

## Fixture/Duo final delta — dbd1b32cc6233fb9fdf6f7b577ab4be06098822f

Independent `sup_luna`, agent `01a05335-8ce8-7000-8d01-f9647c08d564`, high/read-only.
Count: 0 · Worst: none. Explicit fixture gates exercise real default drains, and retained same-command
red2/6→green8 proves forwarding sensitivity. Explorer test275 delegates to the real backing store;
existing persistence/replay assertions remain. Production default is still credential-checking.
No gates, mutation, timeout/assertion weakening or live execution by reviewer.
