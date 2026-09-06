# Task 7 · Record observed page facts
<!-- roadmap: observed-logs -->

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

<!-- roadmap-status: observed-logs -->
- [x] BE provenance points captured at record time and redacted by declaration; probe/prepare/verify emit synchronously, commit flushes after callback settlement — an unclassified leaf fails loud (D270 + fence→click safety exception)
- [x] BE a transaction node's beats stream their observations (probe → stage → fence → click → read-back)
- [x] BE the bounded Logs query serves strict note/observed/fence rows: notes scan only the shared run scope, spans come from the append-time per-run projection index, and immutable snapshot cursors prevent mutable-page drift; descriptor/store `dataOrigins` resolves one exact producer or the read refuses by name, and carries its browser system only when that origin declares one (L3)
- [x] FE the log panel renders combined note / observed / authority-fence rows per producer, in the Context rail's vocabulary; strict cursor pages append without reordering and fence rows carry no invented observation facts
- [x] PROOF a separations dry run reads as a ledger of page facts — document 4502, plan `479f9f1e-83b3-4157-915b-2794bcf61ab0`, run `25d90c9d-72bf-4fa4-bcea-116665f22790` / `sp-143516-25d9`; 13 observed rows (0..12), no notes and zero write evidence (§9.25)
> 2026-08-20 | docs-cohesion 03a | recorded points exist in memory at record time and reach no durable channel — finalizeRead validates them and the executor stores only provenance plus the parsed output (src/core/task-provenance.ts:264, src/core/run-executor.ts:1052)
> 2026-08-21 | D270 | the emission half landed: `data.observed` on the SPAN stream, one event per `ctx.recordData` call, redacted by the declared classification (`ef090ea4` the arm + its wire twin, `68954117` the declarations, `4d074886` the executor, `aabd46f4` the projector). Left: the transaction beats (L2) and the FE rows (L3)
> 2026-08-25 | observed-logs L2 | the transaction lane now opens explicit probe/prepare/commit/verify spans, emits every executed role's declared observations, and carries the kernel's durable fence as strict `transaction.fenced` rather than fabricated page data. Commit-role calls are stamped and frozen at call time but flushed fence-first only after the callback settles, so a writer failure cannot strand a won fence before the external click. Dry-run emits only probe + prepare. Left: the FE rows and proof
> 2026-08-25 | observed-logs L3 repair | the disk-tail projector now indexes `data.observed`/`transaction.fenced` by run at append time, retaining file+line and a generation-local append revision; the query parses zero span lines and therefore cannot lose an observation appended days after its record clock. It validates workflow/trace/legal attempt against run authority, resolves all real probe/prepare/commit/verify task origins from the module stores, and pages notes plus indexed rows through an immutable `lc:` snapshot cursor. Generation 5 requires a present combined logs snapshot; generations 1–4 remain read-forward. Measured on §7.4's fixture: rejected span scope 7,662 lines / 2 files → 0 per-GET span parses. Left: frontend rendering and a live dry-run proof.
> 2026-08-25 | observed-logs FE | the Logs tab now folds the strict `LogRowWire` union in server sequence order: note prose stays note prose; observations group by exact contiguous `step · task`, use the Context rail's read-write pills and its SystemChip when the exact origin declares a browser system, and preserve redacted value facts plus attempts; fence beats show authority only, never a fabricated system/direction/page point. Immutable cursor pages append through the same fold. A production-bundle desktop/mobile browser proof pins focus, pill search, sticky headings, fence absence and panel containment; left: a live separations dry-run ledger.
> 2026-08-25 | observed-logs FE adversarial repair | a continuation is owned by the exact run, cursor and initial snapshot that launched it; a delayed response after same-component refresh cannot append or clear the current request's loading/error. Live notes-only payloads fail with run+cursor. Inline ARIA semantics name every served observation direction and any descriptor-declared system while fences name neither, read/write colors are asserted against their computed DS tokens, server error code+message stay visible, and the mobile continuation target measures at least 44×44. The current query's exact 200-row page renders one-for-one and searches without eager continuation; D9 still owns the shared queue/log/archive virtualization primitive and this slice does not claim it.
> 2026-08-25 | observed-logs live proof | the already-collected dashboard/composed proof is §9.25: document 4502, plan `479f9f1e-83b3-4157-915b-2794bcf61ab0`, run `25d90c9d-72bf-4fa4-bcea-116665f22790` / `sp-143516-25d9`, `parked-gate` v52, 13 observed rows in sequences 0..12 and no notes, with 0 / 0 / 0 run-scoped write evidence. The service-origin row is `.tracker-rebuild/spans/separations-2026-08-25.jsonl:12`; its browser system is absent by declaration, not an error. Live discovery fixed the false API-500 invariant in `17468e60`; the API answered 200 and the UI omitted that system claim. Processes and browser sessions were stopped after collection. The notes emitter and fidelity extras remain open.
<!-- /roadmap-status -->

