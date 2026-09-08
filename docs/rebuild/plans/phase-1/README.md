# Phase 1 · Build the spine

This doc is the dedicated home of **Phase 1**, tree node `{#phase-1}`: its tasks, what is done and
what is left, its exit criteria; contracts it built live in `reference/`.

## Phase summary
<!-- roadmap: phase-1 -->

<!-- roadmap-status: phase-1 -->
- [x] the spine carries ONE real workflow end to end — `person-lookup` ran LIVE against real UCPath + CRM on the new executor (D74, 2026-08-04; run `4ebf7275-0158-49af-a78f-1f37948efb27`, trace `pl-000619-4ebf`)
- [x] all five work-item nodes landed and are still the shape the code has: `p1-base` (07-31) · `p1-authority` (08-01) · `p1-kernel` (08-02→03) · `p1-spine` (08-04) · `p1-exit` (08-04)
- [x] the three presentation defects the live run exposed were closed the SAME day — D123 skipped-arm, D124 terminal duration, D126 accessible-name channel
- [x] the one liveness defect it exposed was root-caused and fixed — a dead CRM session cost 262.9 s to surface → `timeouts.sessionAcquireMs` (D125)
- [x] historical Parts **1.1–1.5** and their original exit criteria remain evidenced
- [x] **1.6** closed 2026-09-08: canonical run/settings authorities, lifecycle/configuration writers and core runtime consumers independently reviewed and integrated as `9b12f2e8`, with full integration and live proof; 2.6 retains downstream read models and 3.1 retains dashboard behavior
> 2026-09-03 | D326/D327 authority reset | reopening 1.6 does not invalidate the live spine proof; it prevents Phase 2/3 consumers from continuing on authorities 0.3 is about to supersede
- [ ] residuals that trace back to spine contracts, all owned in LATER nodes — `src/dashboard/state/` never built its cache half (Track D row D6) · five of six stream topics have no producer and the notes stream has no emitter (`{#track-c}` / `{#observed-logs}`) · `ref:dashboard-surfaces` §3.2's three declaration shapes unimplemented · D71's type BUDGET unmeasured
> 2026-08-29 | D75 authority close | verified one BFF request-identity checkpoint and pre-effect command attribution matching; left: nothing IN this phase — every open line above is a named residual whose owner is a later node
<!-- /roadmap-status -->

### What Phase 1 built

**The minimum of the base's dependency graph (`00-design-the-foundation.md` §The base's dependency
graph) that can carry ONE real workflow end to end** — in this repository's `src/`, inside its own
tsconfig project, with unit tests and `test:architecture` ratchets covering it from its first file.
That last clause is a charter non-negotiable, not a preference: there is no ungated window in this
tree's history.

**Why the cut is where it is (D74, operator ACCEPTED 2026-07-23).** The prior plan built ten base
work items — the whole trust layer, all data services, mobile capture, Edit Data, the explorer, the
AI adapters — against **synthetic fixtures with no consumer**, and only then ran a workflow. Two
problems: a live run falsifies contracts a fixture cannot, and the program's own stop-loss trigger
(b) — *"a base contract flaw surfaces after ≥2 consumers depend on it"* — is far cheaper to hit with
six work items built than with ten. So Phase 1 became **1a–1f plus two thin slices**, and its exit
test is a live workflow. Everything cut is *deferred, not deleted*: it reappears in
`02-prove-writes-build-the-tails.md` as the four base tails, built against a proven spine and a real
consumer. **No contract in `reference/` changed — only delivery order.** The record justifies the
call: every defect §Exit criteria lists was found by the live run and by nothing else.

| In the spine | Deferred to the Phase-2 tails |
|---|---|
| 1a guard plumbing · 1b strict domain/clock/config/secrets · 1c authority storage + recovery + command/write type shell · 1d semantic UI registry + drivers + task/store/session contracts · 1e workflow DAG + delegation + completion + scenarios · 1f registry + workers + command service + write sequencer, including minimal failure/result authority and generic provider admission | 2g (rich evidence receipts, diagnostic bundles, failure/explain projections, notifications, knowledge/fix records, ledger services over the 1f failure authority) · 2h (extraction/normalization/ocr/roster stores, production provider pools/consumers, column mapping, intake manifests, durable capture, Edit Data) · 2i (explorer, AI advisories, storage-health UI, generated catalog UI) · 2j soak/restore/doc gate |
| **1g-spine** — spans/notes emission + the run/queue projection only (what the queue surface reads) | |
| **1i-spine** — the four parity surfaces only: Queue Panel rows, Log Panel, Session Cards, Workflow Panel counts | |

