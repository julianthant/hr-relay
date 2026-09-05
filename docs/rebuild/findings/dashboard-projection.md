# Dashboard projection findings

Records about the BFF's span-fold/projection layer — cases where a served surface
disagrees with what the on-disk streams and authority actually hold.

Three older records carry dated decisions: the `span.patched` channel was RETIRED (D254), the
span-fold duplicate was FIXED at the fold (D255) with its beat-span identity half deferred against
a named trigger, and the run-detail panel's second status derivation was FIXED by **D268**. Two
later records remain open: receipt-qualified outcome truth belongs to Phase 3.1 Task 13-3, and the
worker step/pipeline/browser-health producers belong to Task 10-2 plus the shared projection seam.

_(The 2026-08-14 "`span.patched` has a declared vocabulary and no emitter" record was CLOSED
2026-08-20 by **D254**, an operator ruling: the channel is retired rather than built. The
normative text — every removal site, what stayed and why, and the trigger that would re-open the
question — is ref dashboard-surfaces §1.1's D254 block. The record's own text is kept below, struck through, so the
diagnosis that led to the ruling stays readable.)_

_(The 2026-08-14 "run timeline empty for runs enqueued after dashboard boot" record was
resolved the same day by **D218** — the cross-process disk tail. The diagnosis and fix
shape it carried are ratified as-built in ref dashboard-surfaces §2.3's D218 block; the regression tests
live in `tests/unit/server/run-queue-projection.test.ts` and `bff-flow.test.ts`.)_

## ~~`span.patched` has a declared vocabulary and no emitter — the detail-projection channel is dead~~ CLOSED

**Recorded:** 2026-08-14 · **Status:** CLOSED 2026-08-20 by **D254** (retired, not built — operator
ruling) · **Owning doc:** ref dashboard-surfaces §1.1 (span vocabulary / detail projections)

**Disposition.** The channel was removed end to end: the wire arm, the writer's declared-key
enforcement and its `declaredDetails` dep, the projector fold and `RunFoldRecord.details`, and the
Context rail's read of it. `descriptor.details` stayed — three live readers (the receipt's
mandatory-leaf set, the run-detail data-origin bound, the Explorer's field census) — with its
meaning restated as a DECLARATION rather than a patch vocabulary. Verified against the real state
root as well as the source tree: `.tracker-rebuild/spans` holds no `span.patched` line, so no
history was orphaned by the removal.

_The original diagnosis follows, unchanged._

**Symptom.** `descriptor.details` declares per-node detail projections (`{nodeId, fieldPath}`)
and the projector folds `span.patched` events into `row.details`, run-detail's Data/dataFacts
rail, and the row detail chips — but **no emitter for `span.patched` exists anywhere in
`src/`**. Only tests populate the channel, so in production every surface fed by it renders its
empty state permanently.