**The log should quote what the page said.** Every task already records its observations through
`ctx.recordData` — the D115 collector — as strict `{direction, field, value}` points that the
executor stamps with the run/node/task identity and a Clock instant. Those points are what the run
actually READ or WROTE, in the system's own words, and the operator currently never sees them: they
are used to VALIDATE the output and then discarded. `finalizeRead` returns points AND provenance,
and only `provenance` plus the parsed `output` reach the checkpoint row. The log stream beside them
carries prose messages, which is a description of a step rather than the step's evidence.

**So the build is an emission, not a second scrape.** A point is captured on its task span with its
record-time instant and redacted by the DECLARED evidence classification
(`reference/operator-trust.md` §2.3) — an unclassified leaf fails loud, because dropping it
silently would make a log look complete while hiding what the run read. Probe/prepare/verify
deliver at that call; commit uses the critical-window delay below. Nothing re-reads the page: a
second scrape would be a second observation of a moving system, and two observations of one fact
is exactly how a surface starts disagreeing with authority.

**As built (D270, 2026-08-21).** The emission is a new span arm, `data.observed`, in both halves of
the parity pair — `ExecutorSpanEventSchema` (`src/core/span-emitter.ts`) and `SpanEventWireSchema`
(`src/events/types.ts`, the leaf the JSONL writer parses) — carrying
`{nodeId, taskId, observedAt, points}` under the ordinary `(runId, attempt, spanPath)` identity, on
the producing task's OWN span path. Four choices are worth reading, because each was decidable the
other way.

**The channel is the SPAN stream, not notes.** `ref dashboard-surfaces` §1.1 records that the notes
stream has no production emitter and that `.tracker-rebuild/notes/` has never existed, so emitting
there would have published into a directory nothing reads; and `NoteFieldWire`'s closed kind union
(`text | count | digest | last4 | basename`) has nowhere to carry a point's `direction`, which is the
one thing the rail cannot derive for itself. `assertNoteWithinRunScope` is therefore not on this
path at all — no note is written.

**One event per `ctx.recordData` CALL, with one record-time instant.** A batch is one observation of
the page, so the collector reads the clock ONCE per call and every point in the batch shares the
instant the event carries as `observedAt`. Probe, prepare and verify publish synchronously: a task
that throws later has still read the page. Commit is the deliberate write-safety exception. Its
call validates and freezes the points and owns the same one Clock instant, but emission and
declaration redaction wait until the commit callback settles; then the sequencer flushes
`transaction.fenced`, each commit batch in call order, and the terminal commit span. This is still
record-time evidence — `observedAt` is never restamped — but not record-time delivery. The delay is
required because a legal commit task may record a staged/page fact BEFORE invoking its driver; a
fallible span writer in that callback would otherwise win the durable fence and prevent the click.
"Settles" means the callback itself, not merely its deadline or parent-cancellation race: after the
durable fence the sequencer crosses the transaction lease's one-way `retainAfterFence()` boundary.
Abort is still requested and recorded, but no commit-lane event, park, return, reset, or session close
may run while a signal-ignoring callback remains in flight. An indefinitely unsettled callback therefore leaves the durable intent
`attempting` under the live owner; process-loss recovery, not detached instrumentation, takes it over.
If the callback later throws, its buffered batches are still flushed before the write is parked.
When both the task and that terminal emission fail, the task error remains first and as the cause of
an `AggregateError`; the writer error is retained second. Parking carries that aggregate as its
cause, so instrumentation can neither replace the business failure nor disappear silently.

