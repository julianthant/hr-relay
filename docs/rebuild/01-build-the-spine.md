# 01 · Phase 1 — build the spine

This doc is the dedicated home of **Phase 1**, tree node `{#phase-1}`: its tasks, what is done and
what is left, its exit criteria; contracts it built live in `reference/`.

## Phase summary
<!-- roadmap: phase-1 -->

<!-- roadmap-status: phase-1 -->
<!-- /roadmap-status -->

_Moved from 07-master-plan §3 (Phase 1 — the SPINE) on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

**Goal.** Build the minimum of the dependency graph (§1) that can carry **one real workflow end to
end**, in the rebuild repo's `src/`, inside that repo's own tsconfig project + unit tests +
`test:architecture` ratchets covering it from its first file (charter non-negotiable: no ungated
tree).

**What changed and why (D74, operator ACCEPTED 2026-07-23).** The prior plan built ten base work
items — including the whole trust layer, all data services, mobile capture, Edit Data, the
explorer, and the AI adapters — against **synthetic fixtures with no consumer**, and only then ran
a workflow. Two problems: a live run falsifies contracts a fixture cannot, and this plan's own
stop-loss trigger (b) — "a base contract flaw surfaces after ≥2 consumers depend on it" — is far
cheaper to hit with six work items built than with ten. So Phase 1 is now **1a–1f plus two thin
slices**, and its exit test is a live workflow. Everything cut from Phase 1 is *deferred, not
deleted*: it reappears in Phase 2 §"deferred base tails", where it is built against a proven spine
and a real consumer. **No contract in docs 01–06 changed — only delivery order.**

| In the spine | Deferred to the Phase-2 tails |
|---|---|
| 1a guard plumbing · 1b strict domain/clock/config/secrets · 1c authority storage + recovery + command/write type shell · 1d semantic UI registry + drivers + task/store/session contracts · 1e workflow DAG + delegation + completion + scenarios · 1f registry + workers + command service + write sequencer, including minimal failure/result authority and generic provider admission | Phase-2 tails: 2g (rich evidence receipts, diagnostic bundles, failure/explain projections, notifications, knowledge/fix records, ledger services over the 1f failure authority) · 2h (extraction/normalization/ocr/roster stores, production provider pools/consumers, column mapping, intake manifests, durable capture, Edit Data) · 2i (explorer, AI advisories, storage-health UI, generated catalog UI) · 2j soak/restore/doc gate |
| **1g-spine** — spans/notes emission + the run/queue projection only (what the queue surface reads) | |
| **1i-spine** — the four parity surfaces only: Queue Panel rows, Log Panel, Session Cards, Workflow Panel counts | |

**Program invariant Phase 1 establishes — two isolated repositories, one production authority
(D88/D90, re-mechanized by D93).** The legacy repo keeps running and may receive production
maintenance. The rebuild repo cannot import, invoke, proxy, or read/write legacy live state — that
is now **structural**, not guarded: two repositories share no module graph. What still has to be
*chosen* and *proved*, because both worlds run on one machine, is operational separation:
commands/entrypoints, state/artifact roots, ports, process locks, and browser profiles/sessions are
distinct on both sides. Verified leaf knowledge is ported with provenance (legacy commit hash +
path). Every legacy change maps to affected capabilities and rebuild evidence in the rebuild repo's
`config/legacy-change-accounting.json`; legacy source/tests are preserved. The rebuild's own source
and tests use the full fail-closed strict normal form from their first file; legacy files are held
to the legacy repo's existing gates, whose new/touched test diagnostics cannot add debt. Phase 1
proves only inside the rebuild repo and never changes production routing.

## 1a · 1b — guards, baselines, the strict domain leaf
<!-- roadmap: p1-base -->

<!-- roadmap-status: p1-base -->
<!-- /roadmap-status -->

