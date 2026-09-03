# R5b u28 — T2/T3 dashboard scenario reconciliation

## Result

The T2 layer now contains **3 files / 16 cases**, down from 3 files / 26 cases. The retained cases
cross a real SQLite authority database, real command service, real run/queue projection, or the
composition's parked-gate reader. Pure query and presentation-composer claims moved to their unit
owners; exact unit duplicates were removed. Repository-wide, the three moved claims and one newly
pinned unit refusal make the net change **minus 6 tests**.

Read-only analyst:
`/root/sup_analyst_test_suite_rationalization_cf24df892_r05b_u28_dashboard_reconcile`
(`sup_analyst`). The analyst received no worktree or branch and made no edits.

## Every move/removal and its retained owner

| Former T2 case | Action | Retained owner / equivalent red meaning |
| --- | --- | --- |
| `declares the typed-text surface the explorer serves, dry-run support and all` | Move | `tests/unit/server/explorer-query.test.ts` → `serves separations' typed-text declaration, including dry-run support`; a projection returning an absent or altered input surface fails. |
| `serves the four operator verdicts with their tones, keyed as the descriptor keys them` | Move | `explorer-query.test.ts` → `serves separations' four declared verdicts with their exact tones`; reordered or altered verdict projection fails. |
| `gives every graph node the descriptor's OWN words, with none left as prose-absent` | Move | `explorer-query.test.ts` → `serves an authored purpose for every separations graph node`; an omitted purpose fails with the complete node-id set. |
| `refuses BY NAME when the served shape and the served candidates contradict each other` | Remove exact duplicate | `tests/unit/dashboard/identity-ceremony.test.ts` → `REFUSES a packet whose shape and candidate count contradict each other`, including both candidate-count diagnostics, draft-problem propagation, and undefined answer. |
| `takes a rejection only with the operator's own words, and sends them verbatim` | Remove exact duplicate | `identity-ceremony.test.ts` → `asks for a rejection reason...` pins the exact actionable prompt; `composes a REJECTION...` pins trim, digest, and command value. |
| `refuses to compose a typed-EID decision the operator never made` | Move to cheaper owner | New focused unit case `REFUSES a typed-EID ceremony when no operator answer was supplied`; a temporary production fallback made this test fail `ready !== refused`. |
| `declares exactly the three contracts a separation files, and no two share a proof identity` | Remove exact duplicate | `tests/unit/archive-ledger-read-through.test.ts` → `declares exactly separations' three commit contracts, keyed by PROOF SCHEMA`. |
| `resolves a run's UCPath lines in file order, with the sweep's absence between them` | Remove exact duplicate | `archive-ledger-read-through.test.ts` → termination action/confirmation and pending-sweep declared-absence cases; the reader uses the ordered pointer vector. |
| `names an unread pointer rather than dropping a filing out of the list` | Remove exact duplicate | `archive-ledger-read-through.test.ts` → `names a sequence past the end...` and `keeps every pointer, in order, resolved or not`. |
| `folds the same partition into the Activity report's write-ledger block` | Remove exact duplicate | `tests/unit/ledger-activity-fold.test.ts` owns partition folding; `tests/unit/server/activity-report.test.ts` owns the served ledger block beside report totals. |

The three relocated Explorer tests were independently mutation-checked together: temporarily
removing the input surface, reversing verdict order, and omitting node purposes produced exactly
three named failures at their new owner. The restored source passed **20/20**. The four cheaper-owner
files passed **59/59** after the added typed-EID refusal.

## Retained T2 authority

| File | Cases | Retained seam |
| --- | ---: | --- |
| `dashboard/separations/run-projection.scenario.test.ts` | 6 | Typed input through real start command; queue title before/after a real checkpoint read; categorical timeline; pending state from absent execution evidence. |
| `dashboard/separations/identity-gate.scenario.test.ts` | 6 | Served gate → ceremony → composed command → authority mutation. It retains success plus both required `CommandResult` refusal arms: schema `rejected` and stale-version `conflict`, each proving no decision was stored and the park remained. |
| `dashboard/separations/needs-you.scenario.test.ts` | 4 | Real parked rows through `readGateParks`, durable notification projection, multiplicity, and release after the real gate command. |

All worlds use reserved synthetic subject/document values. Runs default to `dryRun: true`; the world
has no browser, worker supervisor, or write sequencer and every accidental process-edge call throws.
The no-write and evidence-provenance guarantees in the seven T1a structural files were untouched.

## T3 disposition

No T3 file exists and none was created. There is no unique live-run UI interaction in this change:
the retained claims end at command/projection authority and no browser or component is involved.
Manufacturing a combined/live case would require a truthful available subject and would violate the
brief's explicit ban on live workflow execution for this run.

## Gate evidence

- Full scenario project: **17 files / 132 tests passed** with verbose project/file/suite/full-title
  progress.
- Focused T2 plus u27 fixtures: **9 files / 44 tests passed**.
- Cheaper unit owners: **4 files / 59 tests passed**.
- Controlled Explorer-owner red: **3 named failures / 17 passes**, followed by **20/20 green**.
- Controlled missing-answer red: the new unit case failed `ready !== refused` under a temporary
  production fallback, then passed after the production source was restored byte-for-byte.
- Controlled diagnostic red: generic contradiction and rejection messages failed both exact
  operator-facing assertions; restored source passed the complete identity owner **16/16**.
