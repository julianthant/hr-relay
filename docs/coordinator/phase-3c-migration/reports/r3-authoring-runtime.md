# R3 / R3b supervisor report — authoring runtime foundation, stabilized

**Status:** COMPLETE — u25–u28 done; integrated gate green on the run branch; ready for the coordinator's `--no-ff` merge into `feature/03c-workflow-migration`. u19's remaining slice (guide, root rules, agent reference, deletion inventory execution, reference reconciliation) is residue for R3c/R3d, not claimed here.

**Mode:** coordinated-read-only
(`/Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/phase-3c-migration/board.md`, read at
primary HEAD `b7393ed6`, blob `79e97b3c`; never written)

**Coordination:** `57c2dec9-138e-4578-b5da-389ad9b4007a` · `C57c2dec9` · R3 (session `e266c808`, over cap) +
R3b (session `7dee2c47`, this report)

**Worktree / branch:** `/Users/julianhein/Projects/hr-automation-rebuild/.hr-rebuild-worktrees/phase-3c-migration-c57c2dec9-r03-authoring-runtime` ·
`feature/phase-3c-migration-c57c2dec9-r03-authoring-runtime`

**Integration base:** `e5b60489` (merge-base with `feature/03c-workflow-migration`) · R3 range
`8a931cc6..c1bdcf68` (26 commits) · coordinator safety commit `0566b181` · R3b range `0566b181..fcf90cf0`

**Scope:** R3 landed u15–u18 and a slice of u19; R3b (u25–u28) finished the in-flight review-fix set,
re-verified every R3 seam, ran the integrated gate and wrote this report. No feature work, no external
write, no board write, no other branch touched.

## Outcome by unit — R3 (u15–u19)

| Unit | Outcome | Commits |
|---|---|---|
| u15 — workflow-only API, task catalog, four-artifact guard | D317 `defineWorkflow`/`compileWorkflow`/`WorkflowDefinition` replace the recipe seam; generated task-store catalog; Explorer briefs name `workflow.ts`. | `8a931cc6`, `e7f305b3`, `e9fe6ff2`, `acd7ed1b`, `6a20f4fc` |
| u16 — closed entry algebra | Explicit `task \| parallel \| delegate \| gate \| transaction` entries compile to existing runtime nodes; every kind proved to compile, project and retry a failed parallel leaf alone. | `51ec6253`, `2527c149` |
| u17 — whole-step omission (D313) | Definition/plan/executor admission; refusal + provenance matrix; no mid-run prompt. | `b35572cf`, `df40ce18` |
| u18 — D314 recovery + D318 `live-read` | Resume/Restart as next attempts without repeat writes; kernel/executor/sequencer mutation proofs; parity refrozen for the two recovery choices; `live-read` T1b arm through the ordinary path with arm refusals; persisted result bound to its arm. | `7dd401bb`, `785326a0`, `2be6fb5e`, `9c69a7f5`, `10253a5c`, `9a29f723`, `678b0f6d`, `46606feb` |
| u19 (slice) — equivalence, T1 pair, harness conversions | Person Lookup canonical T1 pair with D314 arms and a recorded met `live-read` result; every T1b manifest uncollected; step identities without fragments; four separations harnesses author `workflow.ts` (kronos-timecard, ucpath-termination, kuali-finalization, kuali-read); grouping/options-only mutation proof. | `feb50828`, `208e9837`, `9e0bd2be`, `1cf92142`, `ffe18cf2`, `e2cfdc39`, `a55b2964`, `39c10a52`, `c1bdcf68` |

u19 residue (guide, root rules, agent reference, deletion inventory, `ref stores`/`workflow-model`
reconciliation) is listed under "Residue for R3c / R3d" below; it is NOT done.

## Outcome by unit — R3b (u25–u28)

