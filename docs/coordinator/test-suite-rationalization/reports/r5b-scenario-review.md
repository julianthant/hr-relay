# R5b report — scenario walks, dashboard scenarios, layout, and review

**Coordination UUID:** `f24df892-5171-48f4-97ff-4e91490f8622`
**Task:** `01a0656c-f193-76d1-baea-e0011ee0ce69`
**Branch/base:** `feature/test-r5b-scenario-review` from
`18e5294de0b07f147349a2d62edcc6a5728fcf15`
**Scope:** u27, u28, u30 only
**Result:** complete; no live workflow run, push, merge, or coordinator-board write

## Outcome

R5b retains every ordinary capability scenario and the two-case cross-slice integration walk,
reduces T2 from 26 to 16 cases by placing pure claims at cheaper unit owners, and leaves T3 empty
because this change owns no unique live-run UI interaction. The scenario project is now **17 files /
132 cases**, down from R5a's 17/142. Four claims moved to unit owners and six exact duplicates were
removed; after one newly pinned missing-answer refusal, the repository-wide net is minus six tests.

R5a's seven workflow-owned structural T1a files / 81 cases and both uncollected T1b manifests are
blob-identical to the reservation base. No no-write, evidence-provenance, graph-coverage, or live
authority claim moved.

Durable unit evidence:

- [u27 ordinary/walk review](../artifacts/r5/u27-walks.md)
- [u28 T2/T3 reconciliation](../artifacts/r5/u28-dashboard.md)
- [u30 layout/config/review](../artifacts/r5/u30-review.md)

## Before / after / provenance

| Layer | Before | After | Provenance/disposition |
| --- | ---: | ---: | --- |
| Ordinary capability | 6 files / 33 | 6 / 33 | All retained; fixture identities/addresses made explicitly synthetic. |
| Workflow T1a | 7 / 81 | 7 / 81 | Exact blobs unchanged; one structural source per registered workflow. |
| Dashboard T2 | 3 / 26 | 3 / 16 | 4 moved to unit owners; 6 exact duplicates removed. |
| Integration walk | 1 / 2 | 1 / 2 | Retained for intake→fan-out→settlement→archive→relaunch and receipt/archive joins. |
| **Collected scenario** | **17 / 142** | **17 / 132** | Every source classified and collected exactly once. |
| Uncollected T1b | 2 manifests / 2 cases | 2 / 2 | Exact blobs unchanged; no browser/live execution. |

The two truthful path changes are
`wired-surfaces.scenario.test.ts` → `run-projection.scenario.test.ts` and
`needs-you-and-ledger.scenario.test.ts` → `needs-you.scenario.test.ts`. The paired scenario
instruction maps name the new paths and remain byte-identical. No active import, manifest, or
configuration references either old path.

The T2 world uses a real SQLite authority database, disk span stream, command kernel/service, start
planner, and queue/run-detail projection. It defaults to `dryRun: true`; browser, worker-supervisor,
intake, and write-resolution process edges throw. The identity file retains both required
`CommandResult` refusal arms: wrong-schema `rejected` and stale-CAS `conflict`, each asserting no
gate result and an unchanged park.

## Controlled red → green evidence

| Control | Red meaning | Restored green |
| --- | --- | --- |
| Synthetic EID corpus | Pre-change scenario identifiers failed with file/line-only diagnostics. | Focused architecture 17/17. |
| Scenario-support EID | Temporary unsafe `world.ts` helper value failed at the exact helper line without echoing the value. | Focused architecture 17/17. |
| Relocated Explorer claims | Temporary missing input surface, reversed verdict order, and absent purposes produced exactly three named unit failures. | Explorer owner 20/20. |
| Typed-EID missing answer | Temporary composer fallback changed the result to `ready`; the new owner failed `ready !== refused`. | Identity owner 16/16. |
| Identity diagnostics/answer | Generic contradiction/rejection messages and an untrimmed rejection answer failed the exact operator contract. | Identity owner 16/16. |

Representative green output names the Vitest project, file, suite, and complete behavior/refusal
title. T2 uses stable suite phases; the long operator walk retains ten stable source phases with
operation-specific, non-secret failure messages. R7/u38 owns the final single streaming default
reporter; R5b did not add duplicate progress output or change isolation/parallelism.

