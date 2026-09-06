# Phase 2.5 · Closing verification

Read the [phase overview](../README.md) for shared context, decisions and phase-wide exit criteria.

## 2.5 · Closing verification
<!-- roadmap: p2-2j -->

### Task 1 · Audit the scenario corpus and capability inventory
<!-- roadmap: p2e-close -->

### Task 2 · Prove restore, concurrency, and redaction
<!-- roadmap: p2e-recovery-proof -->

### Task 3 · Repair gate-found defects and reconcile owning docs
<!-- roadmap: p2e-repair -->

<!-- roadmap-status: p2-2j -->
- [x] the **executable scenario corpus** and `scenario-coverage`, audited in BOTH directions, plus D185's corpus-layout audit — a file of neither kind, an unregistered claim and a manifest row nothing executes all fail (`ref operator-trust` §3/§3.1, `ref guards-and-tests` §3.10)
- [x] the **corruption → restore drill**, twice: in fixtures over a seeded real-shaped database through `composeStorageCommand`, and ONCE live on a COPY of the standing local authority database — corruption named read-only in 0.92 s, restore in 0.99 s, doctor healthy in 0.71 s, with 14 runs / 2 checkpoints / 2 write intents / 2 outbox rows preserved including the real Kuali controlled commit's durable footprint (D181; `ref dashboard-surfaces` §2.5)
- [x] the **dependency / control / capture concurrency matrix** and the **3-worker × 30-run soak** — `projectAll()` reports every ledger partition `projected` and the whole-database invariant sweep is `valid` (D182; `ref execution-and-sessions` §7.1)
- [x] the **redaction surface scan** — `redaction-surface-scan` is the one sweep over every egress class (D183; `ref guards-and-tests` §3.15)
- [x] the **capability-inventory re-disposition** (D184/D188) — 27 entries closed with real targets, the rest moved to the milestone that will genuinely build them, and the guard now refuses an entry `open` at or before the runtime's own `completedThrough`, an unresolvable target, and evidence that only says "the legacy file still exists"
- [x] **D190** closed the safety-critical coverage floor (70.08 % → 99.43 % on `run-queue-projection.ts`) and **D191** made `test:coverage` the per-commit gate
- [x] every owning doc brought to as-built
- [ ] `ScenarioManifest`'s preflight fault set has **no runner** and `preflight-coverage` stays `planned` with D188's real trigger — the first migration that adds one; the declaration side is held by `runtime-dependency-coverage` (`ref operator-trust` §3.1, `ref guards-and-tests`)
- [ ] the **component layer has no test lane** — this tree renders no React outside the parity corpus, and the parity lane is OUTSIDE the per-commit gate, so a `.tsx` change is gated only by typecheck/lint/unit until someone runs `npm run test:parity` → `{#workflow-authoring-core}`
- [ ] **D91's BRANCH half is UNMET** and its Phase-2-exit trigger has passed: `coverage.thresholds` configures lines/statements/functions only, so branches are report-only at a measured 71.76 % (`ref guards-and-tests` §3.14/§10.10) → `{#workflow-authoring-core}`
- [x] **D85 parts 2 and 3 did not land in Phase 2, then closed under R10** — `cli dry-run-scenario <workflow> --subject <label>`, `config/test-subjects.json` and insert-only result evidence (`ref guards-and-tests` §10.5/§10.6); current revalidation is owned by `{#workflow-authoring-core}`
- [ ] the 14/8/5 retention sweep and a configurable backup path — both `wont-build-unless-asked` by D193 → `{#def-retention}`
> 2026-08-25 | test-tiers | D85's deferred subject/runner/result machinery is now built; this Phase-2 record still leaves the preflight runner, component/parity lane and D91 branch floor with their existing owners

<!-- /roadmap-status -->

**What 2j was.** The base integration / restore / soak / documentation gate: the full scenario
corpus, the corruption→restore drill, the dependency / control / capture concurrency matrix, worker
teardown and the multi-worker soak, the redaction scan, capability-inventory validation, and then
every owning doc updated to as-built.

