# Supervisor report — Phase 3b R2/u1r: make 4537 the sole test subject

**Date:** 2026-08-28 · **Brief:** `docs/handoffs/2026-08-28-r2-u1r-4537-single-subject.md` (`24349da3`)
**Board:** `docs/plans/03b-board.md` — intake blob `c1599f8deedc2ed816e4142a8e68dbe8fa4c95ff`, re-verified at close (see §6)
**Decision:** `docs/decisions/2026-08-28-r2-u1-4537-registry-reconciliation.md` item 1 A + operator override → D284
**Integration:** `integration/03b`, base `24349da3` (contains verified product base `8ac7faf9`); final merge `c4dd2589`
**Mode:** `/supervise`, coordinated. Roles: the brief's `sup_terra` → native `sup-fable`, `sup_sol` → native `sup-opus`
(only the five native roles were dispatched; `check-role-policy.py --platform claude` valid).

## 1 · Outcome

**Done.** `config/test-subjects.json` holds exactly ONE entry — label `finalization-canary`, Kuali doc 4537,
`available` on its 2026-08-28 read-only re-verification — with one arm per workflow under `workflows`
(`separations`: kind `full-chain-dry-run`; `separations-kuali-finalization`: kind `ordinary`, with three
`pending` leaves). Both resolvers answer under the same label from their own arm; the finalization resolver
returns `blocked` BY NAME (`transactionNumber` not yet filed, `timekeeperComments` not authored,
`terminationEffectiveDate` not observed) before any secret is read. The eight labels
`finalization-already-finalized` · `finalization-no-active-job` · `finalization-subject-mismatch` ·
`separations-dry-run-subject` · `separations-future-dated` · `separations-controlled-commit-candidate` ·
`separations-pending-termination` · `separations-controlled-commit-canary` are gone from `config/`, `src/`,
both T1b manifests and the guard; they survive only as dated migration history (§9.31, doc 03b). D284 is
**built** (doc 03b §The canary registry; decisions.md pointer names the shas).

**No workflow rehearsal, worker, BFF, gate approval, `dryRun=false`, UCPath submit, Kuali save/finalize,
selector/timeout/fallback/retry change or remote write occurred.** The one live action was a read-only
Kuali read (u1r-a). Nothing was pushed.

## 2 · u1r-a — fresh read-only 4537 verification (sup-fable, root checkout, live)

Session `u1ra`, headless full Chromium with Duo Autopilot, evidence (restricted, gitignored) under
`.tracker-rebuild/manual-verification/4537-2026-08-28/r2-u1r/` — neutral filenames: `action-list.png`,
`document-header.png`, `document-dates.png`, `document-transaction.png`, raw snapshots, `facts.redacted.md`,
`read1.fields.txt`/`read2.fields.txt`, `read-timestamps.txt`. Only clicks: SSO `Login` + navigations.
`playwright-cli list` → `(no browsers)` after close; `git status --short` empty. Leak check on the redacted
file: 0 hits for name/EID.

| Fact | Registry claim (pre-run) | Observed live 2026-08-28 (read 1, 19:42:40Z) | Read 2 (19:43:54Z) | Match |
|---|---|---|---|---|
| in RRSS Action List | implied open | YES, one row, 7 cells → same action | identical | yes |
| form / step | — / `Task 1 - Kristina & TES` (§9.19) | `RRSS Separation Request Form` / `Task 1 - Kristina & TES` | identical | = §9.19 |
| action id | `6a8336ee44b521eae41895dc` | `6a8336ee44b521eae41895dc` (deep link settles at `…/actions/<id>/view`) | identical | yes |
| created / status | — | `Aug 17, 2026`; `In Progress`, open/editable (Save / Send Back / Mark Complete rendered, untouched) | identical | = §9.19 |
| document number | `4537` | h1 `4537` | identical | yes |
| Last Day Worked | `08/28/2026` | `08/28/2026` | identical | yes |
| Separation Date | `08/28/2026` | `08/28/2026` | identical | yes |
| Termination Effective Date | `08/29/2026` (registry) | **EMPTY** (DOM value `""`) | identical | **no** — same as §9.19 "absent"; moved to `pending` (§4) |
| Department | `000412 - Housing/Dining/Hospitality` | same | identical | yes |
| Payroll Title Code / Title | `004920` / `STDT 3` | `004920` / `STDT 3` | identical | yes |
| Transaction Number | empty | **EMPTY** | identical | yes |
| Timekeeper Name | (registry value) | string-equal to registry (compared in-process; not reproduced here) | identical | yes |
| Type of Termination | — | `Graduated/No longer a Student` → `UC_INVOL_TERM` / `No Longer Student` | identical | = §9.19 |
| Student Title Code | — | `4920<TAB>- STDT 3` (literal TAB) | identical | = §9.19 |

Facts did not differ in substance from §9.19; no substitution question arose. UCPath was NOT re-read.

