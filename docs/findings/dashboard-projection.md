# Dashboard projection findings

Records about the BFF's span-fold/projection layer — cases where a served surface
disagrees with what the on-disk streams and authority actually hold.

Two open records (below): the dead `span.patched` channel (B8 retires it by operator ruling) and
the requeue span-fold duplicate.

_(The 2026-08-14 "run timeline empty for runs enqueued after dashboard boot" record was
resolved the same day by **D218** — the cross-process disk tail. The diagnosis and fix
shape it carried are ratified as-built in doc 03 §2.3's D218 block; the regression tests
live in `tests/unit/server/run-queue-projection.test.ts` and `bff-flow.test.ts`.)_

## `span.patched` has a declared vocabulary and no emitter — the detail-projection channel is dead

**Recorded:** 2026-08-14 · **Status:** diagnosed · **Owning doc:** doc 03 (span vocabulary / detail projections)

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