| Unit | Outcome | Commits |
|---|---|---|
| u25 — finish the in-flight review-fix set | Each of the seven `0566b181` intents dispositioned (table below); the five `TS2554` call sites fixed; a red-capable test per kept fix; review findings applied (below). | `766632db`, `1823608a`, `eb0feed3`, `f3079fb1`, `d933c9bc`, `001b367c`, `854288b9`, `02d7e574`, `70023520`, `20b3cf12` |
| u26 — re-verify R3's committed seams | sup-opus ran 227 seam files (80 R3-changed test files ∪ importers of 48 R3-changed src modules ∪ the 71-file guard suite ∪ the 3 structural scenarios) in 12 batches at `001b367c`: 3,147 tests, 18 failed — 1 genuine (`step-omission-d313.test.ts`: the fixture compiler minted a fresh manifest per compile and tripped the new identity-keyed memo refusal; fixed in `02d7e574` and re-run green) and 17 environmental (`compose-real-port`, `worker-pool-composition`, `worker-pool-parallel-proof`: a foreign dev dashboard held 127.0.0.1:3938/5174 — `owner-proof-unconfigured`; the dashboard was stopped before u27 and those files pass in the full gate). `npm run build:manifest:check` current. | none (read/run only) |
| u27 — integrated gate | every gate line green at the frozen tree (table below); parity was red on first assert (208 a11y drifts from committed R3 work, 0 visual-first drifts), refrozen once with the stated reason in `fcf90cf0`, then re-asserted 287/287 | `fcf90cf0` (parity refreeze) |
| u28 — this report | committed on the run branch | this file |

### u25 — disposition of the `0566b181` fix intents

| Intent | Disposition | Red-capable proof |
|---|---|---|
| delegate node refuses `live-read` (`liveReadGraphRefusal`, child-run arm) | kept | `tests/unit/dry-run-scenario-live-read.test.ts` — delegating fixture descriptor refused by the exact production string; person-lookup admitted; separations refused on transactions (`1823608a`) |
| explicit arm switching (manifest arm is the authority; case shape must agree) | kept | runner: `evaluateDryRunScenarioEvidence("live-read", previewCase, …)` throws; runtime: live-read manifest + preview case and preview manifest + live-read case both refuse before any graph/effect check (`766632db`, `1823608a`) |
| manifest-keyed compile memoization | kept | `tests/unit/workflow-definition.test.ts` — same manifest returns the same compile, a structurally equal second manifest refuses; proved red by disabling the check (`eb0feed3`) |
| queued-span `recovery` (D314) | kept | `tests/unit/run-queued-span-step-omission.test.ts` — restart carries `recovery` beside `retryOf`, resume/ordinary omit it; proved red by dropping the projection line (`f3079fb1`) |
| drift-before-fresh-fact ordering (write sequencer) | kept | `tests/unit/write-sequencer-restart-no-repeat.test.ts` — real sequencer + DB with BOTH drift and a missing permanent intent: the drift refusal fires, the fresh-fact message does not (`d933c9bc`, sup-opus) |
| safe restart parsing (`safeParse` in the restart classifier) | **reverted** to a direct `stored.runId` read | `stored` is already the repository's strict parse (`runCheckpoints.latest` fails loud on a malformed row), so the lenient re-parse was unreachable and, if ever reached, would classify an unparseable row as "another run's" — the silent-classification pattern the fail-loud rule forbids. Reachable behaviour unchanged; the foreign-run restart arm stays pinned by `tests/unit/run-executor-restart.test.ts` (`001b367c`) |
| doc twins (AGENTS.md/CLAUDE.md D313 paragraph; ref workflow-model D313 "built") | kept as landed | `cmp AGENTS.md CLAUDE.md` identical; no further text change needed |

## Review record

Target `0566b181..20b3cf12` (u25 fix-set completion). Axes run: Correctness (sup-opus), Silent failures (sup-opus),
Tests (sup-sonnet). Skipped: Standards (*rules restated in the briefs; lint/guards green*), Spec (*the originating
spec is the 0566b181 commit message, tabled above*), Performance (*no hot path changed*), Docs (*no doc changed in
R3b*), Security (*supervisor-owned: the only trust-boundary change is the live-read allowlist, which fails closed*).

| Axis | Finding | Disposition |
|---|---|---|
| Correctness | `src/events/types.ts` re-declared the recovery enum (low) | fixed `70023520` — reuses `RunRecoveryModeSchema` |
| Correctness | `run-executor.ts:800,818` still re-parse the strict-parsed `stored` (low) | deferred: pre-existing R3 lines, a no-op re-parse of an already-strict record, not a silent-failure path; R3c/R3d cleanup candidate |
| Correctness | live-read test hardcoded the arm literal (judgement) | fixed `20b3cf12` — passes the checked-in manifest's arm |
| Correctness | "before any effect" pinned only by a rejecting `drainWorker` (judgement) | accepted as-is: the refusal precedes `AuthorityDatabase.open` in `runtime.start`; no authority row can exist |
| Correctness | memo refusal unreachable in production — no caller passes `options.manifest` (judgement) | accepted: the option is test-only; the guard protects the fixture path that u26 proved live |
| Silent failures | restart guard `stored.runId !== runId` lets a REQUEUED restart run replay its own earlier-attempt read checkpoints (medium) | **ruled not a defect**: D314 forbids replaying checkpoints ANOTHER run produced; a requeued restart run's own rows are the fresh reads it already re-executed, and it replays them exactly as any requeued run does through `loadCheckpoint`. The asserted-row branch's stricter attempt equality binds an operator assertion to its exact attempt, a different invariant. Flagged for the coordinator as a D314 wording question (should the reference say "another run" or "another attempt"?), not a code change |
| Silent failures | `liveReadGraphRefusal` was a denylist — a future node kind would be admitted into a `dryRun=false` run by default (low) | fixed `854288b9` — explicit allowlist `task/branch/parallel/gate`; unclassified kinds refuse by name; a test pins admitted + refused == `GraphNodeKindSchema` |
| Tests | five new tests each red-capable against its fix; the run-executor revert is intentionally uncovered (unreachable malformed-row path) (judgement) | accepted; the revert's commit message states it |