**The program invariant Phase 1 establishes — two isolated repositories, one production authority
(D88/D90, re-mechanized by D93).** The legacy repo keeps running and may receive production
maintenance. This repo cannot import, invoke, proxy, or read/write legacy live state — that is
**structural**, not guarded: two repositories share no module graph. What still had to be *chosen*
and *proved*, because both worlds run on one machine, is operational separation: commands/
entrypoints, state/artifact roots, ports, process locks, and browser profiles/sessions are distinct
on both sides (`config/runtime-isolation.json`, `operational-isolation.test.ts`). Verified leaf
knowledge is ported with provenance (legacy commit hash + path). *As-built correction:* the
per-change legacy accounting this invariant originally carried —
`config/legacy-change-accounting.json` — is **RETIRED (D150, 2026-08-05)**; the risk it covered (a
ported selector going stale after legacy fixed it) is now covered by mandatory live re-verification
at each workflow's migration, and the frozen file is a historical record only. Phase 1 proved only
inside this repository and never changed production routing.

### The exit test, in one line

`person-lookup` ran live, recovered a dead CRM session mid-run without an operator, terminalized
`done` at attempt 2 with a correct result, and rendered all four parity surfaces from the ONE
projection. The full record — node walk, result, recovery, the four surfaces, the speed and
wall-clock observations, and the failure-latency root cause — is §Exit criteria; the node's own
section is §Phase 1 exit — the live run.

### The honest state at HEAD

**Phase 1 is DONE and stayed done.** Every node is `[x]`, every exit criterion is MET, and the spine
has carried every workflow built since. The contracts it froze — the task contract, the DAG builder,
authority storage, the command kernel, the write sequencer, spans and the ONE projection — are the
contracts the code still implements; the later rewrites verified them against the tree rather than
against this doc.

**What the later rewrites found are residuals, not regressions, and each has an owner elsewhere.**
They are listed here because they trace back to a Phase-1 contract and an operator reading this doc
should not have to discover them in Phase 3:

| Residual | Where the contract was set | Owner |
|---|---|---|
| `src/dashboard/state/` never built its cache half — six modules of resource hooks, no invalidation/generation layer, and three surfaces bypass it | 1i-spine, the transport/state split | **Track D row D6** (`{#dash-defaults}`) |
| five of the six declared stream topics have no producer (only `dashboard-day` is emitted); `emitNote` is composed and never called, so `.tracker-rebuild/notes/` has never existed | 1g-spine, the subscription protocol | `{#track-c}` (§3.5) and `{#observed-logs}` |
| `StepDisplayRule`, `GateProjectionDefinition` and the `ArtifactSinkId` sink registry are declared in `ref:dashboard-surfaces` §3.2 and implemented nowhere; `span.ended` carries no `verdict` | 1e/1g-spine, the descriptor's presentation declarations | `ref:dashboard-surfaces` §3.2 / §1.3 |
| D71's type-inference proof EXISTS (`tests/types/`, a 21-node graph plus `@ts-expect-error` controls) but its 5 s / 1 GiB BUDGET is unmeasured — nothing runs `tsc --extendedDiagnostics` against it | 1e, the real-scale type proof | `ref:guards-and-tests` §3.12 |
| two port-map invariants are held by nothing named — `cancel-mechanism` and `tracker-row-emission` | 1a, the guard inventory | `ref:guards-and-tests` §2.1 / §5.1 |
| the artifact resource schemas have no route serving bytes | 1b/1g-spine, the wire primitives | `{#def-byte-path}` (D189, `04-close-the-deferrals.md`) |

None of these blocks a phase, and none is a waiver: each names where it is owned.

## Integration amendment — Phase 1's share

`reference/frontend-backend-integration.md` is the owning companion for the composition boundary
between the approved frontend and the backend contracts in `reference/`
(workflow-model · dashboard-surfaces · data-intake-and-edit-data · write-safety ·
clock-config-secrets · operator-trust). It introduces no second sequence: the rows below AMEND the
work items above, and they are recorded here because a reader auditing Phase 1 needs to know which
integration obligations rode on which item.