**COMPLETE 2026-08-09 (D181–D190).** Its normative contracts are `ref operator-trust` §3 and §3.1,
`ref execution-and-sessions` §7.1, `ref guards-and-tests` §3.11 and §3.15, and `ref
dashboard-surfaces` §2.5, with `ref workflow-model` §1.6.3 holding the D58
closure — each carries its own `p2-2j` status block.

### What 2j found, because that is what a gate is for

Four real defects, every one of them green on every earlier gate.

1. **`cli storage restore` could not have worked.** The offline restore service has demanded a
   one-time stopped-system proof since Phase 1c, and `RecoveryStopProofStore` refuses to issue one
   without a recorded `RecoveryRuntimeLockSnapshot` — but **nothing in production had ever recorded a
   snapshot**: `recordRuntimeState` had no caller and `.tracker-rebuild/locks`, pinned as a distinct
   isolated resource since D88, was never created. The whole restore path was complete, tested and
   unreachable from its first day (D181). The fix is one lock file per role, written before the
   authority database opens and released after its handle closes, with the snapshot COMPOSED at
   observation time from both files — a shared snapshot would need a read-modify-write from two
   processes, and a lost update there would report a running server as stopped. Liveness is
   OBSERVED (`process.kill(pid, 0)`, `EPERM` counts as alive) and the observation writes nothing: a
   crashed holder must not brick recovery at the one moment it is needed, and rewriting another
   process's lock file to make a restore possible would be fabricating the fact.
2. **Every `paper-ink` parity reference had been photographed DARK** since the corpus existed. The
   harness stamped `data-demo-theme` on `<html>`/`<body>` with a post-navigation `page.evaluate`,
   while `LoadedApp` renders its own on the app root and `tokens.css` scopes the palette off the
   BARE selector — so the root re-themed its subtree from inside, out of React state nothing had
   touched. The semantic half AGREED with the pixels, so there was nothing to diff. The fix is
   `page.addInitScript` seeding the product's own stored preference BEFORE navigation, plus an
   `assertThemeApplied` that refuses when the three writers disagree (D187).
3. **The run-detail panel was two pixels wide** at every viewport since 1i-spine. Its root is a flex
   child that never claimed a width, so it sized to content and its own
   `grid-cols-[minmax(0,1fr)_var(--ds-w-context-rail)]` resolved to `2px 376px` — the entire column
   holding the failure record and the evidence receipt. The accessibility tree reported every word,
   which is exactly why review after review passed over an empty column, and why **D82's acceptance
   bar was unmet ON SCREEN through a dozen green gates and two deliberate reference reviews** (D187).
4. **`buildRunEvidenceReceipt` answered HTTP 500 on a reachable path.** It minted a `verificationId`
   for every node but emitted the verification row conditionally, while a downstream derived fact
   cites its upstream nodes by that same mint — so `assertEvidenceRefsResolve` correctly refused the
   whole receipt whenever an upstream node had no checkpoint. That is `ref workflow-model` §5.4's
   `startAt` resume with injected context, i.e. the Edit Data path: production-reachable, not a
   fixture corner. Every record-less node now emits `unknown`, which is the honest verdict and
   exactly what the verification section is for (D187).

**The rule the four share.** Each was invisible because something ADJACENT to the broken thing was
working: the accessibility tree reported the panel's words, the semantic half agreed with the dark
pixels, the restore path's own unit tests passed over a precondition production never produced, and
the receipt derived fine for every run whose nodes all had checkpoints. **When a test asserts through
one representation of a surface, something must assert the other** — and a reference corpus nobody
looks at records defects instead of catching them.

### Task 4 · Record explicit dispositions
<!-- roadmap: phase2-dispositions -->

