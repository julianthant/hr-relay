# Status — Phase 3 — 2026-09-03 (HEAD a2b6df38)

_Plan source: `docs/roadmap/roadmap.md`, `docs/rebuild/03a-finish-the-dashboard.md`,
`docs/rebuild/03b-finish-separations.md`, and
`docs/rebuild/03c-migrate-the-remaining-workflows.md`. Verified against: `npm run cli -- phase`,
git history through `a2b6df38`, the current source/test artifacts, the recorded R3c/R3d gate evidence,
and a clean worktree/branch inventory._

The roadmap's hollow **SESSION** cards are append-only journal markers for past planning/build
sessions. They are not running workers, browser sessions, or unfinished phase nodes. The runtime
uses the word *session* separately for a durable group of runs owned by the worker pool.

Phase 3 is one XL delivery split into three ownership documents: 3a (shared dashboard), 3b
(Separations), and 3c (workflow authoring and acceptance). Inside 3c, A and B are gates rather than
additional phases. D319 narrowed the phase: it now ends after the platform is accepted by Person
Lookup and Separations; every other workflow is an unnumbered candidate for a later, separately
approved phase.

## 1 · Complete

| Item | Evidence | Since |
|---|---|---|
| Phase 3a's shared dashboard contract is complete, including parallel workers/sessions and observed logs | `docs/rebuild/03a-finish-the-dashboard.md` §Exit criteria: 10/10 MET; commits cited per row | 2026-08-27 disposition |
| The final `workflow.ts` / `defineWorkflow` authoring API, direct entry algebra, omission admission, recovery choices, task catalog and four-artifact guard are landed | merge `824b7d09`; `src/base/workflow-definition.ts`; `tests/unit/architecture/workflow-authoring-budget.test.ts` | 2026-09-03 integration |
| Person Lookup is converted and has a canonical structural + `live-read` T1 pair | result `66ea3863-2951-4ad9-92b7-4e444eff4959`, run `3bf3d260…`, with 0/0/0 write-authority deltas; doc 03c checklist | R3c |
| Separations is converted through the same compiled seam without weakening its gates, write safety, receipts, recovery or public wire | `ab04231c`; the unchanged equivalence fixtures and R3c 11-file/108-test proof | R3c |
| The practical author guide, paired root rules, internal reference and owning specs are landed | merge `a9f486b2`; guide `9ec2e269`; root rules `b61d12c6`; reference `eec628aa` | R3d |
| Phase 3c and test-suite worktrees/branches were integrated and removed | current `git worktree list --porcelain` contains only the root worktree; current branch inventory contains only `master` | 2026-09-03 |

## 2 · Drift — where the as-built differs from the plan

| Plan said | Reality | Kind | Consequence |
|---|---|---|---|
| The roadmap node still shows the bounded transitional compiler and most D312–D318 work open | The implementation and author docs are merged; doc 03c records all but two 3c-A proof boxes complete | stale-plan-text | The rendered roadmap overstates how much Phase 3 remains; 3c-B must reconcile the roadmap and phase exit table |
| Doc 03c's phase-summary and exit table still describe baseline `b1b36349` as partial/open | `master` is now `a2b6df38`, containing merges `824b7d09` and `a9f486b2` | stale-plan-text | Read the detailed 3c-A checklist and git evidence for current truth until reconciliation lands |
| The runtime reports only `active: 3-workflow-migration` | The plan subdivides Phase 3 into 3a/3b/3c and 3c-A/3c-B | done-differently | The runtime label is intentionally coarse and cannot answer which internal gate is left |
| Separations' workflow compiler acceptance is sufficient for 3c-B | Separations is still 8/9 on its own production-readiness contract because controlled live write evidence is open | blocked, but outside 3c exit | Phase 3's platform acceptance can close without pretending Separations is production-ready; cutover cannot |

## 3 · Next

1. Run a clean-context guide-following proof for both acceptance workflows; record every undocumented
   step or escape hatch and fix the guide until the result is zero.
2. Pin automatic inheritance of worker/session acquisition, authentication, checkpoints, semantic
   logs, screenshots, receipts, notifications and Archive without workflow-specific glue.
3. Resolve the Separations T1b exit wording: obtain a fresh canary and record `met`, or explicitly
   accept the already-recorded typed `blocked/not-started` result as satisfying this gate with an
   owed future rerun.
4. Run the integrated manifest, typecheck, lint, coverage, architecture, parity and workflow proofs;
   then verify the 3c-A lifecycle has no worktree, branch or task residue.
5. Run the separately triggered 3c-B acceptance: reconcile Person Lookup and Separations evidence,
   update the roadmap/phase exit table, re-run the integrated gates, and mark Phase 3 closed.
6. After Phase 3 closes, select one candidate for a verified D319 admission packet; only operator
   approval creates and names Phase 4. I-9 and the old order 1–7/9 cards are not current Phase 3 work.

## 4 · Needs you

| # | Decision / approval | Options | My recommendation | Blocks |
|---|---|---|---|---|
| 1 | How should the unavailable Separations T1b canary satisfy the 3c-A exit wording? | **A:** supply a new closed Kuali document number and rerun; **B:** accept the typed `blocked/not-started` evidence and record an owed rerun; **C:** hold Phase 3 open indefinitely | A if a vetted document is already at hand; otherwise B | Final 3c-A exit claim |
| 2 | Start the final Phase 3 closure run after item 1 and the two proof units are settled | **A:** authorize 3c-B; **B:** leave it parked | A | Canonical Phase 3 close |

