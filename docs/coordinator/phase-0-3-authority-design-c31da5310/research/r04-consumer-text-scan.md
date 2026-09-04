# R04 research — 2.6 / 3.1 consumer-text scan (sup-scout U02, read-only, 2026-09-04)

Coordination `31da5310-fb55-4982-ad02-05f4c9356d8b` · R04 · U02. Scanned at `98037ef7`. Persisted verbatim by
the supervisor; line numbers are at that HEAD.

## Summary

No 2.6 / reopened-3.1 task sentence flatly contradicts D330/D331/D332: the task prose already uses the
vocabulary (claim, tombstone, protected, restore) the contracts fix. The gap is in the CITATIONS: the
`doc:` lines of the 13 nodes point at ref sections that carry no dated pointer to D330/D331/D332
(ref operator-trust, ref frontend-backend-integration and ref data-intake-and-edit-data carry zero
mentions of the three decisions). `ref clock-config-secrets §3` is the one cited section that already
carries the dated supersession note (lines 38 and 225) — the model to replicate.

## Table A — task sentences by term

| file:line | node/task | sentence (compressed) | term | governing section | class |
|---|---|---|---|---|---|
| 02 §2.6:494 | Task 1 | "Prove durable linkage through retry, archive, and tombstone" | tombstone | §D330.8 | consistent |
| 02 §2.6:506 | Task 3 | "counts converge and protected settings never read back" | protected | §D330.2/§D330.3 · §D331.2 | consistent |
| 02 §2.6:508 | Task 4 header | "Run the non-mutating migration and recovery proof" | migration | §D332 | consistent |
| 02 §2.6:511 | Task 4 | "migrated-copy restore, scenario, concurrency, redaction, reconciliation gates" | restore | §D332.4/§D332.11 | consistent |
| roadmap:856 | p2f-proof | "cite historical D135 and perform no second controlled write" | — | §D332.11 | predates D332's own proof rows; names none of D330–D332 |
| 03.1:866 | 9-2 | "protected values remain write-only … presence/revision" | protected | §D331.2/§D331.5/§D331.6 | consistent |
| 03.1:872 | 9-3 | "health/doctor/explicit-backup/restore/degradation … stopped-system" | restore | §D332.1/§D332.2 | consistent |
| 03.1:890 | 10-2 | "durable membership, claims … CAS … orphan cleanup" | claim | §D330.6 | consistent |
| 03.1:915–916 | 11-2 | "first eligible row auto-claim … exactly-once" | claim | §D330.5/§D330.6 | consistent |
| 03.1:921–922 | 11-3 | "terminal-only delete/tombstone, idempotence, storage delta, convergence" | tombstone | §D330.8 | consistent |
| 03.1:928 | 12-1 | "revision-bound, idempotent, convergent across current/archive/tombstone" | tombstone | §D330.2/§D330.8 | consistent |
| roadmap:1214 | dash-settings | "write-only … presence, never plaintext" | protected | §D331.6 | consistent |
| roadmap:1229 | dash-storage | "backup creation, restore admission … stopped-system gated" | backup | §D332.1–§D332.3 | consistent |
| roadmap:1278 | dash-sessions | "durable session membership … current claim" | claim | §D330.6 | consistent (cites execution-and-sessions only) |
| roadmap:1345 | dash-run-modal | "first eligible row … claimed automatically" | claim | §D330.5/§D330.6 | consistent |
| roadmap:1361–1363 | dash-archive | "terminal/archive/tombstone lists … delete idempotence" | tombstone | §D330.8 | consistent |
| roadmap:1378–1379 | dash-queue | "revision-bound … evidence-retention" | CAS | §D330.4 | consistent |

## Table B — cited ref sections and their D330/D331/D332 pointers

| ref doc | § | line | dated pointer? | governing section |
|---|---|---|---|---|
| dashboard-surfaces | §2.6 | 2342 | none | §D330.9 |
| dashboard-surfaces | §4 | 2636 | none | unrelated (completion contract) |
| dashboard-surfaces | §5 | 2944 | none | unrelated (cutover boundary) |
| dashboard-surfaces | §9 (9.1–9.4) | 3213 | none before §D330 (3846) | §D330.1–§D330.12 |
| dashboard-surfaces | §9.5 | 5089 | none | §D330.2/§D330.8 |
| dashboard-surfaces | §9.7 | 5849 | none | §D331 · §D330.9 |
| operator-trust | §1 · §3 · §5.3 · §5.7 · §5.8 · §5.9 | 84 · 1326 · 1897 · 2100 · 2191 · 2223 | none (zero D330–D332 mentions in the file) | §D330 (notifications/evidence) · §D330.9 |
| frontend-backend-integration | §3.4 · §4 · §5.1 · §5.1.1 · §6 · §6.9 | 535 · 943 · 1089 · 1197 · 1592 · 1936 | none (zero mentions) | §D330.5 · §D331.5 · §D332 |
| clock-config-secrets | §3 | 38, 225 | **yes** (`env > settings.json > default … (D331: settings > default …)`) | §D331.8 |
| workflow-model | §4 | 1989 | none | §D330.5 |
| data-intake-and-edit-data | whole | — | none (zero mentions) | §D330.9 · §D331 |

## Table C — the 13 nodes' `doc:` lines at `98037ef7`

| node | line | `doc:` |
|---|---|---|
| p2-authority-revalidation | 809 | `02 §2.6 · … · ref:operator-trust · ref:data-intake-and-edit-data · ref:frontend-backend-integration` |
| p2f-trust | 825 | `ref:operator-trust · ref:dashboard-surfaces §2.6` |
| p2f-data | 834 | `ref:data-intake-and-edit-data · ref:dashboard-surfaces §9.7` |
| p2f-operator | 843 | `ref:frontend-backend-integration §6 · ref:dashboard-surfaces §9` |
| p2f-proof | 852 | `02 §2.6 · … · ref:operator-trust §1 · ref:guards-and-tests` |
| p2f-close | 866 | `02 §2.6 · … · 03.1 §Reopened completion tasks` |
| dash-settings | 1210 | `03.1 §Task 9-2 · … · ref:clock-config-secrets §3 · ref:frontend-backend-integration §4` |
| dash-storage | 1226 | `03.1 §Task 9-3 · … · ref:operator-trust §1 · ref:frontend-backend-integration §6` |
| dash-setup | 1323 | `03.1 §Task 11-1 · … · ref:frontend-backend-integration §5.1 · ref:operator-trust §3` |
| dash-run-modal | 1341 | `03.1 §Task 11-2 · … · ref:workflow-model §4 · ref:frontend-backend-integration §5.1.1` |
| dash-archive | 1358 | `03.1 §Task 11-3 · … · ref:dashboard-surfaces §9.5 · ref:operator-trust §5.7` |
| dash-queue | 1374 | `03.1 §Task 12-1 · … · ref:dashboard-surfaces §4 · ref:frontend-backend-integration §5.1` |
| dash-run-detail | 1391 | `03.1 §Task 12-2 · … · ref:dashboard-surfaces §5` |
