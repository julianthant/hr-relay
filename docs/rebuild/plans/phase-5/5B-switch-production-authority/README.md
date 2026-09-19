# Phase 5B · Switch production authority once

Read the [phase overview](../README.md) for shared context, decisions and phase-wide exit criteria.

This stable-path doc is the dedicated home of tree node `{#cutover}`, the one all-at-once authority
switch, its rollback window, the risks that decide whether the switch is safe, and **the program's
definition of done**. If you open one list to decide whether this rebuild is finished, open
§Exit criteria below: nothing else in `docs/rebuild/` claims to be that list. Contracts the cutover
reads live in `reference/`.

**D323 numbering note (2026-09-03).** This is Phase 5B, following Phase 5A readiness closure. It is
the single authority-switch part on the numbered phase spine, not a floating later stage.

**Nothing here has been built.** The cutover stage has zero landed work at HEAD, and that is
by design — every item is an act performed once, on a day the operator chooses, after Phase 4 closes.
What exists today is the *design* of the switch (ratified in Phase 0, D88–D94) and the *conditions*
that must hold before it happens. This doc's job is to keep those conditions honest.


## Task shape and verification

The deliverable is one verified production-authority switch with a usable rollback asset. Its
subtasks produce concrete readiness, backup/import, launcher and rollback outcomes; the switch
sequence remains serial. Use focused checks while preparing the procedure under the [2026-09-19 cadence](../../../reference/guards-and-tests.md#phase-exit-gates-from-3-2).
Full typecheck, lint, coverage and applicable readiness gates must pass on the final candidate
before the switch is authorized; this is the phase's release gate, not a test run repeated after
every preparation task. After the switch, run the required cutover/rollback observations before
phase closure. Rerun invalidated full gates if the candidate changes. No live switch, import,
legacy deletion or rollback policy change is authorized by this scheduling amendment.

## Stage summary
<!-- roadmap: cutover -->

> **D339 (2026-09-06):** the integration surface matrix is the set of required shipped workflow
> journeys plus explicit deferred-surface dispositions (ref frontend-backend-integration §10).
> Generic People/Review and new advanced recovery UI do not block cutover absent a current workflow
> need. Core recovery, capability migration, live acceptance, cutover rehearsal and rollback stay required.


<!-- roadmap-status: cutover -->
- [x] the model is ratified — ONE all-at-once authority switch, no workflow-scoped flip, no mixed-engine interval, no compat layer (D89, amended by D93 to a change of REPOSITORY)
- [x] the rollback asset is defined and structurally safe — the whole legacy repo, never deleted through the initial cutover; deletion needs its own operator authorization (D89/D93)
- [x] operational isolation is built and gated — roots, ports, process locks and browser session namespace pinned by `config/runtime-isolation.json` and proven by `operational-isolation` (D88, narrowed by D247)
- [x] the capability register that the cutover gate reads exists and is enforced — `config/legacy-capabilities.json`, `cutoverRequiresZeroOpen: true`, `proxyDispositionAllowed: false` (D58/D184/D188)
- [ ] **the switch itself** — no step of the five-step procedure has been rehearsed or run; `one-time-import-offline` is still a `planned` guard with no subject
- [ ] **zero open capabilities** — 47 of 78 entries are `open` at HEAD, every one owned by `workflow-admission-backlog`
- [ ] **every migration order done** — order 0 done, order 8 (separations) in flight at 8 of 9 criteria, eight orders unstarted
- [ ] **the §7.4 budgets measured** — `ref frontend-backend-integration` §7.4 has been normative and unenforced since it was written; Track D's D4/D5 take the first numbers
- [ ] **T4, the parallel end-to-end tier** — unbuilt, and blocked behind `{#parallel-runs}` and `{#duo-lease}` (`ref guards-and-tests` §10.8)
- [ ] **the cutover rehearsal** — `ref frontend-backend-integration` §10 criterion 11; the isolation half is proven, the rehearsal has never run
- [!] the cutover DAY is the operator's call, and so is every step of it — this doc names the preconditions, never a date
> 2026-08-21 | docs-cohesion 05 | verified against `config/legacy-capabilities.json` (78 entries: 47 open · 20 replaced · 7 native · 4 retired), `config/runtime-isolation.json`, `src/control/workflow-registry.ts`, `docs/rebuild/guard-inventory.json` (`one-time-import-offline`, `activationMilestone: cutover-gate`), `ref frontend-backend-integration` §7.4 + §10, `ref guards-and-tests` §10.1 + §10.8; left: the entire phase — every line above with an open box
<!-- /roadmap-status -->

### What the cutover stage is

**One switch, one direction, one day.** D89 is the whole phase in a sentence: *workflow migrations
prove capabilities but never flip production individually.* There is no interval in which both
engines accept production work, no per-workflow go-live, no proxy, no compatibility layer, and no
per-run engine authority. Everything migrates in Phase 3 and everything switches at once here.

**D93 changed the switch's mechanics and nothing about its substance.** When the rebuild left
`temp_src/` for its own repository, the flip stopped being an in-repo authority stamp and became
*repointing the normal production launcher at a different checkout*. That is a strictly simpler act
with a strictly stronger rollback asset: the thing preserved is an entire working repository — source,
commands, tests, and a verified state backup — rather than a directory inside the tree that shipped.

**The legacy repo is frozen production, not a dependency, and nothing in it is deleted.** Two
repositories share no module graph, so cross-runtime imports, invocation, proxying and live-state
access are structurally impossible rather than banned-and-checked — which is why D88's bidirectional
guard family and the preservation manifest's same-tree scanning are **retired by D93**. Deletion or
retirement of the legacy repo is outside this cutover and requires separate operator authorization
(§Rollback window, then closure).

**What is forbidden, named so a future session recognizes the temptation.** Continuous tracker lift ·
a legacy API proxy or remount · a compatibility SPA · per-run engine/generation authority ·
workflow-scoped production flips · any interval where both engines accept production work. An
optional historical importer is permitted only as an explicit versioned, idempotent one-time command
over an **immutable backup** — it is never a runtime adapter, and the `one-time-import-offline` guard
exists to hold that line the day such a command is written.

### The five-step procedure (D89, as amended by D93)

1. **Pass every gate.** Phase, workflow and capability gates; the coverage floors; live dry runs;
   the controlled write proof for every write path; the restore drill and the soak; and the complete
   `ref frontend-backend-integration` §10 surface matrix in the real built app.
2. **Stop new legacy enqueues; drain.** Enumerate every active, queued, gated, parked and
   unknown-write legacy run and drain, terminalize, park or reconcile each one **explicitly**. No
   uncertain write may be buried — an unresolved possible-submit is the one thing a switch cannot
   carry across.
3. **Back up both worlds and verify both backups.** Legacy state/config and rebuild state/config.
   Run only approved versioned one-time imports, recording source digests and idempotent manifests.
4. **Repoint the launcher atomically.** Verify the legacy launch is disabled and the rebuild's
   health / read / write smoke gates pass. Every normal launch target moves as ONE unit — a partial
   repoint is the mixed-engine interval D89 forbids, wearing a different name.
5. **Preserve the entire legacy repo** — source, commands, tests, and the state backup — as the
   rollback asset. After native writes, rollback requires intent/ledger reconciliation and dedupe
   proof before an atomic switch back.

### What must be TRUE before the switch — the eight preconditions

These are §Exit criteria's conditions stated as *readiness*, in the order they will bind. Each one
names where it is measured, so "is the rebuild ready" is a question with an address rather than an
opinion.

| # | Precondition | Measured at | State at HEAD |
|---|---|---|---|
| P1 | **Every admitted workflow is migrated and live-verified** by its declared T1b arm against every real system it touches | the tree's `{#migrations}` Phase 4 parts; `ref workflow-model` §1.6.2 | **open** — Person Lookup and Separations remain under current Phase 3 acceptance; later workflows are unadmitted candidates |
| P2 | **Every write path has its controlled-commit proof** on an operator-approved target | each workflow's §3.2 criterion; `ref write-safety` §Phase-2 controlled-commit as-built | **open** — the platform proof is MET (D135, doc 4489); each workflow still owes its own |
| P3 | **The legacy capability register carries zero open entries** and no proxy disposition | `config/legacy-capabilities.json` (`cutoverRequiresZeroOpen: true`) | **open** — 47 of 78 |
| P4 | **`ref frontend-backend-integration` §10's eleven integration criteria all pass** in the real built app | that section's own table | **open** — 5 met, 4 partial, 2 unmet (9 and 11) |
| P5 | **§7.4's performance and resilience budgets are MEASURED and become the gates** | `ref frontend-backend-integration` §7.4; Track D rows D4/D5 | **open** — nothing is measured anywhere in this repository |
| P6 | **T4, the agent-operated parallel end-to-end tier, is green** | `ref guards-and-tests` §10.8 | **open** — unbuilt; blocked behind `{#parallel-runs}` and `{#duo-lease}` |
| P7 | **The recovery drill has been rehearsed against the real authority database**, not only in the unit lane | `ref dashboard-surfaces` §2.5; `storage-recovery.test.ts` | **partly met** — the automated drill runs every commit on a real-shaped copy and D181 made `cli storage restore` reachable at all; the operational rehearsal is unrecorded |
| P8 | **The parity corpus is green** and covers the states the cutover is judged in | `npm run test:parity`; `ref frontend-backend-integration` §7.1 | **partly met** — 139 reference triples assert both halves (D132/D145); no reference photographs a disconnected, degraded, read-only or conflicted state |

### The honest state at HEAD (2026-08-21)

**Phase 3 is one order done and one in flight.** `src/workflows/` has two rail-level folders:
`person-lookup` (order 0, as-built and **live-proven** by D74 — run `4ebf7275`, trace `pl-000619-4ebf`)
and `separations`, whose six timeline-step folders hold five independently startable harnesses.
D266 dismantled the former annotation proof workflow into the Kuali-finalization T1 scenario pair;
its D135 controlled-transaction result remains historical evidence. The tree's own marker reads
*separations 8 / 9*. Eight migration orders have not started.

**Zero of the fifteen legacy workflow directories are closed**, and one of those zeros is instructive:
`legacy-workflow-person-lookup` is still `open` even though order 0 shipped and ran live, because
order 1's Search and Match modes have no counterpart for legacy's `crm-search.ts`, `match.ts` and
`outcome.ts`. A capability entry closes when the legacy DIRECTORY is covered, not when a workflow by
that name exists here. That is the register working as designed, and it is why P3's 47 is the number
to watch rather than a workflow count.

**Three preconditions have never been touched.** P5 (budgets) is normative and unenforced — the
audit behind D264 found no perf test, no benchmark, no seeded large fixture, no `memo` in any
surface, no virtualization and no backpressure handling. P6 (T4) cannot even be scheduled: running
many parallel dry runs before `{#duo-lease}` exists is running the experiment that BURNS the Duo
credential (D243). And the cutover rehearsal in §10 criterion 11 has never run, while
`dashboard:prod` still names a mode the runtime never parsed (D189) — so "every launch target
repoints atomically" is contradicted by the launcher itself.

**What IS solid, so the list above is read as a to-do and not as a warning.** The kernel half of the
cutover is done and proved: authority re-read + CAS before every transition, the seven-beat write
sequencer with a durable fence before the click, the ordered fsync'd ledger, the derived evidence
receipt, the immutable schema chain, and operational isolation held by a guard against
`config/runtime-isolation.json`. Everything open above is *program* work — migrations, measurements
and one rehearsed procedure — not a hole in the platform the switch would move onto.

### The mechanics of the switch, as designed (D88–D94)

**The two addresses.** The **legacy repo** (`hr-automation`) holds the production automation and stays
the sole production authority — live-runnable, maintainable, and never deleted before cutover. The
**rebuild repo** (`hr-automation-rebuild`) holds the rebuild: source at plain `src/`, tests at
`tests/`, config at `config/`, plan docs at `docs/rebuild/`, gated by the plain
`typecheck` / `lint` / `test:coverage` family (D191). Its history starts fresh, seeded from the
`feature/rebuild-phase1b` tip, which stays in the legacy repo as the pre-split record.

**What FLIPS on the day:** which checkout the normal production launcher starts, and therefore which
runtime accepts new HR work. That is the entire switch. It is one repointing, verified by the legacy
launch being disabled and the rebuild's smoke gates passing.

**What STAYS, because both worlds live on one machine and a repository boundary does not separate two
runtimes.** `config/runtime-isolation.json` pins the values and `operational-isolation` proves them:

| | legacy | rebuild |
|---|---|---|
| state root | `.tracker` | `.tracker` |
| artifact root | `.tracker` | `.tracker/artifacts` |
| backend / frontend port | 3838 / 5173 | 3938 / 5174 |
| process locks | `.tracker/daemons` | `.tracker/locks` |
| browser profile root / session namespace | `.auth` / `hrauto-legacy` | `.auth` / `hrauto-rebuild` |

Two rows carry a decision rather than a value. **Command NAMES are not an isolation resource
(D247):** `dashboard` means different things in the two checkouts, and a muscle-memory `npm run
dashboard` in the wrong one starts *that* checkout's dashboard on *its* port under *its* roots and
locks — legible and harmless, which is exactly what the rows above buy. What survives is the
exact-script DRIFT check on both sides. And **the browser profile ROOT is shared on purpose (D216):**
`.auth` is repo-relative in both checkouts, so the paths never collide; the SESSION NAMESPACE is the
distinct half.

**Cross-repo accounting is retired (D150), and the invariant it protected moved rather than lapsed.**
D90/D94's commit-centred ledger — every legacy `src`/`tests` commit accounted in this repo before a
gate could go green — was withdrawn on 2026-08-05 because it made an unrelated in-flight edit in the
PRODUCTION repo a red gate in the rebuild, which is the wrong coupling. The risk it addressed (a
ported selector or page-state fact going stale after legacy fixed it) is now carried by **mandatory
live re-verification at each workflow's migration**, which is strictly stronger: a selector checked
against the live system beats one diffed against legacy's copy of it. `config/legacy-change-accounting.json`
stays in the tree as a frozen historical record read by nothing. The as-written D90/D94 obligation is
preserved at `history/superseded/2026-08-20-05-cross-repo-accounting.md`. Porting is unchanged:
**copy with provenance** — the legacy commit hash and source path recorded in the ported code, never
linked at runtime, which two repositories make impossible anyway.

- [Rollback window, then closure](rollback-window-then-closure.md)

- [Later, unplanned](later-unplanned.md)

- [Risk register (top sequencing risks)](risk-register-top-sequencing-risks.md)

## Program stop-loss / abort gate

**The gate has never fired, and this section records the trigger state so that stays a fact rather
than an assumption.** The migration is reversible because production remains on the legacy repo
until the single cutover, so rather than sink cost into a base that is not holding, the program
publishes **objective STOP-AND-REASSESS triggers**. Hitting any one freezes rebuild migration — no
new workflow is marked ready — and reassessment happens before proceeding.

| Trigger | State at 2026-08-21 |
|---|---|
| **(a) The Phase-1 live exit test fails twice.** Person-lookup fails to run correctly on the spine, is fixed, and fails again — the spine is not actually stable, and every tail built on it compounds the problem | **NOT FIRED, and now unfireable.** Person-lookup passed on its first live attempt on 2026-08-04 (run `4ebf7275`, trace `pl-000619-4ebf`), terminalizing `done` at attempt 2 after recovering a dead CRM session mid-run. Phase 1 is closed |
| **(b) A base contract needs a breaking change after 2+ migrations.** The task/span/write contract has to change shape once ≥2 workflows already depend on it — the "coupled by contract" thesis is not holding and the churn will compound downstream | **NOT FIRED — and the nearest approach is worth naming.** The base HAS changed shape since two workflows depended on it: D214 re-keyed the durable checkpoint on the claim generation, D221 made the run attempt item-scoped, D215 added a fourth preview-subject arm. None of them was BREAKING in the sense the trigger tests. Every one was read-forward — no stored `record_key` moved a byte, no migration ran, and **no descriptor had to change** — so the churn the trigger predicts (each fix costing every dependent workflow a rewrite) did not occur. If a future contract change forces a descriptor edit across workflows, that is the trigger, and it should be called |
| **(c) Phase 1 exceeds twice its estimated size** (`00-design-the-foundation.md` §Size model + delivery tiers). Not a calendar date — a *size* overrun against the published estimate | **NOT FIRED; EXPIRED.** Phase 1 completed 2026-08-04 having been cut to the spine by D74. The trigger has no remaining subject; nothing replaces it, because Phases 2 and 3 were never sized with an abort threshold |

*(The historical 60-day coexistence deadline remains rejected: evidence-based phase gates and the
single-cutover readiness checklist govern progress. The original text added "while D90 continuously
accounts for legacy drift" — that clause died with D150; the drift detector is now live
re-verification at each migration, per risk 3.)*

**Defined fallback when a trigger fires:** pause the rebuild and reassess **scope**, using the
delivery tiers in `00-design-the-foundation.md` §Size model + delivery tiers — cut **LATER**, then
**SHOULD**, never **MUST** (§Later, unplanned is the tier that goes first). The legacy repo continues
in production normally while the rebuild is paused, and needs no accounting to do so.

- [Legacy vs rebuild (as of 2026-08-21)](legacy-vs-rebuild-as-of-2026-08-21.md)

## Decisions this stage ratified

**Checked against `reference/decisions.md`'s `_phase:_` markers on 2026-08-21: the ledger carries no
`_phase: 5_` marker, and that is correct.** The cutover stage is one act performed once; a decision belonging to
it would be taken ON the cutover day or in the commit that builds a piece of the procedure, and
neither has happened. The ledger's phase markers today read `0` (11) · `1` (11) · `2` (23) · `3a` (19) ·
`3b` (20) · `platform` (4) — no `5`, and nothing mis-filed into another phase that belongs here.

**What binds the cutover was therefore all ratified elsewhere**, mostly in round 10–12 (2026-07-31)
when the two-repo model was settled. This is the inverse index — the decision, the phase it was taken
in, and what it binds HERE — so the reasoning can be read beside the criterion it produced. The
ratification act and the normative pointer stay in the ledger.

| D | Phase | What it binds here |
|---|---|---|
| **D58** | 0 | the capability-inventory closure rule — old-code closure is inventoried, never workflow-counted; `config/legacy-capabilities.json` is its instrument and precondition **P3** reads it |
| **D88** | 0 | isolated coexistence — distinct roots, ports, locks and browser sessions while both worlds run on one machine (§Phase summary's what-stays table) |
| **D89** | 0 | **ONE all-at-once authority switch**; the five-step procedure; no workflow-scoped flip, no mixed-engine interval, no compat layer; the whole legacy repo preserved as the rollback asset and deletion pushed outside this cutover |
| **D90 / D94** | 0 | change accounting through the split — **retired by D150** (phase 2); the as-written obligation is at `history/superseded/2026-08-20-05-cross-repo-accounting.md` and the invariant moved to live re-verification at each migration |
| **D91** | 0 | the coverage floors and the no-legacy-test-deletion rule the cutover gate reads (criterion 4) |
| **D92** | 0 | live probes are mandatory at their named later milestones — why a migration's dry run is a precondition and not a nicety (**P1**) |
| **D93** | 0 | the two-repository ADDRESS — isolation is physical, the D88 bidirectional guard family retires, and the switch becomes a repointing rather than an in-repo flip |
| **D150** | 2 | the retirement of D90/D94 accounting, and the replacement: mandatory live re-verification at each workflow's migration (risk 3) |
| **D156** | 2 | the same decoupling applied to the environment inventory — the last guard that made legacy work a rebuild gate |
| **D184** | 2 | an inventory that gates cutover must be ACTIONABLE — the register's milestones re-dispositioned against the as-built, and the guard taught to refuse an entry `open` at or before the runtime's own `completedThrough` (risk 10) |
| **D188** | 2 | `one-time-import-offline` re-owned to the **cutover gate** — the guard that holds procedure step 3's "approved versioned one-time imports" line the day such a command is written |
| **D191** | platform | `test:coverage` as the per-commit gate, which is the family criterion 4 names |
| **D193** | 3b | (a) "production" means the D89 day this repo becomes the operator's daily LOCAL tool — the reading rule that keeps §Later, unplanned out of the exit criteria |
| **D247** | platform | command NAMES are no longer an isolation resource; what survives is the ports/roots/locks/session-namespace rows and the exact-script drift check on both sides |
| **D264** | 3a | Track D supplies §7.4's first measurements, which precondition **P5** turns into gates |

**What ratifying something here would look like**, so the next agent recognizes it: a decision taken
for the cutover itself lands in THIS doc in the same commit that records it — most likely in
§Exit criteria or in §Phase summary's five-step procedure — `reference/decisions.md` gets the round
row with a `_phase: 5_` marker, and the `{#cutover}` node's `builds:` line for that step flips with
the decision cited. The two most likely subjects are the offline one-time importer (which activates
`one-time-import-offline`) and the rollback bridge's verification shape.

## Exit criteria

**This is the program's definition of done.** It belongs to the whole rebuild, not only the cutover
stage. Every admitted phase
doc's exit block asks whether that phase is finished; this one asks whether the rebuild is, and it is
the list to open when the question is *can we switch yet*. Two halves: the eleven program criteria
below, then the program-wide integration criteria that gate criterion 2 specifically.

**Re-verified against the code and the config on 2026-08-21.** Each row states what it would take to
be MET, what is true now, and where to look. A row is **MET** only when nothing is left, **partly
MET** when a named part is left, and **open** when the substantive work has not started. Two rows
were restated rather than merely re-scored, and each says so — a criterion citing a retired mechanism
is worse than an open one, because it can be satisfied by something that no longer exists.

| # | Criterion | State | Evidence / what is left |
|---|---|---|---|
| 1 | **Every workflow migrated and live-verified** by a submit-free dry run against every real system it touches; every commit / probe / verification path also carries the controlled live evidence its migration exit gate requires | **open** | Order 0 (person-lookup) is as-built and live-proven — run `4ebf7275`, trace `pl-000619-4ebf`, D74. Order 8 (separations) is at **8 of 9** criteria. **Eight orders have not started.** Of the fifteen legacy workflow directories the register tracks, **zero are closed** |
| 2 | **One all-at-once cutover is ready and executed** — the register has zero open entries, legacy work is drained / parked / reconciled, both states are backed up, approved imports are versioned and idempotent, the normal launcher is repointed atomically, and the whole legacy repo plus its state backup remain rollback assets. No deletion occurs | **open** | No step of the five-step procedure has been rehearsed or run. The register reads **47 open** of 78 (`cutoverRequiresZeroOpen: true`, `proxyDispositionAllowed: false`). `one-time-import-offline` is a `planned` guard with `activationMilestone: "cutover-gate"` and no subject — no import path exists in this tree |
| 3 | **No compat layer was built** — the lift adapter as a live layer, the golden-payload parity harness, the legacy-SPA fallback and per-run generation authority were DELETED from the plan rather than built and removed (D88). The dashboard serves entirely from the descriptor + span contract, all surfaces native | **MET** | No `rebuild-demo` reference exists anywhere in this tree (`ref frontend-backend-integration` §10 criterion 10). No served route names a workflow and no `TrackerEntry` type exists (criterion 2). `proxyDispositionAllowed` is `false` in the register, so a proxy disposition is not even representable. The "if a one-time historical import was run" clause is vacuous — none has been |
| 4 | **All applicable guards green** — the guard inventory covers this tree's whole `src/` and `tests/`, and `typecheck` / `lint` / `test:coverage` plus the coverage floors, the operational-isolation guard and the branch gates pass | **MET as restated** | `docs/rebuild/guard-inventory.json` holds 75 entries: **65 active** (matching 65 files in `tests/unit/architecture/`, checked both directions by `guard-manifest`), 8 retired each naming its deciding decision, **2 planned** with real triggers — `one-time-import-offline` (this cutover) and `preflight-coverage` (the first migration adding a preflight runner). The gate is D191's `typecheck` + `lint` + `test:coverage`; the floor moves to 80/80/80 under R10 (measured 84/82/85). **Restated:** the original wording also required the change-accounting guard to pass and constrained the LEGACY repo's `lint:tests` debt. **D150 retired the guard and decoupled the repositories** — legacy work never blocks a rebuild gate — so both clauses are void, not waived |
| 5 | **The docs match what is built** — every owning doc updated to as-built (charter: the foundation's documentation is part of the foundation) | **active** | The master plan whose phase table this criterion originally cited was **dissolved on 2026-08-20**; the plan is now `docs/roadmap/roadmap.md` plus the active phase docs `00`–`06`, bound to the tree both ways by D263's `doc:` refs, `<!-- roadmap: -->` tags and the binding guard. D329 moved the superseded 03b/03c narratives to history and aligned active Phase 3 filenames to 03.1–03.4. Left: each future phase's own as-built reconciliation |
| 6 | **The immutable ledger is live** — every real commit writes an atomic outbox projected by one serialized ordered writer into a never-pruned actor-attributed ledger; restart / reconciliation, ordering, missing-or-duplicate outbox and recovery checks pass. The hash chain / tail anchor is deferred | **open — and this is a finding, not a known gap** | The projector is **built, tested and composed by nothing**: `createLedgerProjector` (`src/infra/ledger/ledger-projector.ts:185`) is called only from `tests/`, and no production composition in `src/server/**` calls it. The read side IS composed — `createLedgerReadThrough` in both `src/server/dashboard/compose.ts:546` and `src/server/storage/compose.ts` — so the dashboard reads a corpus nothing writes. The write sequencer's beat ⑦ does write the durable outbox, so the facts exist and are recoverable; what is missing is the serialized writer that turns them into ledger lines. Same shape as D222 (the notification publisher) and D181 (the runtime-lock snapshot): complete machinery, zero producers, every gate green |
| 7 | **Authority is recoverable** — backup health is green, and a restore drill has recovered the as-built DB schema while preserving claims / dependencies / checkpoints / commands / write intents / outboxes and diagnostic/archive evidence; projection rebuild and unknown-post-backup handling pass | **partly MET** | The automated drill runs **every commit** inside `storage-recovery.test.ts` against a real-shaped copy, and reconciliation replays JSONL into projection tables ONLY, never inventing lost authority from spans. D181 made the path reachable at all — before it, `cli storage restore` could not have worked, because nothing had ever recorded the runtime-lock snapshot its stopped-system proof derives from. D294 retires the former capture-handoff authority. Left: precondition **P7**, an operational rehearsal against the real `.tracker-rebuild`, which nothing records |
| 8 | **Runs are explainable and trustworthy** — every terminal run has a schema-valid evidence receipt with honest confidence, every failure has a structured redacted diagnostic bundle, durable notifications stay visible when desktop delivery fails, and `explain run` needs no tracker-blob archaeology | **partly MET** | The receipt is a pure function of authority, byte-identical on re-derivation, with per-field declared redaction, and it derives over gates through D204's declared arm table; D187 fixed the `unknown`-verification defect that made a `startAt`-resumed run's receipt underivable. Failures carry the D137 two-phase bundle. `explain run` reads the same derivation the dashboard does. **Honest caveat:** "visible when desktop delivery fails" is currently true the easy way — `OsNotificationDelivery` has no producer, so there is no desktop delivery to fail. The durability half is MET; the reach half is a legacy-ahead item |
| 9 | **Workflow knowledge is canonical** — UI ids / catalog, task and workflow results, the scenario corpus, knowledge records and fix records carry no unresolved duplicates, orphans or stale references, and every migrated production bug has a regression scenario that supersedes conflicting lessons | **partly MET** | The registry / catalog / provenance half is held mechanically: the driver registry is authority, the catalog is generated, `legacy-selector-port-provenance` pins 406 keys to a FIXED legacy commit's blobs, and knowledge is insert-only with supersession expressed forward. Left: the scenario corpus is being reorganized by R10 (T1's per-workflow layout is unbuilt, and the pretending fixture scenarios are not yet rewritten), and "every migrated production bug has a regression scenario" cannot close while migrations are open |
| 10 | **Authoring tools respect their boundary** — the explorer renders the exact as-built graph and source links, presentation-only changes use the strict atomic override, graph / policy edits emit a reviewed patch scaffold, code-only selector / schema / subject / proof changes cannot be emitted by the editor, and no workflow has dual graph authority | **partly MET — the load-bearing half by absence** | DSL / codegen remains absent (D79a) and no workflow has dual graph authority, which is the clause that protects a real HR transaction. The **read-only** explorer shipped in 2i and renders the as-built graph. The EDIT half — the override, the patch scaffold, the closed policy union — was REASSIGNED out of Phase 2 by **D186**, whose trigger is a SECOND production workflow whose policy somebody wants to change. Until then the criterion's edit clauses have no subject; `04-close-the-deferrals.md` §Edit a workflow's presentation / policy owns the deferral |
| 11 | **Local-first scope remains true** — the operator server binds loopback and retains the actor / auth-checkpoint / credential-set / per-actor-notification seams without dormant RBAC or LAN mode; diagnostic / backup / evidence permission and redaction tests pass | **MET** | The four D75 seams are built and load-bearing with one constant `local-operator`; D193(a) reaffirmed solo / local / never-hosted; there is no RBAC, no LAN mode, user management, or remote listener. The redaction surface scan is `redaction-surface-scan` (D183). D294 retires the former mobile-capture ingress rather than leaving an untestable exception. |

### The program-wide integration criteria (gates criterion 2)

**Before criterion 2 — the single cutover — all of `ref frontend-backend-integration` §10 must pass in
the real built app.** That section owns the eleven-row table and its own state; this is the summary a
reader of THIS list needs, verified against it on 2026-08-21.

| | |
|---|---|
| **met (5)** | strict runtime schemas at every boundary (3) · all authoritative counts and Activity aggregates reconcile from the one projection family (5) · every visible action is a served command or clear local navigation (6) · Person Lookup and the controlled write slice passed their live gates (8) · the preserved legacy demo/mock wires stay in the legacy repo and are structurally unimportable (10) |
| **partial (4)** | every product surface served by the matrix — Group People and OCR Review have **no surface**, Settings is read-only (1) · no workflow-specific registry in the production app — held everywhere except the ONE named registry import, D264 row D11 (2) · reconnect / gap / reset and command conflict / idempotency proven — mechanically yes, **visibly no**: no reference photographs a disconnected, degraded, read-only or conflicted state (4) · every terminal run renders an honest receipt / failure / diagnostic-capture state — receipt and failure are met, while the generic artifact-byte family remains unserved (7) |
| **unmet (2)** | the complete reference route matrix in both themes — Settings and the Session Panel are unreachable from the harness's routes, and keyboard and reduced-motion exist as one reference each, Paper Ink only (9) · **the cutover rehearsal** — the isolation half is proven by `operational-isolation` against `config/runtime-isolation.json`, the rehearsal itself has never run, and "every launch target repoints atomically" is contradicted while `--prod` is unparsed (11) |
| **and the budgets** | `ref frontend-backend-integration` §7.4's performance and resilience budgets are **normative and unenforced** — no perf test, no benchmark, no seeded 1,240-row / 108-member fixture, no `memo` in any surface, no virtualization, no backpressure handling. Track D's **D4/D5** take the first numbers on the local production build and those numbers become the non-regression gates (D264). This is precondition **P5** |

**Two more things must be true that no §10 row carries.** **T4**, the agent-operated parallel
end-to-end tier, is unbuilt and cannot be scheduled before `{#parallel-runs}` and `{#duo-lease}` —
running many parallel dry runs before the Duo ceremony lease exists is running the experiment that
BURNS the credential (D243, `ref guards-and-tests` §10.8). And the **parity corpus** must be green
over the states the cutover is judged in: 139 reference triples assert both halves at
`maxDiffPixels: 0` (D132/D145), and none of them photographs a degraded or conflicted app.

### What is NOT on this list, deliberately

**None of the eight deferrals.** `04-close-the-deferrals.md` §Exit criteria states the reading from
its side and it is correct: every deferral is either closed by a build or carried past the cutover
with its trigger still standing and named. The cutover switches which repository files real HR
transactions; a deferral is a capability the legacy system also lacks or that the operator has
decided not to buy. The one with a runtime cost is the propagation windows — UCPath and ServiceNow
stay `operator-only`, so a write reaching an unmeasured system parks for a human on a post-fence
absence. That is correct behaviour, not a blocker.

**Nothing from §Later, unplanned.** D193(a) fixes "production" as the D89 day this repository becomes
the operator's daily LOCAL tool, so packaging and cooperation are not conditions of being done.

**No calendar date.** Every criterion above is a state of the world, and the cutover day is the
operator's call once they hold.
