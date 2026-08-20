# Dashboard projection findings

Records about the BFF's span-fold/projection layer — cases where a served surface
disagrees with what the on-disk streams and authority actually hold.

One open record (below): the requeue span-fold duplicate.

_(The 2026-08-14 "`span.patched` has a declared vocabulary and no emitter" record was CLOSED
2026-08-20 by **D254**, an operator ruling: the channel is retired rather than built. The
normative text — every removal site, what stayed and why, and the trigger that would re-open the
question — is doc 03 §1.1's D254 block. The record's own text is kept below, struck through, so the
diagnosis that led to the ruling stays readable.)_

_(The 2026-08-14 "run timeline empty for runs enqueued after dashboard boot" record was
resolved the same day by **D218** — the cross-process disk tail. The diagnosis and fix
shape it carried are ratified as-built in doc 03 §2.3's D218 block; the regression tests
live in `tests/unit/server/run-queue-projection.test.ts` and `bff-flow.test.ts`.)_

## ~~`span.patched` has a declared vocabulary and no emitter — the detail-projection channel is dead~~ CLOSED

**Recorded:** 2026-08-14 · **Status:** CLOSED 2026-08-20 by **D254** (retired, not built — operator
ruling) · **Owning doc:** doc 03 §1.1 (span vocabulary / detail projections)

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

## A requeue duplicates a task-span entry at the same fold key

**Recorded:** 2026-08-19 (found by the B4a verification pass) · **Status:** diagnosed ·
**Owning doc:** doc 03 §2.3 · **Priority:** very low (not a wrong-value hazard)

**Symptom.** The task-span fold keys by `(attempt, spanPath)`
(`src/server/dashboard/projectors/run-queue-projection.ts` ~:638) and a `span.started`
unconditionally pushes a new entry (~:600). A REQUEUE — claim-generation bump with the attempt
unchanged — re-executes a node at the same span path, so the second `span.started` appends a
duplicate entry while the matching `span.ended` binds to the first.

**Consequence.** The new `pipeline[].executions` counter (B4a, D230 batch) would honestly report 2,
but `durationSec` sums only the closed entry — an undercount, never a fabricated value (unmeasured
intervals are dropped, never zeroed). Pre-existing shape, made visible by the new field.

**What a fix involves.** Either fold the requeued execution into the full span identity the
executor already carries (the D123 lesson: a folded span is a fact about ONE execution), or bind
`span.ended` to the LAST open entry at its key. Any unit touching the fold key must know
`executions`/`durationSec` now depend on it.