## 3 · Units → commits (all merged `--no-ff` in order; every worktree/branch swept)

| Unit | Role | Branch → merge | Commits | Gate in worktree |
|---|---|---|---|---|
| u1r-a | sup-fable | root, no commits | — | `playwright-cli list` empty · `git status` clean |
| u1r-b | sup-opus | `feature/u1r-registry` → `936fabc0` | `56cf0119` RED · `7ddfaf18` GREEN · `7942f95c` · `cb24ab38` · `cc131ae9` | typecheck 0 · lint 0 · 4 files / 53 tests green · guard file 2 red (expected, handed to u1r-c) · manifest no diff |
| u1r-c | sup-fable | `feature/u1r-scenarios` → `52183555` | `b511bdfc` (manifests + guard + guard-inventory + doc 03b D284 built + roadmap) · `b0cb2593` (§10.4/§10.5) · `0dd3d260` (§9.31) | typecheck 0 · lint 0 · 5 files / 87 green · `test:architecture` 69 files / 545 green · manifest no diff · roadmap fresh · diff-check clean |
| u1r-fix | sup-opus | `feature/u1r-fix` → `b1acd712` | `a7e60679` `f22dbb68` `fbf3f6f3` `f676fa24` `3648e38a` `01fa9e11` `74ad14c7` `15c2f15e` | typecheck 0 · lint 0 · 62 green · full `npm run test` 321 files / 3517 · manifest no diff · roadmap fresh |
| u1r-fix2 | sup-sonnet | `feature/u1r-fix2` → `58665183` | `4dfa08ab` `917bfbef` `875bceb9` | typecheck 0 · lint 0 · 48 green · manifest no diff · roadmap fresh |
| u1r-fix3 | sup-opus | `feature/u1r-fix3` → `c4dd2589` | `ff3c77da` `3db56c44` `f74fe0b5` `972e5fe5` | typecheck 0 · lint 0 · 70 green · full `npm run test` 321 / 3519 · manifest no diff · roadmap fresh |
| u1r-fix4 | sup-sonnet | `feature/u1r-fix4` → `19ae352a` | `1a5fecfa` `dd8a48b3` | typecheck 0 · lint 0 · 58 green · manifest no diff · diff-check clean |

Supervisor verification per unit: `git log` vs report, clean `git status`, gates re-run by the supervisor
in the worktree before each merge. Throwaway mutation proof of the guard's literal pins (in the u1r-fix
worktree, reverted): a second registry entry → 4 guard cases red; dropping `pending` → 3 red.

Another session committed docs-only plan files onto `integration/03b` during the run (`f17781e8`,
`766f2548`); they are not part of this run and were left as found.

## 4 · Reviews (native read-only roles; every cited line verified by the supervisor)

| Range | Axis · role | Findings | Disposition |
|---|---|---|---|
| u1r-b `24349da3..cc131ae9` | correctness · sup-opus | 1 medium (hand-copied pending key list) · 2 low · 1 judgement | fixed in u1r-fix #2, #5, #8 |
| same | silent-failure · sup-opus | 2 medium (`terminationEffectiveDate` authored as observed → `pending`; vacuous `every`) · 2 low · 1 judgement | fixed in u1r-fix #1, #3, #6, #7 |
| same | tests · sup-sonnet | 1 medium (chain-arm refusal test not asserting `error.name`) | fixed in u1r-fix #4 |
| u1r-c `936fabc0..0dd3d260` | docs · sup-sonnet | 2 medium (commit citations "this commit") | fixed in u1r-fix2 #5–6, fix3 #6 |
| same | tests · sup-sonnet | 0 · 1 judgement (prove literal pins red) | mutation proof above |
| same | correctness (manifest expectations vs code) · sup-opus | 0 medium+ · 3 low (stale citations) · 1 judgement (`armsDeclaredBy` hardcoded keys) | fixed in u1r-fix2 #1–4 |
| u1r-fix `52183555..15c2f15e` | silent-failure · sup-opus | 3 medium (`.refine` misses `{key: undefined}`; `workflowArm` catch-all else; stale two-key invariant in `guard-inventory.json`) | fixed in u1r-fix3 #1–3 |
| same | tests · sup-sonnet | 2 low · 1 judgement | fixed in u1r-fix3 #4–5 |
| u1r-fix3 `58665183..972e5fe5` | silent-failure · sup-opus | 0 medium+ · 2 low (guard pinned `Object.keys(pending)` rather than defined reasons; `declaredWorkflows` hardcoded) — `{}`, `{key: undefined}`, `null`, `""`, unknown key and `__proto__` spellings all verified refused at runtime | fixed in u1r-fix4 |
| u1r-fix4 `c4dd2589..dd8a48b3` | review skipped | — | mechanical `sup-sonnet` unit, 43 lines in the already-reviewed seam, each change pinned by the guard/unit test named in its commits |

