# Cutover stage · switch production authority once

This stable-path doc is the dedicated home of tree node `{#cutover}`, the one all-at-once authority
switch, its rollback window, the risks that decide whether the switch is safe, and **the program's
definition of done**. If you open one list to decide whether this rebuild is finished, open
§Exit criteria below: nothing else in `docs/rebuild/` claims to be that list. Contracts the cutover
reads live in `reference/`.

**D319 numbering note (2026-09-02).** Cutover remains the final authority-switch stage but does not
reserve a phase number while workflow phases are admitted one at a time.

**Nothing here has been built.** The cutover stage has zero landed work at HEAD, and that is
by design — every item is an act performed once, on a day the operator chooses, after Phase 3 closes.
What exists today is the *design* of the switch (ratified in Phase 0, D88–D94) and the *conditions*
that must hold before it happens. This doc's job is to keep those conditions honest.

## Stage summary
<!-- roadmap: cutover -->

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
| P1 | **Every migration order is migrated and live-verified** by a submit-free dry run against every real system it touches | the tree's `{#migrations}` order nodes; `03c-migrate-the-remaining-workflows.md` | **open** — order 0 done, order 8 at 8/9, eight orders unstarted |
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
- [x] the PACKAGING half is no longer LATER — the operator promoted it to the desktop stage on 2026-08-21 (R14, `06-ship-the-desktop-app.md`, tree node `{#desktop-app}`), which gives it the owner and the design a LATER item by definition lacks
> 2026-08-21 | docs-cohesion 05 | verified against `ref operator-trust` §7 (the four seams, built and load-bearing) and `reference/decisions.md` D193(a); this node proposes no work and blocks no gate — nothing is left because nothing is owed
> 2026-08-21 | docs-cohesion R14 | one of the two items left this tier: packaging is the desktop stage now; the cooperation / multi-user item and the hosting refusal are untouched

<!-- /roadmap-status -->

**This node holds the LATER tier, and its only rule is that it never blocks the cutover.** D76 sizes
the program in three delivery tiers and the stop-loss cuts them in one order: **LATER first, then
SHOULD, never MUST** (§Program stop-loss / abort gate). A LATER item is therefore defined by what
happens to it under pressure — it is dropped without renegotiating anything the program promised —
and `05-cut-over.md` §Exit criteria names none of them.

**Two items were recorded by D193(a) with no owner and no design, and one of them now has both.**
*Packaging the local system as a locally-run app* — the "web app → real app" idea — **left this tier
on 2026-08-21**, when the operator made it **the desktop stage** (`06-ship-the-desktop-app.md`, tree node
`{#desktop-app}`, plan ruling R14): a Mac and Windows desktop app, delivered at the end of the
program. What remains here is *a cooperation / multi-user mode built on top of the solo system*, if
ever. It is not scheduled, it has no trigger, and it is not a deferral in the
`04-close-the-deferrals.md` sense: a deferral names the event that ends it, and this one names
nothing because nobody has decided it will happen. The desktop stage changes none of that — packaging is a
delivery mechanism, not a step toward multi-user.

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

**Re-verified against the as-built on 2026-08-21.** Every row below was written between 2026-07-22
and 2026-07-31, before the spine ran and before either proof landed, so each carries a **STATE** now:
**retired** (the condition that made it a risk no longer exists), **standing** (it can still bite, and
the mitigation is what holds it), or **realized** (it happened — with what it cost and whether the
mitigation caught it). A risk register nobody re-scores is a list of old worries; four of these
eleven have already fired, and reading which ones is more useful than reading the original odds.

Rows are in numeric order. The register carried row 11 between rows 5 and 6 through the shelf split;
that ordering was an artifact of the round it was added in, and it is corrected here.