Count: Correctness 5 · worst low — Silent failures 2 · worst medium (ruled judgement) — Tests 1 · worst judgement.
Post-fix re-verification: the changed suites, the 72-file guard suite (701 tests) and the full gate below.

## Gates (u27) — integrated tree at `fcf90cf0`

All gates were run by the supervisor in this worktree with `HRAUTO_LEGACY_REPO` exported, no dev dashboard
listening (stopped first), and a foreign Codex vitest run sharing the host CPU.

| Gate | Tree | Result |
|---|---|---|
| `python3 ~/.claude/skills/supervise/scripts/check-role-policy.py --platform claude --repo "$PWD"` | — | `claude: role policy valid (4 workers)` exit 0 |
| `npm run typecheck` | `20b3cf12` | 0 `error TS` lines, exit 0 |
| `npm run lint` (`--max-warnings 0`) | `20b3cf12` | `LINT_EXIT=0` |
| `npm run test:coverage` (alone) | `20b3cf12` | `Test Files 401 passed (401)` · `Tests 4921 passed (4921)` · Duration 124.43s · All files 85.48 % stmts / 76.54 % branches / 89.43 % funcs / 87.41 % lines · `COVERAGE_EXIT=0` |
| `npm run test:parity` (first assert) | `20b3cf12` | RED: `208 failed / 79 passed` — every failure an a11y reference drift; categories: descriptor/impl fingerprint prefixes moved (header `descriptorHash` and on-screen), `person-lookup(.runtime).scenario.test.ts` → `structural.scenario.test.ts`, `Scenarios 7 registered` → `9` with `resume-from-checkpoints`/`restart-from-start`; no layout/structure line changed (mechanically checked over `git diff -U0` of every a11y file) |
| `npm run test:parity:update` | `20b3cf12` (frozen) | `287 passed`; 503 files under `tests/parity/references/` (228 a11y, 228 meta, 47 png), nothing outside |
| `npm run test:parity` (re-assert) | `fcf90cf0` content | `287 passed (54.0s)` `PARITY_EXIT=0` |
| `npm run build:manifest:check` | `20b3cf12`, re-run at `fcf90cf0` | `src/domain/workflow/generated-build-manifest.ts is current.` |
| `npm run roadmap:check` | `20b3cf12` | `docs/roadmap/index.html is fresh.` |
| `git diff --check` and `git diff 0566b181 --check` | `20b3cf12`; re-run at the report commit | clean |
| `cmp AGENTS.md CLAUDE.md` | `fcf90cf0` | identical |
| Live systems | — | none touched by R3b (no live run, no browser session; `playwright-cli list` → `(no browsers)`) |

`fcf90cf0` changes only `tests/parity/references/**`, so the typecheck/lint/coverage/roadmap/manifest results at
`20b3cf12` hold for it; the report commit is docs-only.

## Worker ledger (R3b)

All workers ran sequentially inside this one worktree (allowance 1, no worker worktrees, no worker
branches); every row is closed — nothing to remove.

| Unit | Role · visible description | Result |
|---|---|---|
| u25.2 | `[sup-opus] phase-3c-migration C57c2dec9 R3b U25.2 — kernel regression tests` | partial: drift-ordering test committed `d933c9bc`; safeParse test correctly reported unreachable → supervisor reverted the hunk (`001b367c`) |
| u28-scout | `[sup-scout] phase-3c-migration C57c2dec9 R3b U28-scout — residue inventory` | returned the residue tables below |
| u26 | `[sup-opus] phase-3c-migration C57c2dec9 R3b U26 — re-verify R3 seams` | returned partial-by-design: all batches run, reds reported verbatim, nothing fixed; the D313 red was fixed by the supervisor |
| review | `[sup-opus] review correctness`, `[sup-opus] review silent failures`, `[sup-sonnet] review tests` (u25 diff) | see Review record |

