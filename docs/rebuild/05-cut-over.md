# 05 · Phase 5 — cut over

This doc is the dedicated home of **Phase 5**, tree node `{#cutover}` — the one all-at-once authority
switch. It holds those tasks, what is done and what is left, and its exit criteria; contracts it
built live in `reference/`.

## Phase summary
<!-- roadmap: cutover -->

<!-- roadmap-status: cutover -->
<!-- /roadmap-status -->

_Moved from 07-master-plan §4 on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

**The two addresses.** The **legacy repo** (`hr-automation`) holds the production automation and
remains the sole production authority — live-runnable, maintainable, and never deleted before
cutover. The **rebuild repo** (`hr-automation-rebuild`) holds the rebuild: source at plain `src/`,
tests at `tests/`, config at `config/`, plan docs at `docs/rebuild/` (kept at that path so every
cross-doc link in this program still resolves), gated by the plain `typecheck` / `lint` / `test` /
`test:architecture` family. Its history starts fresh, seeded from the `feature/rebuild-phase1b` tip;
that branch stays in the legacy repo as the pre-split record.

**Isolation is physical, so the guards that simulated it are retired.** Two repositories share no
module graph, no build, and no process: cross-runtime imports, invocation, proxying, and live-state
access are structurally impossible rather than banned-and-checked. D88's bidirectional
runtime-isolation guard family and the legacy preservation manifest's same-tree scanning — which
imposed the rebuild's strict normal form on changed legacy files — are therefore **retired by D93**;
legacy files are governed by the legacy repo's own existing gates, and the rebuild's own tree is
strict from its first file.

**What still has to be chosen and proved, because both worlds run on one machine:** distinct
commands/entrypoints, distinct state/artifact roots, distinct ports, distinct process locks, and
distinct browser profiles/sessions. These remain REQUIRED and remain gated — a shared port or a
shared browser profile is a real collision that no repository boundary prevents.

**Legacy maintenance continues, accounted cross-repo (D90/D94).** Production fixes and their
matching legacy tests stay allowed. The sequence is mandatory: commit the legacy `src/`/`tests/`
change first, then add schema-v2 records in the rebuild repo for every changed path under that exact
legacy commit. Records bind first-parent/commit blob hashes, affected capability ids (at least the
independent reviewed exact/prefix impact floor), non-empty impact rationale, and closed rebuild
recheck/evidence ids. The guard enumerates the complete commit/path history since the Phase-0
baseline in order and rejects omissions, extras, stale hashes, bad ancestry, or any dirty legacy
`src/`/`tests/` state—including staged and untracked changes. This intentional red interval is the
fail-closed handoff between the two commits, not permission to account an uncommitted tree. The
legacy root `CLAUDE.md` carries the same duty. Verified knowledge is ported by **copy with
provenance** (legacy commit hash + source path), never linked at runtime. Legacy source and tests
cannot be deleted during the rebuild or initial cutover; deletion is representable so the guard
can diagnose it, then always fails.

The following are forbidden: continuous tracker lift, legacy API proxy/remount, a compatibility
SPA, per-run engine/generation authority, workflow-scoped production flips, and any interval where
both engines accept production work. An optional historical importer is an explicit versioned,
idempotent one-time command over an immutable backup; it is never a runtime adapter.

**Single cutover procedure (D89):**

1. Pass every phase/workflow/capability gate, including 60/80 coverage, Phase-2 50/70 branches,
   live dry-runs, controlled write proofs, restore/soak, and the complete doc 13 surface matrix.
2. Stop new legacy enqueues; enumerate active/queued/gated/parked/unknown-write runs and drain,
   terminalize, park, or reconcile each explicitly. No uncertain write may be buried.
3. Back up legacy state/config and rebuild state/config; verify both backups. Run only approved
   versioned one-time imports, recording source digests and idempotent manifests.
4. Atomically repoint the normal production launcher at the **rebuild repo**; verify the legacy
   launch is disabled and rebuild health/read/write smoke gates pass. This is the same single
   authority switch D89 always specified — D93 only makes the switch a change of repository rather
   than an in-repo authority flip.
5. Preserve the **entire legacy repo** — source, commands, tests, and the state backup — as the
   rollback asset. Keeping a whole separate repository is strictly stronger than the in-tree
   preservation D89 originally assumed. After native writes, rollback requires intent/ledger
   reconciliation and dedupe proof before an atomic switch back. Deletion/retirement is outside this
   cutover and requires separate operator authorization.

## Rollback window, then closure
<!-- roadmap: rollback-window -->

<!-- roadmap-status: rollback-window -->
<!-- /roadmap-status -->

_The rollback asset and what re-crossing it costs are step 5 of the single cutover procedure above (07 §4), and definition-of-done item 2 in §Exit criteria below: the whole legacy repository is preserved, and a rollback after native writes requires intent/ledger reconciliation and dedupe proof before an atomic switch back._

## Later, unplanned
<!-- roadmap: later-unplanned -->

<!-- roadmap-status: later-unplanned -->
<!-- /roadmap-status -->

## Risk register (top sequencing risks)

_Moved from 07-master-plan §5 on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