| # | Risk | State | Why it bites | Mitigation, and what actually happened |
|---|---|---|---|---|
| 1 | **A contract flaw surfaces late** | **standing — mitigation proven twice** | a fixture-proven base can be wrong in ways only a real run reveals | **D74 is the mitigation and it worked.** Person-lookup ran live as Phase 1's *exit* on 2026-08-04 (run `4ebf7275`), and that one run found four defects every fixture had passed: a login concluded from a URL (D120), a `node:path` import that reached the browser bundle (`ref frontend-backend-integration` §8.13), a span fold keyed on path alone that erased a re-run node (D123-family), and a timeline seed colliding across attempts. Phase 2's controlled transaction proof (D135, doc 4489) is the second. The risk STANDS because each remaining migration re-runs the experiment on a new system — and separations has already produced D205, D213, D214/D215 and D221 by exactly this route |
| 2 | **Phase 1 (XL) overruns** | **RETIRED** | a long isolated build increases integration drift and delays the single cutover | Phase 1 was cut to the spine (D74), sized per item (`00-design-the-foundation.md` §Size model + delivery tiers) and the D79 trims taken. **Phase 1 completed 2026-08-04 and Phase 2 on 2026-08-09.** There is no Phase 1 left to overrun; what replaces the concern is Phase 3's own pacing, which row 5 owns |
| 3 | **The two maintained repos drift** | **standing — mitigation REPLACED** | a necessary legacy production fix changes knowledge already copy-ported into the rebuild repo, and D93's physical separation means nothing breaks loudly when it does | The original mitigation (D90/D94 cross-repo change accounting) is **retired by D150** — it made an unrelated in-flight edit in the PRODUCTION repo a red gate here. The drift detector is now **mandatory live re-verification at each workflow's migration**, which is strictly stronger: a selector checked against the live system beats one diffed against legacy's copy of it. It is not theoretical — D196's re-verification deleted legacy's entire moment-picker calendar path rather than merely catching drift in it. Residual: re-verification happens at MIGRATION, so knowledge ported and then left unmigrated for a long time is unchecked in the interval |
| 4 | **A target can make settlement unknowable** (write-safety residual) | **REALIZED 2026-08-04 — the kernel held** | UI-only systems may expose neither an idempotent API nor a trustworthy immediate negative read after a click; early absence can be eventual-consistency lag, and a positive match can still be for the wrong subject | D48/D64/D69 and `ref write-safety`: permanent-key fence, fresh binding proof, typed positive proof, negative observations only after the target's propagation window, unsettled evidence parks. **It fired on the first real write.** D128's controlled commit fenced, clicked `Save`, received HTTP 200 and a rendered *"Form saved"* — and persisted nothing, because Kuali serializes only the current step's section. The kernel behaved exactly as designed: durable fence before the click, read-back `absent`, intent parked `unknown`, ZERO checkpoint / ledger / terminal-span rows, and a later run on the same key refused in 1 ms with no browser. **A positive save signal is worth nothing** is now a recorded finding rather than a hypothesis. Residual: propagation windows are measured for Kuali only (D135/D207); UCPath and ServiceNow stay `operator-only` until their own live probes at order 7 (`04-close-the-deferrals.md` criterion 10) |
| 5 | **Build context + operator-attention limits** | **standing — and now the binding constraint** | the program is long (15 legacy workflow directories across 10 migration orders, plus the shared capability closure) and high WIP causes ownership drift | One-at-a-time Phase 3, coherent local commits, explicit handoffs, machine inventories and guards so review concentrates on live evidence; `00-design-the-foundation.md` §Size model + delivery tiers puts the sizing where the mass is. With Phases 0–2 closed, this is the risk that actually governs the remaining schedule: eight unstarted orders, each owing a questionnaire, a live dry run and (for writes) a controlled commit |
| 6 | **Canonical UI registry becomes a second stale selector list** | **standing — mitigation strengthened** | drivers change selectors but forget ids/catalog/scenarios, or obsolete ids multiply | The registry is driver authority with a generated catalog only, a same-system dependency guard, selector verification metadata, non-identity search terms, explicit `supersedes` links, and a migration scenario before removal. Strengthened by D150: 406 legacy keys are pinned to a FIXED commit's blobs (so legacy moving on cannot invalidate the pin) and every ported key is live-re-verified at its migration regardless |
| 7 | **Authority backup exists but has never been restored** | **REALIZED 2026-08-09 — in a form worse than the one written down** | corruption is discovered during a real run and the "backup" is unusable | The written mitigation — an automated corruption/restore drill plus a doctor/backup-health surface, with degraded mode blocking mutations rather than creating an empty DB — was built and green. **2j found the restore path was structurally unreachable anyway** (D181): the offline restore service had demanded a one-time stopped-system proof since Phase 1c, and nothing in production had ever recorded the runtime-lock snapshot it derives from, so `cli storage restore` could not have worked on its first day. Fixed by one lock file per role, written before the database opens. Residual is precondition **P7**: the automated drill runs every commit against a real-shaped copy, and an operational rehearsal against the real `.tracker-rebuild` is unrecorded |
| 8 | **Evidence volume recreates an unreadable log pile** | **standing — and deliberately under-invested (D193(b))** | screenshots, notes and bundles consume disk and hide decisive facts | Structured indexes, on-demand bundles, 30-day notes and spans, content-addressed dedupe, disk warnings and redaction — all built. D193(b) then decided the REST of it is not worth buying at this scope: the retention sweep's scheduling and the content-store refcount are `wont-build-unless-asked`, because this database stores records of COMPLETIONS and the primary record lives in UCPath or Kuali. The risk is accepted, not closed (`04-close-the-deferrals.md` §Auto-purge diagnostics) |
| 9 | **The closed editor regrows DSL/codegen** | **standing — and untested, because there is nothing to edit yet** | a UI edit changes graph, bind, selector or proof semantics without code review | DSL/codegen remains absent (D79a). The Workflow Explorer shipped **read-only** in 2i, and its EDIT half was REASSIGNED out of Phase 2 by **D186** on D79a's own argument: an editor exists to avoid a code change per tweak across many workflows, and a closed policy union shaped by a sample of one would be shaped wrong. The trigger is a SECOND production workflow whose policy somebody wants to change — so this risk cannot be evaluated until the thing that creates it exists |
| 10 | **All workflows migrate but a shared capability is forgotten** | **REALIZED 2026-08-09 as REGISTER ROT, then fixed** | capture, AI assist, exports, settings, maintenance or a special route blocks or degrades the final cutover | The D58 inventory covers old services/routes/UI/CLI/tools exactly once, `cutoverRequiresZeroOpen` is `true` and `proxyDispositionAllowed` is `false`. **The inventory itself rotted first**: D184/D188 found 73 of 78 entries `open`, 53 of them owned by milestones that had already shipped — a claim nobody could act on, invisible because the guard only checked path coverage. Re-dispositioning closed 27 with real targets; the guard now refuses an entry that is `open` at or before the runtime's own `completedThrough`, a `native`/`replaced` target that does not resolve, and evidence that only says "the legacy file still exists". The register reads 47 open / 20 replaced / 7 native / 4 retired at HEAD, all 47 owned by `workflow-admission-backlog` |
| 11 | **Decisions drift ahead of the docs that own them** | **REALIZED 2026-07-26 — the standing rule dates from it** | *observed*: the 07-23/24 operator ratifications sat in a review file for four days while the charter, the master plan and the write-safety doc still specified the world they replaced — the plan would have had Phase 1 build a lift adapter, a parity harness and a generation-authority stamp the operator had already deleted | Charter standing rule, now in `CLAUDE.md`: **a decision is not ratified until it lands in its owning doc, in the same commit that records the answer.** `reference/decisions.md` is a changelog with pointers, never a second spec; history files are history. The rule has held since, and the failure mode it leaves open is the inverse one this docs pass exists to fix — a doc whose prose outlived the code, which D252's "done is verified against the code, never against the earlier prose" answers |

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