Judgements recorded, not actioned (each needs its own decision): `lastObserved` is never compared to the
clock (staleness policy); the `.partial()` public surface could in principle carry an authored
`transactionNumber` (only convention + `pending` stop it); a bug corrupting the pending schema would hide
from a test that derives its expectation from the same schema.

## 5 · Integrated gate on `c4dd2589` (root, `integration/03b`)

Final integrated sha `19ae352a` (fix4 merge). Logs in this session's scratchpad (`gate-19ae352a.log`,
`coverage-rerun2-19ae352a.log`, `parity-base-24349da3.log`).

| Gate | Result on `19ae352a` |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 (`--max-warnings 0`) |
| `HRAUTO_LEGACY_REPO=… npm run test:coverage` | **exit 0 — 321 files / 3520 tests passed**; coverage statements 84.68 % · branches 74.81 % · functions 87.64 % · lines 86.7 % (run alone at load 14; two earlier runs at load 16–22 lost 2–5 files to 30 s hook/test timeouts while a parity build ran concurrently — the documented macOS load flake; every timed-out file passes alone: `5 passed / 54 tests`) |
| `npm run test:parity` | **exit 1 — 22 failed / 217 passed, PRE-EXISTING**: all 22 are `a11y reference drift` on `descriptorHash` (`2d49cb23…` frozen vs `0d397a00…` actual) for `start-run-separations` ×6, `explorer-graph` ×6, `explorer-transaction` ×6, `separations-start-input` ×4. The identical 22 fail at this run's base `24349da3` (detached worktree, `parity-base-24349da3.log`). This run changed nothing under `src/dashboard`, `tests/parity` or any descriptor closure (`generated-build-manifest.ts` byte-identical `24349da3..19ae352a`). Provenance: the manifest last moved in R2c's `56781246` `a5f53274` `3336419a`, after the last deliberate refreeze `0f4c3605`; no refreeze followed. A refreeze is `test:parity:update`'s deliberate act and outside this brief's scope — residue for the coordinator. |
| `npm run build:manifest` | exit 0, **no diff** |
| `npm run roadmap` · `roadmap:check` | exit 0, no diff, `docs/roadmap/index.html is fresh.` |
| `git diff --check` | clean |
| `git status --short` | only this report (untracked until the close commit) |

Worktree sweep: `git worktree list` shows no `u1r*` worktree; `git branch --list 'feature/u1r*'` empty;
`.hr-rebuild-worktrees/` empty; `playwright-cli list` → no browsers. Pre-existing `~/.codex/worktrees/*`
worktrees and their `feature/dc*` branches belong to other sessions and were not touched.

## 6 · Board close

`docs/plans/03b-board.md` re-read at `19ae352a` immediately before writing: blob
`c1599f8deedc2ed816e4142a8e68dbe8fa4c95ff` — **unchanged since intake** (last touched by the brief commit
`24349da3`). Written under the authorization in the supervisor prompt, this exact path only: the
`u1r-a–d` ledger row replaced with the merged/closed row (shas, gate, reviews, evidence), the run-order
fact line marks R2/u1r complete at `19ae352a`, and one `R2/u1r residue` bullet (items (a)–(f) of §7).
New blob `381c71b7b09aa8dc4ce3b3813b232dcbfe109e0b`. The close commit carries only this report and the
board. No handoff was written (successful close).

## 7 · Residue (named, for the coordinator)

- **`.env` lacks `HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EID`** (only the commented
  `.env.example` line exists). Irrelevant while the finalization arm is `pending`, but the standalone
  finalization resolver will defect by name on that missing secret the day `pending` clears. Operator action.
- **`config/test-subjects.json` carries `employeeName` and `timekeeperName`** (pre-existing since u11/u12;
  the finalization ingress requires both). Doc 03b's registry prose says names stay out of the repo. Not
  widened here — a coordinator/operator judgment (secret-reference the two leaves, or amend the prose).
- **`docs/plans/2026-08-27-separations-feature-map.md` lines ~193–200** still tabulate the retired labels;
  a plan artifact (coordinator-owned), not an authority — left as found.
- `.env` lines 27 and 38 carry unquoted values that make `source .env` emit zsh parse warnings (the two
  needed vars load fine). Not touched.
- The next u1 (`dryRun=true` on `finalization-canary`, composed `separations`) is operator-authorized after
  this run integrates. Live facts the manifest cannot settle: the WFD range-field wall at `timecard`
  (§9.29/§9.30) and resume-freshness (4 h) — a run today may refuse before `clear-pending`; UCPath was not
  re-read on 08-28, so the `already-present`/`live-probe` arm stands on §9.19.
- Two `sup-fable`, three `sup-opus`, three `sup-sonnet` execution/review dispatches plus five `sup-opus`
  reviewers; no `sup-scout`/`sup-analyst` was needed. One supervisor slip: a merge command ran inside a
  worktree (no-op) and a worktree was created under the wrong parent — caught, removed, redone from the root
  with absolute paths (the `worktree-agent-traps` cwd-drift trap, again).