| # | Risk | Why it bites | Mitigation |
|---|---|---|---|
| 1 | **A contract flaw surfaces late** | a fixture-proven base can be wrong in ways only a real run reveals | **D74 is the mitigation, and it worked**: person-lookup ran live as Phase 1's *exit* on 2026-08-04, and the live lane that produced it found four defects every fixture had passed — a login concluded from a URL (D120, 2026-08-03), a `node:path` import that reached the browser bundle (doc 13 §8.13), a span fold keyed on path alone that erased a re-run node, and a timeline seed that collided across run attempts. All four were fixed before the tails were built on them. Phase 2 now adds the controlled transaction proof with crash/outbox/dedupe evidence |
| 2 | **Phase 1 (XL) overruns** | a long isolated build increases integration drift and delays the single cutover | Phase 1 is cut to the spine (D74); §3.7 sizes each item; D79 trims are taken; D90 change accounting forces rebuild rechecks after legacy maintenance |
| 3 | **The two maintained repos drift** | a necessary legacy production fix changes knowledge already copy-ported into the rebuild repo, and D93's physical separation means nothing breaks loudly when it does | D90 accounting is now cross-repo and is the *only* drift detector: every legacy commit maps to capability ids and rebuild evidence in the rebuild repo's `config/legacy-change-accounting.json`, keyed by legacy commit hash (the legacy repo's root `CLAUDE.md` carries the standing duty); affected rebuild scenarios/ports must be reverified before readiness |
| 4 | **A target can make settlement unknowable** (write-safety residual) | UI-only systems may expose neither an idempotent API nor a trustworthy immediate negative read after a click; early absence can be eventual-consistency lag, and a positive match can still be for the wrong subject | D48/D64/D69/doc 09: permanent key fence; fresh binding proof; typed positive proof; every counted negative observation must occur after the target-specific propagation window and repeated authoritative checks must agree; unsettled/ambiguous evidence parks; per-probe live verification at migration. The guarantee is at most one unattended commit attempt per intent generation plus verified convergence—not unconditional distributed exactly-once |
| 5 | **Build context + operator-attention limits** | The program is long (15 workflow directories across 10 migration orders, plus shared capability closure); high WIP and oversized sessions cause ownership drift | One-at-a-time Phase 3, coherent local commits, explicit handoffs/checkpoints when needed, Phase-2 gates before scale, machine inventories/guards so review concentrates on live evidence; §3.7 sizes the work so attention is spent where the mass actually is |
| 11 | **Decisions drift ahead of the docs that own them** | *Observed 2026-07-26*: the 07-23/24 operator ratifications sat in a review file for four days while docs 00/07/09 still specified the world they replaced — the master plan would have had Phase 1 build a lift adapter, a parity harness, and a generation-authority stamp that the operator had already deleted | Charter standing rule: **a decision is not ratified until it lands in its owning doc, in the same commit that records the answer.** Doc 04 is a changelog with pointers, never a second spec; review files are history. A doc's amendment date must be ≥ the latest round that touched it |
| 6 | **Canonical UI registry becomes a second stale selector list** | Drivers change selectors but forget ids/catalog/scenarios, or obsolete ids multiply | registry is driver authority, generated catalog only, same-system dependency guard, selector verification metadata, non-identity search terms, explicit `supersedes` links, migration scenario before removal |
| 7 | **Authority backup exists but has never been restored** | Corruption is discovered during a real run and the “backup” is unusable | Phase-1 automated corruption/restore drill and recurring doctor/backup-health surface; degraded mode blocks mutations instead of creating an empty DB |
| 8 | **Evidence volume recreates an unreadable log pile** | screenshots/notes/bundles consume disk and hide decisive facts | structured indexes, on-demand bundles, 30d notes/30d spans, content-addressed dedupe, disk warnings/redaction |
| 9 | **The closed editor regrows DSL/codegen** | a UI edit changes graph, bind, selector, or proof semantics without code review | DSL/codegen remains absent; Phase-2 2i exposes a read-only explorer plus a closed presentation/policy edit union; prohibited changes emit only a code-change brief |
| 10 | **All workflows migrate but a shared capability is forgotten** | capture, AI assist, exports, settings, maintenance, or a special route blocks/degrades final cutover | D58 inventory covers old services/routes/UI/CLI/tools exactly once; cutover rejects undecided/unproven entries; no proxy disposition exists |

## Program stop-loss / abort gate

_Moved from 07-master-plan §5.1 on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

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

_Moved from 07-master-plan §6 (definition of done, whole program) on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

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

_Moved from 07-master-plan §7.4 (added program-wide exit criteria) on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

Before definition-of-done item 2 (single cutover), all of doc 13 §10 must pass. In particular:

- production React has one typed transport client and no direct component `fetch`/`EventSource`;
- no raw legacy tracker/session/log row crosses the rebuilt API boundary;
- all authoritative counts and Activity aggregates come from the one run-projection family;
- every visible action is a served command/navigation descriptor or clearly local UI state;
- reconnect, cursor gap/reset, command conflict/idempotency and degraded read-only behavior are
  proven in the real built app;
- the complete reference route matrix matches the approved frontend in both themes; and
- the preserved legacy demo/mock wires stay in the legacy repo and are unreachable from the rebuild
  repo; removing them is not an integration or initial-cutover requirement.