## Legacy vs rebuild (as of 2026-08-21)

**Dated because it is an inventory of a moving world, not a contract.** Re-verified on 2026-08-21
against `config/legacy-capabilities.json`, `src/stores/`, `docs/rebuild/guard-inventory.json` and
the legacy checkout itself; four claims moved and are called out where they sit. The register is the
machine-readable half of the second table — if these disagree, the register wins and this section is
stale.

### Already built — what the rebuild does differently

| Area | Legacy | Rebuild |
|---|---|---|
| Run kernel | Daemon holds state in memory; crash mid-run leaves the row to be inferred | Authority re-read + CAS before **every** transition; lost claim can never terminalize over another owner; every task races an injected deadline |
| Write safety | No fence; a failed save leaves unknown state; a retry can double-file | Seven beats: probe → prepare → subject binding → **durable fence before the click** → commit → read-back proof → settle; uncertainty **parks** with durable intent; same permanent key re-run answers `already-present` in 2 ms |
| Dry run | A flag the workflow honors | On the run's immutable envelope; `commit` structurally absent; zero durable rows **asserted**; and since D238 a rehearsal can no longer wear `verified-done` — the schema makes that pair unrepresentable |
| Evidence | Reconstructed from log files | `RunEvidenceReceipt` = pure function of authority, byte-identical on re-derivation, per-field declared redaction; CLI and dashboard read the same derivation |
| Failures | `error: string` on a span | Structured `FailureRecord` + auto-captured, capture-time-redacted diagnostic bundle, committed with the terminal state |
| Ledger | None | Ordered, actor-attributed, fsync'd, digest-chained; any corruption stops the partition rather than renumbering history |
| Storage | JSONL + SQLite, no backup, no restore | ONE authority DB, SHA-pinned immutable migrations, live backup cadence, byte-verifying doctor, and a restore drilled **every commit** against a real-shaped copy — D181 is what made the path reachable at all, and the operational rehearsal against the real database is precondition P7 |
| Notifications | In-memory React store — reload loses it — **plus a real desktop channel and a voice cue** (`src/dashboard/lib/desktop-notifications.ts`, `src/tracker/alerts/notify.ts`, `src/infra/auth/voice-cue.ts`) | Durable inbox row committed **before** any OS delivery; repeated triggers fold into a count; no free-text, so it structurally cannot leak form contents. **The OS delivery is a declared seam with no implementation** — `OsNotificationDelivery` has no producer anywhere in `src/`, and an absent delivery means "no desktop channel configured", never "delivered". The durability half is ahead; the reach half is behind (second table) |
| Intake | Parse at enqueue, then gone | Durable session → mapping (suggestions can never auto-bind) → validation → **immutable manifest** + N runs + CAS in one transaction; reruns hash-diff |
| Edit Data | Exists | Resume claim IS the fence; edits become authority only by re-parsing through the producing node's own schema |
| Start | Fire-and-forget enqueue | Plan-then-consume; exact raw JSON retained beside canonical — defaults can never erase what you typed |
| Registries | ~10 hand-maintained parallel registries; a typo compiles | ONE `WORKFLOW_MODULES` tuple; stale fingerprint manifest is a red gate |
| Guards | 31 guards, accepted lint debt | **65** active guards (75 inventory entries: 65 active · 8 retired · 2 planned), zero debt, every mechanical arm proven against a violating fixture |

