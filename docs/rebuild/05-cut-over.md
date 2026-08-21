# 05 · Phase 5 — cut over

This doc is the dedicated home of **Phase 5**, tree node `{#cutover}` — the one all-at-once authority
switch, its rollback window, the risks that decide whether the switch is safe, and **the program's
definition of done**. If you open one list to decide whether this rebuild is finished, open
§Exit criteria below: nothing else in `docs/rebuild/` claims to be that list. Contracts the cutover
reads live in `reference/`.

**Nothing here has been built.** Phase 5 is the only phase with zero landed work at HEAD, and that is
by design — every item is an act performed once, on a day the operator chooses, after Phase 3 closes.
What exists today is the *design* of the switch (ratified in Phase 0, D88–D94) and the *conditions*
that must hold before it happens. This doc's job is to keep those conditions honest.

## Phase summary
<!-- roadmap: cutover -->

<!-- roadmap-status: cutover -->
- [x] the model is ratified — ONE all-at-once authority switch, no workflow-scoped flip, no mixed-engine interval, no compat layer (D89, amended by D93 to a change of REPOSITORY)
- [x] the rollback asset is defined and structurally safe — the whole legacy repo, never deleted through the initial cutover; deletion needs its own operator authorization (D89/D93)
- [x] operational isolation is built and gated — roots, ports, process locks and browser session namespace pinned by `config/runtime-isolation.json` and proven by `operational-isolation` (D88, narrowed by D247)
- [x] the capability register that the cutover gate reads exists and is enforced — `config/legacy-capabilities.json`, `cutoverRequiresZeroOpen: true`, `proxyDispositionAllowed: false` (D58/D184/D188)
- [ ] **the switch itself** — no step of the five-step procedure has been rehearsed or run; `one-time-import-offline` is still a `planned` guard with no subject
- [ ] **zero open capabilities** — 47 of 78 entries are `open` at HEAD, every one owned by `phase-3-workflow-migration`
- [ ] **every migration order done** — order 0 done, order 8 (separations) in flight at 8 of 9 criteria, eight orders unstarted
- [ ] **the §7.4 budgets measured** — `ref frontend-backend-integration` §7.4 has been normative and unenforced since it was written; Track D's D4/D5 take the first numbers
- [ ] **T4, the parallel end-to-end tier** — unbuilt, and blocked behind `{#parallel-runs}` and `{#duo-lease}` (`ref guards-and-tests` §10.8)
- [ ] **the cutover rehearsal** — `ref frontend-backend-integration` §10 criterion 11; the isolation half is proven, the rehearsal has never run
- [!] the cutover DAY is the operator's call, and so is every step of it — this doc names the preconditions, never a date
> 2026-08-21 | docs-cohesion 05 | verified against `config/legacy-capabilities.json` (78 entries: 47 open · 20 replaced · 7 native · 4 retired), `config/runtime-isolation.json`, `src/control/workflow-registry.ts`, `docs/rebuild/guard-inventory.json` (`one-time-import-offline`, `activationMilestone: cutover-gate`), `ref frontend-backend-integration` §7.4 + §10, `ref guards-and-tests` §10.1 + §10.8; left: the entire phase — every line above with an open box
<!-- /roadmap-status -->