Harness-internal task ids are not reproduced here (tool policy); the visible descriptions above are
the exact dispatch names.

## Residue for R3c — deletion inventory (open) and Separations T1b

Deletion inventory — what R3b believes is leftover old-path/adapter surface (verified by read, not
deleted; R3c owns the deletion test):

| Path | Kind | Note |
|---|---|---|
| `src/workflows/separations/kronos-timecard/{node-ids,nodes,step,omission}.ts` | fragment factory beside `workflow.ts` | `workflow.ts` exists; fragment files still present |
| `src/workflows/separations/kuali-extraction/{node-ids,nodes,step}.ts` | fragment factory beside `workflow.ts` | same |
| `src/workflows/separations/kuali-finalization/{node-ids,nodes,step,omission}.ts` | fragment factory beside `workflow.ts` | same |
| `src/workflows/separations/ucpath-transaction/{node-ids,nodes,step,omission}.ts` | fragment factory beside `workflow.ts` | same |
| `src/workflows/separations/identity-check/{descriptor,module,node-ids,nodes,step}.ts` | hand-authored `descriptor.ts`, no `workflow.ts` | unconverted step folder |
| `src/workflows/separations/job-summary/{node-ids,nodes,step}.ts` | fragment factory, no `workflow.ts`/`descriptor.ts` | unconverted step folder |
| `src/base/workflow-recipe.ts` | — | already gone; `src/base/` holds only `workflow-definition.ts` + `workflow.ts` |
| `config/pending-impl-bindings.json` | — | `tasks: []`, nothing open |
| root `AGENTS.md`/`CLAUDE.md` D265-review convention (`defineWorkflowStepNodeFactory` paragraph) | doc convention still normative | retire or rewrite with the fragment deletion |
| `docs/rebuild/03c-migrate-the-remaining-workflows.md` L73/L75/L105/L218–219 | stale `workflow-recipe.ts`/`defineWorkflowRecipe` references and unchecked checklist items | update with the deletion |
| `docs/rebuild/reference/workflow-model.md` L1009/L1011 | stale recipe references (L1104 forbidden-names clause stays) | update with the deletion |

`person-lookup/` and top-level `separations/` are fully converted (`workflow.ts` only).

Separations T1b — blocked re-run state: `tests/scenario/workflows/separations/dry-run.scenario.ts` declares
`arm: "dry-run-preview"` on subject label `finalization-canary`; `config/test-subjects.json` records that label
`availability.state: "gone"`, `lastObserved: 2026-09-01`; `docs/migrations/separations.md` status
(2026-09-02): "BUILT and available for historical dry-run inspection; controlled completion BLOCKED by the test
protocol." No replacement canary was chosen (D284 rule); the re-run stays blocked until the coordinator/operator
supplies one.

## Residue for R3d — guide, root rules, agent reference, reference reconciliation

- `docs/guides/workflow-authoring.md` does not exist.
- Root `AGENTS.md`/`CLAUDE.md` carry the D311–D317 convention paragraph (L398–L414) that still says "At
  implementation baseline `b1b36349` the bounded compiler still uses transitional `workflow-recipe.ts`
  names… Finish 3c-A's D317 rename/direct-entry/deletion gate before starting Order 1" — the rename is done,
  the deletion gate is not; rewrite once R3c deletes.
- No `.agents/skill-library/*` or `.claude/skills/*` file mentions `defineWorkflow` — the internal agent
  reference is unwritten.
- `docs/rebuild/reference/stores.md` has no D317/catalog mention (only `defineWorkflowStore`); reconcile with
  the generated task-store catalog.
- `ref workflow-model` §1.6 is titled for D311/D317; §5.6 ("The four scenarios") and §5.8 ("Step omission
  (D307)") still need the D313/D318 text the root convention paragraph cites.

## Environment notes

- A dev dashboard from the primary checkout and a Codex vitest run from `feature/test-r3a-server-runtime` were
  running on this host during R3b; the dashboard (pids on 3938/5174) was stopped with `pkill -INT -f scripts/dev-dashboard.ts` before u27 as the brief directs, leaving zero listeners; the foreign vitest forks were left alone and are the likely cause of any elevated gate duration.
- `npm run build:manifest` at `f3079fb1` and again at `001b367c` produced zero diff — the manifest is current.