### Where legacy is still ahead (the honest list — this IS the Phase 3 surface)

**This list is derived from the register, not from memory.** `config/legacy-capabilities.json` holds
78 entries and **47 are open** at HEAD — every one owned by `workflow-admission-backlog`, and the
cutover requires zero (`cutoverRequiresZeroOpen: true`, `proxyDispositionAllowed: false`). The 47
split 15 / 32:

**Fifteen legacy workflow directories, none closed.** crm-doc-download · emergency-contact ·
i9-check · i9-lookup · kronos-pay-rule · oath-signature · oath-upload · ocr · old-kronos-reports ·
onbase · onboarding · person-lookup · separations · sharepoint-download · work-study. Two of those
are worth reading twice: **person-lookup is open even though order 0 shipped and ran live**, because
order 1's Search and Match modes have no counterpart for legacy's `crm-search.ts`, `match.ts` and
`outcome.ts`; and **separations is open while its migration is at 8 of 9**, because a capability
closes when the legacy directory is covered, not when a workflow by that name exists here.

**Thirty-two non-workflow capabilities**, by kind:

| kind | n | entries |
|---|---|---|
| route | 14 | ai-assist · base · daemon-stop-instance · files · oath-upload · ocr · ops · screenshots · search · settings · sharepoint · static · workflow-design · workflow-presentation |
| dashboard | 7 | capture · log-panel · navigation · oath-upload · ocr · settings · workflow-modifier |
| export | 3 | export-excel · i9-check-tracker · spreadsheet (incl. the master I-9 retention workbook) |
| maintenance | 3 | ops-clean-tracker · ops-compact-tracker · ops-setup (the setup wizard) |
| codegen | 2 | codegen-export-schemas · workflow-design-build-data-bank |
| cli | 1 | cli-main — legacy's per-workflow subcommands and system probes, including `test-login` |
| dev-tool | 1 | debug-kronos |
| service | 1 | llm |