**"Four parity surfaces" means the exact Person Lookup capability slice inside the approved full
shell**, not four approximate legacy components. It includes the typed Start Run surface, the
day/count/navigation shell, the Context rail, the Receipt placeholder, and the live/reconnecting
Session Panel states needed to operate that workflow.

| Item | Integration addition | Exit evidence — as built |
|---|---|---|
| **1b** | strict bootstrap / day / detail / subscription / artifact primitives, schema versions, revisions, projection cursors and explicit absence/error unions | every boundary schema parses fixtures and rejects unknown/invalid combinations (`strict-boundary-schemas`); the closed unions 1b froze are still the served ones |
| **1c** | durable command type shells for start, intake, worker/browser, atomic settings and version/archive targets beside the run/gate/notification/capture arms; D95 reserves run `bump` for priority, names the version actions `plan-version-bump`/`apply-version-bump`, and adds a strict run `rename` | every product mutation has ONE idempotent actor-stamped command family before a route can exist — nine families, and no discriminant would have meant losing either priority or version work |
| **1e** | one complete client descriptor projection: start methods, dry-run/instance absence reasons, panel kind and sections, actions, graph summary and capability availability | no workflow / start / panel registry exists outside the descriptor projection. **One standing exception, named:** the run modal still reads `WORKFLOW_DESCRIPTORS` from the bundle — Track D row **D11**, amending D251 |
| **1g-spine** | the in-process typed BFF; bootstrap / day / run-detail queries; one transport client; resumable cursor-based SSE; the Phase-1 start and run command routes | a snapshot plus any valid patch sequence equals a fresh snapshot; gaps or schema/revision changes reset visibly. **As built the stream carries one producer** — `dashboard-day`; the other five topics are declared and unserved (`ref:frontend-backend-integration` §3.5) |
| **1i-spine** | port the approved tokens and primitives and the exact Person Lookup shell composition; wire Start, Queue, Detail/Context/Receipt, counts and the Session Panel end to end | live Person Lookup plus both-theme Playwright a11y and screenshot parity at the reference viewports — with the correction that until D187 the `paper-ink` half of that corpus was photographed dark (§1i-spine above) |

## Decisions this phase ratified

_Indexed from `reference/decisions.md`'s round headings and their `_phase: 1_` markers. The
ratification act and the normative pointer stay in the ledger; this is the phase index._

