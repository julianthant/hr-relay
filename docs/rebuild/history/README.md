# `history/`

Records superseded by the owning docs wherever they differ — kept so nothing is deleted; **never
cite as normative.**

Everything here was true when it was written and is preserved verbatim. What is normative now lives
in the phase docs (`docs/rebuild/00`–`05`), the contract specs (`docs/rebuild/reference/`) and the
tree plus its governance prose (`docs/roadmap/roadmap.md`). Each file carries a one-line header
naming its successor; the tables below say the same thing in one place, with the old filename in
the **what it was** column so an old citation resolves.

Cross-references *inside* these files still name their siblings by the pre-2026-08-20 filenames
(`<what>-<date>.md`, `NN-review.md`) and their subjects by the old doc numbers. That is deliberate:
the files are kept as written, and correcting them would make the record a second, quieter opinion
about the past. Read a name here through the tables below.

This folder was `docs/rebuild/reviews/` until 2026-08-20 (cohesion plan ruling R6, step 3d).

## `doc-reviews/` — adversarial reviews OF a design doc

| file | date | what it was | what superseded it |
|---|---|---|---|
| `2026-07-17-task-contract-review.md` | 2026-07-17 | was `reviews/01-review.md` — adversarial review of doc 01 (the task contract): nine findings, two BLOCKERs (parked/polling tasks; session ownership), verdict "buildable with amendments" | `reference/task-contract.md`; resolutions in `reference/decisions.md` round 1 (D4, D5, D15) |
| `2026-07-17-workflow-model-review.md` | 2026-07-17 | was `reviews/02-review.md` — adversarial review of doc 02 (the workflow model): docs 01/02 described two different systems at the task-identity seam, plus two correctness holes | `reference/workflow-model.md`; `reference/decisions.md` round 1 (D1–D3, D6–D9, D16) |
| `2026-07-17-dashboard-surfaces-review.md` | 2026-07-17 | was `reviews/03-review.md` — adversarial review of doc 03 (the tracker dashboard): two incompatible `SpanEvent` wire contracts, and both flagship mechanisms checked against the OCR happy path | `reference/dashboard-surfaces.md`; `reference/decisions.md` round 1 (D1, D10–D14) |
| `2026-07-18-write-safety-review.md` | 2026-07-18 | was `reviews/09-review.md` — skeptic pass over doc 09 and its 10/11 seams: exactly-once sound only with amendments; same-key concurrent double-file found | `reference/write-safety.md`; `reference/decisions.md` round 2 (D17–D22) |

## `design-inputs/` — memos the design was built from