_Moved from 07-master-plan §3 (Phase 1's ordered work items — 1a and 1b) on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

| # | Work item | Owner | Key guards that must be green at this step |
|---|---|---|---|
| 1a | **COMPLETE 2026-07-31 — Pre-tree guard plumbing + honest legacy baselines.** With no rebuild source yet, first extract shared walk/allowlist helpers as a zero-count-change commit; add the reviewed guard inventory, D58 capability baseline, and D90 legacy-change-accounting manifest, plus exact path/state-root isolation tests; generate the diagnostic-fingerprinted no-new-debt legacy-test lint manifest and zero-debt/non-vacuous rebuild lint/coverage commands. Install coverage tooling inertly; seed the baseline-plus-current legacy-test disposition inventory; do not add unmatched globs or pretend an absent tree was scanned. Acceptance hardening makes ratchet arms executable with adversarial fixtures, discovers nested guards recursively, gives coverage exclusions independent owner/status activation, and treats the rebuild repo's `tests/` root itself as the test-lane activation boundary. **D93 re-homing:** this item landed in-tree; the surviving inventories/manifests/commands move to the rebuild repo under `config/` and the plain gate names, while the bidirectional runtime-isolation guard family, the AST/call-site bridge scan, and the preservation manifest's strict-normal-form scanning of changed legacy files are retired (isolation is physical; legacy files are governed by the legacy repo's own gates) | **Docs 07/10 + ratified testing-system plan** | helper-refactor preserves architecture count; the legacy repo's `npm run lint` stays green; 1,344-error/2-warning fingerprints reproduce; touched legacy tests add/change no diagnostics; state/artifact roots, ports, locks, and browser profiles are isolated across the two repos; rebuild lint/coverage rejects warnings, empty sets, and exclusions drift; 60/80 line-statement-function floors encoded; branch report enabled; guard/capability/test inventories self-validate; no legacy path deletion |
| 1b | **COMPLETE 2026-07-31 — First strict domain leaf + full coverage activation.** Landed closed/branded ids, canonical JSON/absence/boundary types, injectable Clock, strict config/default/settings/env resolution with provenance/fingerprint, fail-loud fiscal/instance rules, typed environment/local-source/file secrets, redaction, exhaustive runtime-dependency + environment/preflight registries, base failure/evidence/scenario/knowledge schemas, and strict bootstrap/day/detail/artifact/subscription wire primitives. `ObservationId` is stable dotted semantic identity; UUID `EvidenceEntryId` owns dynamic receipt rows. Trace hours are `00–23`; the live 60s UKG timeout is reconciled; ngrok local-source absence/unreadability is descriptor-preflight visible. Whole-`src` ratchets/layering are active and the fail-loud catch arm covers multi-statement and block-bodied Promise handlers. Runtime status reports completed-through 1b / active 1c | **Docs 01/10/11/12/13** | **MET:** strict-boundary catalog + unknown-key fixtures; typecheck/lint/tests/architecture/coverage gates; clock/secrets/config/preflight/redaction canaries; defaults/env/settings provenance; bidirectional system/provider/endpoint/secret prerequisite coverage; adversarial ratchet fixtures; no open decision maps |

## 1c · 1d · 1e — authority storage, UI registry + drivers, the workflow DAG
<!-- roadmap: p1-authority -->

<!-- roadmap-status: p1-authority -->
<!-- /roadmap-status -->

_Moved from 07-master-plan §3 (Phase 1's ordered work items — 1c, 1d and 1e) on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

| # | Work item | Owner | Key guards that must be green at this step |
|---|---|---|---|
| 1c | **COMPLETE 2026-08-01 — Authority storage + recovery + command/write type shell.** Landed the private native `node:sqlite` authority adapter, exact authority/projection registry and immutable v1→v2 migration chain, savepoint-correct generation accounting, self-describing verified online backup with generation follow-up, strict authority-record validation, read-only doctor/degraded boot, one-time runtime/process-generation-bound stopped-system restore proof, full D95 command families, strict proof/settlement/binding/intent/attempt/dependency/manifest/gate/notification/outbox shells, permanent `(system,idempotency_key)` fencing, Clock-injected stabilized-negative settlement, and all-or-none intent+attempt+ledger+terminal-span commit. Runtime status reports completed-through 1c / active 1d. This is the authority/type shell: workers, browser mutation, command service, sequencer/projectors, HTTP/UI, and live writes remain later items | **Docs 03/09/11** | **MET:** exact v1 upgrade fixture, DDL/invariants and raw-`DatabaseSync` boundary; authority/projection enumeration; corrupt/foreign/newer/invariant/record-invalid boot fixtures; verified native backup + bounded follow-up; exact consumable stopped-proof restore and projection rebuild; sequential/competing-connection permanent-key dedupe; caught nested fence/commit rollback; observed-present zero attempt/write-outbox; exact Clock settlement boundaries; failure after every atomic storage step rolls back all rows and generation; no untyped command/proof/gate/notification/outcome arm; active `storage-recovery`, `permanent-key-dedupe`, `recovery-negative-proof-settlement`, and `atomic-write-outbox` guards; full gates and coverage green |
| 1d | **COMPLETE 2026-08-01 — Semantic UI registry, typed drivers, task + provider contracts and stores/sessions.** Landed the full legacy selector port map with pinned commit/blob provenance, the server-only closed recipe registry, the recipe-free generated `ui-catalog.json` + per-system `UI-CATALOG.md` projection and its `selector:search` consumer, the typed driver boundary, sealed read/prepare/commit contract overloads with subject specs, freshness/provenance, unforgeable `MutationCapability`, the crash-recoverable content-addressed artifact writer, capability-declared provider adapters with narrowed injected clients, and all nine browser stores with matching session providers and OnBase-only exclusivity. D98/D99/D101 (conjunctive fixture+live verification, UI-owned verification scenarios, imported semantic ids) and D96/D97/D100 (one `SessionNeed`, separate artifact/content identity, provider scope stops at the seam) are ratified in their owning docs. The first `stores/common/` leaf (Kronos timecard) is ported with provenance. Login wiring, session lifecycle, mutation-token minting, and worker execution remain 1f | **Docs 01/05/12** | **MET:** semantic-id uniqueness/dependencies/catalog; catalog omits recipes and captured values; premature commit implementations and capability forgery rejected; raw Page/Locator absent outside driver/session internals through AST plus transitive import-graph checks; remote I/O requires provider declaration and an infra adapter; effect/capability/subject/contract/impl/example/error/store/no-any/artifact/OnBase guards active; every published observation/recipe carries both a fixture and a read-only live evidence ref bound to the same port-map row |
| 1e | **COMPLETE 2026-08-01 — Complete workflow DAG + result/delegation/completion/scenario descriptor.** The mandated real-scale type-inference proof (21-node representative graph + sixteen `@ts-expect-error` controls; `tsc --extendedDiagnostics` 0.47s / 215 MiB against the 5s / 1 GiB budget); the bundle-safe node vocabulary and the ONE builder; the transform-free canonical-input validator with proven round-trip and fail-loud snapshot re-validation (D62); delegation fan-out planning, fingerprinted replay verification, and joins; graph-level scenario coverage derived from the node tuple; doc 03 §4's sealed completion program with its stage chain proven against a sample; the closed run-surface ingress specs and their exhaustive interpreters; descriptor assembly with derived steps/gates/systems/requires and build-manifest `contractFingerprint`; checkpoint storage (authority schema v3 `run_checkpoints`), checkpoint and canonical-snapshot migrations, and the D8 freshness walk; person-lookup registered as the first descriptor with its four contracts; `tests/scenario/`'s executable per-branch/gate/policy corpus; and all five architecture guards active. D102–D107 ratified in their owning docs | **Docs 02/03/12** | realistic graph type suite **MET**; transform-free canonical-input audit + round-trip **MET**; delegation matrix **MET**; no erased target **MET**; strict terminal/gate result **MET**; ingress→canonical round-trip over stored authority **MET**; transaction pairing **MET**; descriptor projection matrix **MET**; executable per-branch/gate/policy scenarios **MET** (`dry-run` and `subject-mismatch` are executor behaviours, pinned as 1f obligations and re-pointed at a real run there) |

**Item 1e begins with a new real-scale type-inference proof.** The deleted spike covered only two
effects and three linear steps. The replacement must compile a representative 15–25-node graph with
read/prepare/commit, transaction pairing, output-dependent branch, fork/join, typed child runs,
external/children gates, heterogeneous completion stages, decorations, errors, and schema changes
that deliberately fail their consumers. No production builder or skeleton lands until the positive
and negative controls pass under the real toolchain with no `any`/`unknown` target erasure.
The D71 disposable 40-node simplified chain is a feasibility floor, not a substitute. The real
suite records `tsc --extendedDiagnostics` and fails if the representative file exceeds 5 seconds or
1 GiB on the same baseline machine; a regression outside that budget stops builder work for type-
shape simplification rather than being normalized as editor lag.

## 1f — registry, workers, commands, the write sequencer
<!-- roadmap: p1-kernel -->

<!-- roadmap-status: p1-kernel -->
<!-- /roadmap-status -->

_Moved from 07-master-plan §3 (Phase 1's ordered work items — 1f) on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

| # | Work item | Owner | Key guards that must be green at this step |
|---|---|---|---|
| 1f | **COMPLETE 2026-08-04 — Core registry + workers/checkpoints/command service/write sequencer.** Landed the composition root above workflows; exact raw+canonical start plans and atomic consumption (D109, schema v6); one-item claims with unfinished-write recovery before requeue (D118); verified-neutral navigation and explicit fresh-session boundaries keyed by config fingerprint (D116/D117); the required non-no-op task provenance collector (D115); minimal durable `FailureRecord` and terminal `RunResultRecord` under pre-terminal authorization (D110/D114, schema v7→v8); D112/D119 generic provider admission/budgets (schema v9, 2026-08-03); one exhaustive command kernel with Phase-1 start/worker-browser/run/gate/write-resolution arms active and later arms typed `capability-unavailable` (D113); context-exclusive transactions; the probe→prepare→binding proof→fence→commit→proof→complete beat-⑦ checkpoint/run/outbox transaction (D111). D120 additionally made a session's authentication a content-level proof rather than a URL, live-verified on ucpath (~17s) and crm (~12s) including a real Duo ceremony | **Docs 01/02/03/05/09/10/11/12** | **MET:** atomic plan-consumption crash/conflict tests; command idempotency + typed unavailable zero-side-effect cases; one-active-item-per-worker; recovery-before-requeue; exact config-key session reuse; neutral-reset/fresh-boundary proof; live/derived provenance completeness; result/failure authority integrity; no visible-root fallback; dry-run commit-free; binding mismatch/unknown creates zero fence/click; provider admission; full beat-⑦ crash tests; `authentication-proof-not-url` |

## 1g-spine · 1i-spine — spans, the ONE projection, the BFF, the Person Lookup shell
<!-- roadmap: p1-spine -->

<!-- roadmap-status: p1-spine -->
<!-- /roadmap-status -->

_Moved from 07-master-plan §3 (Phase 1's ordered work items — 1g-spine and 1i-spine) on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

| # | Work item | Owner | Key guards that must be green at this step |
|---|---|---|---|
| 1g-spine | **COMPLETE 2026-08-04 — Span emission + the ONE projection (slice only).** Landed strict spans/notes on the executor's paths and the single server-side run/queue projection that every surface reads, served by the in-process typed dashboard BFF on port 3938. **D81 holds as-built:** the live exit test's counts agreed across every surface (All 1 / Done 1 / workflow 1) because they are one projection, not three. Span folding is keyed by `(attempt, spanPath)` — a node re-run after a recovered failure is two real spans that share a path, and folding on the path alone erased one of them. Evidence receipts, diagnostic bundles, rich failure projections/explain, notifications, knowledge, and the ledger *services* remain deferred to Phase 2; 1f's minimal failure/result authority is available (the ledger *tables + atomic outbox* landed in 1c, so no write is unrecorded) | **Docs 03/09/12** | **MET:** boundary corruption; redaction canaries; atomic projection tests; one-projection guard (no count computed off a second path); run/task identity `(runId, attempt, spanPath)` plus worker/browser identity `(workerId, spanPath)` |
| 1i-spine | **COMPLETE 2026-08-04 — The exact Person Lookup capability slice in the approved shell.** Landed Queue Panel rows (three row types, eight statuses); run/member `Logs · Receipt`; persistent timeline; Context rail; typed Start Run; Session Cards; Workflow Panel/Status Bar/day counts — all rendered from the 1g-spine BFF at the contracted frontend port 5174, and all four parity surfaces verified headless against the live run. Review/People tabs, full trust/data surfaces, and the Archive/Explorer/Activity/Settings tails remain deferred. Three presentation defects the live run exposed were recorded and then all three closed the same day as D123/D124/D126 (see the exit-criteria block below) | **Docs 03/12/13** | **MET:** one typed transport client; finished wires only; no workflow-id switches; both-theme headless a11y + screenshot parity at reference viewports; browser-bundle purity (doc 13 §8.13 — no browser-reachable module statically imports a Node built-in) |

## Phase 1 exit — the live run
<!-- roadmap: p1-exit -->

<!-- roadmap-status: p1-exit -->
<!-- /roadmap-status -->

_The live exit test's full record — the run, the four parity surfaces, the speed and wall-clock observations, the failure-latency root cause — is the first bullet of §Exit criteria below, where 07 §3 wrote it._

## Integration amendment — Phase 1's share (07 §7)

_Moved from 07-master-plan §7 intro, §7.1's parity-surface bullet, §7.2's `1b`/`1c`/`1e`/`1g-spine`/`1i-spine` rows on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

`docs/rebuild/13-frontend-backend-integration.md` is now the owning companion for the composition
boundary between the approved rebuild frontend and docs 02/03/06/09/11/12's backend contracts. It
does **not** introduce another sequence; the delivery slices below amend the existing work items in
this plan.

- “Four parity surfaces” means the **exact Person Lookup capability slice inside the approved full
  shell**, not four approximate legacy components. It includes the typed Start Run surface,
  day/count/navigation shell, Context rail, Receipt placeholder, and live/reconnecting Session
  Panel states needed to operate that workflow.

| Existing item | Integration addition | Exit evidence |
|---|---|---|
| **1b** | strict bootstrap/day/detail/subscription/artifact primitives, schema versions, revisions, projection cursors and explicit absence/error unions | every boundary schema parses fixtures and rejects unknown/invalid combinations |
| **1c** | durable command type shells for start, intake, worker/browser, atomic settings and version/archive targets in addition to run/gate/notification/capture arms; D95 reserves run `bump` for priority, names version actions `plan-version-bump`/`apply-version-bump`, and adds strict run `rename` | every product mutation has one idempotent actor-stamped command family before a route can exist; no discriminant means both priority and version work |
| **1e** | one complete client descriptor projection: start methods, dry-run/instance absence reasons, panel kind/sections, actions, graph summary and capability availability | no workflow/start/panel registry exists outside the descriptor projection |
| **1g-spine** | in-process typed dashboard BFF; bootstrap/day/run-detail queries; one transport client; resumable cursor-based SSE; Phase-1 start/run command route | snapshot + any valid patch sequence equals a fresh snapshot; gaps or schema/revision changes reset visibly |
| **1i-spine** | port the approved tokens/primitives and exact Person Lookup shell composition; wire Start, Queue, Detail/Context/Receipt, counts and Session Panel end to end | live Person Lookup plus both-theme Playwright a11y/screenshot parity at the reference viewports |

## Decisions this phase ratified

_Derived from `reference/decisions.md`'s round headings on 2026-08-20 (3b) — the
ratification act and the normative pointer stay in the ledger; this is the phase index._

| Rounds | Dates | D-range | What they settled |
|---|---|---|---|
| 13 | 2026-07-31 | D95 | the command-family ambiguity closure (1c's type shell) |
| 14–16 | 2026-08-01 | D96–D107 | 1d's session/artifact/provider seams (D96–D101) and 1e's descriptor closure (D102–D107 — forward-referencing branch cases, the bundle-safe descriptor closure, `pending-impl-bindings`) |
| 17 | 2026-08-02 | D108 | the person-lookup CRM read stays source-semantic and EID-bound |
| 18 | 2026-08-02 | D109–D118 | **1f's runtime/authority closure**: atomic start plans (D109), the minimal durable failure record (D110), beat ⑦ as one transaction (D111), the generic provider-admission core (D112), the exhaustive command kernel (D113), factory-derived terminal results (D114), the required provenance collector (D115), config-keyed session reuse (D116/D117), recovery-before-requeue (D118) |
| 19–20 | 2026-08-03 | D119–D120 | provider budget windows; **a login is proven by CONTENT, never a URL** (D120) |
| 21 | 2026-08-04 | D121 | browser-bundle purity — no browser-reachable module statically imports a Node built-in |
| 23–24 | 2026-08-04 | D123–D126 | **the three presentation defects the live exit run exposed** (D123 `skipped` is its own state, D124 a terminal row's duration, D126 the accessible name is its own channel) and D125's separate session-acquisition bound |

Rounds 22 and 25 onward belong to Phase 2 (`02-prove-writes-build-the-tails.md`).

## Exit criteria

_Moved from 07-master-plan §3 (Phase 1's hard exit criteria, with the three presentation defects the exit run exposed) on 2026-08-20 (3b); this is the as-written record, the step-5 rewrite re-verifies it._

**Hard exit criteria (Phase 1) — ALL MET 2026-08-04.**

- **THE exit test — person-lookup runs LIVE on the spine (D74). MET 2026-08-04.** A submit-free live
  run against real UCPath + CRM (Duo cleared hands-off by Autopilot, charter §9) produced a correct
  person-lookup result on the new executor, and every projected surface (Queue Row, Log Panel,
  Session Card, Workflow Panel count) rendered from the descriptor via the single 1g-spine
  projection — verified headless with the `playwright-cli` seed→boot→assert loop (root
  `CLAUDE.md`). This criterion is not satisfiable by fixtures; that is the point of moving it here.
  Its `descriptor-coverage` guard is green, and the speed criterion — which budgets **fixed sleep
  time**, doc 05 §5 — is met at **zero**, with wall clock recorded beside it as an observation and
  not as a threshold.

  **The run.** `4ebf7275-0158-49af-a78f-1f37948efb27`, trace `pl-000619-4ebf`, workflow
  `person-lookup`, input EID `10873698`, terminal `done` **at attempt 2**. Node walk:
  `searching` done (22.5s) → `cross-verify` **cancelled** (262.9s — the CRM browser died) → run
  re-attempt → `cross-verify` done (12.8s) → `active-status` done → `crm-dates` **skipped**
  (`condition-false`).

  **The result is correct, not merely schema-valid.** `activeStatus.state = "active"`, `hdh = true`,
  reason *"UCPath reports active and CRM record a1ZVr000004Xoq9MAC matches…"*;
  `crmDates.state = "not-requested"`. The terminal dependencies record `active-status` resolved with
  full output/provenance fingerprints and `crm-dates` as `state: not-run, reason: condition-false` —
  a closed reason for a conditional node, exactly as D114 requires, never a silent omission.

  **Mid-run recovery worked unprompted.** The poisoned CRM session was closed, reopened, and the node
  re-ran under attempt 2 with no operator action. That is 1f's worker-owned browser lifecycle and
  D118's recovery-before-requeue behaving as designed against a real failure rather than a fixture.

  **The four parity surfaces, all from the ONE projection** (BFF 3938, frontend 5174), verified
  headless against this run: Queue row (*"EID 10873698 — done"*, trace `pl-000619-4ebf`, attempt 2);
  Workflow Panel count (1); Session Panel (*"0 working 1 idle"*, status Live, v0.1.0); Log Panel
  run-detail timeline showing all five events **including both Cross Verification entries**.
  Projection counts agreed across every surface (All 1 / Done 1 / workflow 1) — D81 proved by a real
  run, not only by its guard.

  **Speed sanity — what this criterion budgets is FIXED SLEEP, and it is zero (doc 05 §5).** Doc 05
  §5 is the speed contract, and the quantity it names is the *sleep tax*: fixed `waitForTimeout`
  sleeps are replaced by waits on real readiness predicates, and cumulative fixed-sleep time is
  recorded per task span. **Met exactly, and at the floor:** `sleepMs` is **absent on every task
  span** of the exit run. The executor emitted no fixed sleeps at all, because it waits on
  conditions and never on a hardcoded duration — so legacy's ~24s of `waitForTimeout` on this path
  is *removed*, not reduced, and there is no residual sleep budget to shrink later.

  **Wall clock is recorded as an OBSERVATION, not as a pass/fail threshold.** The UCPath person-org
  read took **22.5s end to end**, dominated by UCPath's own page loads. Stated plainly: **22.5s is
  not materially below the old ~24s**, and it must never be reported as though it were a speed win.
  The two numbers do not measure the same thing — 22.5s is total wall clock for the read, ~24s was
  legacy's *sleep alone* — so comparing them proves nothing in either direction, and **no exit
  criterion turns on the 22.5s.** What the measurement does establish is that removing the sleep tax
  cost nothing, and that the remaining time is real work on the far side of the network. Making that
  work faster is a Phase-2 concern and was not attempted here.

  Authentication is D120 content-level proof, live-verified at ~17s (ucpath) and ~12s (crm)
  including a real Duo ceremony — also observations, on the same footing.

  **Failure latency — root-caused and FIXED 2026-08-04 (D125).** The `cross-verify` cancellation took
  **262.9s** to surface. The run recovered correctly and no wrong data was produced, but 4m23s is the
  cost of discovering a dead browser session, and it was charged to the operator's wall clock. The
  hang was in session ACQUISITION, not in the read: `factory.open` succeeded (which is why the run's
  CRM close span reads `login-failed` with no matching start span), and the login recipe then chained
  steps that are each individually bounded while **nothing bounded the chain**. The only outer bound
  reaching that code was `timeouts.taskMs` (180 000 ms) — which must stay generous for the real read
  and never fired here anyway: the D118 claim sweep (wall-clock 60s staleness, 30s cadence) requeued
  the run first, the heartbeat then reported the claim lost, and the span closed `cancelled`. Claim
  expiry is recovery, not a liveness bound. The fix is a separate, much shorter acquisition bound —
  `timeouts.sessionAcquireMs`, default 60 000 ms — armed on the same kernel scheduler, failing loud
  and never retrying. See doc 05 §"Session acquisition is bounded separately from the task".

**Three presentation defects the exit run exposed — ALL THREE FIXED 2026-08-04.** All three are
presentation-only: the durable authority is correct in every case, which is why none of them
blocked the exit. They were logged here because this program's
charter is that a surface must never mislead the operator, and each of these did. Normative text
lives in doc 03's *Phase 1g/1i-spine as-built presentation deltas*.

1. **FIXED (D123) — a conditionally-skipped node rendered as "cancelled" in the run-detail
   timeline.** The `RunDetailWire` step-state enum (`src/domain/dashboard/run-detail.ts`) had no
   `skipped` arm, so `src/server/dashboard/queries/run-detail.ts` mapped `skipped → cancelled`. The
   durable result was right (`crm-dates` = `not-run / condition-false`); the timeline was not.
   "Cancelled" names an act someone took — doc 03 D-status vocabulary is explicit that it means
   *"You stopped it"* — and a branch that was never supposed to run is the opposite. The wire enum
   now has a `skipped` arm, every timeline event carries an explicit `notRun` reason-or-absence over
   the durable result's own closed vocabulary, the executor stamps that reason on the skip span, and
   the surface draws a skipped step with its own shape and its own accessible name.
2. **FIXED (D124) — the queue row's elapsed kept counting after a run went terminal.**
   `RowFooterLine` (`src/dashboard/surfaces/queue.tsx`) computed `now − startedAt` for every
   non-`queued` status, so the exit-test row displayed **2h 47m** for a run whose actual execution
   was ~14.5 minutes. It was **elapsed-since-start, not run duration**. The queue wire now serves an
   explicit terminal `endedAt`, an in-flight row may not carry one at all, and the row renders
   `took <endedAt − startedAt>` once terminal — or an explicit `duration unknown` with the server's
   reason if the instant is genuinely missing, never a silent fall back to `now`.
3. **FIXED (D126) — two status controls computed the same ACCESSIBLE name, "Done — n".**
   `verifiedDone` and `doneWarnings` in `src/dashboard/ds/primitives-status.tsx` both carry
   `label: "Done"`, so `StatusFilters` produced two buttons named `"Done — 1"` / `"Done — 0"` and
   two queue rows both ended `"— done"`. Put to the operator, who **ratified the visible design and
   refused to change it**: on screen the pair is *not* colour-only — `doneWarnings` draws an amber
   warning triangle with its count beside the pill and `verifiedDone` draws the bare green word, so
   icon + hue + count are three visible channels and the short word is the one that fits the header.
   The real defect was assistive-technology only. Doc 03's D22 is amended to record that as-built
   ground (icon + colour + a distinct accessible name, no longer "the word remains"), and the fix is
   a non-visual `accessibleLabel` channel — `doneWarnings` announces `Done with warnings` while the
   drawn word is untouched. Verified by re-freezing the parity corpus: **56 `.a11y.yml` references
   changed, zero `.png` files.**
- In the rebuild repo, `npm run typecheck`, `npm run lint`, `npm run test`, and
  `npm run test:architecture` are **all green**, with every guard inventoried and covering the
  rebuild `src/` and `tests/` roots. In the legacy repo, `npm run lint:legacy-tests-ratchet` is the
  honest gate while maintained legacy tests still exist; `npm run lint:tests` is reported truthfully
  but is not an initial-cutover gate. The manifest may remain or shrink, but any new/replaced
  fingerprint fails and touched legacy files cannot add debt. The rebuild repo's `test:coverage`
  gates 60/80 lines/statements/functions; branches are report-only.
- Write-safety fixtures pin simultaneous and later sequential same-key dedupe, proof validation for
  every completion arm, fresh subject binding, crash injection across atomic commit, and ledger
  projector concurrency/tail loss. Alternating-EID/file-digest mismatch produces zero fence/click.
- Command/delegation fixtures prove transactional enqueue policies, versioned/idempotent actions,
  scoped CAS only for real-race arms,
  authority-only cancel targets, zero/one/many/partial/cancel/retry/replay/multi-edge child behavior,
  and no duplicate active runs when authority lookup fails.
- Strict schema mutation tests cover every durable/wire/config/intake/evidence boundary recursively;
  raw Page/Locator/selector access exists only in driver/session internals; generated UI catalog has
  no duplicate ids, invalid `supersedes` references, or unresolved dependencies.
- A real-shaped copied authority DB passes corruption detection → read-only degraded mode → newest
  checksummed-backup restore → projection rebuild, preserving commands/dependencies/checkpoints/
  write intents/outboxes. Backup age/health is visible.
- Every task/workflow/UI dependency in the spine references executed scenarios (every branch, gate,
  delegation policy, and control path has one). *Evidence receipts, diagnostic bundles, and the
  notification inbox move to the Phase-2 tails — the spine emits spans and the ONE projection.*
- **D81 one-projection guard is green:** no count anywhere is computed by a second path.
- Zero new-code allowlist entries in any extended ratchet (ported leaves shrink-only, argued).
- Every activated guard arm resolves a non-empty file set; ESLint's CLI target and typed config block
  both cover the rebuild repo's `src/` and `tests/`. Missing paths and unmatched patterns are
  failures, not skips.
- **No external HR WRITE yet.** The exit test is a submit-free live read; existing selector
  knowledge maps from the maintained legacy registry, and newly introduced page-state/observation
  recipes receive read-only live verification as they enter the catalog. All external-write proof
  begins in Phase 2.