<!-- roadmap-status: phase2-dispositions -->
- [x] **D186** — the Workflow Explorer's EDIT half is REASSIGNED out of Phase 2, on D79a's own argument one level down; the trigger that ends the deferral is named (`ref operator-trust` §5.3) and §5.4's apply protocol is unchanged by it
- [x] **D189** — the production BFF **serves no frontend bytes**, so `dashboard:prod` names a mode the runtime never parsed and 2i-F's phone capture surface has no delivery path; deferred deliberately, with an owner (`ref frontend-backend-integration` §6.9)
- [x] **D79a** — the DSL graph-authoring mode is CUT ENTIRELY, and reinstating it requires a new explicit operator architecture decision; a migration questionnaire cannot enable it
- [x] both dispositions confirmed 2026-08-12 and carried onto the deferral shelf — `{#def-explorer-edit}` → 04 §Edit a workflow's presentation / policy without a code change, `{#def-byte-path}` → 04 §Run the dashboard without the dev server / use the phone page in production
- [ ] neither is a waiver: each ships as a named criterion with a trigger and an owner, and `config/legacy-capabilities.json`'s `legacy-route-static` stays honestly **open**
> 2026-08-21 | docs-cohesion 02 | verified against `reference/decisions.md` D186/D189, `ref operator-trust` §5.3, `ref frontend-backend-integration` §6.9 and 04's two deferral sections; left: nothing to decide here — both are owned on the shelf

<!-- /roadmap-status -->

**Two Phase-2 criteria left the phase by explicit disposition, not by silence.** Both are recorded
in full in §Exit criteria below with their evidence; this section is the statement of WHY each was
allowed to leave, and where it now lives.

**1 · The Workflow Explorer's EDIT half — REASSIGNED (D186, 2026-08-09).** The read-only explorer
shipped in 2i-G and its criterion is MET. Phase B — the constrained editor — is deferred on D79a's
own argument applied one level down: **an editor exists to avoid a code change per tweak across MANY
workflows, and this tree has one production workflow plus the one-node transaction proof.** Building
it now would fix its closed policy union and its override schema against a sample of one, which is
the most expensive way to get a schema wrong. The criterion is reassigned, not waived: `ref
operator-trust` §5.3 names the trigger that ends the deferral — the **second** production workflow
whose presentation or policy an operator wants to change without a code change — and §5.4's apply
protocol (compile + scenario + diff + version bump + restart-gated atomic apply + rollback) is
unchanged by the delay. `workflow-editor-compile-integrity` holds Phase A's read-only boundary today
and its inventory entry records that it carries no Phase-B arms. **Owner:** `{#def-explorer-edit}`,
04 §Edit a workflow's presentation / policy without a code change.

**What the editor may never express, whenever it is built (D79a — DSL mode TRIMMED).** Editing is
limited to presentation overrides, hot-applied through their strict atomic file, plus a closed set of
safe typed policy fields. **The DSL graph-authoring mode is cut entirely** — no second authoring
pipeline, no codegen, no exclusive source-vs-DSL mode, no synthetic workflow built to prove it. The
questionnaire's own phrasing expected everything real to stay source-authored, and no concrete
DSL-authored workflow was ever named. Selectors, driver operations, schemas, bind functions and
write-proof/subject rules stay **code-only**; anything the closed editor cannot express generates a
**code-change brief**, never partial config. Reinstating the mode requires a new, explicit operator
architecture decision — a migration questionnaire cannot enable it.

**2 · The production BFF serves no frontend bytes — NAMED GAP (D189, 2026-08-09).**
`http-server.ts` has no static handler and `api.ts` 404s every unrouted path, so `npm run
dashboard:prod` names a mode the runtime never parses, and **2i-F's token-scoped phone capture
surface has no delivery path in production** — `/capture.html` is allow-listed by the Host gate and
nothing serves it. Nothing regresses: the operator's working path has always been the Vite dev
server on 5174 beside the BFF on 3938. It is deferred deliberately for two reasons that compound.
Those bytes would be served on the one surface exposed to the public internet, through the capture
ingress, behind the gate whose whole contract is *"a phone origin reaches capture routes and nothing
else"* — so shipping them is a security change, not a build-config change. And the tunnel launcher
(D175) is unbuilt anyway, so static bytes alone would not make the phone reachable. **Owner:** the
first migration that needs the phone in production, building both halves plus the guard arm;
`{#def-byte-path}`, 04 §Run the dashboard without the dev server / use the phone page in production.
`ref frontend-backend-integration` §6.9 is the normative record, and
`config/legacy-capabilities.json`'s `legacy-route-static` stays honestly **open**.