**In product terms**, that register is: the OCR review/approve UI · the screenshots gallery and the
artifact-bytes route · cross-date search · three Excel export writers · the workflow graph editor and
its data bank · editable settings · the production phone-capture delivery path · LAN mode · the setup
wizard · `test-login` · **the desktop notification channel and voice cue** · and **five system stores
that are declaration-only here** — `i9`, `old-kronos`, `onbase`, `servicenow`, `sharepoint`, each a
session declaration with **zero tasks** (`src/stores/`).

**Four corrections against the 2026-08-20 wording**, each verified rather than assumed:

1. **Five declaration-only stores, not six.** `new-kronos` acquired a real driver, session recipe and
   two task files at separations chunk 1 (D196), so it left the list.
2. **The record-sanity-check AI tool is RETIRED, not deferred to order 8.** The operator retired it on
   2026-08-18 (D192), and the register carries all three advisories as `retired` —
   `tool-ops-sanity-check-record`, `tool-ops-selector-suggest`, `tool-ops-summarize-run`. The gate
   packet's own server-computed deterministic comparison IS the sanity check. What stays OPEN is the
   route and the service that hosted them (`route-ai-assist`, `service-llm`), which is a different
   thing from the feature.
3. **Two matrix rows have no surface at all** — Group People and OCR Review, both `declared-unserved`
   (D184). They are not on the register as their own entries because the register tracks legacy
   capabilities and these are rebuild-side absences; `ref frontend-backend-integration` §10 criterion
   1 is where they are gated.
4. **The desktop notification channel is a genuine legacy-ahead item**, added here for the first time:
   the rebuild's durable inbox is strictly better as a RECORD and currently reaches nobody who is not
   looking at the dashboard.

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
| 5 | **The docs match what is built** — every owning doc updated to as-built (charter: the foundation's documentation is part of the foundation) | **active** | The master plan whose phase table this criterion originally cited was **dissolved on 2026-08-20**; the plan is now `docs/roadmap/roadmap.md` plus the phase docs `00`–`05`, bound to the tree both ways by D263's `doc:` refs, `<!-- roadmap: -->` tags and the binding guard. The docs-cohesion pass IS this criterion's work and is in flight. Left: the per-doc rewrites not yet landed, and `03c` still carries its shelf-split "Moved from" markers |
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