| file | date | what it was | what superseded it |
|---|---|---|---|
| `2026-07-22-second-look.md` | 2026-07-22 | was `second-look-2026-07-22.md` — whole-program second-look review after Codex's three passes: six parallel audits (docs, legacy typing, bug archaeology, authoring cost, lessons), recommendations only | `reference/decisions.md` round 8 (D73–D86 — the operator answers this file's §6.5/§6.6 recorded) and, per decision, each answer's owning doc |
| `2026-07-25-delegation-layouts.md` | 2026-07-25 | was `delegation-layouts-2026-07-25.md` — delegation topology, shapes and layouts across all 16 legacy workflows; §7 posed twelve questions | `reference/dashboard-surfaces.md` §9 (D6–D20), which wins on any disagreement and explicitly supersedes §7 Q1, §4's ladder and half of §7 Q10 |
| `2026-07-25-demo-feature-plan.md` | 2026-07-25 | was `demo-feature-plan-2026-07-25.md` — the coverage plan that made `?view=rebuild-demo` a faithful preview of every capability the rebuilt backend serves; do not execute its tiers | `reference/frontend-backend-integration.md` (the production wiring/completeness contract); the build sequence is the phase docs `00`–`05` |
| `2026-07-25-legacy-keep-ditch.md` | 2026-07-25 | was `legacy-keep-ditch-2026-07-25.md` — keep/ditch ledger for the legacy Queue Row + Log Panel, against 114 special-casing sites in 30 files | `reference/dashboard-surfaces.md` |
| `2026-07-25-shell-build-spec.md` | 2026-07-25 | was `shell-build-spec-2026-07-25.md` — pixel spec for Top Bar · Workflow Panel · Status Bar · Session Panel, extracted from the shipped legacy dashboard | `reference/dashboard-surfaces.md` for the naming canon and the surface contracts. Its pixel detail has **no successor doc** — the shipped `src/dashboard/` is the as-built |
| `2026-07-26-gap-audit-round2.md` | 2026-07-26 | was `gap-audit-round2-2026-07-26.md` — round-2 gap audit over the full 12-doc corpus (a re-run of doc 08's method): six ranked gaps, no BLOCKER, headline "nothing owns the operator's attention" | the owners it recommended: `reference/operator-trust.md` (the cross-run operator work queue), `reference/execution-and-sessions.md` (kernel self-health), `reference/dashboard-surfaces.md` (retention/growth, archive sizing, single-instance safety) |
| `2026-07-27-testing-system-plan.md` | 2026-07-27 | was `testing-system-plan-2026-07-27.md` — coverage policy, test-value standard, suite sizing and legacy-suite preservation; RATIFIED 2026-07-31 as D91 | `reference/guards-and-tests.md` (D91). Still named as the `owner` of the `legacy-test-disposition` entry in `guard-inventory.json` — a live guard owned by a history file, to be re-owned by the guards-and-tests rewrite |
| `2026-07-28-backend-capabilities-from-the-demo.md` | 2026-07-28 | was `backend-capabilities-from-the-demo-2026-07-28.md` — the harvest of what the demo programme proved the backend must serve, item by item with evidence | `reference/frontend-backend-integration.md` (which still cites this file as its backend-discovery record) |
| `2026-07-28-operator-feedback-screenshots.md` | 2026-07-28 | was `operator-feedback-2026-07-28-screenshots.md` — the operator's numbered screenshot feedback on the rebuild demo, transcribed so the surface is locatable from the text without the images | `reference/dashboard-surfaces.md` §9 and the shipped `src/dashboard/` surfaces |

## `superseded/` — prose an owning doc has overtaken

This folder also receives the narrative the per-doc rewrites (cohesion plan step 5) fold out of the
reference and phase docs, one file per source section, named
`YYYY-MM-DD-<source-doc>-<section>.md`. Nothing is deleted: a section that stops being true moves
here with a header naming the doc that now answers it.

| file | date | what it was | what superseded it |
|---|---|---|---|
| `2026-08-20-frontend-backend-integration-1.3.md` | 2026-07-30 | was `reference/frontend-backend-integration.md` §1.3 — the audit's list of integration requirements the reference specs did not yet carry (bootstrap document, resumable subscription, panel-kind projection, start/enqueue contracts, command families, Review patches, one count family, archive snapshots, capture metadata, contextual command results) | `reference/frontend-backend-integration.md` §3 / §5 / §5.1, whose sections now carry each item as built or as a named absence; the file's own tail table maps item → section |
| `2026-08-20-03b-separations-status-2026-08-14.md` | 2026-08-14 | was `07-master-plan.md` §3.1's "Separations' §3.2 status, 2026-08-14" block, carried into `03b-finish-separations.md` by the shelf split — the 8-of-9 reading as it stood before the canary was named, before D221 was live-proved and before the browser-profile wedge was root-caused | `docs/rebuild/03b-finish-separations.md` §Phase summary / §Separations — order 8, the first migration / §Exit criteria, and `docs/migrations/separations.md` §9.19 · §9.20 · §9.22 · §9.24; the file's own header lists what moved |
| `2026-08-20-master-plan-dissolved.md` | 2026-08-20 | `docs/rebuild/07-master-plan.md` exactly as it stood at commit `8bd97c2f`, preserved when step 3b distributed it | the phase docs `00`–`05` and `docs/roadmap/roadmap.md` §Governance; the file's own header carries the 35-row § → destination table (`ce5d87fa`). Still named as the `owner` of the planned `one-time-import-offline` entry in `guard-inventory.json`, whose invariant already points at `doc 05 §Exit criteria` |
| `2026-08-20-05-cross-repo-accounting.md` | 2026-07-31 | was `07-master-plan.md` §4's "Legacy maintenance continues, accounted cross-repo (D90/D94)" paragraph, carried into `05-cut-over.md` by the shelf split — the mandatory commit-legacy-first sequence, the schema-v2 record set, and the clean-worktree rule | **D150** (2026-08-05) retired the accounting; `docs/rebuild/05-cut-over.md` §Phase summary now states what is true — the invariant moved to mandatory live re-verification at each workflow's migration, and `config/legacy-change-accounting.json` is a frozen record read by nothing |
| `2026-08-20-guards-and-tests-legacy-change-accounting.md` | 2026-08-02 | was `reference/guards-and-tests.md` §3.13's account of what the `legacy-change-accounting` guard enforced — the commit-centred schema v2, the `(commit,path)` record set, F1–F4, the clean-worktree rule | **D150** (2026-08-05) retired the guard; the invariant moved to live re-verification at each workflow's migration (`03c-migrate-the-remaining-workflows.md`). `reference/guards-and-tests.md` §3.13 keeps the retirement statement and points here; `config/legacy-change-accounting.json` stays in the tree as a frozen record |
| `2026-08-20-guards-and-tests-stub-lane.md` | 2026-07-22 | was `reference/guards-and-tests.md` §7's stub-lane migration plan — `maybeWrapE2EStub`, per-workflow `StepDataFn`s, and D3's plan to derive the stub map from each contract's `example` | **Never ported.** Verified against the tree 2026-08-20: no `maybeWrapE2EStub` / `StepDataFn` / `stub-workflows` anywhere in `src`, `tests`, `scripts` or `config`, and no runtime reader of `.example`. `reference/guards-and-tests.md` §7 now states the absence and §10 is what replaced it — every test that must RUN a workflow is a live dry-run scenario |
| `2026-08-20-operator-trust-1d-seed.md` | 2026-08-01 | was `reference/operator-trust.md` §"Phase 1d as-built seed" — the 2026-08-01 snapshot of the FIRST registry/driver slice (UCPath Person Org, two ported selector rows, `external-commit` still prohibited) | `reference/operator-trust.md` §1.6 (what the Phase-1d seam ratified) and §1.7 (what the four store registries hold today: 406 pinned legacy keys, Kuali's commit element) |
| `2026-08-20-operator-trust-5.4-dsl-authoring.md` | 2026-07-24 | was `reference/operator-trust.md` §5.4's *(Historical rejected DSL design—do not implement.)* paragraph — codegen, isolated build, restart-gated apply, exact-hash rollback | `reference/operator-trust.md` §5.4, which states what D79a's trim LEFT: two apply levels, presentation-only overrides and a reviewed code-change brief |
| `2026-08-20-dashboard-surfaces-amendment-log.md` | 2026-07-22 → 2026-08-14 | was `reference/dashboard-surfaces.md`'s opening `Status:` paragraph and its nine dated `**Amended …**` sentences — a chronology of when the doc grew the command protocol, §9's row-model series, §10's Round-8 obligations, §5's cross-repo boundary, Phase 1f's ratification and D219's grouping rule | `reference/dashboard-surfaces.md`'s rewritten header (what the doc IS, what it owns, the § number map) and each amended section, which states what is true rather than what changed on a date |
| `2026-08-20-dashboard-surfaces-phase-1c-stage-deltas.md` | 2026-07-31 → 2026-08-01 | was `reference/dashboard-surfaces.md`'s four `## Phase 1c Stage A–D as-built …` blocks, which stood above `## 0.` — the domain shell, the native storage adapter + migration v1, the verified backup + offline restore primitive, and the authority-write seam + migration v2, each closing on what Phase 1c still owed | `reference/dashboard-surfaces.md` §2.3 (the table classes and the generation rule), §2.4 (the command families), §2.5 + its D181 as-built (backup, doctor, restore, the process locks) and `ref write-safety` §5 (beat ⑦); the "Phase 1c remains in progress" framing died with Phase 1 on 2026-08-04 |
| `2026-08-21-03c-phase-summary-migration-loop.md` | 2026-08-20 | was `03c-migrate-the-remaining-workflows.md` §Phase summary — the seven-step migration loop as step 3b moved it out of the dissolved master plan (§3 + §3.1), stating the phase's GOAL rather than its state | `03c` §The seven-step migration playbook (2026-08-21) — the same seven steps, each expanded into its artefacts and its gate, with D150's retirement of legacy change accounting, R10's T1/T2/T3 artefacts and the `Dashboard · wire` sub-task folded in; §Phase summary now states the honest state at HEAD |
| `2026-08-20-dashboard-surfaces-shell-widths.md` | 2026-07-27 → 2026-07-28 | was the *superseded numbers* block inside `reference/dashboard-surfaces.md`'s *Shell and layout as rebuilt* — the two-tier queue widths (400px at 1180–1479, 470px at ≥1480) and the measurements that produced them (the review's 464px centre floor, 1480 = 470 + 348 + gaps) | `reference/dashboard-surfaces.md` §9.9, where the queue and the context rail share ONE 376px resting width and the detail region's own split is a container query at `@min-[868px]/detail` / `@min-[1068px]/detail` |

## How to add to history

1. **Name it date-first**: `YYYY-MM-DD-<what>.md`, where the date is when the content was *written*,
   not when it moved. Recover it from the file's own title before trusting `git log` — every file
   in this folder was added to the repository on 2026-07-31, the day the rebuild tree was seeded.
2. **Give it a one-line header**, at the very top, naming what took over:

   ```
   _History — superseded by <owner> (see `history/README.md`); kept verbatim as written on <date>._
   ```

   Then change nothing else inside it — a record that gets edited is not a record.
3. **Put it in the folder that matches its kind**: `doc-reviews/` a review of a doc ·
   `design-inputs/` a memo the design was built from · `superseded/` prose an owning doc overtook.
4. **Add its row to the table above** (file · date · what it was · what superseded it; `—` only
   when genuinely nothing succeeded it), and repoint whatever cited the old path.
