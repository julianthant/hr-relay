# Dashboard projection findings

Records about the BFF's span-fold/projection layer — cases where a served surface
disagrees with what the on-disk streams and authority actually hold.

## Run timeline (and pipeline/dataFacts) empty for runs enqueued after dashboard boot

**Recorded:** 2026-08-14 · **Status:** diagnosed · **Owning doc:** doc 03 §2.3
(`docs/rebuild/03-tracker-dashboard.md:775-780`); a decision id (D2xx) is warranted.

### Symptom

Run detail renders no Timeline for some runs — e.g. today's failed `separations` runs
`49f5e1ee…` and `77530d5f…` serve `timeline.events: []` while
`.tracker-rebuild/spans/separations-2026-08-14.jsonl` holds their full span rows
(4 task spans each). **The composed `separations` descriptor is NOT implicated.**

### Root cause (diagnosed 2026-08-14)

The BFF's run/queue projection has only two ingest paths, and neither sees another
process's spans: a one-shot `projection.rebuildFromJsonl()` at compose time
(`src/server/dashboard/compose.ts:326`) and an in-process `onEvent` hook wired into the
BFF's OWN span writer (`compose.ts:307-316`). Task spans are emitted by the worker — a
separate OS process (`compose.ts:180-185`). So for any run enqueued AFTER the current
dashboard booted, the BFF folds its own `run.queued` (and its own `gate.resolved` from the
command endpoint) and never sees `span.started`/`span.ended`: `row.taskSpans` stays `[]`,
and `buildRunDetail` derives the timeline exclusively from `row.taskSpans`
(`src/server/dashboard/queries/run-detail.ts:221-236`).

### Decisive evidence

Live dashboard pid 58685 started 14:52Z. Runs whose spans were on disk at boot fold fine
(`1fd7b3a4…` 12 events, `6a6c6f44…` 12 events — same composed descriptor); runs queued by
pid 58685 serve 0 events. Run `00419600…` has exactly ONE event — its `gate.resolved`,
emitted by the BFF itself — the fingerprint of "only this process's own spans are folded".

### Blast radius

The same fold feeds `#pipeline` chips (`run-queue-projection.ts:655-686` — read `pending`
for a running/finished run), `context.dataFacts` (`run-detail.ts:315`), `row.claimedBy`,
`row.ended`, `span.patched` details, and the SSE patch/snapshot stream. Run STATUS stays
right because `#status` falls back to authority (shared SQLite); LOGS work because the
notes JSONL is re-read per request (`run-detail.ts:334`) — that asymmetry is why only the
timeline looked broken. `runs_view` is written (`run-queue-projection.ts:540`) and never
read (`runFold` returns in-memory `#rows`, `:256-258`).

### Fix shape (for the owning session)

Doc 03 §2.3's own model ("one projector consuming only native rebuild spans; JSONL writes
first, projection applies after") implemented cross-process: an offset-aware JSONL tailer
in the dashboard process.

- New cursor-based reader in `src/infra/events/jsonl-streams.ts` (today
  `readEventStreamLines` is whole-file `readFileSync`) + poll/`fs.watch` tailer that also
  notices NEW files (partitioning is `<workflow>-<date>.jsonl`: day roll / new workflow).
- Wire beside the boot rebuild in `compose.ts`; make the tailer the SOLE live feed and drop
  the `onEvent` hook — otherwise the BFF's own lines fold twice and `#fold` throws
  `run.queued replayed…` (`run-queue-projection.ts:358-360`), degrading + full-rebuilding
  on every enqueue. One ingest path also matches the doc's "one projector".
- Fail-loud: an unparsable tailed line degrades + schedules the guarded rebuild (existing
  `apply` catch), never skipped; a partial trailing line is not consumed until its newline
  lands.
- Doc 03 §2.3 should state the projector consumes the stream FROM DISK, cross-process,
  because the worker is a separate process.
- Rejected: per-request re-fold (O(all spans) per call); worker→BFF push (couples the two
  processes); reading `runs_view` back (write-only mirror of the same in-memory rows).
  Also NOT right: making `buildRunDetail` tolerate/fail-loud on an empty fold — the events
  are not dropped by a filter, they never arrive.

### Regression test to add

`tests/unit/server/run-queue-projection.test.ts` (+ a `buildRunDetail` assertion in
`bff-flow.test.ts`): compose over a temp state root, `apply()` only `run.queued`
(simulating the BFF), append a worker's span pair DIRECTLY to the JSONL without `apply()`,
tick the tailer, assert `runFold(runId).taskSpans` has both and `timeline.events` is
non-empty. Second case: the BFF's own `run.queued` line also on disk → projection stays
`live` (no duplicate-fold degrade). Fails today.

### Operational note

Restarting the dashboard makes all of today's runs render (boot rebuild folds the whole
stream) — but every run started after that restart goes empty again until the fix lands.