**A point is redacted per LEAF, through the receipt's own function.** `redactObservedDataPoints`
(`src/core/observed-data.ts`) splits a point's value by the provenance collector's leaf rule (an
array is one leaf, an empty object is one leaf, a populated object recurses) and pushes each leaf
through `redactEvidenceLeaf` — the same declared table `reference/operator-trust.md` §2.3 owns and
the D82 receipt uses. There is deliberately no second redaction implementation: a log that leaked a
value the receipt would have dropped is the same defect from a different surface. So one recorded
`selection` point carries one redacted value per leaf, keyed by the full dotted path a
`FactProvenance` row is written under.

**An undeclared leaf fails the task, by name.** Probe, prepare and verify refuse inside
`ctx.recordData`; commit refuses during its post-callback flush and therefore parks the already
fenced write. Both paths name the producing task and exact leaf rather than silently dropping it.
Because verify begins after the click, resolving its declaration, binding its input, and emitting its
start span are inside the same post-fence failure boundary as the read-back itself; failure in any of
those setup steps parks rather than escaping as an ordinary task error.
The transaction lane explicitly declares all four production probe roles and all four post-fence
verify roles. The executor's transaction fixture is DECLARED rather than exempted, because a
fixture bypass would mean the refusal is never exercised by a composed run.

**The queue projection ignores the arm BY NAME** (`run-queue-projection.ts`). Folding a page
observation into a task span it is not would be D123's collapse again, and a stream carrying an
unfoldable line degrades the projection and schedules the guarded rebuild (D218) — so "ignored" had
to be written down, not left to a fall-through. Rendering these rows is this node's FE row.

**A transaction node streams its beats.** `ref write-safety`'s sequence is represented by explicit
`probe`, `prepare`, `commit` and `verify` task spans. Their declared page points use
`data.observed`; the kernel's durable fence uses the strict `transaction.fenced` parity arm because
authority state is not page data. The sequencer flushes the commit group as fence → commit points,
then opens verify for the read-back, preserving probe → stage → fence → click → read-back order.
Prepare/commit emission is preserved. A receipt completion has no verify role and emits none. A dry
run executes and reports only probe and prepare: it fabricates no fence, click or read-back beat.

**Two constraints the code imposes on the design, both worth stating before anyone builds it.**
`DataPoint` carries `direction` natively (`read` or `write`), which the Context rail has to DERIVE
from the producing node's declared task-contract `effect` because the checkpoint row carries no such
field (D252) — so an observed log is strictly better placed than the rail to say what the run did to
the world, and must not re-derive what it already holds. But `DataPoint` carries **no system**: the
system is declared by the STORE implementing the task and reaches the wire through
`RunDetailDescriptorView.dataOrigins`, composed at the root because a descriptor may not reach a
store (D106). The observed log resolves the system the same way the rail does; inventing a `system`
field on the point would be a second authority over a fact the declaration already owns.

**Scope may widen** when the operator reviews phase 3a — the ruling that created this node
(2026-08-20) also said the log EMISSION path and the log STRUCTURE are rebuilt around recorded
observations rather than around messages, and how far that goes is theirs to settle. Owning specs:
`reference/dashboard-surfaces.md` for the stream and the panel, `reference/operator-trust.md` for
the redaction declaration.