### What Phase 5 is

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
| P1 | **Every migration order is migrated and live-verified** by a submit-free dry run against every real system it touches | the tree's `{#migrations}` order nodes; `03c-migrate-the-remaining-workflows.md` | **open** — order 0 done, order 8 at 8/9, eight orders unstarted |
| P2 | **Every write path has its controlled-commit proof** on an operator-approved target | each workflow's §3.2 criterion; `ref write-safety` §Phase-2 controlled-commit as-built | **open** — the platform proof is MET (D135, doc 4489); each workflow still owes its own |
| P3 | **The legacy capability register carries zero open entries** and no proxy disposition | `config/legacy-capabilities.json` (`cutoverRequiresZeroOpen: true`) | **open** — 47 of 78 |
| P4 | **`ref frontend-backend-integration` §10's eleven integration criteria all pass** in the real built app | that section's own table | **open** — 5 met, 4 partial, 2 unmet (9 and 11) |
| P5 | **§7.4's performance and resilience budgets are MEASURED and become the gates** | `ref frontend-backend-integration` §7.4; Track D rows D4/D5 | **open** — nothing is measured anywhere in this repository |
| P6 | **T4, the agent-operated parallel end-to-end tier, is green** | `ref guards-and-tests` §10.8 | **open** — unbuilt; blocked behind `{#parallel-runs}` and `{#duo-lease}` |
| P7 | **The recovery drill has been rehearsed against the real authority database**, not only in the unit lane | `ref dashboard-surfaces` §2.5; `storage-recovery.test.ts` | **partly met** — the automated drill runs every commit on a real-shaped copy and D181 made `cli storage restore` reachable at all; the operational rehearsal is unrecorded |
| P8 | **The parity corpus is green** and covers the states the cutover is judged in | `npm run test:parity`; `ref frontend-backend-integration` §7.1 | **partly met** — 139 reference triples assert both halves (D132/D145); no reference photographs a disconnected, degraded, read-only or conflicted state |

### The honest state at HEAD (2026-08-21)

**Phase 3 is one order done and one in flight.** `src/workflows/` holds nine descriptor directories:
`person-lookup` (order 0, as-built and **live-proven** by D74 — run `4ebf7275`, trace `pl-000619-4ebf`),
`kuali-timekeeper-annotation` (not a legacy migration at all — it is the purpose-built one-node
workflow that carries the Phase-2 controlled transaction proof, D135), and the seven that compose
separations. The tree's own marker reads *separations 8 / 9*. Eight migration orders have not started.

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
| state root | `.tracker` | `.tracker-rebuild` |
| artifact root | `.tracker` | `.tracker-rebuild/artifacts` |
| backend / frontend port | 3838 / 5173 | 3938 / 5174 |
| process locks | `.tracker/daemons` | `.tracker-rebuild/locks` |
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

## Rollback window, then closure
<!-- roadmap: rollback-window -->

<!-- roadmap-status: rollback-window -->
- [x] the asset is defined and cannot be lost by accident — the WHOLE legacy repository (source, commands, tests) plus its verified state backup; nothing in it may be deleted through the rebuild or the initial cutover (D89/D93, `CLAUDE.md` cross-repo rules)
- [x] the asset is stronger than the one D89 originally assumed — a separate repository rather than an in-tree `src` directory, because D93 moved the rebuild's ADDRESS (D93)
- [x] re-crossing has a stated price, written before anyone needs it — after native writes, rollback requires intent/ledger reconciliation and dedupe proof before an atomic switch back (D89)
- [ ] **nothing flips yet, so no window is open.** The switch has not happened; there is no rollback bridge to verify and no window to close
- [ ] the rollback bridge verified BEFORE the switch — the `{#cutover}` node's fourth build item; unbuilt
- [!] closure — deletion or retirement of the legacy repo is OUTSIDE this cutover and needs its own operator authorization, given after the window, never inside it
> 2026-08-21 | docs-cohesion 05 | verified against `CLAUDE.md` "Cross-repo rules (D93/D94)" ("Nothing in the legacy repo may be deleted during the rebuild or the initial cutover — the whole repository is the D89 rollback asset") and `reference/decisions.md` D89/D93; nothing in `src/`, `config/` or `scripts/` implements any part of a switch, a bridge or a closure — left: the whole node, which cannot start before `{#cutover}`

<!-- /roadmap-status -->

**The window is the interval between the switch and the authorization that ends it**, and it exists
because a single all-at-once cutover has exactly one way to be wrong: it turns out the rebuild cannot
carry a real day's work. During the window the legacy repo stays intact and runnable — not archived,
not pruned, not partially deleted — so recovery is *repointing the launcher back*, the same act as
the switch, in the other direction.