| Rounds | Dates | D-range | What they settled |
|---|---|---|---|
| 13 | 2026-07-31 | D95 | the command-family ambiguity closure (1c's type shell) |
| 14 | 2026-08-01 | D96–D101 | 1d's session / artifact / provider seams — one `SessionNeed`, separate artifact and content identity, provider scope stopping at the seam, conjunctive verification, imported semantic ids |
| 15–16 | 2026-08-01 | D102–D107 | 1e's descriptor closure — forward-referencing branch cases, the bundle-safe descriptor closure, `pending-impl-bindings` |
| 17 | 2026-08-02 | D108 | the person-lookup CRM read stays source-semantic and EID-bound |
| 18 | 2026-08-02 | D109–D118 | **1f's runtime/authority closure**: atomic start plans (D109), the minimal durable failure record (D110), beat ⑦ as one transaction (D111), the generic provider-admission core (D112), the exhaustive command kernel (D113), factory-derived terminal results (D114), the required provenance collector (D115), config-keyed session reuse (D116/D117), recovery-before-requeue (D118) |
| 19–20 | 2026-08-03 | D119–D120 | provider budget windows; **a login is proven by CONTENT, never a URL** (D120) |
| 21 | 2026-08-04 | D121 | browser-bundle purity — no module the dashboard entry can value-reach may statically import a Node built-in, and a runtime-only config leaf is required in the shared schema and supplied by the server resolver |
| 23 | 2026-08-04 | D123–D125 | the live exit run's defects — `skipped` is its own state (D123), a terminal row's duration is served not computed (D124), and session acquisition gets its own bound (D125) |
| 24 | 2026-08-04 | D126 | the accessible name is its own channel |

Round 22 (D122, the Phase-2 Kuali transaction proof) and rounds 25 onward carry `_phase: 2_` or
later and are indexed by `02-prove-writes-build-the-tails.md`.

## Exit criteria

**ALL MET 2026-08-04.** Each criterion below carries its evidence; where a later phase found the
criterion was met more narrowly than it read, the correction is stated inline rather than left for
a reader to discover.

### THE exit test — person-lookup runs LIVE on the spine (D74). MET 2026-08-04

A submit-free live run against real UCPath + CRM (Duo cleared hands-off by Autopilot,
`reference/charter.md` §9) produced a correct person-lookup result on the new executor, and every
projected surface rendered from the descriptor via the single 1g-spine projection — verified
headless with the `playwright-cli` seed→boot→assert loop. **This criterion is not satisfiable by
fixtures; that is the point of moving it here.** Its `descriptor-coverage` guard is green, and the
speed criterion — which budgets **fixed sleep time** (`ref:execution-and-sessions` §5) — is met at
**zero**, with wall clock recorded beside it as an observation and not as a threshold.

**The run.** `4ebf7275-0158-49af-a78f-1f37948efb27`, trace `pl-000619-4ebf`, workflow
`person-lookup`, input EID `10873698`, terminal `done` **at attempt 2**. Node walk: `searching` done
(22.5 s) → `cross-verify` **cancelled** (262.9 s — the CRM browser died) → run re-attempt →
`cross-verify` done (12.8 s) → `active-status` done → `crm-dates` **skipped**
(`condition-false`).

**The result is correct, not merely schema-valid.** `activeStatus.state = "active"`, `hdh = true`,
reason *"UCPath reports active and CRM record a1ZVr000004Xoq9MAC matches…"*;
`crmDates.state = "not-requested"`. The terminal dependencies record `active-status` resolved with
full output and provenance fingerprints, and `crm-dates` as `state: not-run, reason:
condition-false` — a closed reason for a conditional node, exactly as D114 requires, never a silent
omission.

**Mid-run recovery worked unprompted.** The poisoned CRM session was closed, reopened, and the node
re-ran under attempt 2 with no operator action. That is 1f's worker-owned browser lifecycle and
D118's recovery-before-requeue behaving as designed against a real failure rather than a fixture.

**The four parity surfaces, all from the ONE projection** (BFF 3938, frontend 5174), verified
headless against this run: the Queue row (*"EID 10873698 — done"*, trace `pl-000619-4ebf`, attempt
2); the Workflow Panel count (1); the Session Panel (*"0 working 1 idle"*, status Live, v0.1.0); and
the Log Panel run-detail timeline showing all five events **including both Cross Verification
entries**. Projection counts agreed across every surface (All 1 / Done 1 / workflow 1) — D81 proved
by a real run, not only by its guard.

**Speed sanity — what this criterion budgets is FIXED SLEEP, and it is zero.**
`ref:execution-and-sessions` §5 is the speed contract, and the quantity it names is the *sleep tax*:
fixed `waitForTimeout` sleeps are replaced by waits on real readiness predicates, and cumulative
fixed-sleep time is recorded per task span. **Met exactly, and at the floor:** `sleepMs` is **absent
on every task span** of the exit run. The executor emitted no fixed sleeps at all, because it waits
on conditions and never on a hardcoded duration — so legacy's ~24 s of `waitForTimeout` on this path
is *removed*, not reduced, and there is no residual sleep budget to shrink later.

**Wall clock is recorded as an OBSERVATION, not as a pass/fail threshold.** The UCPath person-org
read took **22.5 s** end to end, dominated by UCPath's own page loads. Stated plainly: **22.5 s is
not materially below the old ~24 s**, and it must never be reported as though it were a speed win.
The two numbers do not measure the same thing — 22.5 s is total wall clock for the read, ~24 s was
legacy's *sleep alone* — so comparing them proves nothing in either direction, and **no exit
criterion turns on the 22.5 s.** What the measurement does establish is that removing the sleep tax
cost nothing, and that the remaining time is real work on the far side of the network. Making that
work faster is a Phase-2 concern and was not attempted here. Authentication is D120 content-level
proof, live-verified at ~17 s (ucpath) and ~12 s (crm) including a real Duo ceremony — also
observations, on the same footing.

**Failure latency — root-caused and FIXED 2026-08-04 (D125).** The `cross-verify` cancellation took
**262.9 s** to surface. The run recovered correctly and no wrong data was produced, but 4 m 23 s is
the cost of discovering a dead browser session, and it was charged to the operator's wall clock. The
hang was in session ACQUISITION, not in the read: `factory.open` succeeded (which is why the run's
CRM close span reads `login-failed` with no matching start span), and the login recipe then chained
steps that are each individually bounded while **nothing bounded the chain**. The only outer bound
reaching that code was `timeouts.taskMs` (180 000 ms) — which must stay generous for the real read
and never fired here anyway: the D118 claim sweep (wall-clock 60 s staleness, 30 s cadence) requeued
the run first, the heartbeat then reported the claim lost, and the span closed `cancelled`. Claim
expiry is recovery, not a liveness bound. The fix is a separate, much shorter acquisition bound —
`timeouts.sessionAcquireMs`, default 60 000 ms — armed on the same kernel scheduler, failing loud
and never retrying (`ref:execution-and-sessions` §"Session acquisition is bounded separately from
the task").

_A later correction to this same message, worth knowing: `describeStalledLanding` — the function
whose whole job is explaining a stalled Duo login — is unreachable at the shipped defaults, because
`duoApprovalSeconds` (180 s) sits inside a 60 s acquisition envelope. D244 answers it from the other
side: the refusal is decided by CONTENT, so the wait observes Duo's own "canceled or timed out" and
refuses in 9.52 s naming the real cause._

### Three presentation defects the exit run exposed — ALL THREE FIXED 2026-08-04

All three are presentation-only: the durable authority is correct in every case, which is why none
of them blocked the exit. They are logged because this program's charter is that a surface must
never mislead the operator, and each of these did. Normative text lives in `ref:dashboard-surfaces`
§Phase 1g/1i-spine as-built presentation deltas.

1. **FIXED (D123) — a conditionally-skipped node rendered as "cancelled" in the run-detail
   timeline.** The `RunDetailWire` step-state enum (`src/domain/dashboard/run-detail.ts`) had no
   `skipped` arm, so `src/server/dashboard/queries/run-detail.ts` mapped `skipped → cancelled`. The
   durable result was right (`crm-dates` = `not-run / condition-false`); the timeline was not.
   "Cancelled" names an act someone took — the D-status vocabulary is explicit that it means *"You
   stopped it"* — and a branch that was never supposed to run is the opposite. The wire enum now has
   a `skipped` arm, every timeline event carries an explicit `notRun` reason-or-absence over the
   durable result's own closed vocabulary, the executor stamps that reason on the skip span, and the
   surface draws a skipped step with its own shape and its own accessible name.
2. **FIXED (D124) — the queue row's elapsed kept counting after a run went terminal.**
   `RowFooterLine` (`src/dashboard/surfaces/queue.tsx`) computed `now − startedAt` for every
   non-`queued` status, so the exit-test row displayed **2 h 47 m** for a run whose actual execution
   was ~14.5 minutes. It was **elapsed-since-start, not run duration.** The queue wire now serves an
   explicit terminal `endedAt`, an in-flight row is schema-refused from carrying one, and the row
   renders `took <endedAt − startedAt>` once terminal — or an explicit `duration unknown` with the
   server's reason if the instant is genuinely missing, never a silent fall back to `now`.
3. **FIXED (D126) — two status controls computed the same ACCESSIBLE name, "Done — n".**
   `verifiedDone` and `doneWarnings` in `src/dashboard/ds/primitives-status.tsx` both carry
   `label: "Done"`, so `StatusFilters` produced two buttons named `"Done — 1"` / `"Done — 0"` and
   two queue rows both ended `"— done"`. Put to the operator, who **ratified the visible design and
   refused to change it**: on screen the pair is *not* colour-only — `doneWarnings` draws an amber
   warning triangle with its count beside the pill and `verifiedDone` draws the bare green word, so
   icon + hue + count are three visible channels and the short word is the one that fits the header.
   The real defect was assistive-technology only. `ref:dashboard-surfaces`'s D22 is amended to record
   that as-built ground, and the fix is a non-visual `accessibleLabel` channel — `doneWarnings`
   announces `Done with warnings` while the drawn word is untouched. Verified by re-freezing the
   parity corpus: **56 `.a11y.yml` references changed, zero `.png` files.**

_A later correction, and it is the reason the parity lane is what it is today: D132 found that the
lane ASSERTED only the `.png` and rewrote every `.a11y.yml` unconditionally — so this re-freeze was
green by construction — and D187 found that every `paper-ink` reference had been photographed dark
and the run-detail panel was two pixels wide. Both are fixed; both are recorded in §1i-spine above._

### The gate criteria — MET, with the command names as they stand today

- **The gates are green over the whole tree.** `npm run typecheck`, `npm run lint` and
  `npm run test:coverage` pass with every guard inventoried and covering `src/` and `tests/`.
  *Correction to the criterion as written:* it named `npm run test` + `npm run test:architecture` as
  the per-commit pair and a legacy-side `lint:legacy-tests-ratchet` beside them. **D191** replaced
  the pair with `test:coverage` (a strict superset, measured faster), and the legacy half retired
  with **D93/D150** — nothing here reads legacy's working tree and legacy work blocks no rebuild
  gate. `test:coverage` gates **60/80** lines/statements/functions (`vitest.config.ts:40-41`);
  branches are report-only. R10 raises the global floor to 80 and has not landed (`{#workflow-authoring-core}`).
- **Write-safety fixtures** pin simultaneous and later sequential same-key dedupe, proof validation
  for every completion arm, fresh subject binding, crash injection across the atomic commit, and
  ledger-projector concurrency and tail loss. Alternating EID and file-digest mismatch produce zero
  fence and zero click.
- **Command and delegation fixtures** prove transactional enqueue policies, versioned idempotent
  actions, scoped CAS only for real-race arms, authority-only cancel targets, the
  zero/one/many/partial/cancel/retry/replay/multi-edge child behaviours, and no duplicate active
  runs when authority lookup fails.
- **Strict schema mutation tests** cover every durable / wire / config / intake / evidence boundary
  recursively; raw `Page`/`Locator`/selector access exists only in driver and session internals; the
  generated UI catalog has no duplicate ids, invalid `supersedes` references, or unresolved
  dependencies.
- **Recovery is proved end to end:** a real-shaped copied authority DB passes corruption detection →
  read-only degraded mode → newest checksummed-backup restore → projection rebuild, preserving
  commands, dependencies, checkpoints, write intents and outboxes, with backup age and health
  visible. *Correction:* the OFFLINE restore path this criterion also covers was proved by fixture
  and was **unreachable in production** until D181 supplied the runtime-lock snapshot its one-time
  stopped-system proof derives from — see §1c above.
- **Every task, workflow and UI dependency in the spine references executed scenarios** (every
  branch, gate, delegation policy and control path has one). Evidence receipts, diagnostic bundles
  and the notification inbox were correctly OUT of scope here and landed in the 2g tail (D134–D145).
- **D81's one-projection guard is green:** no count anywhere is computed by a second path.
- **Zero new-code allowlist entries** in any extended ratchet (ported leaves are shrink-only and
  argued), and every activated guard arm resolves a non-empty file set — ESLint's CLI target and its
  typed config block both cover `src/` and `tests/`, so a missing path or an unmatched pattern is a
  failure and not a skip.
- **No external HR WRITE.** The exit test is a submit-free live read; existing selector knowledge is
  ported from the legacy registry with provenance, and newly introduced page-state and observation
  recipes receive read-only live verification as they enter the catalog. All external-write proof
  begins in Phase 2, and the controlled-commit proof was MET live on 2026-08-04 (D135).

### What this phase leaves open

Nothing in Phase 1's own scope. Every residual the later rewrites found on a spine contract is
listed with its owner in §Phase summary above, and each is owned by a later node: `{#track-c}`,
`{#observed-logs}`, **Track D row D6** and **row D11**, `{#def-byte-path}`, `{#workflow-authoring-core}`, and
three reference-doc sections. D75 closed the former unowned `requestedBy` admission check on
2026-08-29 without adding a second actor.

## Subphase plans

- [Phase 1.1 · Guardrails and strict domain](1.1-guardrails-and-strict-domain/README.md)
- [Phase 1.2 · Durable authority and workflow model](1.2-durable-authority-and-workflow-model/README.md)
- [Phase 1.3 · Execution kernel and write safety](1.3-execution-kernel-and-write-safety/README.md)
- [Phase 1.4 · Projection, BFF, and operator shell](1.4-projection-bff-and-operator-shell/README.md)
- [Phase 1.5 · Live foundation proof](1.5-live-foundation-proof/README.md)
- [Phase 1.6 · Implement canonical run and settings authorities](1.6-implement-canonical-run-and-settings-authorities/README.md)