**Evidence.** Found 2026-08-14 while implementing the subject-title record: reading the subject
name from `row.details` was rejected precisely because the channel never fills (the title work
reads the authority checkpoint instead, via the descriptor's declared `subjectProjection`).
Grep: `span.patched` has fold/read sites and zero emit sites outside `tests/`.

**Mechanism (suspected).** The executor was expected to emit `span.patched` when a task's
recorded data points land (the D74-era task-provenance channel); the emission was never wired
when the span writer landed in 1g-spine. Same shape as the D218 lesson: nothing fails when a
producer is missing — the events just never arrive.

**What a fix involves.** Decide the producer (executor, at `recordData` collection or checkpoint
persist), emit with the full span identity `(runId, attempt, spanPath)`, and add the negative
guard the channel never had: a fixture asserting a run with declared `details` produces at least
one `span.patched` per resolved detail leaf. Until then, every `details`-fed surface is
structurally empty and any test asserting through fixtures proves nothing about production (the
"fixture emitter hides the fork" lesson).

**What was decided instead (D254).** Not that fix. Building the producer would have spent the work
on making a dead channel live, when the one surface that genuinely needed a value — the subject
title, and later the Context rail — had already been served from the CHECKPOINT, which is the
record the executor really writes. So the channel went and the readers stayed on checkpoints.

## ~~A requeue duplicates a task-span entry at the same fold key~~ FIXED (fold) · one half DEFERRED

**Recorded:** 2026-08-19 (found by the B4a verification pass) · **Status:** the fold half is FIXED
2026-08-20 by **D255**; the producer half is DEFERRED with a named trigger · **Owning doc:**
ref dashboard-surfaces §2.3

**The original symptom, and the part of it that was wrong.** The record said the fold keys by
`(attempt, spanPath)`, that a `span.started` unconditionally pushes, and that a REQUEUE re-executes
a node at the same span path so the second start duplicates while the close binds to the first. The
first two are true. **The third is falsified at HEAD:** `taskSpanPath` has been
`<trace>/<node>#<claimGeneration>.<taskAttempt>` since **D214** (2026-08-14, five days before this
record), so two executions of one node inside one attempt already differ in the path. Nothing the
run executor emits can collide.

**And the consequence was the wrong sign.** The record called it an undercount and "not a
wrong-value hazard". With first-match binding, entry one keeps its own `startedAt` and takes
execution two's `endedAt` — so the chip reports a duration spanning both executions **and the idle
gap between them**, which for a gate park is hours, while execution two stays open and is dropped.
That is a fabricated measurement, not a missing one, which is why it was fixed rather than deferred.

**Fixed (D255).** A close now binds to the LAST STILL-OPEN entry at its identity, and appends a new
entry when every entry there is already closed, so a measured span's end is never rewritten. Pinned
by `tests/unit/server/run-queue-projection.test.ts` ("binds a close to the LAST OPEN entry"), which
writes the duplicate straight to the stream because the JSONL writer's own identity guard refuses a
re-open in-process — and which fails against the old binding.

**Still open, precisely attributed.** The one producer that CAN emit a repeated
`(attempt, spanPath)` is the write sequencer's beat spans — `emitTaskSpan`,
`src/core/write-sequencer.ts`, path `<trace>/<node>/<beat>` with no claim generation and no task
attempt. D214's identity fix never reached it.

- **Reachability today: none traced.** The transaction arm of the executor has no retry loop, and a
  node with a checkpoint replays without emitting spans, so a transaction node executes at most once
  per run attempt.
- **Where it would land first:** not the chip. A same-process repeat throws at the writer's
  `opens exactly once per identity` guard — a dead worker. The fold is the cross-process face.
- **Trigger:** the first transaction node that can execute twice inside one attempt (an
  `always-rerun` transaction node downstream of a gate; a ref write-safety §4 recovery re-entering the
  sequencer under the same attempt), or the first requirement that a beat span attribute to its node
  on the timeline.
- **Shape of the repair, decided in advance:** `<nodeSpanPath>/<beat>` — the beat span under the
  node's own path, which needs the executor to hand the sequencer the node span path it already
  computes. NOT a `#<generation>` suffix: `nodeIdOfTaskSpanPath` reads everything before the last
  `#` of the last segment, so that would attribute the span to a node called `prepare`.

## ~~The run-detail panel derives a run's status a second time, and answers a different word~~ FIXED

**Recorded:** 2026-08-20 (the architecture audit, C1/C2) · **Status:** FIXED 2026-08-21 by **D268**
(`81bfed73`) · **Owning doc:** ref dashboard-surfaces §2.3

**Symptom.** Two surfaces, one fact, two answers. `queries/run-detail.ts`'s private `statusOf`
lacked the `row.ended` and `row.claimedBy` arms the projector's `#status` has and inlined its own
copy of the outcome map, so a run whose `span.ended` had folded before its terminal transaction
committed read `done` in its queue row and `queued` in the panel that row opens. One level down,
`TASK_OUTCOME_PIPELINE` mapped `cancelled|discarded|superseded` to `blocked` while
`TASK_OUTCOME_STEP` mapped them to `cancelled` — one folded span, two words, two panels.

**Why nothing caught it.** Both derivations were internally consistent and separately tested; no
test compared the pair, which is the only comparison that can see this class of defect. The window
the RUN-level half needs is not one the executor's own ordering produces — `run-executor.ts` settles
the terminal CAS before a worker emits its run span, so the fold lags authority rather than leading
it, and the divergence is representable only through the test harness. The TASK-level half needed no
window at all: `TASK_OUTCOME_PIPELINE`/`TASK_OUTCOME_STEP` disagreed unconditionally, for every
folded span, regardless of timing.

**Disposition.** `deriveRunStatus`, `taskStateOf` and `panelKindOf` are one implementation each in
`src/server/dashboard/run-status.ts`, read by the projector and the run-detail query alike; the
unified task vocabulary keeps `cancelled` on D123's rule and `PipelineStepWireSchema.state` gains
that arm. `tests/unit/server/run-status-derivation.test.ts` asserts the two surfaces against each
other, not only against literals. The third fold of `row.taskSpans` (`archive.ts`'s `foldAttempts`)
was deliberately left alone: it counts RAW span outcomes rather than mapping them to a display word,
so it shares no vocabulary with the two that diverged — unifying the folds themselves is Track D
row D8.

## The run's terminal outcome and its own receipt answer the verdict differently — OPEN

**Recorded:** 2026-08-26 (unit F8a, the receipt fidelity port) · **Status:** OPEN · **Owning doc:**
ref dashboard-surfaces §2.3 (the outcome) / ref operator-trust §2.3 (the receipt)

**Symptom.** Two derivations, one verdict, two answers — the same class as the D268 record above,
one level further out. The run-detail panel's verdict band is drawn from `outcome.result`, which the
projection maps from the RUN outcome (`RUN_OUTCOME_STATUS`: `done` → `verified-done`). The receipt
carries its OWN `result`, derived by `deriveReceiptResult` from the evidence actually collected. On
the seeded adapter's `doneRun` these disagree: the band reads a green **Done / verified-done** while
the receipt beneath it reads `result partial` with `confidence unknown — nothing was read back`,
over a Verification section holding two `absent` and three `unknown` obligations.

Evidence: `/tmp/f8a-receipt/receipt-populated-scrolled--graphite-warm--desktop-1440x900.png`
(unit F8a's capture, `tests/parity/helpers/seeded-bff.ts`'s `doneRun`, both themes).

**Why it matters.** `verified-done` is the ONE verdict the receipt's own schema refuses to print
without verified confidence and no unresolved mandatory evidence — `RunEvidenceReceiptSchema`'s
refinement, pinned by `tests/unit/dashboard/receipt-invariant-unrepresentable.test.ts`. The receipt
half honours that. The OUTCOME half does not go through it at all: it reads a run outcome word and
maps it, so the strongest claim this product can make about an HR filing is reachable without any
of the evidence that is supposed to earn it. A green band over an unverified receipt is the exact
inversion of D82's acceptance bar.

**Why nothing caught it.** Same shape as D268: both derivations are internally consistent and
separately tested, and no test compares the pair. The parity corpus photographed this run's receipt
tab before and after, and the two words sit ~40px apart on screen — but until unit F8a moved the
confidence onto the band (ledger 2 row D8), nothing put the qualification anywhere the eye reading
the verdict would land, so the screenshot review had no reason to read to the bottom of the body.

**Not fixed here.** F8a is a frontend fidelity unit and this is a projection/derivation question:
either `RUN_OUTCOME_STATUS` must not mint `verified-done` from a run outcome alone, or the band must
prefer the receipt's own `result` when one is served, or the two must be reconciled at the source.
That is an operator/architecture call, not a rendering one. What F8a DID do is stop the surface
hiding it: the confidence chip now sits beside the verdict word, and the receipt's own `result`
deliberately stays on the body's trailing line rather than being suppressed as a duplicate of the
band — precisely because, as this record shows, it is not one.

## The worker card's step, pipeline and browser health have no producer — OPEN

**Recorded:** 2026-09-01 (D305, the Session Panel restored to the demo's strip) · **Status:** OPEN
against a named producer · **Owning doc:** ref dashboard-surfaces §9.9 (the card) / ref
execution-and-sessions §1 (browser sessions)

**Symptom.** Side by side with the demo's `SessionCard` (`DemoShell.tsx:1544-1681`), the rebuild's
worker card is the same shape with three slots left honestly empty: the footer's STEP (`UCPath
transaction` on the demo, `s.step`), the micro-pipeline of one dot per step with the current one
ringed (`s.steps[]`), and each browser tile's health word (`Ready` / `Refreshing` / `Unhealthy`,
`b.health`) — the rebuild's tile reads `Not checked · open 3m`. The demo's strip is unmistakably
"what is every worker doing right now"; the rebuild's is "which workers exist and on which run".

**Evidence.** `WorkerCardWireSchema` (`src/domain/dashboard/projection.ts:708`) carries `workerId`,
`workflowId`, `state`, `directive`, `startedAt`/`endedAt`, `stopReason`, `currentRun` and
`browsers[{sessionId, system, openedAt}]` — no node id, no step vector, no health. `shell.tsx`'s
card comment records the two absences by name and the tile comment records the third.

**Mechanism.** The card is folded from the worker LEASE (D248) plus the browser child spans of the
worker span. The lease knows the run it holds, not the node inside it; the run's own timeline
projection (`ref dashboard-surfaces` §2.3) knows the node and every step, but the day wire's
`workerCards[]` block is snapshot-level and does not join it. Browser health has no probe at all
(`refresh-browser` / `reopen-browser` are refused by name by the dashboard supervisor).

**A fix would involve.** (1) The projector joining each working card's `currentRun.runId` to that
run's timeline fold and serving `currentStep: {nodeId, label}` plus `steps[{label, state}]` on the
card — the same fold the run panel draws, so the two cannot disagree; (2) a browser-session health
observation with a producer (a heartbeat span per session, or the supervisor's own probe), served
as a closed enum with `Not checked` as its honest default — never inferred from age. Both are
projection/execution work, not rendering; the card already reserves the slots (the pipeline row
holds its height, the step slot is `flex-1`), so serving the facts draws them.