**What is built: nothing.** No step of the cutover has run, so no window has opened. The rollback
bridge named in the tree's fourth `{#cutover}` build item — the verification, before the switch, that
the return path actually works — has not been written, and it is deliberately a PROOF item rather
than a code item: what it must show is that the legacy launcher starts, reaches its own state root,
and is not blocked by anything the rebuild did on the way past.

**Re-crossing is not symmetric, and that asymmetry is the whole reason the window closes.** Before
the rebuild writes anything native, rollback is a launcher repoint. After it does, the two worlds
have both filed real HR transactions and rollback requires **intent/ledger reconciliation and dedupe
proof** before the atomic switch back: every rebuild write intent must be matched against what the
external system actually holds, because the legacy engine has no fence and no permanent-key record
of what the rebuild already filed. A rollback that skips that step is how one termination gets filed
twice.

**Closure is a separate operator authorization, deliberately.** D89 puts deletion and retirement
*outside* this cutover, and `CLAUDE.md`'s cross-repo rules restate it as a standing prohibition:
nothing in the legacy repo may be deleted during the rebuild or the initial cutover. There is no
trigger, no elapsed-time rule and no automatic expiry — the window closes when the operator says it
does, and until then the honest description of the legacy repo is *frozen production reference and
rollback asset*, not *old code*.

## Later, unplanned
<!-- roadmap: later-unplanned -->

<!-- roadmap-status: later-unplanned -->
- [x] the tier exists and is named — D76's MUST / SHOULD / LATER delivery tiers; LATER is what gets cut FIRST when the stop-loss fires, and cutting it costs nothing that was promised
- [x] the two LATER items are recorded with no owner and no design, which is the point — packaging the local system as a locally-run app ("web app → real app"), and a cooperation / multi-user mode built ON TOP OF solo, if ever (D193(a))
- [x] the seams that keep them possible are already built and may never be trimmed as ceremony — actor attribution, one identity checkpoint, credential-set-keyed sessions, per-actor notification state (D75, reaffirmed by D193)
- [-] hosting — never, by design (D193(a)); "production" in these plans means the D89 day this repo becomes the operator's daily LOCAL tool
- [-] designing for multi-user now — refused; no slice may claim scope, ceremony or abstraction in its name (D193(a))
> 2026-08-21 | docs-cohesion 05 | verified against `ref operator-trust` §7 (the four seams, built and load-bearing) and `reference/decisions.md` D193(a); this node proposes no work and blocks no gate — nothing is left because nothing is owed

<!-- /roadmap-status -->

**This node holds the LATER tier, and its only rule is that it never blocks the cutover.** D76 sizes
the program in three delivery tiers and the stop-loss cuts them in one order: **LATER first, then
SHOULD, never MUST** (§Program stop-loss / abort gate). A LATER item is therefore defined by what
happens to it under pressure — it is dropped without renegotiating anything the program promised —
and `05-cut-over.md` §Exit criteria names none of them.

**Two items, both recorded by D193(a) with no owner and no design.** *Packaging the local system as a
locally-run app* — the "web app → real app" idea; and *a cooperation / multi-user mode built on top
of the solo system*, if ever. Neither is scheduled, neither has a trigger, and neither is a
deferral in the `04-close-the-deferrals.md` sense: a deferral names the event that ends it, and these
name nothing because nobody has decided they will happen.

**They are cheap to keep possible and expensive to design for now, which is why the answer is
"seams, not scope".** The four D75 seams — actor attribution on every command, run, approval, gate
resolution and ledger entry; one identity checkpoint; credential-set-keyed browser sessions;
per-actor notification read state — are built, carry one constant `local-operator`, and cost nothing
to keep. They exist because retrofitting an actor onto an immutable ledger is impossible: the old
rows would have no honest answer. What is explicitly NOT built and may not be smuggled in under a
LATER banner: RBAC, a permissions UI, user management, teams, tenant separation, remote or cloud
deployment, TLS, per-user dashboards, remote sync, or public API compatibility.