## Integrated exit gates

| Gate | Result |
| --- | --- |
| `npx vitest run --project scenario --reporter=verbose` | PASS — 17 files / 132 tests, 3.10s |
| `npm run test:architecture` | PASS — 70 files / 707 tests, 22.18s |
| Focused Explorer owner | PASS — 20/20 |
| Focused identity/ledger cheaper owners | PASS — 59/59 at consolidation; final identity owner 16/16 |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS, zero warnings |
| `npm run build:manifest:check` | PASS — generated build manifest current |
| `npm run roadmap:check` | PASS — generated roadmap fresh |
| `git diff --check 18e5294..HEAD` | PASS |
| `cmp tests/scenario/AGENTS.md tests/scenario/CLAUDE.md` | PASS |

The expected pdfjs `Indexing all PDF objects` warning remains scoped to the named unreadable-PDF
case. No diagnostic was globally suppressed. Full coverage remains R7's integrated family gate; the
R5b brief requires the full scenario and applicable architecture projects, both run here.

## Consequential review

| Axis | Independent evidence | Resolution / final state |
| --- | --- | --- |
| Repository standards | `sup_luna_test_suite_rationalization_cf24df892_r05b_review_standards` | Initial support/negative-control/operator-label findings fixed; PASS at `ec477b2a`. |
| Correctness | `sup_terra_test_suite_rationalization_cf24df892_r05b_review_correctness` | Support scan and 4-move/6-removal arithmetic fixed; PASS at `6ec76374`. |
| Silent failures | `sup_terra_test_suite_rationalization_cf24df892_r05b_review_silent_failures` | Helper bypass fixed with non-leaking negative control; PASS at `ec477b2a`. |
| Performance | same Terra reviewer, separate performance turn | PASS at `6ec76374`; scenario 3.64s measured, scan 23 files / 377,003 bytes once, concurrency unchanged. |
| Tests | standards Luna, separate test-quality turns | Three equivalence gaps fixed; PASS at `1faf891d` with scenario 17/132 and identity/Explorer 36/36. |
| Docs | `sup_luna_test_suite_rationalization_cf24df892_r05b_review_docs` | Commit provenance and R7 u38/u40 ownership corrected; PASS at `258375e0`. |
| Security/privacy | Supervisor-owned review at `258375e0` | PASS: no live/network/credential path, no production mutation, reserved subject IDs, file/line-only red output, no raw identifier diagnostics. |
| Originating spec/brief | `sup_terra_test_suite_rationalization_cf24df892_r05b_review_spec` | T1/T2/T3 method passed. The first report rerun found only trailing whitespace and prospective cleanliness wording in this file; both were corrected before the final range check. |

Review fixes landed as separate logical commits; every reviewer was read-only and received no extra
worktree. No open correctness, silent-failure, performance, test, docs, security, or standards
finding remains.

## Commits

- `2abf8b62` — reserve synthetic offline identities and add the corpus ratchet.
- `74805a25` — move/deduplicate T2 claims at their cheapest owners.
- `176d69ce` — record u27/u28/u30 evidence.
- `ec477b2a` — close support-fixture and operator-label review gaps.
- `6ec76374` — align support-scan evidence wording.
- `215ab4d3` — preserve exact identity refusal diagnostics.
- `1faf891d` — pin rejection-answer normalization.
- `258375e0` — reconcile evidence provenance and R7 ownership.

## Coordination identity and close state

At intake, the coordinator worktree was `7e83a34840ead7b9cc26fb73ed3ead08fa007082` and the board
blob was `ae29bff06b7529cdf7827ac4368e0ec71071f522`. At report close, the read-only coordinator worktree
is `8ed17a8ba219dc5f3aa10b16a9e8078502bc5fbe` and its board blob is
`df93ac32d203920227b9b99108e363610d619560`; the coordinator's active R5b row records this exact task,
worktree, branch, and base. The board changed under its sole owner as expected; R5b did not edit it.

The post-report correction checks used the exact base-to-candidate range. `git diff --check` passed;
the paired scenario instructions compared byte-identically; and the temporary ignored
`node_modules` dependency link was removed. After the correction commit, the supervisor repeats the
range check and requires `git status --short` to emit nothing before handoff. No temporary
production mutation, untracked evidence, or staged file remains part of the reviewed result.