**Hosting is not LATER, it is never (D193(a)).** The distinction matters when reading this node: a
LATER item might happen; hosting is a decided refusal, and it is why "production" throughout these
plans means the D89 day this repository becomes the operator's daily LOCAL tool. The one deny-by-
default exception to loopback stays what it already is — the operator-started, token-scoped mobile
capture ingress.

## Risk register (top sequencing risks)

_Moved from `history/superseded/2026-08-20-master-plan-dissolved.md` §5 on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

| # | Risk | Why it bites | Mitigation |
|---|---|---|---|
| 1 | **A contract flaw surfaces late** | a fixture-proven base can be wrong in ways only a real run reveals | **D74 is the mitigation, and it worked**: person-lookup ran live as Phase 1's *exit* on 2026-08-04, and the live lane that produced it found four defects every fixture had passed — a login concluded from a URL (D120, 2026-08-03), a `node:path` import that reached the browser bundle (ref frontend-backend-integration §8.13), a span fold keyed on path alone that erased a re-run node, and a timeline seed that collided across run attempts. All four were fixed before the tails were built on them. Phase 2 now adds the controlled transaction proof with crash/outbox/dedupe evidence |
| 2 | **Phase 1 (XL) overruns** | a long isolated build increases integration drift and delays the single cutover | Phase 1 is cut to the spine (D74); §3.7 sizes each item; D79 trims are taken; D90 change accounting forces rebuild rechecks after legacy maintenance |
| 3 | **The two maintained repos drift** | a necessary legacy production fix changes knowledge already copy-ported into the rebuild repo, and D93's physical separation means nothing breaks loudly when it does | D90 accounting is now cross-repo and is the *only* drift detector: every legacy commit maps to capability ids and rebuild evidence in the rebuild repo's `config/legacy-change-accounting.json`, keyed by legacy commit hash (the legacy repo's root `CLAUDE.md` carries the standing duty); affected rebuild scenarios/ports must be reverified before readiness |
| 4 | **A target can make settlement unknowable** (write-safety residual) | UI-only systems may expose neither an idempotent API nor a trustworthy immediate negative read after a click; early absence can be eventual-consistency lag, and a positive match can still be for the wrong subject | D48/D64/D69/ref write-safety: permanent key fence; fresh binding proof; typed positive proof; every counted negative observation must occur after the target-specific propagation window and repeated authoritative checks must agree; unsettled/ambiguous evidence parks; per-probe live verification at migration. The guarantee is at most one unattended commit attempt per intent generation plus verified convergence—not unconditional distributed exactly-once |
| 5 | **Build context + operator-attention limits** | The program is long (15 workflow directories across 10 migration orders, plus shared capability closure); high WIP and oversized sessions cause ownership drift | One-at-a-time Phase 3, coherent local commits, explicit handoffs/checkpoints when needed, Phase-2 gates before scale, machine inventories/guards so review concentrates on live evidence; §3.7 sizes the work so attention is spent where the mass actually is |
| 11 | **Decisions drift ahead of the docs that own them** | *Observed 2026-07-26*: the 07-23/24 operator ratifications sat in a review file for four days while ref charter, the master plan and ref write-safety still specified the world they replaced — the master plan would have had Phase 1 build a lift adapter, a parity harness, and a generation-authority stamp that the operator had already deleted | Charter standing rule: **a decision is not ratified until it lands in its owning doc, in the same commit that records the answer.** Ref decisions is a changelog with pointers, never a second spec; review files are history. A doc's amendment date must be ≥ the latest round that touched it |
| 6 | **Canonical UI registry becomes a second stale selector list** | Drivers change selectors but forget ids/catalog/scenarios, or obsolete ids multiply | registry is driver authority, generated catalog only, same-system dependency guard, selector verification metadata, non-identity search terms, explicit `supersedes` links, migration scenario before removal |
| 7 | **Authority backup exists but has never been restored** | Corruption is discovered during a real run and the “backup” is unusable | Phase-1 automated corruption/restore drill and recurring doctor/backup-health surface; degraded mode blocks mutations instead of creating an empty DB |
| 8 | **Evidence volume recreates an unreadable log pile** | screenshots/notes/bundles consume disk and hide decisive facts | structured indexes, on-demand bundles, 30d notes/30d spans, content-addressed dedupe, disk warnings/redaction |
| 9 | **The closed editor regrows DSL/codegen** | a UI edit changes graph, bind, selector, or proof semantics without code review | DSL/codegen remains absent; Phase-2 2i exposes a read-only explorer plus a closed presentation/policy edit union; prohibited changes emit only a code-change brief |
| 10 | **All workflows migrate but a shared capability is forgotten** | capture, AI assist, exports, settings, maintenance, or a special route blocks/degrades final cutover | D58 inventory covers old services/routes/UI/CLI/tools exactly once; cutover rejects undecided/unproven entries; no proxy disposition exists |

## Program stop-loss / abort gate

_Moved from `history/superseded/2026-08-20-master-plan-dissolved.md` §5.1 on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

The migration is reversible because production remains on the legacy repo until the single cutover. Rather than sink cost into a base
that is not holding, the program has **objective STOP-AND-REASSESS triggers**. Hitting any one
freezes rebuild migration—no new workflow is marked ready—and reassessment happens before proceeding:

- **(a) The Phase-1 live exit test fails twice.** Person-lookup fails to run correctly on the
  spine, is fixed, and fails again — the spine is not actually stable, and every tail built on it
  compounds the problem.
- **(b) A base contract needs a breaking change after 2+ migrations.** The task/span/write contract
  has to change shape once ≥2 workflows already depend on it — the "coupled by contract" thesis is
  not holding and the churn will compound downstream.
- **(c) Phase 1 exceeds twice its estimated size** (§3.7). Not a calendar date — a *size* overrun
  against the estimate this plan publishes. An overrun of that magnitude means sizing or scope is
  wrong and must be revisited.

*(The historical 60-day coexistence deadline remains rejected: evidence-based phase gates and the
single-cutover readiness checklist govern progress, while D90 continuously accounts for legacy
drift.)*

**Defined fallback when a trigger fires:** pause the rebuild and reassess **scope**, using §3.7's
tiers—cut LATER, then SHOULD, never MUST. The legacy repo continues in production normally; D90
accounting continues for any maintenance edits while the rebuild is paused.

## Legacy vs rebuild (as of 2026-08-20)

_Moved from `docs/roadmap/roadmap.md` Appendix B on 2026-08-20 (3b); this is the as-written record,
the step-5 rewrite re-verifies it. Dated because it is an inventory of a moving world, not a
contract._

### Already built — what the rebuild does differently

| Area | Legacy | Rebuild |
|---|---|---|
| Run kernel | Daemon holds state in memory; crash mid-run leaves the row to be inferred | Authority re-read + CAS before **every** transition; lost claim can never terminalize over another owner; every task races an injected deadline |
| Write safety | No fence; a failed save leaves unknown state; a retry can double-file | Seven beats: probe → prepare → subject binding → **durable fence before the click** → commit → read-back proof → settle; uncertainty **parks** with durable intent; same permanent key re-run answers `already-present` in 2 ms |
| Dry run | A flag the workflow honors | On the run's immutable envelope; `commit` structurally absent; zero durable rows **asserted** |
| Evidence | Reconstructed from log files | `RunEvidenceReceipt` = pure function of authority, byte-identical on re-derivation, per-field declared redaction; CLI and dashboard read the same derivation |
| Failures | `error: string` on a span | Structured `FailureRecord` + auto-captured, capture-time-redacted diagnostic bundle, committed with the terminal state |
| Ledger | None | Ordered, actor-attributed, fsync'd, digest-chained; any corruption stops the partition rather than renumbering history |
| Storage | JSONL + SQLite, no backup, no restore | ONE authority DB, SHA-pinned immutable migrations, live backup cadence, byte-verifying doctor, **drilled** restore |
| Notifications | In-memory React store — reload loses it | Durable inbox row committed **before** any OS toast; repeated triggers fold into a count; no free-text (structurally can't leak form contents) |
| Intake | Parse at enqueue, then gone | Durable session → mapping (suggestions can never auto-bind) → validation → **immutable manifest** + N runs + CAS in one transaction; reruns hash-diff |
| Edit Data | Exists | Resume claim IS the fence; edits become authority only by re-parsing through the producing node's own schema |
| Start | Fire-and-forget enqueue | Plan-then-consume; exact raw JSON retained beside canonical — defaults can never erase what you typed |
| Registries | ~10 hand-maintained parallel registries; a typo compiles | ONE `WORKFLOW_MODULES` tuple; stale fingerprint manifest is a red gate |
| Guards | 31 guards, accepted lint debt | 60 guards, zero debt, every mechanical arm proven against a violating fixture |

### Where legacy is still ahead (the honest list — this IS the Phase 3 surface)

OCR review/approve UI · screenshots gallery + artifact-bytes route · cross-date search · Excel
exports (3 writers incl. the master I-9 retention workbook) · workflow graph editor + data bank ·
editable settings · the record-sanity-check AI tool (deferred to order-8; run-summary and
selector-suggest are **retired**, D192 — not gaps, decided) · production phone-capture delivery
path · LAN mode · setup wizard · `test-login` · **six system drivers** (onbase, servicenow, i9,
new-kronos, old-kronos, sharepoint — declaration-only in the rebuild).

### What the rebuild will never do, by design

- **Unverified silent fallbacks** — the founding rule; enforced by ratchets run against violating fixtures
- **Selector `.or()` fallback chains** — live re-verification at migration replaces them
- **Per-daemon stdout logs / ~30 bespoke polling hooks / secondary count caches** — one projection, one SSE spine; a second data path cannot disagree with the first
- **Per-action mutation routes / fire-and-forget enqueue** — one idempotent actor-stamped command endpoint
- **Generic retry on a parked write** — only proof-of-presence or operator-confirmed-absence releases one
- **DSL/codegen workflow authoring (D79a)** — selectors, schemas, proof, and graph structure stay code, forever
- **LAN/remote operator mode** — loopback only; the token-scoped phone ingress is the one deny-by-default exception
- **Hosting** (D193) — never deployed to a platform; it runs on your machine. A locally-run app package and a cooperation mode over solo are *later, unplanned* ideas, not a hosted future
- **Legacy change accounting (D150)** — replaced by mandatory live re-verification at each migration

## Decisions this phase ratified

_Derived from `reference/decisions.md`'s round headings on 2026-08-20 (3b) — the
ratification act and the normative pointer stay in the ledger; this is the phase index._

**Nothing has been ratified in this phase yet** — the cutover has not been designed past what Phase 0
settled. Its binding decisions were all taken in round 10–12 (2026-07-31) and are listed under
`00-design-the-foundation.md`:

| D | What it binds here |
|---|---|
| **D88** | isolated coexistence — distinct roots, ports, locks and browser profiles while both worlds run on one machine |
| **D89** | ONE all-at-once authority switch; no workflow-scoped flip, no mixed-engine interval, no compat layer |
| **D90 / D94** | change accounting through the split (**retired by D150**, 2026-08-05 — replaced by live re-verification at each migration) |
| **D91** | the coverage floors and the no-legacy-test-deletion rule the cutover gate reads |
| **D93** | the two-repository address — isolation is physical, so the guards that simulated it retired |

A decision taken for the cutover itself lands here in the same commit that records it.

## Exit criteria

_Moved from `history/superseded/2026-08-20-master-plan-dissolved.md` §6 (definition of done, whole program) on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

The rebuild is complete when **all** hold:

1. **Every workflow migrated** (§3.3 orders 0–9) and **live-verified** by a submit-free dry-run
   against every real system it touches; every commit/probe/verification path also has the controlled
   live evidence required by its migration exit gate.
2. **One all-at-once cutover is ready and executed** — D58 has zero undecided entries; legacy work
   is drained/parked/reconciled; both states are backed up; approved imports are versioned and
   idempotent; the normal launcher is repointed at the rebuild repo atomically; the whole legacy
   repo — source, commands, tests — and the state backup remain rollback assets. No deletion occurs.
3. **No compat layer was built** — under D88 the lift adapter (as a live layer), the
   golden-payload parity harness, the legacy-SPA fallback, and per-run generation authority were
   deleted from the plan rather than built and removed (§4). The dashboard serves entirely from the
   descriptor + span contract, all surfaces native. If a one-time historical import of old
   `.tracker` data was run, it is a script that ran once and left no runtime surface.
4. **All applicable guards green with isolated debt** — the rebuild repo's guard inventory covers
   its whole `src/` and `tests/` tree; its `lint`, `typecheck`, `test`, `test:architecture`, 60/80
   coverage, Phase-2 50/70 branch gates, operational-isolation (roots/ports/locks/browser profiles),
   and change-accounting guards pass. In the legacy repo, `lint:tests` may retain only fingerprinted
   pre-existing debt; no new/replaced fingerprint exists and touched legacy files add no debt.
5. **The docs match what is built** — every owning doc updated to as-built (charter: the foundation's
   documentation is part of the foundation), and this master plan's phase table fully checked off.
6. **The immutable ledger is live** — every real commit writes an atomic outbox projected by one
   serialized ordered writer into a never-pruned actor-attributed ledger; restart/reconciliation,
   ordering, missing/duplicate outbox, and recovery checks pass. Hash chain/tail anchor is deferred.
7. **Authority is recoverable** — current backup health is green; a restore drill has recovered the
   as-built DB schema while preserving claims/dependencies/checkpoints/commands/write intents/
   outboxes/capture handoffs; projection rebuild and unknown-post-backup handling pass.
8. **Runs are explainable and trustworthy** — every terminal run has a schema-valid evidence receipt
   with honest confidence; every failure has a structured redacted diagnostic bundle; durable
   notifications remain visible when desktop delivery fails; `explain run` needs no tracker-blob
   archaeology.
9. **Workflow knowledge is canonical** — UI ids/catalog, task/workflow results, scenario corpus,
   knowledge records, and fix records have no unresolved duplicates/orphans/stale references. Every
   migrated production bug has a regression scenario and supersedes conflicting lessons.
10. **Authoring tools respect their boundary** — the explorer renders the exact as-built graph and
    source links; presentation-only changes use the strict atomic override; graph/policy edits emit
    a reviewed patch scaffold; code-only selector/schema/subject/proof changes cannot be emitted by
    the editor, and no workflow has dual graph authority.
11. **Local-first scope remains true** — the operator server currently binds loopback and retains
    the actor/auth-checkpoint/credential-set/per-actor-notification seams without dormant RBAC or
    LAN mode. Diagnostic/backup/evidence permissions + redaction tests pass; the only remote
    listener is a live-session-scoped mobile-capture ingress whose deny-by-default route tests pass.

_Moved from `history/superseded/2026-08-20-master-plan-dissolved.md` §7.4 (added program-wide exit criteria) on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

Before definition-of-done item 2 (single cutover), all of ref frontend-backend-integration §10 must pass. In particular:

- production React has one typed transport client and no direct component `fetch`/`EventSource`;
- no raw legacy tracker/session/log row crosses the rebuilt API boundary;
- all authoritative counts and Activity aggregates come from the one run-projection family;
- every visible action is a served command/navigation descriptor or clearly local UI state;
- reconnect, cursor gap/reset, command conflict/idempotency and degraded read-only behavior are
  proven in the real built app;
- the complete reference route matrix matches the approved frontend in both themes; and
- the preserved legacy demo/mock wires stay in the legacy repo and are unreachable from the rebuild
  repo; removing them is not an integration or initial-cutover requirement.
