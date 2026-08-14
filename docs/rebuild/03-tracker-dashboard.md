# 03 — Tracker/Event Layer + Dashboard Contract (span rebuild)

Status: **Phase 1c authority/recovery shell completed 2026-08-01; revised 2026-07-22 after the
whole-plan/legacy-code review.** The span rebuild now also
owns a closed control-command protocol, durable notifications, strict boundary schemas, and an
explicit backup/restore contract for the non-rebuildable SQLite state. **Amended 2026-07-25:** §9
carries the operator-ratified delegation and presentation decisions (row-model series D6–D20).
**Amended 2026-07-26 (Round 8):** §10 adds the four surviving Round-8 obligations this doc owns — the one projection every
count reads (D81), run versioning + archive-on-version-bump (D80), operator-assigned run display
names (D83), and the slimmed notification model (D79b).
**Amended 2026-07-30:** row-model D8 makes OCR approval Review-only; D19 places screenshot
evidence inside Receipt and run data in Context. Reconciliation D87 removes executor-capacity
projections and chips in favor of concrete worker/browser-session state.
**Amended 2026-07-31 (Round 10):** §5 now owns the isolated-runtime boundary and all-at-once
cutover contract (D88/D89), superseding D73 and the historical live-lift/scoped-flip design.
**Amended 2026-07-31 (Round 11):** D93 moves the rebuild out of the legacy tree into a standalone
`hr-automation-rebuild` repo — rebuild code at plain `src/`, rebuild tests at `tests/`, rebuild
config at `config/`, these plan docs still at `docs/rebuild/`. §5 therefore owns a **cross-repo
runtime boundary**: isolation is physical, so the D88 guard machinery is retired and only
operational separation stays gated.
**Amended 2026-08-02 (Round 18):** Phase 1f ratifies planned-start consumption, the minimal
failure/result authorities, the executable command-family boundary, and the complete atomic
write-commit bundle; rich trust projections remain Phase 2g.
**Amended 2026-08-14 (Round 61):** §Shell — a chunk harness presents as a step of its composition
on every workflow-listing surface (D219): nested under the composition via the ONE grouping rule,
served as a required wire `role`, no count roll-up, labels and startability unchanged.

## Ownership (D1)

| | Concept | Where |
|---|---|---|
| **This doc OWNS** | Span/event wire schema (§1, amended per D10), notes, storage layout, SQLite authority and recovery, enqueue/action/queue command semantics, durable notifications, local artifact outboxes/projectors, SSE wire shapes, the completion union, the cross-repo runtime boundary and one-time historical-import rules (D88/D89/D93), the ratified delegation/presentation decisions, **the ONE run/queue projection (D81)**, **run versioning + archive-on-bump (D80)**, **run display names (D83)** | §§1–5, §9–10 |
| **Imports from doc 01** | Task contract + `defineTask`, task id grammar (`<system>/<verb-object>` slash ids, per D2), the closed `SystemId` union — real `src/systems/` dir names (`new-kronos`, `old-kronos`) plus the D4 service systems (`extraction`, `normalization`, `ocr`, `roster` — charter §11), error taxonomy | referenced, never redefined |
| **Imports from doc 02** | Workflow descriptor shape + builder, RunEnvelope (`dryRun` home per D6), run-state machine incl. gates/parks (D5), checkpoint store schema, the readable span-path id grammar (`pl-104233-9f3e/searching#2`) | referenced, never redefined |
| **Exports doc 02 adopts** | Verdict/detail semantics, completion program semantics, and wire projections; doc 02's descriptor now carries every consumed field | §3–4 |
| **Imports from doc 12** | `FailureRecord`, evidence receipts/bundles, semantic action targets, scenario ids, knowledge/fix references | referenced, never redefined |

---

## Phase 1c Stage A as-built contract delta (2026-07-31)

Stage A lands the domain shell, not the storage service. `src/domain/authority.ts` now classifies an
exhaustive, recursively frozen registry of authority versus rebuildable projection table names;
there is deliberately no DDL, `node:sqlite`, repository, backup, doctor, or restore implementation
yet. Strict Zod-derived schemas now cover dependency records and immutable delegation manifests,
schema-hash-bound gate results, actor-keyed notifications, command results/audits, and the closed
atomic write-outbox arms.

`src/domain/commands.ts` implements D95's nine exhaustive target families and actor-stamped
idempotent envelope. Run `bump` is priority-only, version/archive uses only
`plan-version-bump` → `apply-version-bump`, and run `rename` accepts only the bounded normalized
display-name payload in §2.4. These are type shells: no route, handler, projector, worker, or UI
uses them in Stage A. Phase 1c remains in progress; the native authority/recovery implementation is
a later Stage-B delta.

---

## Phase 1c Stage B as-built storage delta (2026-07-31)

Stage B lands the native authority adapter, deterministic schema migration, and narrow repository
surface in `src/infra/sqlite/`. The runtime remains Node `>=26.0.0`; the Node 26 declaration package
is pinned exactly to the official-registry release `@types/node@26.1.2`. One
`AuthorityDatabase` privately owns its `node:sqlite` `DatabaseSync`; callers receive only typed
authority/projection repositories, transaction callbacks, schema inspection, and metadata. No raw
connection, SQL callback, or `DatabaseSync` type crosses the adapter boundary.

Schema version 1 creates every table in the Stage-A authority registry with its exact authority or
projection classification. Opening configures WAL, foreign keys, a positive busy timeout, and
`synchronous=FULL`; migration runs under `BEGIN EXCLUSIVE`, records/validates its owner marker, and
fails loud for empty or foreign existing files, newer/contradictory versions, a retained migration
marker, corruption, foreign-key violations, or registry/schema drift. It never replaces an invalid
existing file with a fresh database.

Every successful outer transaction that actually mutates authority increments
`authority_generation` once in the same commit. Nested authority repositories use real SQLite
savepoints, so an outer callback that catches a failed nested fence/commit cannot retain that
operation's partial rows or dirty-generation state; empty/idempotent transactions and projection
upsert/clear do not increment it, and rollback changes neither records nor generation. Permanent write-intent insertion deduplicates by the durable
idempotency-key digest for both `committed` and preflight `observed-present` records. Authority
repositories deliberately expose no cleanup/delete operation; projection repositories alone expose
`clear`.

This is not the recovery service. Stage B includes no backup, manifest/checksum, doctor,
read-only-degraded boot mode, restore, worker, command handler, projector loop, browser, route, UI,
or live-system wiring. Phase 1c therefore remains in progress; those later stages must not infer
completion from the existence of `state.db` authority.

---

## Phase 1c Stage C as-built recovery delta (2026-08-01)

Stage C adds a verified online-backup path around the private native SQLite adapter. It uses
Node's official online-backup API, writes a unique temporary copy, opens that copy read-only for
quick-check, foreign-key, registry, schema, typed-JSON, write-attempt, generation, and page-count
inspection, then fsyncs and atomically renames it. A strict self-describing manifest pins the
source identity, authority generation, schema/application identity, byte size, SHA-256 digest,
copy fingerprint, and verification result. The public surface still exposes neither the raw
database handle nor a SQL callback, and there is no `VACUUM INTO` or filesystem-copy fallback.
Concurrent requests coalesce behind one flight; a generation watermark can cause exactly one
follow-up copy, and failure to reach that watermark fails loud.

Existing authority files are inspected read-only before writable boot. Empty, corrupt, foreign,
newer-schema, foreign-key-invalid, or invariant-invalid files enter structured
`degraded-read-only` mode without being replaced; enqueue, claim, commit, and control mutation
entry points all fail with the same typed storage-health cause. The read-only doctor reports exact
pending command/write/outbox/notification counts and explicit restore candidates. It verifies
every discovered manifest and treats the newest invalid candidate as an invalid backup state
instead of silently falling back to an older plausible copy.

Inspection parses every durable `record_json` through the strict schema registered for its authority
table; JSON validity alone is never backup, doctor, or restore authority. Offline restore is
deliberately only a stopped-system primitive. It first verifies the exact requested manifest/copy
without mutation, then atomically consumes a fresh one-time proof issued from the isolated rebuild
process-lock root. The proof binds source-database identity, `hrauto-rebuild`, current runtime
generation, and current server/worker lock generations; stale, replayed, mismatched, or active-lock
proofs fail before suspect preservation or staging. A valid restore preserves the suspect authority
file and exact WAL/SHM companions, stages in the live directory, invokes an injected projection
rebuild, then proves the authority generation and content fingerprint did not change before the
atomic swap. It does not stop processes, choose a backup, delete preserved evidence, expose an
HTTP/UI surface, or contact a live system. Phase 1c remains incomplete until the later Stage-D spine work.

---

## Phase 1c Stage D as-built authority-write delta (2026-08-01)

Stage D closes item 1c's authority-write storage seam. The committed Stage-B version-1 DDL remains
immutable; schema migration 2 adds and backfills the strict natural idempotency-key columns beside
the derived digest and adds the unique `(system,idempotency_key)` index. An exact old-v1 fixture is
opened, migrated, validated, read, and written in the focused suite. The public adapter offers only narrow permanent-key operations:
record an unseen `observed-present` intent, fence one consistent intent/attempt pair, read by exact
permanent key, and commit the current fenced attempt. Standalone attempt insertion, durable-outbox
insertion, raw SQL, and native handles remain private.

`commitWriteAttempt` performs the 1c-owned portion of beat ⑦ in one outer authority transaction:
the intent becomes `committed`, its current attempt records the same accepted proof, and one valid
ledger outbox plus one valid terminal-span/generic-outcome outbox become durable together. Injected
failure after each of those four storage steps rolls back every row and leaves
`authority_generation` unchanged. An unseen live `present` result remains permanently
click-blocking while creating no attempt and no ledger/span outbox. Sequential and independently
opened competing connections resolve the same `(system,idempotency_key)` to the original permanent
intent; mismatched natural-key, key-digest, binding-proof, generation, proof, outcome, or outbox
identity fails before authority can advance. The ledger and terminal-span arms must share one trace
identity, and ledger subject evidence must exactly match the fenced subject proof (or be explicitly
absent for an unscoped proof).

This completes **Phase 1c**, not Phase 1. The command handler, enqueue/CAS services, task workers,
browser mutation seam, run/checkpoint state changes, full recovery orchestrator, write sequencer,
ledger/span projectors, HTTP routes, dashboard, and live-system wiring remain owned by 1d–1i-spine
or Phase 2. In particular, Stage D does not implement 1f's probe→prepare→bind→click sequence or
1g's outbox sequencing/projection; it makes the authority operations those later consumers must use
atomic and fail-closed. Phase 1d is next.

## Phase 1f authority and command ratification (2026-08-02)

Phase 1f completes the authority semantics that the Phase-1c storage shell intentionally left
open:

- `start_plans` retains the exact strict-JSON raw submission/artifact refs for every accepted and
  refused entry, the once-parsed canonical input,
  separate ingress and canonical schema hashes, canonical-input digest, descriptor/version/
  contract/config fingerprints, config snapshot, resolved instances, match key/item id, proposed
  run set, expiry, revision, and consumption state. `start-run` reads and revalidates this row, then
  in **one authority transaction** records the command outcome, applies the descriptor's active-run
  policy, marks the plan consumed, and creates every accepted run with its immutable envelope/input
  snapshot. Any drift, expiry, spent-plan conflict, target lookup failure, or run insert failure
  rolls back plan consumption, command application, supersession, and every proposed run. Replay of
  the same `commandId` returns the recorded result only after every descriptor/config/ingress/
  canonical/input binding has revalidated; another command cannot consume a spent plan. A
  confirmation carries the plan id and pre-consume revision. Consumption advances the stored
  revision once, while an exact same-command replay presents and validates the original revision.
  Migration v6 deletes pre-D109 start plans because their transformed canonical input cannot
  truthfully be reconstructed as raw ingress; they are short-lived proposals and must be re-planned.
- `failures` is a non-rebuildable authority family in 1f. Every failed task/run writes doc 12's
  strict `FailureRecord` and stores its `failureId` with the failure transition; a display-safe span
  summary is not a substitute. This is the minimum durable record/lookup path. Automatic diagnostic
  bundles, receipts, search/explain, and rich dashboard projections remain 2g and do not get
  fabricated placeholder refs in 1f. The composite mutation receives the exact factory-built
  workflow descriptor separately from the strict request, resolves a node's allowed task ids from
  that authenticated runtime node, and rejects caller-invented node/task pairings.
- `run_results` is a non-rebuildable authority family. One successful run writes the doc 02
  `RunResultRecord` keyed by `runId`; the record's schema/result/dependency digests and the terminal
  run transition/outbox commit together. A second identical write is idempotent; a different result
  for the same run is corruption. Child joins read this authority rather than reconstructing output
  from spans or checkpoints. Initial success additionally requires doc 02's factory seal and exact
  rereads of the stored checkpoints. Both failed and successful composites first persist one strict
  `run_terminal_authorizations` row keyed by `runId`, binding the original expected version, worker/
  claim generation, descriptor identity, timestamp, and exact failure or result/outbox identity.
  Replay must reproduce that row exactly and prove the terminal row is its exact consequence:
  `run.version = expectedVersion + 1`, claim generation and authorization timestamp are retained,
  and terminal state/outcome/failure identity match the authorization arm. Terminal state cannot
  make a stale claim look valid. Released migration v7 remains byte-for-byte the failure/result/
  outbox migration; immutable v8 adds the authorization table. An architecture guard pins the
  version and ordered statement bytes of every released v1–v9 migration by literal digest; the next
  schema change appends v10 and its reviewed digest without editing history. Schema-v8 recovery
  treats any authorization/failure/result/outbox/terminal-transition subset, authority column/JSON
  mismatch, or cross-binding mismatch as corruption, including JSON `NULL` outcomes that ordinary
  SQL inequality would otherwise miss.
- Immutable schema v9 adds D112's `provider_budget_counters` and `provider_admissions` authority.
  Backup fingerprinting, strict record validation, read-only doctor counts, and recovery invariants
  include active reservations, counter/record column bindings, and exact active-reservation totals;
  a corrupt or partial provider settlement degrades boot rather than resetting a budget.
- Beat ⑦ is one outer authority transaction over the current claim generation and intent
  generation: mark intent/attempt committed, persist the schema-valid transaction-output
  checkpoint, insert ledger and same-trace terminal-span/generic-outcome outboxes, attach any real
  evidence-receipt ref already produced, and transition the run. Failure after any storage step
  rolls back all of them and leaves the intent `attempting`; the Phase-1c four-row helper is a
  storage primitive inside this complete bundle, not a separately committable terminal path.

The runtime command kernel is exhaustive over D95's family/action union. Phase 1f activates
`start-run`; worker/browser plan, spawn, stop, pause/resume, refresh, and reopen; run retry, cancel,
priority bump, rename, hide/unhide, and typed write resolution; and gate resolution. `run`'s
`edit-checkpoint` arm plus the `intake`, `settings`, `version-archive`, `notification`, and `capture`
families remain schema-recognized but return
`rejected{code:"capability-unavailable",message}` with zero authority side effects until their
owning later milestone activates them. There is one exhaustive dispatcher and one durable command
journal—no route may omit a union arm, throw an untyped “not implemented”, or install a second
handler later.

---

## Phase 1g/1i-spine as-built presentation deltas (2026-08-04)

D74's live exit test (run `4ebf7275-0158-49af-a78f-1f37948efb27`, trace `pl-000619-4ebf`, master
plan §Phase 1) rendered all four parity surfaces from the ONE projection and agreed on every count.
It also surfaced four things about this doc's contracts that fixtures had passed. **All four are now
fixed and are as-built contract** — every one of them is presentation-only, with correct durable
authority underneath, which is why none blocked the exit. The `skipped`-arm and terminal-duration
deltas closed on 2026-08-04 as D123/D124; the duplicate `Done` pair closed on 2026-08-04 as D126,
once the operator ratified the visible design and named the defect as an accessible-name collision
only.

**Fixed — folding and identity are keyed by the WHOLE span identity.** §1.1's task identity is
`(runId, attempt, spanPath)` and that has to be honoured in both the projector and the wire. A node
that fails and re-runs under a later RUN attempt emits a second span at the same `spanPath`; the
projector folded on `spanPath` alone and the run-detail timeline seeded its React keys with
`<trace>/<node>#<taskAttempt>`, so the exit test's two `cross-verify` spans — a 262.9s cancellation
and a 12.8s success — collapsed into one row. Both are real history and both must render. The
projector now folds by `(attempt, spanPath)`; the timeline seed is `task:<attempt>:<spanPath>`.
A folded span is a *fact about one execution*, never a per-node latest-wins slot — that is the same
re-stamp failure §0 catalogues, in a new place.

**Fixed (D123, 2026-08-04) — `skipped` is its own timeline arm and carries its closed reason.**
`RunDetailWire`'s timeline state enum used to be `pending|active|done|failed|blocked|cancelled`, so
`buildRunDetail` (`src/server/dashboard/queries/run-detail.ts`) mapped span outcome
`skipped → cancelled`. In the exit run the durable result was exactly right — `crm-dates` recorded
`state: not-run, reason: condition-false` — while its timeline row said **Cancelled**. §9 D-status
vocabulary defines `Cancelled` as *"You stopped it. Not an alert — a deliberate act."* A branch
whose condition was false is the opposite: nobody acted, and nothing was interrupted.

As-built contract:

- `TimelineEventWireSchema.state` is `pending|active|done|failed|blocked|cancelled|**skipped**`.
  The query's closed mapping is `done→done`, `failed→failed`, `skipped→skipped`,
  `interrupted→blocked`, `cancelled|discarded|superseded→cancelled`.
- Every timeline event carries `notRun`, an explicit absence union. On a `skipped` event it is
  `{ state: "present", reason }` over the **same closed vocabulary the durable result uses**
  (`condition-false | branch-not-selected`, `TerminalNotRunReasonSchema`), or an explicit
  `{ state: "absent", reason: "this step did not run; its span recorded no reason" }`. A non-skipped
  event may never carry one — the schema refuses it. **A missing reason is never back-filled.**
- The reason reaches the wire as data, not inference: the executor stamps `notRunReason` on the
  `span.ended` task event when it skips a node by `when`, the projector folds it verbatim, and the
  query reads it. A skip is ONE fact with one vocabulary in three places, pinned by a parity arm in
  `tests/unit/events/span-events.test.ts`.
- The surface renders it distinctly and NOT by hue: a skipped step draws a hollow ring and an
  outlined dashed bar (the "nothing happened here" shape) against `cancelled`'s solid bar, and its
  accessible name is `<label> — skipped, did not run: <why>` rather than `<label> — cancelled`.

**Fixed (D124, 2026-08-04) — a terminal queue row shows its DURATION, and the wire carries the
second instant.** `RowFooterLine` (`src/dashboard/surfaces/queue.tsx`) computed
`fmtElapsed(elapsedSecondsBetween(surface.startedAt, nowIso))` for every status except `queued`, so
a terminal row kept counting forever: the exit test's row displayed **2h 47m** for a run whose
execution was ~14.5 minutes. The row was not lying about a number it invented — it was answering a
different question than the one the operator asks of a finished run.

As-built contract:

- `QueueBaseFields` carries `endedAt`, an explicit presence union, in its own right. `updatedAt`
  happens to equal `lifecycle.endedAt` on a settled run, but the wire never *said* so, and a row
  that measured a duration from it would depend on an invariant it cannot see.
- The projector serves `lifecycle.endedAt` when authority is terminal, the run span's `endedAt`
  when the status came from the span stream, and an explicit reasoned absence otherwise. **An
  in-flight row may never carry a terminal instant** — the schema refuses it, because a running run
  that carried one would let a surface print a finished duration for live work.
- §2.2's rule that arithmetic may stay on the client is unchanged; what changed is that the client
  is now given both instants. `runTiming` (`src/dashboard/surfaces/format.ts`, extracted so it is
  measured logic rather than presentation) renders: nothing for `queued`; live `now − startedAt`
  while in flight, including the parked statuses; `took <endedAt − startedAt>` once terminal; and,
  for a terminal row whose `endedAt` the server could not serve, an explicit **`duration unknown`**
  carrying the server's own reason. It never substitutes `now` — "we do not know when it ended" and
  "it ended just now" are different facts and must not render as the same number.

**Fixed (D126, 2026-08-04) — the two `Done` statuses are separated by ICON + COLOUR + a distinct
ACCESSIBLE NAME; the visible word stays short.** `verifiedDone` and `doneWarnings`
(`src/dashboard/ds/primitives-status.tsx`) both carry `label: "Done"`, and `StatusFilters` renders
one pill per `QueueStatus` (`done → verifiedDone`, `partial → doneWarnings`), so the filter bar
showed two controls whose accessible names were both `"Done — n"` and the queue rows both ended
`"— done"`. The operator, asked directly, **ratified the visible design and refused the visible
change**: on screen the two are not colour-only — `doneWarnings` renders its amber warning triangle
with its count beside the pill and `verifiedDone` renders the bare green word, so icon + hue + the
count chip are three visible channels and the shorter word is the one that fits the header. The
defect was therefore **assistive-technology only**, and only the non-visual channel is fixed.

As-built contract:

- `DsStatusSpec` gains an optional `accessibleLabel`. It is **never rendered**. `dsStatusText`
  stays the visible word; `dsStatusAccessibleName` (`primitives-status.tsx`, re-exported through
  `surfaces/status.ts` as `statusAccessibleName`) returns `accessibleLabel ?? label` and is what
  **every** `aria-label` naming a status must use. Only `doneWarnings` sets one today:
  `"Done with warnings"`.
- The three collisions that existed are closed at their name sites, not by lengthening any drawn
  string: the `StatusFilters` pill (`"Done with warnings — 2"` vs `"Done — 2"`), the queue row and
  member line (`"<title> — done with warnings"` vs `"<title> — done"`), and `StatusDot`, whose
  `role="img"` name is all an assistive technology gets because a dot draws no word at all.
- **The pixels are unchanged, and that is verified rather than asserted.** Re-freezing the doc 13
  §7.1 parity corpus after the change rewrote 56 `.a11y.yml` references and **zero** `.png` files;
  the only diffs are accessible names, with every visible text node (`Done 2`, `text: Done …`)
  byte-identical.
- **The rule this generalises to:** when two statuses deliberately share a visible word because a
  non-textual channel carries the difference, that channel must have an assistive-technology
  counterpart. Hue, a glyph, and a count chip have none. `accessibleLabel` is that counterpart, and
  a future status that shortens its word owes one too.

---

## 0. What exists today (and what specifically hurts)

| Today | Mechanism | Pain |
|---|---|---|
| Queue rows | `TrackerEntry` snapshots, latest-wins dedupe, `data: Record<string,string>` bag | Every emit must re-stamp `archetype`/`__traceId`/`parentRunId`/`mode`/… or the latest row *eats* them (≥6 CLAUDE.md lessons are re-stamp bugs: ISS-006, E2E-016, the 2026-06-02 parentRunId lesson, the sweep-step lesson…) |
| Steps/timeline | `step` string on rows + `computeStepDurations` reconstruction + `step_change` session events | Three sources of "where is the run"; durations are *reconstructed*, not recorded; cancelled runs need a sentinel step (`failed`+`step="cancelled"`) that every classifier must special-case |
| Session cards | `sessions/<date>.jsonl` events keyed by mutable `workflowInstance` names + pid heuristics | The 2026-06-25 triple-root-cause dedup saga: instance names are reusable, so attribution needs pid + time-window hacks |
| Status | 5 base statuses + sentinel steps + per-workflow `statusExtensions` + OCR-only predicates (`isPrepareRow` keys on `workflow === "ocr"`) | Status semantics smeared across row fields, sentinels, extensions, and hardcoded branches |
| Approve fan-out | 3 divergent spec shapes (`approveTo`/`approveDocumentTo`/`completeDelegatedRun`) + string-keyed intent gate (`data.operationWorkflow`) + cross-spec borrowing (`onbase-emergency-contact.ts:82`) | Nothing forces coherence; a spec can declare contradictory shapes and only a doc comment objects |
| Dashboard | SSE `entries` (row-ish) + heavy client-side re-projection (queue-surface classifier duplicated client-side, `statusKeyForEntry`, `computeOcrPipelineView`, `workflow === "ocr"` at App.tsx:386/852/976, LogPanel.tsx:249, ocr/types.ts:142–211) | The client re-derives what the server already knows, and re-derivation drifts |

What is **good** and must be kept (charter: port, don't rewrite):
- The **three orthogonal axes** (shape / scope / kind) and the queue-surface collapse algorithm
  (`queue-surfaces.ts`) — battle-tested, including synthetic operation shells and
  `alwaysOperationDelegatedMembers`.
- **Backend-authoritative counts** (`wfCounts`) — the rail never trusts client math.
- Kind-dispatched **title/subtitle** (`queue-row-presentation.ts`) and the **trace id**
  (`<code>-<HHMMSS>-<runId4>`, frozen once).
- JSONL-per-day on disk — the operator greps files. (SQLite's role is split per D14: the
  claim/checkpoint tables are system-of-record; only the *projection* tables are rebuildable — §2.3.)
- Cross-midnight read-layer merge; append-at-now writes.
- The **`ocr_approvals` claim/lease/manifest durability machinery** (2026-07 hardening) — §4.4.

---

## 1. The span event model

### 1.1 Primitives

Everything observable is one append-only stream of **span events**. Three span kinds live in
`spans/` (worker / run / task) plus gate events; **per-action attribution rides the notes stream**
(D10) — an action is a note addressed to its owning task span, not a span of its own. This keeps
the span stream small enough to be the queue/timeline truth while preserving per-action drill-down.

```
worker ──┬─ browser / auth / idle …        (daemon process lifetime; replaces sessions/*)
         │
run ─────┬─ task                           (one descriptor step — doc 02's task chain)
         ├─ task …
         └─ gate events                    (parked-on-operator/system states, D5)
                └─ actions → notes stream  (click/fill/goto/ocr-page/… — addressed by spanPath)
```

```ts
// src/events/types.ts — the wire/at-rest contract. ZERO imports (leaf module).

export type SpanKind = "worker" | "browser" | "run" | "task";

export type RunOutcome =
  | "done" | "failed" | "cancelled" | "discarded" | "skipped" | "interrupted" | "superseded";
// cancelled / discarded / interrupted / superseded are FIRST-CLASS outcomes.
// The `failed + step:"cancelled"` sentinel family does not exist in the rebuild repo.
// An optional versioned one-time historical import may decode it (§5); runtime never does.

/**
 * Run/task identity = (runId, attempt, spanPath); process-lifetime worker/browser identity =
 * (workerId, spanPath). Workers persist across runs, so they never receive a synthetic run id.
 * spanPath uses doc 02's readable path grammar (imported, not redefined):
 *   run span:   pl-104233-9f3e
 *   task span:  pl-104233-9f3e/searching#2        (#N = in-run kernel retry attempt)
 *   worker span: worker/oath-signature/W-88112
 * "Opened and closed exactly once" holds per `(runId, attempt, spanPath)` for run/task spans and
 * per `(workerId, spanPath)` for worker/browser spans. A reassigned or
 * re-pended execution of the same runId is a NEW attempt, so today's same-runId re-pend
 * (`returnTaskToQueued` → row-lifecycle "reassign", VL-004) is representable without violating
 * the invariant. In-run kernel retries are attempt-suffixed task spans; cross-run retries are a
 * NEW run with `retryOf`; the legacy `-N` display suffix stays display-only formatting.
 */
interface SpanPathRef {
  spanPath: string;
  parentSpanPath?: string; // task→run, browser→worker
}
export interface RunSpanRef extends SpanPathRef {
  runId: string;           // full UUID — SQLite/store join key
  attempt: number;         // 1-based execution attempt of this run
  traceId: string;         // frozen `<code>-<HHMMSS>-<runId4>`; root-prefix propagation unchanged
}
export interface WorkerSpanRef extends SpanPathRef {
  workerId: string;
  runId?: never;
  attempt?: never;
  traceId?: never;
}
export type SpanRef = RunSpanRef | WorkerSpanRef;

export type SpanEvent =
  | RunQueued | RunClaimed | RunRequeued | SpanStarted | SpanPatched
  | SubjectObserved | GateOpened | GateResolved | SpanEnded;

interface Base {
  t: string;            // event type discriminant
  ts: string;           // ISO-8601
  workflow: string;     // descriptor id — partition key
  pid: number;
}

/** Run is born at ENQUEUE, not at claim. Carries the validated workflow-constant input or a
 * sensitive-input authority reference—exactly one, proven by `RunQueuedSchema`. */
interface RunQueuedBase extends Base, RunSpanRef {
  t: "run.queued";
  kind: "run";
  itemId: string;                  // stable business key (the completion program's deriveItemId, §4)
  parentRunId?: string;            // SCOPE axis — delegated iff present (unchanged semantics)
  shape: "single" | "preview" | "operation" | "operation-member";  // SHAPE axis, stamped ONCE
  subjectKind: "person" | "file" | "catalog";                      // KIND axis, derived from
                                                                   // descriptor.inputSubject, ONCE
  subject?: QueueSubjectWire;      // closed person/file/catalog union; display-safe fields only
  dryRun: boolean;                 // mirrored from the RunEnvelope (D6) for display
  displayOnly: boolean;            // task-less display row (§4.3, §5) — no claim will ever follow
  priority: "interactive" | "bulk"; // trusted server stamp; children inherit their root
  retryOf?: string;                // prior runId when this is a cross-run retry
  descriptorVersion: number;
  contractFingerprint: Fingerprint;
  resolvedInstance: Partial<Record<BrowserSystemId, SystemInstance>>;
  configFingerprint: Fingerprint;
  configSnapshotId: ConfigSnapshotId;
}
export type RunQueued = RunQueuedBase & (
  | { input: JsonValue; sensitiveInputRef?: never }
  | { input?: never; sensitiveInputRef: SensitiveInputRef }
);

export interface RunClaimed extends Base, RunSpanRef { t: "run.claimed"; workerId: string; }
export interface RunRequeued extends Base, RunSpanRef {
  t: "run.requeued";
  cause: "reassign" | "bump" | "recovery";
  nextAttempt: number;             // the attempt the next claim will run as
}

/** Opens a worker/browser/task span. A run span is born at `run.queued`. */
export type SpanStarted =
  | (Base & WorkerSpanRef & {
      t: "span.started"; kind: "worker" | "browser"; name: string; system?: string;
    })
  | (Base & RunSpanRef & {
      t: "span.started"; kind: "task"; name: string; system?: string;
    });

/**
 * Durable KV updates on the owning RUN (detail fields, resolved names, record snapshots).
 * Patch keys MUST be declared in the descriptor's `details` list (§3.3) — an undeclared key
 * throws at emit. Identity attrs can never ride a patch (§6 guard 4).
 */
export interface SpanPatched extends Base, RunSpanRef {
  t: "span.patched";
  updates: readonly [DetailUpdateWire, ...DetailUpdateWire[]];
}

/** Fresh subject observation. The raw identifier is retained only in the encrypted/local
 * authority record when required; this stream carries a redacted value + comparison outcome. */
export interface SubjectObserved extends Base, RunSpanRef {
  t: "subject.observed";
  taskId: TaskId;
  expected: SubjectEvidenceWire;
  observed: SubjectEvidenceWire;
  observationId: ObservationId;
  result: "match" | "mismatch" | "unknown";
}

/** A run parked on an operator/system decision (D5: gates are run-state, owned by doc 02;
 *  these events are their wire form). Replaces `running/awaiting-approval` + sentinel steps. */
export interface GateOpened extends Base, RunSpanRef { t: "gate.opened"; gate: string; }   // gate ids declared in descriptor
export interface GateResolved extends Base, RunSpanRef {
  t: "gate.resolved"; gate: string;
  /** Descriptor-validated display/audit key, never the gate's decision payload. */
  resolutionKey: GateResolutionKey;
  /** The schema-parsed gate result lives in authority/checkpoint storage (D67). */
  resultRef: GateResultRef;
  resultHash: Sha256;
}

export type SpanEnded = Base & SpanRef & {
  t: "span.ended";
  outcome: RunOutcome;             // task spans use "done" | "failed" | "cancelled" | "skipped"
  failureId?: FailureId;           // full structured failure lives in doc 12's failure store
  errorSummary?: string;           // display-safe, legible summary; never the only failure evidence
  verdict?: VerdictKey;            // validated against the descriptor's closed tuple (§3.2)
  evidenceReceiptId?: EvidenceReceiptId;
};
```

The TypeScript declarations above are readable views, **not validation**. `SpanEventSchema`,
`NoteSchema`, every `*WireSchema`, and the SSE payload schemas are strict discriminated zod unions;
their inferred types are the implementation types. Native JSONL read, SQLite read/write, HTTP
input/output, SSE emission, and fixture load all parse at the boundary. Unknown keys, invalid ISO
instants, unbranded ids, non-canonical JSON, `NaN`, and invalid state combinations fail—never get
cast into the model. An optional offline historical importer owns its own explicit-version parse and
visible quarantine contract; it is not a runtime boundary.

**Notes** (high-volume annotations — log lines, screenshots, per-action records, data points) are a
parallel stream, not span events. Same `SpanRef` addressing, so a note attributes to its exact task
attempt or worker/browser lifetime:

```ts
export type Note = SpanRef & {
  ts: string; workflow: string; pid: number;
  level: "step" | "success" | "error" | "waiting" | "warn" | "debug";
  message: string;
  fields?: readonly NoteFieldWire[];          // closed key/value union; no decision-bearing map
  /** Per-action attribution: task + semantic UI id + page-state transition, never a raw selector. */
  action?: UiActionEvidenceWire;
  attachment?: ScreenshotAttachmentWire | DataPointAttachmentWire | DiagnosticAttachmentWire;
};
```

Notes are evidence, not control state. A new structured field requires a union/schema extension.
High-cardinality exploratory metadata belongs in a schema-versioned diagnostic attachment. No
projector, command handler, retry policy, or workflow bind may branch on note prose or an untyped
attachment payload.

**Volume, honestly (review #8):** today the per-page OCR pipeline emits **zero** tracker rows —
its state rides ~8–12 deduped, 250ms-debounced row snapshots per run (`orchestrator.ts:671-692`).
A naive per-action *span* stream would multiply that by orders of magnitude. Under D10 the split
is: `spans/` carries run + task + gate events — roughly **10–40 events per run** (bounded by the
descriptor's step count × attempts, not by page/click counts) — and everything per-action
(per-page OCR calls, clicks, fills, screenshots) lands in `notes/` at roughly today's **log-line
volume** (hundreds per OCR run). Queue and timeline projections read spans only; notes load lazily
per selected run. Timeline *folds* read spans only; per-action drill-down reads notes by spanPath.

### 1.2 What each of today's surfaces becomes (all are projections)

| Surface | Today | Projection of |
|---|---|---|
| Queue row | latest TrackerEntry snapshot | run span: `run.queued` attrs (immutable identity) ⊕ folded `span.patched` ⊕ open gates ⊕ `span.ended` |
| Status badge | status + sentinel step + statusExtensions | run span state machine: queued→pending, claimed+open→running, open gate→gate status (e.g. `approval` open ⇒ needsReview), ended→outcome verbatim |
| Step pipeline | registered steps + `step` string + reconstructed durations | descriptor.steps ⊕ task spans (a task span IS the duration; a cancelled run's reached step = last open task span — no sentinel recovery) |
| Timeline / log panel | rows + logs + filtered session events (pid heuristics) | run span tree's notes ⊕ the owning worker span's lifecycle events selected **by `workerId`** (recorded at `run.claimed`) — the instance-name/pid/time-window attribution class of bugs is structurally dead |
| Session card | rebuildSessionState over instance-keyed events | worker span + its browser child spans (health notes ride the browser span); subtitle = the in-flight run's traceId (run.claimed links both ways) |
| wfCounts | countSidebarRowsFromTrackerHistory | same collapse algorithm over projected run surfaces — still computed server-side, still authoritative |
| Row-lifecycle debug | replay + cause *guessing* (`reassign` derivation) | free: `run.requeued.cause` + `attempt` are recorded, not derived |

### 1.3 Decision: archetypes survive as vocabulary, die as per-row stamps

The four row shapes (`single | preview | operation | operation-member`) and the three axes are
**kept** — they are the proven queue vocabulary. What changes:

- **Declared on the descriptor** (doc 02's `archetype`, literal or input-resolver), materialized
  **once** on `run.queued.shape`. Member shape is set by the fan-out dispatcher on the child's
  `run.queued` (today's `rowShape` option).
- **Never re-stamped.** Span identity attrs are written once and immutable; patches can't clobber
  them because projections fold `patch` over identity, not the reverse. The entire re-stamp bug
  class (ISS-006 etc.) is unrepresentable.
- No legacy normalization (`batch`→`operation`) in the rebuild runtime. An optional versioned
  one-time historical import owns that translation (§5).

Derived statuses stop being per-workflow code where a universal mechanism exists:
- `needsReview` ⇒ any run with an open `approval` gate (universal projection rule; OCR just declares
  the gate).
- `notFound` / `inactive` / secondary tags ⇒ descriptor-declared **verdict mappings** (§3.2) over
  `span.ended.verdict` — plain data, bundle-safe, no `statusExtensions` function registry.

---

## 2. Storage and transport

**The whole layer in one picture.** The load-bearing rule is the split between what is *authority*
(SQLite — not rebuildable, never deleted casually) and what is *projection* (JSONL + the read
model — regenerable). Every arrow below is one-directional; nothing reads back up.

```mermaid
flowchart LR
  subgraph EX["executor / kernel"]
    T["task &amp; run spans"]
    N["action notes"]
    W["write commit"]
  end

  subgraph AUTH["SQLite — AUTHORITY (D14/D51)<br/><i>not rebuildable from JSONL</i>"]
    CL["claims · checkpoints"]
    DEP["dependencies · manifests"]
    CMD["commands (idempotent, version/actor-stamped; scoped CAS)"]
    WI["write_intents (the fence)"]
    OB["ledger + span OUTBOXES"]
  end

  subgraph PROJ["projections — REGENERABLE"]
    SJ["spans/*.jsonl"]
    NJ["notes/*.jsonl<br/><i>30d</i>"]
    RM["THE run/queue projection<br/><b>(D81: the only count source)</b>"]
  end

  LED["ledger/*.jsonl<br/><b>NEVER pruned</b><br/><i>serialized projector, one writer</i>"]

  subgraph UI["dashboard surfaces"]
    WP["Workflow Panel badges"]
    SB["Status Bar counts"]
    QP["Queue Panel rows"]
    LP["Log Panel"]
    AR["Archive (D80)<br/><i>self-contained rows</i>"]
  end

  W ==>|"ONE atomic transaction (D32)"| AUTH
  T --> OB
  N --> NJ
  OB -->|"serialized projector"| SJ
  OB ==>|"serialized ordered projector"| LED
  AUTH --> RM
  SJ --> RM
  RM --> WP & SB & QP
  RM --> LP
  RM -->|"on version bump"| AR

  classDef auth stroke:#c0392b,stroke-width:2px,fill:#00000000;
  classDef proj stroke:#7f8c8d,fill:#00000000;
  classDef ledger stroke:#8e44ad,stroke-width:2px,fill:#00000000;
  class CL,DEP,CMD,WI,OB auth;
  class SJ,NJ,RM proj;
  class LED ledger;
```

Three things to read off it: a write reaches **authority in one atomic transaction** before any
JSONL exists (so a crash between them is repairable, never a lost filing); the **ledger has exactly
one ordered writer**, with actor-attributed entries reconciled from atomic outboxes; and **every
count in the UI descends from one node** (D81, §10.1) — there is
no second path a badge could take.

### 2.1 On disk — JSONL-per-day stays, two streams

The rebuild owns the distinct `.tracker-rebuild/` state root. Production `src` owns `.tracker/`;
neither runtime reads or writes the other's root.

```
.tracker-rebuild/
├── spans/   <workflow>-<date>.jsonl   span events (low volume — the queue/timeline truth)
├── notes/   <workflow>-<date>.jsonl   notes (high volume — logs, actions, screenshots, data points)
├── evidence/<runId>/                  run receipts + redacted diagnostic bundle manifests (doc 12)
├── artifacts/<hash>.artifact          content-addressed task outputs; atomic, immutable bytes
├── ledger/  <system>-<date>.jsonl     immutable write receipts (D21; shape owned by doc 09 §6) —
│                                      ordered, actor-attributed, append-only, per-SYSTEM+day,
│                                      NEVER pruned (the audit floor; hash chain deferred by D79)
├── backups/state/                     checksummed online backups + restore manifests (§2.5)
└── state.db                           SQLite — claims/checkpoints/intents/outboxes,
                                       commands/dependencies/notifications are system-of-record;
                                       read projections alone are rebuildable
```

Rationale against alternatives:
- **Why not SQLite-only?** The operator greps files. **Debug grep now spans two dirs:**
  `grep ou-1430 .tracker-rebuild/spans/*.jsonl` answers *what happened* (state transitions, outcomes,
  gates); `grep ou-1430 .tracker-rebuild/notes/*.jsonl` answers *what it did* (log lines, per-action
  records, screenshots). One trace id returns the whole operation tree across workflows in both.
  This second grep is a real cost of the D10 split and is documented as such — the `spans/` grep
  alone no longer contains log-line text the way `rows/`+`logs/` greps did.
- **Why split spans/notes?** Queue projection reads spans only (§1.1 volume note); notes load
  lazily per selected run. Mirrors today's proven rows/logs split.
- **Why a separate `ledger/` (D21 — owner = this doc)?** Doc 09's write-safety layer files one
  immutable receipt per real HR mutation. It is partitioned per-**system**+day so
  `grep 10001573 .tracker-rebuild/ledger/ucpath-*.jsonl` answers "what did we file for this person,
  across time." It is ordered, actor-attributed, and **never pruned**. Doc 09 owns
  the entry *shape* (`LedgerEntry`, §6 there); this doc owns that the dir lives in the layout and is
  exempt from `clean-tracker`.
- **Base retention — DECIDED (D86):** `notes/` and `spans/` both prune at **30 days**.
  `ledger/` is exempt from both — its never-pruned floor now sits **above a settled number, not a
  guess** (this is what doc 09 §6 references). Legacy `.tracker/` retention is unchanged and owned
  only by production `src`.
- **Why per-workflow files?** Small greppable files; partition key matches the SSE topic scope.
  Worker spans write to their workflow's file (a daemon serves one workflow).
- **Span/note write discipline (ported):** append-at-now partitioning; cross-midnight solved at the
  read layer with the OPEN-span forward-merge (same algorithm as `cross-midnight.ts`); synchronous
  SIGINT terminal writes; `O_APPEND` single-line writes. **Ledger is different:** executors write
  durable outbox rows and one serialized projector assigns ordered sequence and appends (doc 09).
- **Local artifacts are not hidden task writes (D45).** A read task may create only immutable,
  content-addressed bytes under `artifacts/` through doc 01's writer; the returned `{id,sha256,bytes,
  mediaType}` is canonical JSON and checkpoints reference it without exposing a filesystem path.
  Per D97, `id` remains the existing UUID-backed `ArtifactId`; `sha256` is the distinct content
  identity and private `artifacts/<hash>.artifact` key. Byte-identical puts are idempotent and
  return the same public reference. The backing path is never part of a task, checkpoint, or wire
  contract.
  Mutable operator artifacts (for
  example i9's retention workbook) are different: the node checkpoint and a stable-keyed
  `artifact_outbox` row commit atomically in SQLite, then a single sink projector performs
  temp+fsync+atomic-replace and records the projected content hash. Duplicate outboxes/key retries
  are no-ops. A blocking projection failure parks the run; it never reports done while silently
  dropping the workbook update.
- **Evidence is indexed, not scattered.** `evidence/<runId>/receipt.json` points to immutable
  screenshots/artifacts/failures by content hash and records missing capture explicitly. Diagnostic
  bundles redact by schema before writing; they never copy `.env`, cookies, browser storage, raw
  SSNs, or unrestricted input blobs (doc 12 §3).

### 2.2 Projections are computed server-side — the wire carries surfaces, not rows

Today the client re-implements queue-surface classification, status keying, and pipeline math. In
the rebuild repo the SSE stream carries **finished projections**; the client renders and never re-derives.
Descriptor metadata is served as doc 02's validated client projection; the SPA never imports
workflow modules. The SSE hello carries its fingerprint so a stale bundle fails loud.

```ts
// src/server/topics.ts — SSE topic payloads (all change-gated snapshots, as today)
interface EventsHubPayload {
  descriptorHash: string;                  // doc 02's skew tripwire — NOT the descriptors themselves
  queue: { workflow: string; date: string; surfaces: QueueSurfaceWire[] };  // per subscribed panel
  queuePatch?: { workflow: string; date: string; surface: QueueSurfaceWire }[];
  //  ^ after the initial snapshot, a changed surface re-sends ONLY that complete strict surface — a
  //    100-member operation tick re-serializes one member row, never the resolved member tree (D10)
  wfCounts: readonly { workflow: WorkflowId; count: NonNegativeInt }[];
                                             // closed tuples, backend-authoritative rail badges
  sessions: WorkerCardWire[];              // worker-span projections
  notifications: NotificationWire[];       // incl. gate.opened rising edges (kills App.tsx:386)
}

interface QueueSurfaceWire {
  surface: "single" | "preview" | "operation";      // group collapse already applied server-side
  runId: string; itemId: string; workflow: string;
  traceId: string;                                   // review #11 — was missing
  parentRunId?: string;
  attempt: number;
  dryRun?: boolean;                                  // review #11 — RunEnvelope mirror (D6)
  enqueuedAt: string; startedAt?: string; endedAt?: string;   // review #11 — timestamps; queue-wait
                                                              // and elapsed derive from these
  title: string; subtitle?: string;                  // kind dispatch applied server-side
  status: StatusWire;                                // { key, label, tone, secondaryTag? } — final
  pipeline: { step: string; label: string; state: "pending"|"running"|"done"|"failed"|"cancelled"|"skipped"; durationMs?: number; attempt?: number }[];
  gates: { gate: string; open: boolean; resolutionKey?: GateResolutionKey }[];
  actions: ActionDescriptorWire[];                   // ported from the standard command projection;
                                                     // display-only rows get Hide only (§4.3)
  memberRunIds?: string[];                           // operation only — ids, NEVER nested trees (D10);
  memberRollup?: readonly { status: StatusKey; count: NonNegativeInt }[];
                                                     // closed status/count tuples for the mini-badge
  //  members are ordinary flat surfaces in the same queue payload (joined client-side by
  //  parentRunId); each is change-gated individually via queuePatch
  detailSurfaces: ("logs"|"review"|"receipt"|"people"|"data")[]; // panel-kind tabs + Context Data section
  links?: { review?: { workflow: string; runId: string } };  // "Open OCR review" jump
  evidence: { receiptId?: EvidenceReceiptId; failureId?: FailureId;
              confidence: "verified" | "partial" | "unknown" };
}
```

For a run parked on an unfinished write intent, the server replaces ordinary retry/done actions
with the closed kernel actions `resolve-write-present` and `resolve-write-absent` (doc 09 §4.1),
including intent generation+version tokens and the proof/evidence form spec. The descriptor cannot
re-enable generic Done/Retry for that state. These actions derive from durable intent state, not a
workflow-id registry; stale tokens fail with a conflict and trigger a fresh projection.

Per-run detail (timeline, notes, screenshots) stays request/response + a per-run SSE topic, as
today — but the payload is the span tree + notes, already merged and ordered; `LogStream` stops
owning merge/dedup heuristics (`mergeDisplayItems` collapse survives as a server-side fold).

### 2.3 SQLite (role per D14)

`state.db` has **two classes of table with different authority**:

- **System-of-record (NOT rebuildable and never deleted by projection/runtime row maintenance):**
  the task/claim store (tasks, leases,
  dependencies, delegation manifests, commands, start plans, terminal authorizations/results, failures,
  notifications, capture sessions/photo order/finalization outboxes — doc 02 §5.7's checkpoint payloads,
  §4.4's `ocr_approvals` manifests, and
  doc 09's permanent-key `write_intents`, `write_attempts`, and durable outbox, plus
  stable-keyed local `artifact_outbox`/sink-head rows). The system-of-record set is
  "planned/accepted run authority + claims + checkpoint/result/failure payloads + write
  authority/outboxes + local artifact projection authority + in-progress capture/handoff
  authority." Losing any of these loses accepted input, claims, resumable/terminal results,
  structured failure truth, in-flight write fences, or accepted capture work — they have no JSONL
  double.
- **Projection tables (rebuildable):** span-shaped read models (`spans`, `gates`, `notes`,
  `runs_view`) fed by one projector consuming only native rebuild spans — **FROM DISK,
  cross-process (D218)**: the worker emits its task spans from a separate OS process, so the
  projector's one live feed is an offset-aware tail of the stream files, never an in-process emit
  hook. These — and only these — can be deleted and rebuilt from JSONL, with today's operational
  rules: JSONL writes first, projection applies after (structural under D218 — the fold can only
  see bytes already landed), projection failures schedule guarded rebuilds and never block
  workflows; source identity is `resolve(path)`; deletion tombstones and offline compaction port
  as-is.

The system-of-record class includes a singleton `authority_meta(schema_version,
authority_generation,updated_at)`. The infra adapter exposes separate authority and projection
transaction APIs; repositories cannot execute arbitrary SQL or receive the raw connection. Every
top-level committed transaction that mutates at least one authority table increments
`authority_generation` exactly once inside that same transaction; projection-only rebuilds do not.
Nested authority operations share the outer transaction/generation increment. The table-class
registry generates coverage tests that mutate each authority repository and prove the generation
advances, then mutate each projection repository and prove it does not. A newly added authority
table without a registered mutator test fails. This makes D72 backup RPO comparison an actual
monotonic authority fact rather than a timestamp guess.

Any sentence in this doc that says "rebuildable" means the projection tables only. The sole
authority-removal exception is the explicit stopped-system, exact-id, backup-gated Purge procedure
in §2.4; ordinary cleanup, Hide, projection rebuild, and runtime code cannot reach authority rows.

#### D218 — the projector consumes the span stream FROM DISK, cross-process (2026-08-14)

"One projector" had been implemented single-process: a one-shot boot `rebuildFromJsonl` plus an
in-process post-append hook on the BFF's OWN span writer. The worker is a separate OS process, so
its task spans never reached the projection — every run enqueued after the dashboard booted served
an empty timeline, empty pipeline chips, and empty `dataFacts`, while its full span history sat in
`spans/<workflow>-<date>.jsonl`. Run STATUS stayed correct (it joins authority per surface) and
LOGS stayed correct (the notes JSONL is re-read per request), which is exactly why only the
timeline looked broken; the fingerprint of the defect was a run whose fold held exactly ONE event —
its own `gate.resolved`, the only span the BFF itself emits mid-run. The defect stood from 1i-spine
until 2026-08-14; restarting the dashboard masked it for every run already on disk.

As-built contract:

- **The projection's ONE live feed is an offset-aware tail of `spans/*.jsonl`**
  (`RunQueueProjection.ingestFromDisk` over `readEventStreamLinesFrom`): a byte cursor per file,
  advanced only through the last landed newline. `rebuildFromJsonl` seeds the cursors from exactly
  what it consumed, so the rebuild and the tail can never double-fold a line. The span writer's
  `onEvent` hook is REMOVED — "JSONL writes first, projection applies after" is now structural,
  because the fold can only read bytes that already landed.
- **Two triggers, one cursor.** The dashboard polls the tail every 250 ms (`SPAN_TAIL_POLL_MS`,
  the staleness ceiling for worker-emitted spans), and the command service ticks the SAME cursor
  after its own emissions (`run.queued`, `gate.resolved`), so an operator's follow-up read never
  waits for the poll. Neither is a second ingest path: every event reaches the fold as bytes read
  back from the stream file.
- **Fail-loud, never skip.** A torn trailing line (another process mid-append) is not consumed
  until its newline lands. An unparsable tailed line degrades the projection and schedules the
  guarded rebuild — and since the line is real durable history, the rebuild refuses it by name
  too, leaving the projection loudly degraded rather than quietly reading past it. A stream file
  SHORTER than its cursor fails loud (these files are append-only; a shrink is truncation of
  history). A file the cursors have never seen (day roll, new workflow) is read from byte 0.
- **Rejected:** per-request re-fold (O(all spans) per call); worker→BFF push (couples the two
  processes the D88/D181 isolation model keeps apart); reading `runs_view` back (a write-only
  mirror of the same in-memory rows); and tolerating an empty fold in `buildRunDetail` (the events
  were never dropped by a filter — they never arrived, and the reader is the wrong place to repair
  an ingest gap).

### 2.4 One command protocol with strict target families

The dashboard, CLI, recovery code, workflow editor, notification inbox, gate resolvers, and capture
UI all issue the same idempotent command **envelope**, then one strict target-family arm (D67). They
do not update queue rows, JSONL, or authority records directly. Workflow descriptors select from
closed policies; workflows never own cancel/delete/retry/bump/update implementations.

```ts
export type EnqueuePolicy = "reject-active" | "supersede-active" | "allow-parallel";
export type CommandActionId =
  | "retry" | "cancel" | "bump" | "rename" | "hide" | "unhide"
  | "edit-checkpoint" | "resolve-write-present" | "resolve-write-absent";
export type NavigationActionId = "open-review" | "open-evidence";
export type WorkflowActionId = CommandActionId | NavigationActionId;

export interface WorkflowActionPolicy {
  enabled: readonly WorkflowActionId[];
  /** Optional descriptor conditions are closed rules over projected state, not callbacks. */
  conditions?: readonly ActionConditionRule[];
}

interface CommandEnvelope {
  commandId: CommandId;                 // client-generated idempotency key
  requestedAt: IsoInstant;
  reason?: OperatorReason;
}
export type RunCommandRequest = CommandEnvelope & (
  | {
      target: { runId: RunId; expectedVersion: PositiveInt };
      type: "retry" | "cancel" | "bump" | "hide" | "unhide";
      payload?: never;
    }
  | {
      target: { runId: RunId; expectedVersion: PositiveInt };
      type: "rename";
      /** Trimmed NFC text, 1..120 Unicode code points, with control characters forbidden. */
      payload: { displayName: RunDisplayName };
    }
  | { target: { runId: RunId; expectedVersion: PositiveInt };
      type: "edit-checkpoint"; payload: EditCheckpointCommand }
  | {
      target: { runId: RunId; expectedVersion: PositiveInt };
      type: "resolve-write-present" | "resolve-write-absent";
      payload: ResolveWriteCommand;
    });
export type GateCommandRequest = CommandEnvelope & {
  type: "resolve-gate";
  target: { runId: RunId; gateId: GateId; expectedVersion: PositiveInt };
  /** Generic only on the wire; the handler resolves the descriptor and parses the exact gate schema
   * before atomically storing the result checkpoint + resolved event outbox. */
  payload: { result: CanonicalJsonValue };
};
export type NotificationCommandRequest = CommandEnvelope & (
  | { type: "notification-read" | "notification-unread";
      target: { notificationId: NotificationId; expectedVersion: PositiveInt }; payload?: never }
  | { type: "notification-snooze";
      target: { notificationId: NotificationId; expectedVersion: PositiveInt };
      payload: { until: IsoInstant } }
);
export type CommandRequest =
  | StartCommandRequest | IntakeCommandRequest | WorkerBrowserCommandRequest
  | SettingsCommandRequest | VersionArchiveCommandRequest | RunCommandRequest
  | GateCommandRequest | NotificationCommandRequest | CaptureCommandRequest;
// CaptureCommandRequest is owned by doc 06 and uses this envelope's idempotency, version-stamp,
// and transactional current-state validation; it is not a blanket CAS arm.

/** Multi-select never means "loop and hope". Targets and versions are frozen at confirmation. */
export interface BulkCommandRequest {
  bulkCommandId: CommandId;
  type: "retry" | "cancel" | "bump" | "hide" | "unhide";
  targets: readonly [
    { runId: RunId; expectedVersion: PositiveInt },
    ...{ runId: RunId; expectedVersion: PositiveInt }[],
  ];
  mode: "all-or-none" | "best-effort";
  requestedAt: IsoInstant;
  reason?: OperatorReason;
}
export type CommandResult =
  | { state: "applied" | "already-applied"; commandId: CommandId; affectedRunIds: RunId[] }
  | { state: "conflict"; commandId: CommandId; currentVersion: PositiveInt; message: string }
  | { state: "rejected"; commandId: CommandId; code: CommandRejectionCode; message: string };

export type ActionDescriptorWire =
  | {
      kind: "command";
      id: CommandActionId;
      label: string;
      tone: "neutral" | "warning" | "destructive";
      target: { runId: RunId; expectedVersion: PositiveInt };
      form?: ActionFormWire;
    }
  | {
      kind: "navigation";
      id: NavigationActionId;
      label: string;
      tone: "neutral";
      target: { runId: RunId };
    };
```

Command semantics are binding:

| Operation | Standard behavior |
|---|---|
| Enqueue | Validate raw input once, derive stable item id, then apply descriptor policy in one transaction. `reject-active` returns the existing active run; `supersede-active` terminalizes the exact active generation and creates the new run atomically; `allow-parallel` still requires a distinct stable item/variant key. An authority read error aborts—never “continue and enqueue anyway.” |
| Retry | Creates a new run linked by `retryOf`, reuses immutable parsed input/config, validates checkpoints/freshness, and preserves the logical item. A parked unknown write uses resolution actions, never generic retry. |
| Cancel | Resolves the full dependency tree from authoritative SQLite, applies every edge's doc 02 cancel policy, and commits state transitions together. If the tree is unavailable/inconsistent, no target is cancelled. Visible queue roots are never an authority fallback. |
| Bump | **Run-family only:** changes priority/claim order through an idempotent transactional command; it does not fabricate a requeue, mutate business input, change a descriptor version, or archive anything. Running work returns a typed rejection unless the scheduler explicitly supports cooperative yield. Version drift alone does not conflict. |
| Rename | Replaces only the operator-visible run display name with a strict `RunDisplayName` payload: NFC-normalized, already trimmed, 1–120 Unicode code points, and no control characters. Empty, whitespace-padded, overlong, non-normalized, or unknown-key payloads fail boundary parsing. Identity and trace id never change. |
| Hide / Unhide | A reversible presentation tombstone only. It changes no run outcome, task, dependency, checkpoint, intent, or evidence. The UI label is **Hide**, never Delete. |
| Purge | Not a row action. `cli purge-run <exact-run-id> --backup <path>` is an offline maintenance command requiring a fresh verified backup and refusing any active/dependency/write-authority reference. It writes a purge receipt. |
| Edit checkpoint | Uses doc 06's field-level patch/provenance model, creates a new run/attempt as specified there, and never mutates original input or a completed proof. |

Every command is inserted durably before application and records the target's monotonic `version`.
Re-delivery returns `already-applied`. CAS is enforced only for real race families: cancel-tree,
edit-vs-resume, gate resolution, and write recovery; a stale projection conflicts and forces refresh
only for those arms. Other arms retain the version seam for audit/future concurrency but validate
current authority without rejecting solely because the observed version changed. The command audit
records requester (`local-operator` for now), source surface, reason, before/after versions, affected
dependency ids, and outcome. API routes are thin schema parsers over this service—there are no
workflow-specific mutation endpoints except domain gates whose handlers themselves issue commands.

Bulk commands first resolve the union of all authoritative dependency targets. `all-or-none` locks,
validates every policy plus expected versions for CAS-enforced arms, and applies one transaction or
none. `best-effort` writes a child command/result per requested target and returns the complete
applied/conflict/rejected vector; the UI may never collapse a partial result into “Done.” Bulk cancel
defaults to `all-or-none`; bulk hide defaults to `best-effort`. There is no client loop whose last
response overwrites earlier errors.

For descriptor-driven starts, the Enqueue row above is reached only by consuming the server-issued
`start_plan` described in the Phase-1f ratification. The command target carries the plan id and
pre-consume version, not mutable input. The handler compares every bound fingerprint/hash and consumes the plan in the
same transaction as active-run resolution and run creation; “plan consumed but no run” and “run
created from an unconsumed/stale plan” are both invalid states.

**D95 — command-family closure and the two meanings formerly called bump (2026-07-31).** Every
command arm carries exactly one closed target family; an id valid for one family cannot be erased
to a generic string target. Phase 1c ratifies the following complete family shell before any route
or handler exists:

| Target family | Closed action shell and authoritative target |
|---|---|
| `start` | `start-run`; exact workflow/start-plan token plus pre-consume revision and its bound descriptor/config/input fingerprints |
| `intake` | inspect/confirm mapping, correct/exclude/validate, and enqueue-manifest actions; exact intake artifact/session/manifest id plus observed version |
| `worker-browser` | plan/spawn/stop/pause/resume worker and refresh/reopen browser; exact worker id, or worker id + browser session id, plus observed version where authority is mutable |
| `settings` | `apply-settings`; one expected config revision plus one strict atomic multi-leaf patch—never per-field route writes |
| `version-archive` | `plan-version-bump`, `apply-version-bump`, and archived-run relaunch; the plan action names an exact workflow/app scope and fingerprints, while apply consumes one immutable plan id/version and refuses blockers or drift |
| `run` | retry/cancel/**priority `bump`**/rename/hide/unhide/edit-checkpoint/write resolution; exact run id + observed version |
| `gate` | resolve one exact `(runId, gateId)` with schema-hash-bound result + observed version |
| `notification` | read/unread/snooze one exact actor-owned notification + observed version |
| `capture` | the closed doc 06 session/photo/finalize/discard arms; exact capture session/photo ids + observed version |

The string **`bump` is permanently reserved for run priority/claim order**. Descriptor/app version
work uses only `plan-version-bump` then `apply-version-bump`; the plan is reviewable and immutable,
and apply cannot be synthesized from a run-priority command. No union arm, bulk action, route, or UI
descriptor may use one `bump` discriminant for both meanings. Start, intake, worker/browser,
settings, version/archive, run, gate, notification, and capture are the exhaustive product mutation
families; adding another family is a contract change in this owner doc, not a route-local string.

### 2.5 Non-rebuildable SQLite recovery contract

Calling `state.db` authoritative without a recovery path would make a single corrupt file capable
of erasing claim, delegation, checkpoint, and write-fence truth. The base therefore includes:

1. SQLite runs with WAL, foreign keys on, a busy timeout, and `synchronous=FULL` for authority
   transactions. Schema migrations run only under an exclusive migration lease.
2. Boot runs `PRAGMA quick_check`, schema-version validation, foreign-key checks, parses every
   authority table's durable `record_json` through its registered strict schema, and runs invariant
   queries (one active claim per run, manifest children match dependencies, every attempting write
   has an attempt, every outbox references authority, every finalizing capture has exactly one live
   bundle/handoff outbox, and every finalized capture references one intake handoff). Any failure starts the dashboard read-only
   and blocks enqueue/claim/commit/control commands with one durable/console-visible health error.
3. One infra-owned `AuthorityDatabase` retains the private native `DatabaseSync`; task/command/
   projection consumers receive only narrow repositories and never the raw handle. Its async,
   single-flight `backupToTemp` calls `node:sqlite.backup`—the rebuild does not inherit the current
   compatibility wrapper's erased backup capability and does not file-copy a live WAL database.
   After backup completes, verification opens the **backup itself** read-only, runs full integrity/
   foreign-key/invariant checks, and reads schema version/page count/`authority_generation` from
   that copy. Only those self-observed values enter the manifest with SHA-256/created-at; the service
   then fsyncs and atomically renames. A pre/post read of the live DB cannot label a different
   snapshot. `VACUUM INTO` and raw file-copy are not online-backup fallbacks (D72).
   Retain 14 verified daily backups, the latest 8 coalesced critical/interval backups, and the last
   5 pre-migration backups; expose age/health in
   Settings. A configurable path may point at another local volume.
4. A dirty authority store gets a coalesced verified online backup at least every 15 minutes and
   immediately after schema migration, external-write durable commit, capture final handoff, and
   graceful drain. Critical triggers may join one already-running backup, but cannot be silently
   dropped: if the completed copy's self-read generation predates a trigger's required generation,
   one coalesced follow-up backup is scheduled. Backup health reports both last verified time and
   the verified copy's authority generation/RPO gap.
5. `cli storage doctor` is read-only and reports checks, backup freshness, pending commands,
   unresolved writes, leases, outboxes, and restore candidates. `cli storage restore --from
   <exact-backup>` verifies the exact backup first, then consumes a fresh one-time rebuild-runtime
   proof bound to current runtime/server/worker lock generations before preserving the suspect DB;
   it restores into a temp path, repeats all checks, and atomically swaps only while those locks remain stopped.
6. Restore reconciliation replays JSONL into **projection tables only**. It never invents lost
   authority from spans. Runs/events newer than the restored authority generation are surfaced as
   `authority-unknown`; any possible external write is parked for doc 09's live probe/operator
   resolution before execution continues.

An automated restore drill copies a real-shaped DB, corrupts the copy, detects it, restores the
named verified backup, rebuilds projections, and proves pending commands/delegations/write intents
and capture handoffs remain consistent. (This sentence read "Phase 1 cannot exit until…" until
2026-08-09; D74 moved the drill behind the first live proof and the as-built below is where it
actually landed, in **2j**.) Backups are useful recovery state, so they
are excluded from ordinary tracker cleanup and covered by disk-space warnings.

**As-built (2i-D, 2026-08-08, D169) — the doctor/backup wire is live; restore and retention are
the recorded remainders.** The dashboard composition is the backup cadence's owner: one verified
backup at process start, a coalesced verified backup on each 15-minute tick **only when the store
is dirty** (`authorityGeneration` moved past the last verified backup), and a graceful-drain
backup inside `stop()` whose failure throws to the stopper AFTER cleanup. A failed run leaves no
manifest for the on-disk doctor to see, so the composition RETAINS its backup service's last
outcome and serves it on the doctor wire's `service` arm. Two health readings exist on purpose
and say which they are: the bootstrap summary (`storage.backup`) is CHEAP — the newest manifest
judged by created-at age (bound 45 min = three intervals) and live generation gap, trusting the
byte verification every manifest received when it was written — while the doctor
(`GET /api/v1/storage/doctor`, the Settings section's button, and `rebuild:cli storage doctor
[--json]`, exit 0 only when authority is healthy AND a verified current backup exists)
re-verifies backup BYTES on demand; an unparseable manifest reads `missing` on the summary (its
closed enum's fail-safe arm) and `invalid`, named, on the doctor. Settings itself
(`src/dashboard/surfaces/settings.tsx`, the top-bar gear with an attention dot) renders the
sections the SERVER serves (`settingsSections`, today exactly `storage`) — §5's mandate "expose
age/health in Settings" is met read-only; `apply-settings` stays a deferred command family.
NOT built here, each on its owning milestone: `cli storage restore` and the one-time
rebuild-runtime proof (the 2j corruption→restore→rebuild drill owns wiring
`offline-restore.ts`), and the retention sweep (14/8/5) — until it lands, dirty-only ticks bound
growth to real generations. First real run of the doctor (2026-08-08) correctly reported the
standing local authority DEGRADED at schema v10 against the v11 build — the migration applies at
the next read-write open, and a summary that had guessed "healthy" would have hidden exactly
this.

#### D181 — the restore command, and the process locks the interlock was always about (2j, 2026-08-09)

**`rebuild:cli storage restore --from <manifest.json>` is live, and the reason it could not have
been built earlier is that its precondition did not exist.** `OfflineAuthorityRestoreService` has
required a one-time `StoppedSystemProof` since Phase 1c, `RecoveryStopProofStore` has refused to
issue one without a recorded `RecoveryRuntimeLockSnapshot`, and **nothing in production had ever
recorded a snapshot** — `recordRuntimeState` had no caller, and `.tracker-rebuild/locks` (pinned as
a distinct isolated resource by D88) was never created. The restore path was therefore complete,
tested, and unreachable.

**The locks are now real, one file per role.** `src/infra/sqlite/runtime-process-locks.ts` gives
the dashboard composition (`server`) and the worker composition (`workers`) a lock file each,
taken BEFORE the authority database opens and released only AFTER its handle closes. Each process
writes only its own file; the snapshot the stop-proof store records is **composed at observation
time** from both. That is the load-bearing choice: one shared snapshot file would need a
read-modify-write from two processes, and a lost update there would report a running server as
stopped — the exact state this interlock exists to refuse. A second live holder of one role is now
refused by name and pid, which is the "two dashboards over one authority store" collision
`config/runtime-isolation.json` has named since D88 and nothing enforced.

**Liveness is OBSERVED, never assumed, and the observation writes nothing.** A crashed process
leaves its lock held. Reading that as "still running" would make restore permanently impossible
after a crash — the one moment it is most needed — so the observation asks the operating system
whether the recorded pid still exists and reports `stopped` only for a pid that is genuinely gone
(`EPERM` counts as ALIVE: the process exists and belongs to someone else). It never rewrites
another process's lock file to make a restore possible. `runtimeGeneration` is the sum of the two
lock generations, so it strictly advances whenever either process restarts, which is what stops a
proof issued before a restart from matching the runtime after it.

**The command never chooses a backup.** `--from` names one exact manifest, because "restore the
newest" is a decision about which minutes of real HR work to discard and no default is right; a
missing or tampered manifest refuses by file name rather than falling back. Projection rebuild runs
against the STAGED copy through the same `createRunQueueProjection` the dashboard uses, and a
degraded rebuild refuses the whole restore while the live authority is still untouched —
`rebuildFromJsonl` records rather than throws, so without that check an operator would be handed a
database whose surfaces are silently empty. A refusal is REPORTED with its whole `cause` chain and
exit 1 (not a stack trace) plus the observed lock line, because a running runtime is an expected
outcome the operator has to read.

**Measured — the 2j drill on a copy of the standing local authority database (2026-08-09).** Never
in place; `.tracker-rebuild/state.db` was copied to a scratch repo root with its `spans/` (14,044 B
across two JSONL files) and drilled there.

| Step | Measured |
|---|---|
| copied authority | 565,248 B, schema **v10**, authority generation 75 |
| dashboard boot over the copy (migrate v10→v13 + start backup) | **1.07 s**; `-wal` 177,192 B |
| verified backup written | `authority-g76-…sqlite` **684,032 B**, manifest 942 B, generation **76** |
| corruption injected | 36,864 B of interior pages overwritten (`0x5A`), SQLite header left intact |
| `storage doctor` over the corruption | **0.92 s**, exit 1, `authority-corrupt` (`quick_check` ≠ ok), 1 verified restore candidate, zero bytes written |
| runtime lock at restore time | `server` held by hard-killed pid 89364 → observed **stopped** (the crash path, not the graceful one) |
| `storage restore --from <manifest>` | **0.99 s**, restored generation 76, projections rebuilt |
| suspect quarantined | 565,248 B + `-wal` 177,192 B + `-shm` 32,768 B, byte-identical to what the doctor saw |
| `storage doctor` after restore | **0.71 s**, exit 0, healthy schema v13, generation 76, **167 pages** |
| authority preserved | 14 runs, 2 checkpoints, **2 write intents**, 2 durable-outbox rows, 1 command — including the real Kuali controlled commit's durable footprint |
| projections rebuilt | `runs_view` re-folded from the copied spans JSONL |

**One defect the drill found and fixed:** a `StorageHealthCause.summary` is a one-line human
sentence printed inside the doctor's report, the Settings surface, and a notification title — and
the failures that produce it are frequently zod errors whose `message` is pretty-printed multi-line
JSON. The first drill run printed `authority: DEGRADED —` followed by twenty lines of issue
objects, burying the sentence. `storageHealthCauseFromError` now collapses runs of whitespace;
every word survives, nothing is truncated, and the line is a line.

**Still not built, and named:** the retention sweep (14/8/5) stays a remainder, and no config leaf
names the suspect directory — it is `<stateRoot>/suspects` by construction. Doc 03 §2.5's
"a configurable path may point at another local volume" remains unimplemented.

**Storage stance — operator 2026-08-12 (D193): the built surface is enough, and the remainders are
`wont-build-unless-asked`.** With the doctor, the dirty-only 15-minute verified backup cadence, and
the drilled `cli storage restore` all live, the operator judges storage **done for this scope** and
judges a **manual folder copy of `.tracker-rebuild/` taken with the app stopped** an acceptable
backup for a solo-local system (charter §Non-negotiables, reaffirmed the same day). **The reasoning
is that this database stores records of COMPLETIONS, not primary records:** the real record of a
completed HR transaction lives in the external system — the UCPath transaction, the Kuali document —
and can be checked there in more than one way, while these rows carry *how* a thing was completed
and *whether* it completed, and mean little going forward once it is completed and approved. That is
what makes backup non-critical at this scope. It says nothing about durability *during* a write —
the fence, its binding proof, and a parked intent are load-bearing for the run in flight (doc 09),
and that is untouched. Everything above
**stays exactly as built — nothing is removed or weakened.** What changes is the forward plan: the
**14/8/5 retention sweep scheduling** and the **content-store refcount reclamation** (doc 12 §D137)
move off "deferred on an owning milestone" and onto nobody's milestone; no gate, cutover criterion,
or later slice is blocked on either. They land only if the operator asks. Note this decision is
about *further investment*, not about correctness: the doctor's refusals, the byte verification, and
the restore interlock are safety floor and remain mandatory.

### 2.6 Durable single-operator notifications

Desktop notifications are delivery conveniences, not the record. A `notifications` authority
table stores a strict event with `notificationId`, dedupe key, severity, run/workflow/failure refs,
created time, message template+arguments, read state (`unread|read`), and optional snooze expiry.
Triggers are closed and base-owned: run failure, subject mismatch, open operator gate, unknown write
outcome, storage degradation, stalled lease/outbox, and failed backup. Repeated identical triggers
update count/lastSeen instead of spamming.

The dashboard inbox and per-run timeline always render durable state. OS notification delivery is
best-effort; a failed toast never loses the unread inbox item. Snooze suppresses delivery until its
expiry without changing read state. Notification text uses redacted arguments and links to the
evidence/failure/run—not raw secrets or captured form contents.

```ts
export interface NotificationWire {
  notificationId: NotificationId;
  dedupeKey: NotificationDedupeKey;
  trigger: NotificationTrigger;
  severity: "info" | "warning" | "error" | "critical";
  state: "unread" | "read";
  title: string;
  message: string;
  count: PositiveInt;
  createdAt: IsoInstant;
  lastSeenAt: IsoInstant;
  snoozedUntil?: IsoInstant;
  link?: { kind: "run" | "failure" | "storage"; id: string };
}
```

**Durable representation (D134).** "Repeated identical triggers update count/lastSeen" is stored as
**one row per `(actorId, dedupeFingerprint)`, updated in place** — schema v10 adds that unique index
plus triggers freezing identity and creation and requiring a strictly advancing `version`. The
durable `NotificationRecord` therefore carries `count` and `lastSeenAt` beside `version`. Doc 12
§6.1 owns the justification and the boundary against the ledger's true immutability.

**Publish ordering (D138).** "A failed toast never loses the unread inbox item" is an ORDER, not an
aspiration. `publish` settles create-or-fold in one authority transaction and only then attempts OS
delivery; the delivery call is made after that transaction returns, over a row authority can already
read. A delivery that throws is reported to the caller and **never written back** — status, `count`,
and `version` are untouched — and no per-attempt delivery state is stored at all. A missing desktop
channel reports `no-channel`, never success. Snooze is evaluated at delivery time only: a snoozed
row still folds durably, it just does not ping.

**AS-BUILT (2i-B, 2026-08-08; recorded 2j) — the `NotificationWire` sketch above is SUPERSEDED by
what the wire actually serves.** The `interface NotificationWire` block in this section was written
before the durable row existed and does not describe `NotificationWireSchema`
(`src/domain/dashboard/projection.ts`). Three differences, each deliberate:

- **There is no `critical` severity.** The sketch's four-value ladder had no consumer: severity is
  DERIVED from the trigger by what the operator must DO, and D79b's six trigger keys map onto three
  outcomes — `failed`/`write-parked` → `error`, `verified-done` → `info`, and the waiting/storage
  family (`gate-waiting`, `repeating`, `storage`) → `warning`. A fourth level would have needed a
  trigger that means "worse than error", and no trigger does. Adding one is a decision about the
  trigger vocabulary, not about the wire.
- **`state` is a single three-value axis `unread | read | snoozed`, not `state` plus `snoozedUntil`.**
  The DURABLE model keeps read-state and snooze as two independent axes exactly as D138 requires —
  `NotificationRecord` carries `status` and `snooze` separately, and snoozing never changes read
  state. The WIRE folds them because the inbox renders one row state: `snoozed` wins **only while
  the snooze is still in force**, and an expired snooze reads as its underlying status again with
  nothing written back. Serving `snoozedUntil` as its own field would have invited the client to
  re-derive that comparison against its own clock, which is how two surfaces come to disagree about
  whether a row is snoozed.
- **`dedupeKey`, `trigger`, `message`, `count` and `link` are not on the wire.** The row carries all
  of them durably; the bell and inbox render `title`, `severity`, `state`, `occurredAt` and
  `revision`. `revision` IS `version`, which is what the read/snooze commands CAS against — the
  sketch had no version at all, and without it the three arms could not have been safe.

**Trigger arguments are closed (D138).** "Notification text uses redacted arguments" is enforced by
having no free-text argument: every trigger-event arm is ids, closed codes, and counts, and the
title/message are composed from those. A caller cannot hand the inbox prose, so captured form
contents have nowhere to enter. The doc-03 trigger list routes onto D79b's six keys as: run failure
and subject mismatch → `failed`; open operator gate → `gate-waiting`; unknown write outcome →
`write-parked`; repeat threshold → `repeating`; storage degradation, stalled lease/outbox, and
failed backup → `storage`; verified-done receipt → `verified-done`.

---

## 3. Descriptor fields this layer consumes (shape owned by doc 02)

**Doc 02 owns the `WorkflowDescriptor` shape and builder** (D1). This section does not define a
descriptor interface; it names the fields this layer *reads*, and the fields it *contributes* for
doc 02 to adopt. The tracker enforces its half at the emit boundary: **emitting a task span whose
`name` is not a descriptor step key, a gate not in the descriptor's gate list, a verdict not in its
verdict map, or a patch key not in its detail-field list, throws at emit time.**

### 3.1 Read from doc 02's descriptor
`id`, `code` (2-char trace prefix), `label`, `icon`, `category`, `surface.shape` /
`surface.resolveShape`,
`inputSubject`, graph-node keys/labels, `surfaces`, `details`, `actions`, `presets`, `identity`,
`presentation`, `coordinator`, `completionConsumes`, `artifactProjections`, `enqueue`, `scenarios`,
version/fingerprint, and
override layering. There is no second `archetype` declaration.

### 3.2 Contributed by this doc, adopted into doc 02's descriptor
These are plain-data fields; doc 02's descriptor carries them, this doc defines their semantics:

```ts
steps display rules: readonly StepDisplayRule[]               // computeOcrPipelineView's fold/hide
gates: readonly GateProjectionDefinition[]                    // descriptor-derived from gate nodes
verdicts: readonly VerdictDefinition[]
//  ^ REPLACES statusExtensions (review #5 / D1): person-lookup's `notFound` becomes
//    { key:"not-found", label:"Not found", tone:"warning" } over span.ended.verdict; the
//    identity-approval badge (§5.4) becomes a gate statusKey. The statusExtensions function
//    registry does not exist in the rebuild repo.
details: readonly DetailProjectionSpec<Nodes>[]
//  ^ the SpanPatched validation set (review #11): every patch key must be declared here.
//    Successor of today's detailFields incl. the "declared but never populated" warn.
capabilities: WorkflowCapabilities
completion?: CompletionProgram                                // §4 — OCR-backed workflows only
enqueue / actions / scenarios / presets / identity / presentation / coordinator /
completionConsumes / artifactProjections
// artifact projection specs name an exact producing node+field, sink id, stable key fields,
// blocking policy, and canonical record schema; the client receives status only, never sink paths
```

The bundle-safe artifact spec is a closed infrastructure contract, not an arbitrary callback:

```ts
export type ArtifactSinkId = "xlsx-retention"; // extend with a sink implementation + guard fixture
export interface DurableArtifactProjectionSpec<RecordSchema extends z.ZodType> {
  id: string;
  source: { nodeId: string; fieldPath: string };
  record: CanonicalJsonSchema<RecordSchema>;
  keyFields: readonly [string, ...string[]];
  sink: ArtifactSinkId;
  blocking: true;
}
```

The builder factory receives the exact node accumulator and constrains `nodeId`, `fieldPath`, and
`keyFields` to real paths in that node's output/record schema; the broad wire form above is runtime
only. `blocking:false`, a free-form sink id, positional keys, and function-valued projectors are not
legal. Sink implementations live in one exhaustive `Record<ArtifactSinkId,Projector>` owned by
infrastructure—deliberately a sink-kind registry, never keyed by workflow.

Every hand-maintained parallel list in today's dashboard (icons, INSTANCE_LABELS, step-label
switches, stub map) becomes a projection of the descriptor set with a coverage guard — that
mechanism and its guard are doc 02's (§1.3/§1.4 there).

---

## Phase 1e as-built completion + delegation-manifest delta (2026-08-01)

`src/domain/workflow/completion.ts` implements §4. Three as-built points:

- **`PerDocumentStage.deriveItemId` returns `ItemId`, not `string`.** §4.1's sketch types the
  per-record stage's id as `ItemId` and the per-document stage's as a bare `string`; there is no
  reason for two identity types on one program, and the loose one is the arm that could smuggle a
  positional id.
- **The program is sealed, and reveal is a named function.** §4.2's "branded opaque type whose
  completion config is not structurally reachable" is implemented as a handle exposing `mode` and
  `gate` only, plus `revealCompletionProgram`. `descriptor-coverage` additionally checks that no
  workflow module calls it, so §4.2's second mechanism (no spec-to-spec reach) is mechanical too.
- **Construction proves the chain against a mandatory sample**, including the §4.1 rule that stage
  N+1 receives the ids stage N ACTUALLY enqueued after `eligible` filtering.

**Durable delegation manifest (D105).** The 1c `DelegationManifestSchema` could not express what the
1e planner writes, and all three gaps were silent losses rather than validation:

- it recorded no `policy`, so the manifest — the authority a replay verifies against — was not the
  durable home of the policy the operator selected (D102 says one vocabulary END TO END);
- its `join` carried only `all`/`all-settled`, making an awaited one-child edge (`join:"one"`) and
  an un-awaited fan-out (`join:"none"`) unwritable, even though the latter's manifest reference IS
  the node's output;
- `children` required `min(1)`, so a zero-child fan-out — a legitimate empty upstream list that
  doc 02 §3.2 requires to stay an explicit satisfied join — had no writable record.

All three are corrected in `src/domain/dependencies.ts`, with `join`/`cardinality` agreement
enforced. Like D102 this is a zod-validated JSON payload, so no authority migration version is
consumed by the shape change.

---

## 4. Unified completion contract (replaces approveTo / approveDocumentTo / completeDelegatedRun)

**Re-derived from `tracker/dashboard/ocr/approve.ts` + `prepare.ts` as-built (D11), not the OCR
happy path.** The as-built route is a *staged program with durable state*, and the contract must
express five things the previous draft missed: intent-derived child shape, `deriveItemId`, ordered
stages (per-document consumes per-record's *actually-enqueued* itemIds), oath-upload's
sibling-subscriber shape with NO coordinator, and i9's prepare-route enqueue + task-less
display-only failed rows.

### 4.1 The typed staged completion program

```ts
// src/descriptor/completion.ts
import { z } from "zod/v4";
import type { AnyWorkflowRef } from "./ref.js";
// WorkflowRef<InputSchema,ResultSchema> carries both concrete schemas (docs 01/02).

export type CompletionProgram =
  | StagedFanOut<readonly [PerRecordStage<AnyWorkflowRef>, ...AnyFanOutStage[]]>
  | CompleteThenEnqueue<AnyWorkflowRef>;
// oath-upload deliberately has NO CompletionProgram — see §4.5 (sibling subscriber).
// verify deliberately has NO CompletionProgram — see §4.6 (in-run enrichment, not completion).

export interface StagedFanOut<Stages extends readonly [PerRecordStage<AnyWorkflowRef>, ...AnyFanOutStage[]]> {
  mode: "staged-fanout";
  gate: "approval";                          // the gate this program resolves
  /** ORDERED. Stage N+1's derive receives stage N's ACTUALLY-ENQUEUED itemIds — as-built:
   *  oath's per-document ticket gets `perRecordItemIds` = the ids the record stage really
   *  enqueued after `eligible` filtering (approve.ts:306, oath.ts:455), never the selected set. */
  stages: Stages;
}

export type AnyFanOutStage =
  | PerRecordStage<AnyWorkflowRef>
  | PerDocumentStage<AnyWorkflowRef>;

export interface PerRecordStage<Target extends AnyWorkflowRef> {
  per: "record";
  to: Target;
  derive: (record: PreviewRecord, ctx: ApproveContext) => z.input<Target["input"]>;
  /** As-built canFanOut: oath = signed + 5-digit EID (`hasOathSignerInput`); EC = EID-complete.
   *  Shared, named, exported predicates only (§4.2). Skipped records are NOT enqueued and their
   *  itemIds do NOT reach later stages. */
  eligible?: NamedPredicate;
  /** PreviewRecord carries a StableRecordId derived when extraction admits the record from
   * source-artifact digest + stable page/form identity. Item identity may use that id and validated
   * subject/business fields, never array index or run id. IDs are minted into the durable manifest
   * BEFORE dispatch. The enqueue-side resolver keys on the LOGICAL (runtime-options-stripped)
   * input and FAILS LOUD on a miss (buildFanOutItemIdResolver); the E2E-015 shared-id/index fallback
   * is banned. */
  deriveItemId: (record: PreviewRecord, ctx: ApproveContext) => ItemId;
}

export interface PerDocumentStage<Target extends AnyWorkflowRef> {
  per: "document";
  to: Target;
  derive: (doc: ApprovedDocument) => z.input<Target["input"]>; // gets prior enqueued ids
  deriveItemId: (doc: ApprovedDocument) => string;
}

export interface CompleteThenEnqueue<TTarget extends AnyWorkflowRef> {
  mode: "complete-then-enqueue";             // i9: no approval gate exists — nothing to approve
  then: {
    per: "person";
    to: TTarget;                             // concrete input schema retained end to end
    /** Runs at the PREPARE seam (as-built: /api/ocr/prepare after the delegated run completes,
     *  gated on the coordinator existing — prepare.ts:476-505), NOT at an approve route. */
    derive: (plan: MemberPlanEntry) => z.input<TTarget["input"]>;
    /** Pages that can never be searched become TASK-LESS display-only failed member rows
     *  (`run.queued { displayOnly: true }` + immediate `span.ended("failed")`; no run.claimed,
     *  no worker span, Hide-only actions) — as-built i9-check-results.ts displayFailures. */
    displayFailures: true;
  };
}
```

`defineCompletionProgram(...)` infers and returns the concrete heterogeneous stage tuple; workflow
descriptors are inferred values and are never annotated as broad `CompletionProgram`. A type-level
fixture renames a target input field and requires every `derive` site—including i9—to fail `tsc`.
Broad target erasure, untyped `derive` results, or exported erased stage arrays are forbidden.

### 4.2 Cross-spec borrowing becomes impossible

Today: `onbase-emergency-contact.ts:82` reaches into `emergencyContactOcrFormSpec.approveTo!.canFanOut`.
Two mechanisms close this:

1. **Predicates are first-class named exports in a shared home**, not properties fished out of
   another spec's config:

```ts
// src/forms/shared/eligibility.ts
export const hasResolvedEid: NamedPredicate = definePredicate("has-resolved-eid",
  (r) => /^\d{5,}$/.test(normalizeUcpathEmployeeId(readEid(r))));
// onbase-ec and ec BOTH import hasResolvedEid. Neither imports the other's config.
```

2. **Specs are sealed at definition.** `defineFormSpec(...)` returns a branded opaque type whose
   completion config is not structurally reachable (`unique symbol` brand + no exported property
   types). `otherSpec.completion.stages[0].eligible` is a type error — the only composition
   surface is the shared-predicate module and explicit `extendFormSpec(base, overrides)` which
   re-validates the result. The architecture guard (§6) additionally bans importing one spec
   module from another spec module (registry + shared modules only).

### 4.3 Intent-derived child shape and stage consumption — declarative, coordinator-owned

As-built, TWO things are derived at approve time from the *launching intent*
(`data.operationWorkflow`, a string stamped on the OCR row at prepare):

- **Child shape** (approve.ts:236-239, recovery :882-884): fan-out children are stamped
  `operation-member` iff the intent is an operation coordinator (`oath-signature` /
  `emergency-contact` / `onbase` / `i9-check` — `ocr/shared.ts:25-34`). **oath-upload is
  deliberately NOT a coordinator** — its children keep the natural archetype, and the ticket is a
  real `single` task, not a display row.
- **Stage suppression** (approve.ts:224-227): the per-document stage is suppressed when the intent
  is `oath-signature` (signs only, no ticket) or `oath-upload` (the born-at-upload task files its
  own ticket).

In the rebuild both move onto the **launching coordinator's descriptor**, resolved via
`parentRunId → run.queued.workflow` — no string-keyed `data` field:

```ts
// oath-signature descriptor:  completionConsumes: { memberShape: "operation-member", suppress: ["document"] }
// emergency-contact / onbase: completionConsumes: { memberShape: "operation-member" }
// oath-upload descriptor:     completionConsumes: { memberShape: "natural", suppress: ["document"] }
// i9-check descriptor:        completionConsumes: { memberShape: "operation-member" }   (used by §4.1's then)
```

A **display-only coordinator** (operation shape, no daemon task) declares
`coordinator: "display"` — its `run.queued` carries `displayOnly: true`, no `run.claimed` ever
follows, and completion is the members-terminal rollup (`rollupOperationStatus`, ported as a
projection rule). The as-built subtlety that dependency edges are simply *not created* when the
parent has no task (approve.ts:1389-1429) becomes structural: display coordinators are not in the
task store, and the dependency step of the program skips them by type, not by a missing-row probe.

Standalone approve stays rejected loud (approval ≡ delegation, ported rule — approve.ts:162-171).

### 4.4 Durability: the approval manifest is part of the contract's execution, ported as-is

The `ocr_approvals` machinery (2026-07 hardening) is transport-level idempotency and orthogonal to
the contract *shape* — it ports as-is, with its manifest now referencing span identity: stable
child `runIds` minted into the manifest before dispatch; claim/lease with heartbeat renewal;
conflict/stale/failed claim outcomes; a recovery path (`resumeRecoverableOcrApprovals`) that
re-dispatches **from SQLite alone** (never re-reads JSONL state that may be missing post-crash);
child-input schema validation *before* the claim is accepted (a bad derive is a durable failed
approval, not a stuck review); terminal presentation (`gate.resolved("approval","approved")` +
`span.ended("done")` with `fannedOutItemIds`) written only after the SQLite commit, so
presentation failure can never turn enqueued children into a failed approval. Dispatch failure →
`gate.resolved("approval","failed")` + `span.ended("failed")` (today's `approve-failed`), emitted
with inherited identity (ISS-006 rule, now structural — identity lives on `run.queued`).

### 4.5 oath-upload — owner-consumes via a sibling born-at-upload task (no coordinator)

**What cannot be expressed as a CompletionProgram is stated here explicitly rather than
mis-modeled (D11).** oath-upload has **no OCR form spec at all** (`forms/registry.ts:8-14` lists
oath/ec/onbase-ec/verify/i9 — oath-upload is a fan-out *target*, not a form). Its as-built shape
(`oath-upload/handler.ts:114-181`, prepare.ts:356-419):

- The real `single` ticket task is **born at upload** at the prepare seam, BEFORE OCR; the OCR run
  is delegated *under it* (`parentRunId` = the ticket run). If the born task cannot be created,
  prepare fails loud and aborts the OCR run (`ocr-prep-failed`) — OCR must never run with no
  consumer.
- The oath spec's per-record signer stage **still runs** at approve (the ticket's coordinator
  descriptor suppresses only the `document` stage, §4.3).
- The ticket task consumes the approval as a **sibling subscriber**: its `wait-approval` step
  (a gate in the new model, per D5) calls `subscribeToApproval({ workflow:"ocr", sessionId })` and
  learns the signer set from the approval payload's `fannedOutItemIds` — cross-process, JSONL/
  SQLite-backed, not an in-memory wake.
- Declared on the oath-upload descriptor as a gate wired to an approval subscription:
  `gates: [{ id:"await-approval", subscribes: { workflow:"ocr", key:"sessionId" } }, { id:"await-signatures", … }]`.
- The zero-signer refusal is an output-dependent branch to a typed failure node; discard is a gate
  resolution mapped to cancelled; signature waiting is a typed children-terminal gate; ticket fill
  and submit form a transaction node. The submit idempotency window is doc 09's write intent. None
  of these hides in a handler side channel.

### 4.6 verify — in-run enrichment, not completion

verify has **no completion contract**: no approve targets, no `completeDelegatedRun`. Its
fan-outs (`verify.ts:523-660`) happen during the run: doc 02 models two typed child-run branches in
a first-class parallel `all-settled` node, followed by a typed join/enrichment step. Child inputs,
results, cancellation, and joins are descriptor-visible and checkpointed. This doc still does not
model them as completion. i9 is §4.1's post-completion enqueue; verify is mid-run enrichment.

---

## 5. Cross-repo runtime boundary and one cutover (D88/D89/D93, 2026-07-31)

The legacy and rebuilt event worlds live in **two separate repositories** (D93). Their isolation is
therefore **physical, not guarded**:

- The **legacy repo** (`hr-automation`) remains the sole production authority. It continues to own
  its existing `.tracker`, state, processes, ports, locks, and browser profiles/sessions, and stays
  live and maintainable — source and tests intact, never deleted — until the single cutover.
- The **rebuild repo** (`hr-automation-rebuild`) has fresh git history seeded from the
  `feature/rebuild-phase1b` branch tip (that branch stays in the legacy repo as the pre-split
  record). Rebuild code is plain `src/`, rebuild tests are `tests/`, rebuild config is `config/`,
  and these plan docs stay at `docs/rebuild/` so every cross-doc link survives. Its gates are the
  plain script family — `typecheck` / `lint` / `test` / `test:architecture` / `test:coverage`; the
  `*:rebuild` script names and the "present-but-empty rebuild root fails" activation semantics are
  retired with the in-tree layout. `lint:legacy-tests-ratchet` and `lint:tests` survive, as the
  **legacy repo's** commands.
- **The two repos share no module graph, no build, and no process**, so a cross-runtime import,
  invocation, proxy, or live-state read is structurally impossible rather than merely forbidden.
  **Retired by D93:** the D88 bidirectional-ban guard machinery that enforced this inside one tree —
  the runtime-isolation guard family (its deliberately finite fail-closed syntax normal form over
  dynamic loaders and bridge-capable filesystem, process, network, route, state, and browser/profile
  sinks; its manifest-pinned module-family catalog; its ban on aliased, bound, wrapped, returned,
  passed, computed-selected, or re-exported bridge capabilities) **and** the legacy preservation
  manifest's same-tree hash-bound scanning, which imposed the rebuild's strict normal form on new,
  modified, or hash-mismatched legacy files. None of that machinery is built. Legacy files answer
  only to the legacy repo's own existing gates, and the rebuild tree is strict from its first file
  with no preservation exception to carve out.
- **Still required and still gated:** both worlds run on ONE machine, so a repo boundary does not by
  itself prevent operational collisions. The rebuild keeps distinct commands/entrypoints, distinct
  state and artifact roots, distinct ports, distinct process locks, and distinct browser
  profiles/sessions from the legacy repo, and tests continue to prove it.
  - **D216 (2026-08-14, operator decision) narrows exactly ONE distinctness: the browser profile
    ROOT'S NAME.** Both repos now name their profile root `.auth` (the rebuild's was
    `.auth-rebuild`, renamed with its contents — sessions and the Duo WebAuthn credential moved
    intact). The roots are repo-relative, so the two runtimes still never share the directory —
    what a shared NAME could never cause and a distinct name never prevented. The browser-state
    identity that MUST stay distinct — and remains guarded by `operational-isolation.test.ts` — is
    `browserSessionNamespace` (`hrauto-legacy` vs `hrauto-rebuild`), which is the segment that keeps
    a session opened in the wrong checkout from reusing the other runtime's authenticated state.
    `DISTINCT_RESOURCE_KEYS` dropped `browserProfileRoot` with a comment naming this decision;
    every other distinctness in the table above is unchanged and still asserted.
- **Legacy maintenance stays accounted for, now cross-repo (D90).** Every legacy maintenance change
  is recorded against the affected capabilities and rebuild evidence in the rebuild repo's
  `config/legacy-change-accounting.json`, referencing legacy-repo commit hashes. The legacy repo's
  root `CLAUDE.md` carries that standing duty.
- Live-verified selectors, parsers, and behavioral knowledge may be copied/ported into the rebuild
  repo only with provenance evidence — the legacy-repo commit hash plus source path — and rebuild
  tests. This is knowledge transfer; runtime linking is structurally impossible.
- Legacy tracker rows never enter the rebuilt BFF during development. There is no continuous lift,
  compatibility API, legacy proxy, dual projection, per-run engine/generation authority, or
  workflow-scoped dashboard flip.
- A historical import is optional and **one-time only**. If built, it accepts an explicit source
  schema version, reads a backed-up immutable legacy snapshot (never the live legacy root), writes
  self-contained archive records into a fresh/import transaction, records source digest + importer
  version + result counts, quarantines unknown rows visibly, and is idempotent by import manifest.
  It leaves no runtime adapter or cross-tree import behind.

Production authority changes exactly once, after the entire rebuild is ready. Cutover stops new
legacy enqueues, enumerates and drains/parks/reconciles active or uncertain legacy runs, backs up
both runtimes' state/config, runs any approved one-time import, then atomically repoints the normal
production launcher at the **rebuild repo** (D89's substance is unchanged; D93 only changes the
mechanics of the switch from an in-repo authority flip to a repo target). The legacy repo is
preserved **wholesale** as the rollback asset — commands, source, and tests all stay runnable, which
is strictly stronger than the previous "`src` remains rollback code". After native writes, rollback
requires explicit ledger/intent reconciliation and dedupe proof before the launcher can point back.
At no point may both repos accept production work.

<details>
<summary>Historical D12/D13 coexistence design — superseded by D88/D89/D93; do not implement</summary>

The following subsections are preserved only to explain why continuous lift, engine generations,
and a scoped dashboard flip were rejected. They are not current requirements and may not be used
as an implementation contract.

### 5.1 The seam: one direction, one place

**Decision: a read-side lift adapter in the new server — legacy events are lifted into span form;
there is exactly one projection pipeline.** Rejected alternatives (unchanged): dual projection
paths (two codebases in visual parity for months), dual-write from old src (destabilizes it),
down-emit shim (unneeded once the scoped flip lands first).

```ts
// temp_src/tracker/compat/lift-legacy.ts — PURE, deleted at end of migration.
// Reads legacy state via the OLD validators (imported from src/tracker — the one sanctioned
// old→new import, quarantined to this module) and lifts each legacy run into spans.
export function liftLegacyRun(
  schemaVersion: LegacyEmitSchemaVersion,
  entries: TrackerEntry[], logs: LogEntry[], sessions: SessionEvent[],
): LiftResult;
// LiftResult = { spans: SpanEvent[]; notes: Note[] } | { quarantined: QuarantinedRow }
```

Legacy emit shapes are **versioned, not frozen**. Central legacy emitters stamp one reviewed
`LegacyEmitSchemaVersion` covering row/log/session channels; records predating the field are explicit
`v0`. The lifter dispatches through a closed version→adapter map. A guard snapshots the legacy wire
schemas: changing a source schema without bumping the version, adding its adapter, and adding
old+new golden fixtures fails CI. Production `src` can therefore receive necessary fixes during the
multi-quarter migration without silently changing the meaning of already-stored rows.

**Lift inputs come from the visible-entries layer, never raw files (review #9):** the lifter reads
through `readVisibleEntries*` / the tombstone-filtered SQLite views (`deletions/visible.ts`), so an
operator-deleted run stays deleted — raw-file reads would resurrect it. Session-event lifting
applies the same tombstone filter.

**Lift policy is quarantine, NEVER throw (D12) — for invalid rows.** A row the lifter cannot
classify — an invalid `data.archetype` (which
`resolveRowArchetype` throws on today, `row-archetype.ts:96-99`; the lifter catches at the row
boundary) or an unknown status/step combination — produces a
`quarantined` diagnostic: a loud queue card carrying a schema-redacted excerpt + reason, a warn
note, and a
count on the SSE hub (`quarantine` topic, §2.2). One bad row degrades to a visible quarantine card; it can never take down
the projection read path for every workflow, which a throw would.

### 5.2 The mapping — enumerated from the kernel terminal contract (D12)

Re-derived from `tracked-workflow.ts` / `jsonl-core.ts` / the route emitters — not the OCR happy
path. Legacy statuses are `pending | running | done | failed | skipped`; everything else is step
sentinels and read-time reclassification. The lift decodes each exactly once:

| Legacy state (source) | Lifted form |
|---|---|
| `pending` row (pre-emit) | `run.queued` — shape via `resolveRowArchetype` incl. `batch`→`operation` normalization (legacy normalization lives HERE ONLY); identity attrs from the pending row's data |
| first `running` row / step transitions | `run.claimed` + `span.started(task)` per step change; `attempt` starts at 1 |
| same-runId re-pend after progress (`returnTaskToQueued` — row-lifecycle "reassign", VL-004) | `run.requeued(cause:"reassign", nextAttempt: n+1)`; the next running row opens attempt n+1 task spans — span identity `(runId, attempt, spanPath)` keeps "once per attempt" true (review #10) |
| re-pend under a NEW runId | new run with `retryOf` = prior runId |
| `running` with pseudo-step `` `<step>:failed:<err>` `` (`tracked-workflow.ts:365-370`) | NOT a step named that string: parsed at the first `:failed:` → `span.ended(task <step>, "failed", error)`; the run stays open until its terminal row |
| plain `done`, no step (`:420` — the MOST COMMON terminal) | `span.ended(run, "done")` |
| `done` + `step="approved"` (+ `fannedOutItemIds`) | `gate.resolved("approval","approved")` + `span.ended(run,"done")` |
| `done` + `data.eidApproval="pending"` (identity-approval pause, `domain/identity-approval.ts:12-40`) | **NOT a completed run**: `gate.opened("identity-approval")`, run stays open/parked — the legacy `done` here is a browser-release artifact, and lifting it as done loses an operator gate (review #10). `"dismissed"` → `gate.resolved("identity-approval","dismissed")` + `span.ended(run,"done", verdict:"dismissed")`; an approve re-queue is a new run (`retryOf`) that resolves the gate `"approved"` |
| `failed` + real step (`:493`) | `span.ended(run,"failed", error)`; reached step = the step (already closed failed by the pseudo-step row above) |
| `failed` + `step="cancelled"` / `"discarded"` (cancel sentinels, ISS-007) | `span.ended(run,"cancelled")` / `span.ended(run,"discarded")` — sentinel decoded at the seam |
| `failed` + `step="superseded"` (re-upload, `ocr/prepare.ts:309-332`) | `span.ended(run,"superseded")` — first-class outcome |
| `failed` + `step="approve-failed"` (approve dispatch failure) | `gate.resolved("approval","failed")` + `span.ended(run,"failed", error)` |
| `failed` + `step="ocr-prep-failed"` (oath-upload born-task failure, `prepare.ts:392-417`) | `span.ended(run,"failed", error)` |
| `skipped` row (`:377-380` — a per-STEP marker, not a run terminal) | `span.ended(task <step>, "skipped")`; the run continues |
| older non-terminal run + a newer run for the same itemId (read-time reclassification, `jsonl-core.ts:447-503`) | `span.ended(run,"interrupted")` — mirrored EXACTLY: only `pending`/`running` reclassify, only non-newest runs; reached step preserved (`step ?? "interrupted"`), no fabricated duration |
| SIGINT synchronous terminal (`failed`, lastStep, archetype re-stamp) | `span.ended(run,"failed"|"interrupted")` per the message; identity still from the pending row |
| `running` + `step="awaiting-approval"` **with** `parentRunId` (delegated OCR, `prep-rows.ts:29-41`) | `gate.opened("approval")`, statusKey `needsReview` |
| `running` + `step="awaiting-approval"` **without** `parentRunId` (standalone OCR — review #10) | `gate.opened("approval")` STILL opens (the run IS parked on the operator); only the projected status key differs (`in-review`, mirroring today's delegated-only `needsReview` scoping) — the gate is keyed on row state, not on delegation |
| `running` + `step="wait-approval"` / `"wait-signatures"` (oath-upload waits) | `gate.opened("await-approval")` / `gate.opened("await-signatures")` (§4.5 gates) |
| operation coordinator rows (display-only, stamped at prepare) & i9 `data.displayOnly==="true"` members | `run.queued { displayOnly: true }` (+ `span.ended` for the failed members) — **NO fabricated `run.claimed`, NO worker span** (review #9); actions project Hide only |
| session events | worker/browser spans keyed by (instance, pid) — the pid heuristics live here and ONLY here |
| data diffs on re-emits | `span.patched` (identity keys excluded — a legacy re-stamp folds into details, never identity) |
| anything else — invalid archetype or unknown status/step | **quarantine (§5.1), never throw, never a silent default** |

**Pinned by versioned real-tracker fixtures (D12):** a test corpus of copied real `.tracker`
days for every supported legacy schema version (plus seeded operation/preview/cross-midnight fixtures) replays through the lift asserting
**zero quarantines** and asserting the invariants above (every attempt's spans open/close exactly
once; no claimed/worker spans on display-only rows; tombstoned runs absent). An unstamped/unregistered
shape is quarantined visibly; the source-schema/version guard is what prevents shipping one knowingly.

### 5.3 Source authority — immutable per run

Every enqueue stamps `(engine:"legacy"|"native", cutoverGeneration)` in the authoritative run
record; the lift assigns the registered legacy generation to already-running tasks. All later
events inherit authority by `runId`, never by timestamp. Starting generation N+1 routes new runs
to native while the enumerated generation-N legacy run set drains normally. A duplicate event for
one run from the wrong engine quarantines; a legitimate late legacy terminal does not.

Cutover is transactional: increment generation, atomically switch enqueue routing, record the
legacy drain set, and reject new legacy enqueues. Rollback creates another generation; it never
rewrites an existing run. Cross-generation delegation still joins by runId/parentRunId/traceId.

### 5.4 The flip is SCOPED (D13), then per-workflow migration

Review #7 sized the wholesale flip honestly: ~103 endpoints across 23 route files, ~122
components, 5 SSE topics, 5 hard derived-state clusters — an unacceptable pre-Phase-2
mega-milestone that also strains "old system keeps working". So the flip covers the **four parity
surfaces only**:

1. **Phase 1:** build `temp_src/events` + projections + SQLite projector + new SSE server + lift
   adapter + the replay fixture (§5.2). All workflows are legacy; the new server renders
   everything via lift.
2. **Parity gate — queue rows + log panel/timeline + session cards + wfCounts, nothing more:**
   golden-payload tests serve the same fixture tracker dirs (including the real-day corpus)
   from both servers; those four surfaces are diffed field-by-field. The e2e stub lane
   (`HRAUTO_E2E_STUBS`) runs against the new dashboard.
3. **Flip:** `npm run dashboard` boots the new server + new SPA **for the four surfaces**.
   Everything else — **Capture, the Workflow Modifier, Settings, the AI-assist endpoints** (and
   the rest of the ~103-endpoint long tail: exports, screenshot/blob serving…) — is
   **proxied/re-mounted onto the old route handlers** inside the new server, each with its own
   later migration milestone. **Exception — OCR's review/approve mutation routes are NOT in the
   proxied long tail:** they are part of the OCR workflow's own scoped-flip surface set and
   migrate *with* the OCR workflow at master-plan order 3–4 (§5.3 / Phase 2+ per-workflow
   migration), exercising the native completion union + approval gates — not left proxied to the
   old `/api/ocr/approve-batch`. The old SPA stays runnable for one week **against a compatibility
   API projected from the unified native/lifted read model**. It does not read legacy files directly,
   so native runs remain visible during rollback. No native event is down-written to legacy storage.
4. **Phase 2+ (per-workflow migration):** each cutover increments the workflow generation; new
   runs switch to native spans while the registered legacy drain set continues through the lift. The dashboard cannot tell the
   difference — that is the definition of the seam holding.
5. **Deletion:** when the last workflow migrates, delete `lift-legacy.ts`, the legacy validators
   it imported, and the `rows|logs|sessions` readers; when the last proxied surface migrates,
   delete the old route handlers. A ratchet guard fails if `compat/` survives with zero legacy
   workflows registered.

**Honest milestone estimate:** the scoped flip is still the largest single pre-Phase-2 item —
the four surfaces are exactly the five-cluster derived-state core (queue collapse, status keying,
pipeline math, session attribution, counts) — but it is bounded by the lift mapping table (§5.2)
plus four wire shapes, not by 122 components; the proxied long tail migrates per-surface behind
its own milestones with no parity deadline coupling.

</details>

---

## 6. Adversarial self-review — how this rots, and the guard for each

| # | Rot vector | Mechanical guard |
|---|---|---|
| 1 | Per-component status/icon/label maps reappear (a new `STATUS_CONFIG` branching on workflow) | Architecture test: the rebuild repo's `src/dashboard` components may not contain `workflow ===` comparisons or workflow-id string literals (allowlist: the registry plumbing file only) |
| 2 | Client-side re-projection creeps back (someone recomputes status from spans in React) | Raw `SpanEvent`/`Note` types are not exported from the client lib; the SPA's server-types module exposes only `*Wire` types. Import-boundary guard fails on `src/events/types` imported under `dashboard/` |
| 3 | Silent projection fallbacks (`?? "running"`, catch→default) violating fail-loud | The `fail-loud-catch-default` + `nullish-literal-data-fallback` ratchets are ported into the rebuild repo and cover its `src/` from day one (charter: same quality umbrella). Projection code has zero allowlist entries |
| 4 | Re-stamp culture returns via `span.patched` clobbering identity | Projector folds patches into a `details` namespace only; identity attrs (`shape`, `subjectKind`, `parentRunId`, `traceId`, `itemId`) are read exclusively from `run.queued`. A patch carrying an identity key OR an undeclared detail key **throws at emit**. Unit-pinned |
| 5 | Undeclared vocabulary (ad-hoc gate names, step keys, verdicts, patch keys) | Emit-time validation against the descriptor (task name ∈ steps, gate ∈ gates, verdict ∈ verdicts, patch key ∈ details) — throws. Coverage test walks every descriptor and asserts the sets are non-empty where capabilities require them |
| 6 | A runtime crosses the isolation boundary and creates two sources of authority | Separate repos share no module graph, build, or process, so a legacy↔rebuild runtime edge is structurally impossible (D93 retires the D88 bidirectional-ban guards that policed it in one tree). What is still gated is the one-machine collision surface: state/artifact roots, ports, locks, and browser profiles/sessions are distinct, and cutover tests prove only one launcher accepts production work |
| 7 | Open spans leak on crash and show "running" forever | Projection derives `interrupted` for an open run span whose worker pid is dead AND a newer run for the same itemId started (mirrors `readRunsForId` exactly — pending/running only, non-newest only); worker liveness rides SQLite heartbeats as today. No fabricated durations |
| 8 | The completion union grows a fourth ad-hoc arm as an object literal side-channel | Programs constructible only via `defineFormSpec` (sealed brand, §4.2); spec-to-spec imports banned by guard; `extendFormSpec` is the sole composition path and re-validates. The two declared non-arms (oath-upload, verify — §4.5/§4.6) are pinned by tests asserting they have NO CompletionProgram |
| 9 | A one-time historical importer becomes a runtime compatibility adapter | dependency guards ban the importer from production composition roots; it accepts only an immutable backup + explicit version, records an idempotent import manifest, and leaves no route/proxy/reader registered |
| 10 | Notes stream abused as a data channel (parsing log text for state — today's forbidden pattern) | Notes are render-only in projections; any projection reading `note.message` content (vs. structured `fields`/`action`) fails a grep guard. Data that drives state must be a span event |
| 11 | A historical import silently drops unknown legacy records | One-time importer fixtures require source/result/quarantine counts to reconcile and render quarantines in the imported archive; import commits only with a signed-off manifest, never against live state |
| 12 | Resolved member trees creep back onto the wire (the 5-8k-field re-serialization) | `QueueSurfaceWire` has `memberRunIds: string[]` only — no recursive member field exists to populate; a type-level test pins that the wire type is non-recursive; the SSE tick test asserts a 100-member operation patch serializes one surface |
| 13 | Attempt discipline erodes (a re-pend reuses attempt 1 and re-opens closed spans) | The replay fixture asserts open/close-once per `(runId, attempt, spanPath)` across days containing real reassign/bump traffic; `run.requeued.nextAttempt` is emit-validated as monotonic |
| 14 | The `ledger/` dir gets pruned, or `write_intents` treated as a rebuildable projection (D21/D79/D86) | `.tracker-rebuild/ledger/` is exempt from cleanup; `write_intents` remains system-of-record; ordered actor-attributed ledger projection reconciles from atomic outboxes. Notes/spans are both 30d. Hash-chain/tail-anchor is explicitly deferred until multi-user |
| 15 | Cancel/deletion targets fall back to whatever roots the caller can currently see | command integration tests make SQLite authority unavailable/inconsistent and assert zero transitions; source scan bans caller-supplied root fallback in target resolution |
| 16 | Two active runs appear because active-run lookup failed and enqueue continued | transactional enqueue-policy tests inject lookup/constraint failures; every result is reject/no-op/one new generation, never two active generations |
| 17 | A dashboard retry races a newer state and mutates the wrong attempt | every action carries the observed version for audit; the idempotent command resolves the stable run from current authority and transactionally rejects an inapplicable state rather than mutating a caller-selected attempt. Version drift alone is not a Retry conflict |
| 18 | `state.db` corrupts and the app silently starts an empty authority store | boot corruption fixture must enter read-only degraded mode; restore-drill test proves a checksummed backup restores commands, dependencies, checkpoints, and write intents before claims resume |
| 19 | OS notification fails, so a critical unknown write is invisible | notification trigger and durable inbox commit in the authority transaction; delivery failure never clears or removes the unread inbox item, and no per-attempt delivery state is required |

---

## 7. Worked example — operation coordinator flow, end to end in spans

Operator uploads `Oath_Packet.pdf` targeting oath-signature (dry-run off, 2 signers on the paper).
Span ids shown in doc 02's path grammar; `attempt` omitted where 1.

```jsonc
// Abridged for readability. Checked fixtures are generated through RunQueuedSchema and include
// every required Base/envelope/config field; these snippets are not accepted as standalone events.
// spans/oath-signature-2026-07-17.jsonl        (coordinator — operation shape, file kind)
{"t":"run.queued","workflow":"oath-signature","runId":"R-op","spanPath":"os-141002-9f3e",
 "traceId":"os-141002-9f3e","itemId":"op-9f3e","shape":"operation","subjectKind":"file",
 "displayOnly":true,"input":{"pdfFileId":"F1","pdfOriginalName":"Oath_Packet.pdf"},"pid":88}
// display coordinator: NO run.claimed ever — it completes by member rollup (projection rule)

// spans/ocr-2026-07-17.jsonl                   (delegated OCR run under the coordinator)
{"t":"run.queued","workflow":"ocr","runId":"R-ocr","spanPath":"os-141002-11ab",
 "traceId":"os-141002-11ab","parentRunId":"R-op","itemId":"ocr-9f3e","shape":"preview",
 "subjectKind":"file","input":{"formType":"oath","pdfFileId":"F1"}}
{"t":"run.claimed","runId":"R-ocr","spanPath":"os-141002-11ab","workerId":"W-dash"}
{"t":"span.started","kind":"task","name":"render-pages","spanPath":"os-141002-11ab/render-pages#1"}
{"t":"span.ended","spanPath":"os-141002-11ab/render-pages#1","outcome":"done"}
{"t":"span.started","kind":"task","name":"ocr","spanPath":"os-141002-11ab/ocr#1"}
// per-page provider calls are NOTES (D10), not spans — notes/ocr-2026-07-17.jsonl:
//   {"spanPath":"os-141002-11ab/ocr#1","level":"step","message":"page 1 … 1 record",
//    "action":{"task":"ocr/extract-page","type":"ocr"},
//    "fields":[{"key":"page","value":"1"},{"key":"tier","value":"1"}]}
{"t":"span.ended","spanPath":"os-141002-11ab/ocr#1","outcome":"done"}
{"t":"span.started","kind":"task","name":"person-lookup","spanPath":"os-141002-11ab/person-lookup#1"}
{"t":"span.patched","spanPath":"os-141002-11ab","updates":[{"key":"records","value":[/* preview records v2 */]}]}
{"t":"span.ended","spanPath":"os-141002-11ab/person-lookup#1","outcome":"done"}
{"t":"gate.opened","spanPath":"os-141002-11ab","gate":"approval"}   // parked — NOT a fake "running" step
```

**Queue render now** (all server-projected): OCR panel shows one `preview` surface — title
`Oath_Packet.pdf` (file-kind dispatch), status `needsReview` (open approval gate → descriptor
`gates[approval].statusKey`), pipeline chips render-pages ✓ / ocr ✓ / person-lookup ✓ with real
span durations, Review tab present. oath-signature panel shows the `operation` surface for `R-op`
with `gates:[{gate:"approval",open:true}]` mirrored from its delegated child (projection join over
`parentRunId` — no denormalized `data.ocrStatus` copy to keep fresh) and the `links.review` jump.
The rail badge counts one surface per panel — same collapse algorithm, computed once, server-side.

Operator approves 2 records. The approve engine runs oath's `StagedFanOut` (record stage →
document stage); the launching coordinator is plain oath-signature, whose `completionConsumes`
suppresses `document` (§4.3), so only the record stage dispatches — with stable itemIds/runIds
from the durable manifest (§4.4):

```jsonc
{"t":"gate.resolved","spanPath":"os-141002-11ab","gate":"approval",
 "resolutionKey":"approved","resultRef":"gate-result:R-ocr:approval","resultHash":"sha256:…"}
{"t":"span.ended","spanPath":"os-141002-11ab","outcome":"done"}

// spans/oath-signature-2026-07-17.jsonl        (member fan-out — children of the COORDINATOR)
{"t":"run.queued","workflow":"oath-signature","runId":"R-m1","spanPath":"os-141002-c001",
 "traceId":"os-141002-c001","parentRunId":"R-op","itemId":"ocr-oath-rec-7b12a9",
 "shape":"operation-member","subjectKind":"person","input":{"employeeId":"12345678","name":"Lopez, Maria"}}
{"t":"run.queued","workflow":"oath-signature","runId":"R-m2", /* … rec-c84d31 … */}
{"t":"run.claimed","runId":"R-m1","spanPath":"os-141002-c001","workerId":"W-oath-1"}
{"t":"span.started","kind":"task","name":"navigation","spanPath":"os-141002-c001/navigation#1"} 
{"t":"span.ended","spanPath":"os-141002-c001","outcome":"done"}
{"t":"span.ended","spanPath":"os-141002-c9b2","outcome":"cancelled"}   // operator cancelled — a real outcome
```

**Queue render after:** the operation surface's members render inline (flat member surfaces
joined by `parentRunId`; the operation row itself carries only `memberRunIds` + `memberRollup` —
1 done · 1 cancelled, cancelled a first-class bucket, no `step==="cancelled"` decoding anywhere).
The coordinator completes to `done` when all members are terminal (`rollupOperationStatus` ported
into the projection). The coordinator's timeline shows its own notes ⊕ each member's
`run.claimed`/`span.ended` boundary events (selected by `parentRunId` — structurally, not via the
memberRunIds SQL widening workaround). Grep debug: `grep os-141002 .tracker-rebuild/spans/*.jsonl` returns
the operation's state history across all three files; `grep os-141002 .tracker-rebuild/notes/*.jsonl`
returns its log/action detail (§2.1 — two greps, by design).

---

## 8. Settled design questions and one volume monitor

1. **Notes retention & volume — RESOLVED (D86), no longer open.** Base retention is **decided**
   (§2.1): `notes/` and `spans/` both prune at **30 days**. The
   `ledger/` dir is **never pruned** and sits above both floors (doc 09 §6 depends on this settled
   number). Only the *volume* question—whether 30-day notes strain disk in practice—remains a
   monitor-and-revisit, not an open design decision.
2. ~~Worker-span ownership~~ — **resolved 2026-07-21; amended by D87 on 2026-07-30:** one worker
   span per workflow-scoped worker process, with worker-owned per-system browser/session child spans
   and linked run spans. A worker owns at most one active run; distinct workflows never share its
   authenticated sessions.
3. ~~Descriptor `verdicts` expressiveness~~ — **resolved 2026-07-21:** use a closed serializable
   `tag: { fromDetail, map }` rule interpreted exhaustively on the server/client projection. No
   pure-function escape is sent to the browser and no workflow-id switch is introduced.
4. ~~Historical-import quarantine operations~~ — **amended 2026-07-31:** an optional one-time
   importer emits visible redacted raw/reason records and reconciled counts; there is no Re-lift
   runtime action or “mark valid/done” shortcut.

*(Resolved since the first draft: SQLite's role — D14, §2.3; cross-repo runtime boundary + one
cutover — D88/D89/D93, §5. End of the design body; §9 carries the ratified presentation decisions.
Review order: §1.1 span identity → §4 completion union → §5 boundary/cutover → §6 guards → §9
decisions.)*

---

## 9. Ratified delegation and presentation decisions (**row-model** D6–D24)

Status: **ratified by the operator 2026-07-25.** These continue the **row-model decision series**
ratified 2026-07-24 (`reviews/second-look-2026-07-22.md` §6.6 — D1: three row types Run/Group/Member
with review-as-status and eight statuses; D2: a PDF upload is always a Group; D3: unrunnable items
are typed Rejected Member Rows, delete-only; D4: a delegated OCR run keeps its own Run Row in the
OCR panel plus a link from the parent; D5: groups default collapsed, auto-expand on a member
`Waiting on you` or `Failed`). **This series is not the reconciliation memo's D-numbers**
(`04-reconciliation.md` D1–D144) — cite these as *row-model D6…D24*, prefix mandatory. The
collision is real: this section's **row-model D22** shortens the status vocabulary, while the memo's
bare **D22** is an unrelated contract-shape/guards ownership split. `04-reconciliation.md` carries
the matching warning at its top; keep both in step.

D6–D17 close the twelve delegation questions in `reviews/delegation-layouts-2026-07-25.md` §7;
D18–D20 close three build-gating decisions in `reviews/demo-feature-plan-2026-07-25.md` §6. The
vocabulary is that ledger's: **`containment`** = `member | linked | rejected` (§3), Group Row anatomy
+ presentation ladder + rollup precedence (§4), delegation shapes S0–S7 (§5).

**Amended 2026-07-27 by the demo redesign** (`?view=rebuild-demo`, commits `1d656f76`..`a380406c`):
**D11** loses its 41+ status-matrix rung, **D19** moves Data off the tab set without changing one of
its semantics, and **D21** is added — the step timeline is equal-width. The as-built shell and
layout those waves settled are recorded at the end of this section; they are not separately
numbered, because none of them re-opens a question the D-series answered.

**Amended again 2026-07-28 by the redesign's later waves** (commits `d1530a1f`..`fa6c251c`):
row-model **D5** gains a close-on-settle arm, **D11** loses the rest of its ladder (one member
presentation at every count), **D12** is touched but not overridden, the gate banner that expressed
**D18**'s loudness principle at run-detail level is overridden (the decision moves inline into the
stream), **D19**(d) is re-amended (the `Edit & re-run` dialog is removed — editing happens in
place in the rail), **D20** is reinforced structurally, **D21** is extended (the wait renders on
the step's own bar; a queued run draws its shape), and **D22–D24** are new. Several of these
**reverse earlier operator-directed decisions**; each entry says so and records the reason, so a
future agent does not restore the old behaviour on principle.

### Row-model D5 — amended 2026-07-28: a settled group collapses shut

D5 (ratified 2026-07-24: groups default collapsed, auto-expand on a member `Waiting on you` or
`Failed`) gains the symmetric arm: **a group that settles collapses back shut**, and a settled row
stops re-explaining its own composition — the prose count line, the checked counter and the
member-name preview are all dropped on terminal rows. Attention rows and live rows keep
everything.

Rationale: the auto-expand exists because an open group is a demand; a group with nothing left to
demand holding the space of an open one is the same defect inverted. And a terminal row restating
its member count in prose beside the count strip that already shows it is the duplication D24
names — the row's expansion state and its explanatory chrome are both projections of settlement,
derived in one place (`visibleMemberIds` branches on settlement and nothing else), never authored
per fixture.

### D6 — oath-upload's signers are `linked`, not `member`; shape S4 is deleted

Oath Upload stays **one Run Row** for the PDF being uploaded. The signer rows live in the **Oath
Signature panel** as their own rows; the upload row carries a chip (`6 signers · 3 done ↗`) that
jumps there. Containment is **`linked`** — signers are never counted as members, never render nested
under the upload row, and are never removed from their own panel.

Rationale: a signer run is independently meaningful and independently viewable; the upload row's job
is the ticket, not the roster.

**Supersedes `reviews/delegation-layouts-2026-07-25.md` §7 Q1, which recommended the opposite**
(signers as `member`, delisted from the Oath Signature panel), **and deletes that ledger's §5 S4
layout ("Packet that ends in one filing")** — oath-upload is a Run Row that waits on linked children
and then performs its one final act. It has no Group Row anatomy, no member ladder, no member
rollup. This restores the as-built production model recorded in the root `CLAUDE.md` and in §4.5
here: the ticket is a real `single` daemon task born at upload that walks `OCR prep → awaiting
approval → wait signatures → submit` as one row. §4.5's sibling-subscriber gates and §4.3's
`completionConsumes: { memberShape: "natural", suppress: ["document"] }` are unchanged — the
presentation now matches the contract instead of contradicting it.

### D7 — a packet still at OCR review shows its extracted count

The count badge reads `6 people extracted` while the delegated OCR run is open, and flips to
`6 people` at fan-out. Rationale: "how big is this" is answerable before the members exist, and a
blank group before approval reads as broken.

### D8 — record approval exists only after the operator works through Review

Neither the packet Group Row nor the OCR row's Logs gate offers `Approve N of M`. Both route the
operator into the OCR **Review** surface, where every person is shown beside the scanned page they
were read from. The approval action exists only on that surface and remains disabled until the
operator has visited every record. `N of M` may still exclude records that genuinely cannot be
submitted, but it is never a shortcut around the review. Rationale: approval is the operator's
attestation that the extraction was checked against its source, so the source and the complete set
must have been presented before approval becomes possible.

### D9 — rejected members never count toward done

A packet carrying rejections is `Done with warnings` until every rejection is deleted or explicitly
acknowledged. Rejected members stay excluded from the rollup and counted separately
(`50 people · 3 rejected`). Rationale: an unrun person is not a finished person. This pins the
ledger §4 rollup rule to its ratified form — `Verified done` requires zero unacknowledged
rejections.

### D10 — depth-2 delegated lookups are visible only from the OCR review row

Person-lookup / i9-lookup children of a delegated OCR run surface on that OCR row (and in their own
panel, per row-model D4) — **never on the packet group**. From the packet, "why is this person
blank" is answered on the **record card**, not by walking a delegation tree. Rationale: maximum real
depth is 2; surfacing it twice buys nothing and doubles the count surface.

### D11 — one member presentation at every count; the density ladder is deleted

**Amended 2026-07-27, amended again 2026-07-28.** There is no ladder. A group's expanded body is
**one rung at every member count**: count strip → compact member lines in a capped scroll well →
`Open all N people` drill-in. The same shape at 3 people and at 50 — scale changes the container's
**overflow** and nothing else. Member count is continuous, presentation is never a row type, and
the drill-in is part of the one shape, not a route to a different one.

**What this replaces, in two stages — both reversals of ratified, operator-directed designs.**
The ratified-2026-07-25 D11 was a four-rung ladder (1–3 full inline Member Rows · 4–12 compact
list · 13–40 scroll well · **41+ status matrix** with a matrix-only attention strip). The
2026-07-27 amendment deleted the 41+ matrix: the operator saw the 50-member I-9 group render as a
grid of status cells where the 18-person work-study group renders named lines, read the matrix as
a *different kind of row*, and said *"we also don't need a new row type for i9 quarterly
retention"* while pointing at that work-study group. The 2026-07-28 amendment deleted the rest:
shown a 2-member group rendering full inline row cards beside a 6-member group rendering compact
lines, the operator said *"why are some like this and some like that? keep the design like above.
ditch the bottom design completely."* — so the 1–3 inline-card rung went the same way the matrix
did, and compact/well merged into the one surviving shape. Note the earlier amendment recorded the
operator confirming "4 is good" for the 1–3 / 4–12 boundary; **that ratification is spent** — the
later, more general instruction supersedes it, and it must not be quoted to restore the rung.

**The principle, which is why neither deletion may be undone piecemeal:** a second visual language
for *the same thing but more of it* makes the product read as having more concepts than it has —
the exact cost the three-row-type model exists to avoid. D14 already holds this from the other end
(a group of one still renders as a Group Row); the matrix broke it at 41+, the inline cards broke
it at 3. **`densityRung` / `DensityRung` / `DENSITY_RUNGS` were deleted, not reduced to a function
that ignores its argument** — a per-count switch that currently maps every count to the same rung
is a per-count switch waiting to grow rungs back. `PersonWell` + `PersonLine` make the one shape
mechanical rather than a convention two call sites keep.

**The two numbers behind the well.** `--ds-h-member-well` = **136px ≈ 5.67 rows**. The half-cut
sixth row IS the depth cue, which is why it is deliberately **not** 144px / 6 whole rows — a well
that ends on a clean row edge reads as a complete list, and the operator then has no reason to
scroll it. Members are ordered **attention-first**, so the top of the well IS the attention list
the 41+ rung used to draw as a separate strip.

**Nothing was lost.** The per-status information the matrix carried survives as the count strip's
status counts plus the separate waiting / rejected tallies (D9's `50 people · 3 rejected`); the
detail an inline card carried survives on the member's own drill-in and the group's People tab;
and `Open all N people` is still the route into the full member list at every size.

**Supersedes** the original D11 ladder in full, `reviews/delegation-layouts-2026-07-25.md` §4's
four-rung ladder and its "at 41+ the attention strip renders **above** the matrix" rule, and the
2026-07-27 three-rung amendment this entry previously recorded.

### D12 — the collapsed row shows the gate's age

`Waiting on you · 10m`. Rationale: an aging gate is the most actionable fact in the queue.

**Touched 2026-07-28, not overridden.** On the run detail the gate's age now renders in three
places — the panel header's status pill (`Waiting on you · 33m 50s`), the inline decision in the
log stream, and the corner notice that appears while the decision is scrolled out of view (see the
D18 amendment). **The queue row's gate age is unchanged** — this entry's contract stands as
ratified.

### D13 — a failed `linked` child makes the parent `Failed`, with `Re-upload`

When a linked OCR child fails, the parent goes **`Failed`**, mirrors the child's error verbatim
(never "Unknown error"), and offers a **`Re-upload`** action. **`Waiting on you` is reserved for a
pending decision and is never used for a breakage.** Rationale: the two states demand different
operator actions, and a breakage disguised as a decision is a gate that will never resolve.

### D14 — a group of one still renders as a Group Row

Consistent with row-model D2. Rationale: a group of one that looks like a Run Row makes the next
fan-out look like a new object.

### D15 — Person Lookup carries Search and Match as modes

Person Lookup owns one Workflow Panel entry and one queue surface. **Search** asks Person
Organizational Summary for identity/employment status by EID or name; **Match** asks HR-Tasks
Search/Match whether UCPath already knows a legal-name + DOB/SSN identity. The operator chooses
the question at start time, like choosing an OCR form spec, rather than navigating to a second
workflow identity for the same person-check domain.

This supersedes the earlier D15 decision to keep a standalone `person-match` entry and
`reviews/delegation-layouts-2026-07-25.md` §7 Q10's recommendation to hide that entry. The two
UCPath surfaces remain distinct; only their workflow/panel identity is unified.

### D16 — cancelling a group is tree-scoped, final, with no dialog and no undo

The only scope is the **tree** — group + all members + linked children. There is **no confirmation
dialog and no undo window**; cancel commits immediately. Recovery is re-running from the row's
history.

**Tradeoff, stated plainly: this deliberately accepts misclick risk to avoid a dialog on every
intentional cancel.** Cancel is used deliberately and often; a confirm on each one costs more than
the occasional re-run.

**Supersedes the "with a confirm naming the casualties" half of `reviews/delegation-layouts-2026-07-25.md`
§7 Q11**; the tree-scope half is ratified as recommended. Mechanically this is §2.4's `Cancel`
semantics unchanged — full dependency tree resolved from SQLite authority, every edge's doc 02
cancel policy applied, all-or-none, visible queue roots never an authority fallback. What D16
decides is scope and the absence of ceremony, not a new command.

### D17 — per-member confirmation numbers are inline on the packet receipt

Listed inline in the Receipt rollup table, not one link per member. Rationale: the Q8 acceptance
test is "the operator completes their double-check without opening UCPath", and a link per member
re-introduces N clicks.

### D18 — Status Bar pills: `All`, a composite `Needs you`, then the individual statuses

One row: an **`All`** pill, then a composite **`Needs you`** pill (= `Waiting on you` +
`Write parked` — the two statuses that mean a human is blocking), then each individual status.
**No status is hidden.** Rationale: the bar answers "is anything on me?" first and "what is
everything doing?" second. Counts are the same server-side projection that feeds `wfCounts` and the
queue rows (§2.2); the composite pill is a sum of projected buckets, never a second count path.

**Amended 2026-07-28 — the gate banner this loudness principle produced is overridden.** The pill
model above is untouched. What is overridden is the run-detail expression of "the decision is the
loudest thing": the **tall gate banner above the tabs** (ratified as-built through D19 and pinned
in this section's shell notes as "the gate banner … never moves into the rail") is **deleted**.
The decision now lives **inline in the log stream at the point it was reached** (`InlineDecision` —
title, age, note, candidates, staged writes, both park resolutions); the panel header keeps a
**one-line state plus its action**; and a small **dismissable notice** in the panel's corner
(`DecisionNotice`) appears only while a decision is outstanding **and not visible** (an
IntersectionObserver on the decision's anchor; dismissal is per row+tab and re-arms on either
change, so a dismissed reminder can never become an unreachable decision).

**Why this is not a loss of loudness, stated so the banner is not restored on principle:** the
decision was being rendered **twice** — the banner above the tabs and, at the moment it occurred,
the same title, the same copy and the same buttons inline in the stream. Removing the banner
removed a **duplicate**, not information. Verified on both the write-parked and identity-approval
runs before the deletion. Two bands saying the same thing is how a dense panel teaches an operator
to skim past both — the duplication was itself the defect.

Recorded with it, because they close the same "can the record hide?" question: a **failed run now
opens on Logs** rather than Review (`defaultTabFor` puts logs ahead of every other default), so
the failure record cannot hide behind a tab; and the failure's **write-state sentence** ("what
this run left behind" — the difference between a safe retry and a duplicate termination) renders
**unconditionally in the stream, never behind a disclosure**. Only diagnosis (progress ledger,
cause chain, fingerprint) may sit behind a disclosure.

### D19 — run-detail tabs derive from panel kind; screenshot evidence lives in Receipt; Data lives in Context

Ratifies the tab model **as built in the rebuild demo**:

- **(a) Tabs derive from the panel kind**, not a fixed set. **Amended 2026-07-27:** the sets are
  **Run 2 · Review 3 · Group 3 · Member 2** — `Logs · Review · Receipt`, plus `People` on a group —
  where they were Run 3 · Review 4 · Group 4 · Member 3.
- **(b) Screenshots is not a tab.** Captures are evidence and render inside the Receipt tab,
  beside the outcome they qualify. This applies to both a full `RunEvidenceReceipt` and the honest
  short receipt shown before a full receipt exists.
- **(c) Data and Edit Data are ONE merged surface** — every value the run touched. Reads are editable
  in place; **writes are shown but not editable**; the footer offers `Load a prior run` and
  `Start a run from this data`.
- **(d) Amended 2026-07-27, re-amended 2026-07-28 — Data is not a tab, and not a dialog either.**
  It is a section of the run's **context rail**, edited **in place**. The separate `Edit & re-run`
  Dialog that briefly carried the editing half was introduced and then **removed at operator
  instruction** (*"we also need the edit data and data tab to be together so i can have a feel of
  how its like to edit the data"*); the rail section **widens** while editing
  (`--ds-w-context-rail-wide`, 520px) instead of opening a modal. `DemoTab` and `tabsFor` drop
  `"data"` entirely, so no dead tab id is reachable. The panel tab list derives from `tabsFor`,
  while `detailSurfaces` separately carries the `data` capability for the Context rail section.

**(c) is preserved byte-for-byte by (d), through both amendments.** Reads stay editable, writes
stay shown and never editable, staged writes still render as staged, unconfirmed still says
unconfirmed, nothing gains success styling it has not earned, and the `Load a prior run` /
`Start a run from this data` footer survives intact. The unlock rules (`editPolicyFor` with the
reason always shown), the CAS on the checkpoint generation, and the audited freshness override all
carry over into the rail section unchanged (the freshness *confirm* stays a dialog — it is a
question with a typed answer and two mutually exclusive exits, which is what a dialog is for).
**Only the home changed** — the ledger is read AND corrected in one place, because the operator's
stated need was to *feel* the editing in the context of the data, not to be handed a task surface.
Gating is still `actions[]` descriptors at the `data` placement, so a run that may not be edited
is simply not sent a Save.

**As-built (2i-C, 2026-08-08, D168) — the rail's Data section is wired end-to-end for reads.**
`editPolicyFor` exists in `src/dashboard/surfaces/context-rail.tsx` and composes three policies,
each carrying its own sentence onto the lock: the entry's field policy and the run-level policy
arrive ON the `context-data` wire (doc 06 §6.4.1 owns that shape), and the live staleness signal
is `liveLockReasonOf` over the day stream's queue-row status — there is still no per-run SSE
client, and the queue row flipping out of `queued`/`awaiting-approval` is the same "this run was
claimed while you were editing" fact, with the kernel's CAS as the authority either way. Editing
enters on FOCUS of a value box; the rail widens to `--ds-w-context-rail-wide` through the log
panel's grid (its first consumer), and Save issues one `run/edit-checkpoint` command whose applied
result refetches the detail at the bumped `rowRevision` (which re-fetches every section through
the same revision). A staged correction renders beside the recorded value it will supersede —
"staged renders as staged" applied to corrections. Two (c) arms are NOT yet built and stay open:
the `Load a prior run` / `Start a run from this data` footer, and `actions[]` gating at the
`data` placement (the served-actions projection is still empty; the wire's `editing` union
carries the gate until it lands).

**Why the move.** Logs and Data were mutually exclusive tabs, so the operator could not watch a
run's log stream and see what that run read and wrote at the same time. That mutual exclusion was a
significant part of the reported clutter — the panel appeared to hold more than it did because
half of what it held was behind the other half. The split is by **reading pattern**, not by
importance: live state (what the run is doing, what it needs from you) stays in the centre column,
reference data (what it read and wrote, who asked for it) moves to the rail. Screenshot evidence
moves to Receipt, beside the outcome it qualifies. Nothing is deleted and nothing hides behind a
hover.

**(b) is now honoured by putting the proof with the verdict.** D19b said Screenshots is not a tab;
captures first moved from a 52px strip into Context, but that still separated evidence from the
receipt it qualifies. The Receipt tab now owns the real capture tiles — kind, label, workflow step,
and clock — under both full and short receipt states. The failure capture keeps its red frame in the
tile and lightbox; the filter chips and Export menu carry over unchanged.

**Supersedes the "Log Panel tabs are therefore FIVE: Logs / Data / Review / Receipt / Screenshots"
wording in `reviews/second-look-2026-07-22.md` §6.6.** Unchanged from that decision sheet: the step
timeline is **not** a tab (persistent strip + hover detail — see D21 for its width rule), and tab
defaults stay state-driven (`Waiting on you` / `Write parked` → Review, terminal → Receipt, running
→ Logs; a group with a member needing attention → People).

Consequence for §2.2's wire: `QueueSurfaceWire.detailSurfaces` stays server-declared and
capability-driven — the panel kind selects from what the server declares — but `"screenshots"` no
longer projects a tab (it projects capture evidence inside Receipt), and `"edit-data"` / `"view-data"`
collapse into one `data` surface — which, as of (d), projects a **rail section edited in place**,
not a tab and not a dialog, with its write fields still rendering read-only.

### D20 — `Write parked` means an unknown write outcome, and nothing else

`Write parked` is only for a write whose outcome is genuinely **UNKNOWN**, and it has exactly two
typed resolutions: **confirmed-present** and **confirmed-absent** (§2.2's `resolve-write-present` /
`resolve-write-absent` over doc 09's durable intent state). **A pre-submit hold is NOT parked — it
is a gate, and its status is `Waiting on you`.**

Consequence: the rebuild demo's `sep-rosa` fixture, which labels a pre-submit hold as `Write parked`
with a "Resume & submit" action, is wrong and must be re-authored as a gate. Rationale: parked is the
one status that means "we may have already filed something"; diluting it with holds we know the
state of destroys the only signal that warrants a live probe.

**Reinforced 2026-07-28 — a parked row is structurally sent no data-mutating command.** The prior
action policy offered `rerun-with-existing-data` ("Start a run from this data") on a parked row —
i.e. a fresh run seeded from a write whose outcome is unknown, which is exactly the
duplicate-termination path this decision exists to prevent. `deriveActions` now sends a parked row
**no** `data`-placement command at all; its only exits remain the two typed park resolutions.
Because every control is derived from the served `actions[]`, the hazardous command is
unreachable, not merely hidden.

### D21 — every step segment on the timeline is the same width; the duration is printed

**Ratified 2026-07-27.** The step timeline (D19's persistent strip, not a tab) draws **equal-width
segments regardless of duration**. Each segment prints its duration as a label beneath it, and the
working / waiting totals sit on the axis below. The **gate/wait segment is hatched and equal-width
like every other**, with the **TRUE age printed as text** beside it. The `×N` retry marker and its
hover-card row carry over, as does the dashed treatment for a step the run has not reached.

**This reverses a prior operator-directed design.** The timeline was **proportional** — segment
width ∝ elapsed time — chosen deliberately on the grounds that the width WAS the data, and later
hardened by clamping the gate wedge to ≤1.5× the step total while printing the real age beside it.
Both the proportional maths and the clamp are gone: `MIN_SLOT_SEC`, `slot()`, `stepTotal`,
`gateSlot`/`gateClamped`, the per-step inline width and the wedge clamp were all removed.

**Why the reversal.** A genuinely proportional 34-minute gate beside three minutes of work is a
true 91% of the track, and at 91% the step labels crush to `3.¹2 4..`. A timeline whose labels
cannot be read tells you nothing about where the time went either — the literal encoding destroyed
the thing it was encoding. Equal widths make the track legible at every duration spread, including
the ones this product actually produces (a gate is usually an order of magnitude longer than the
work around it, so the pathological case is the common case).

**Why this is NOT a no-fabrication violation, stated so a future agent does not "restore honesty".**
Equal widths **make no claim about duration**, precisely BECAUSE the duration is printed as a
number beside every single segment and the totals are on the axis. Nothing implies a length it does
not also state in words. The no-fabrication rule forbids *inventing* a number or drawing a quantity
the data does not support; it does not require that every visual dimension be a data channel. A
bar chart that clamps a bar while printing the real value is a standard convention; inventing the
value was the bug the clamp era fixed, and that fix (`now − gate.openedAt`, never `max(active, 90)`)
is retained here in full.

**This is an explicit legibility-over-literalism call the operator made**, verbatim: *"all the
timeline elements should have equal sizes doesnt matter the time."* **A future agent must not
restore proportional widths on no-fabrication grounds.** If proportionality is ever wanted again it
needs a fresh operator decision, not a correctness argument — the correctness argument has been
made and answered.

**Extended 2026-07-28** — two further moves, superseding this entry's "gate/wait segment" and
"dashed treatment" wording above:

- **The waiting state renders on the current step's own bar** — hatched, with the true elapsed age
  printed beneath it — rather than as a separate trailing gate segment. A wait is a **state of a
  step**, not a step of its own: the old trailing segment meant `Your review` occupied two of six
  slots and read as two separate things, one of them apparently finished, and deleting it gave the
  track a sixth of its width back. "Working" and "waiting on you" are told apart by the bar's
  fill, not by a slot count. Fail-safe kept deliberately: a gate whose run records no waiting step
  still draws the old trailing segment — a true fact is never dropped because the shape did not
  line up.
- **A queued run draws every segment outlined and empty**, so the track states the run's *shape*
  before it starts. The old dashed hairlines read as one dashed rule across the panel with labels
  floating over it — the surface that exists to say what a run will do said nothing until it
  started, which is an information defect, not a visual one. The outline is **continuous, not
  dashed**: the dash is spoken for (`Write parked` is the one thing in this product that dashes,
  and nothing else may borrow the cue).

The track therefore has exactly **three legible states**: **outlined-empty** (not reached) ·
**solid** (done, or being worked now) · **hatched** (the run is stopped here, on you).

### D22 — the status vocabulary shortens: `Verified done` renders as `Done`

**Ratified 2026-07-28. AMENDED 2026-08-04 (D126) — read the amendment, not the original ground.**
The quietest status renders as a green **`Done`** with **no icon** on the pill. The qualifier was
doing two jobs badly: it made the quietest status the longest label in the vocabulary, and beside
`Done with warnings` it asked the operator to work out whether *that* one was verified too. The
pill is green rather than muted (a muted `Done` beside a muted `Cancelled` is two greys).

**What the amendment replaces.** As first ratified, D22 rested on two claims that a later operator
direction and the live exit run each falsified, and both are hereby superseded:

1. *"The sibling deliberately did not shorten, because the qualifier IS the difference between
   them."* **No longer true.** The operator subsequently directed that `doneWarnings` also render
   the bare word `Done` — `Done with warnings` shoved the run title off the row header, beside a
   count chip that already named the warning. Both terminal dones now draw the same word, on
   purpose, at the operator's direction.
2. *"Safe, because the word remains: this is not colour-only encoding."* **The word can no longer
   carry it**, so the justification is restated: the two are separated **by ICON + COLOUR**, not by
   the visible word. `doneWarnings` draws an amber warning triangle carrying its warning count
   beside an amber-tinted pill; `verifiedDone` draws the bare word on a solid green fill. Two
   visible non-textual channels plus the count, not hue alone. The operator inspected this pair and
   ratified it as-is on 2026-08-04; **the visible design is settled and is not to be relitigated.**

**And a third channel that is not visible at all:** because the drawn word stopped distinguishing
them, the two statuses must carry **distinct ACCESSIBLE names** — an assistive technology reads
neither the tint nor the triangle. `doneWarnings` announces `Done with warnings`; `verifiedDone`
announces `Done`. That is the mechanism (`accessibleLabel` / `dsStatusAccessibleName`) specified in
this doc's *Phase 1g/1i-spine as-built presentation deltas*, and it is what makes the amended D22
honest where the original relied on the word. **Never satisfy this by lengthening the drawn label.**

**The guarantee is structural, not textual, and the shortening must not be read as a weakening:**
the verdict is still reachable **only via read-back** (doc 12's completion contract), and the
receipt still shows its read-back checks — only the *label* shortens. The wire/status key stays
`verified-done`, and `done-with-warnings` stays its own key.

**Reconciliation debt, recorded rather than silently fixed:**
`docs/rebuild/12-operator-trust-and-authoring.md:284` and this doc's D9 (…"`Verified done`
requires zero unacknowledged rejections") still use the long label. They describe the same verdict
under its pre-D22 name and need reconciling when next touched — the semantics they state are
unchanged.

### D23 — the motion rule is narrowed on purpose

**Ratified 2026-07-28.** From *never animate status changes* to **never animate ambient status
churn; a run that starts needing you may announce itself** — once, on the edge.

**The reasoning, so the narrower form is applied and not merely quoted:** a dashboard where
everything that updates also moves is unreadable exactly when it is busiest, and this one updates
constantly. So elapsed timers, incrementing counts, background settling and self-initiated
re-sorts stay **still** — if all of that moved, movement would be unavailable for the one thing
that needs it. But the two states allowed to shout (`Waiting on you`, `Failed`) mark the moment a
run stops being background and becomes work, and that is precisely the moment the operator is
looking somewhere else; a row that turns amber silently between glances is a row that gets found
late.

**Four constraints keep the exception from becoming a licence:** (1) **edge, never state** — it
fires on the *transition into* an attention status; a row already waiting when scrolled to does
nothing; (2) **never on mount** — first sight of a row is not a change; (3) **once, then still**
(`ATTENTION_ANNOUNCE_MS`) — nothing pulses, repeats, or waits to be acknowledged; (4) **only the
two loud statuses** — reaching for this on a third status is the drift, and the answer is no.
Implemented once (`useAttentionAnnounce`); never re-derive it at a second call site. **The
narrower form must not become a licence** — this entry is authority for exactly the attention edge
and nothing more.

### D24 — a professional dashboard does not explain itself

**Ratified 2026-07-28.** Explanatory prose on a surface is a **defect** unless it lives inside an
**ⓘ** (a click-to-open Popover — reachable by pointer, touch and keyboard, costing the surface
nothing until asked for). Two exemptions, and only two, because neither is explanation: a
**refusal**, which must state what was *not* done and why or the operator cannot act on it; and a
genuine **hazard** about the run in front of you (a stale checkpoint, a staged write, an
unresolved park) — those are outcomes, not teaching.

**The test:** a sentence on a surface must be a fact about the RUN in front of you. A sentence
that would be equally true of every run in the product is a rule of the product, and a rule of the
product is not information — it is teaching, and it costs the same pixels every time it is drawn
whether or not anyone needed it. Operator, verbatim: *"i feel like the dashboard right now is
bloated with extra information like explanations and descriptions that we dont need."*

This decision drove the removal of dozens of strings (control descriptions restating the
control's label, captions repeating icons, the UI describing its own mechanics, the product
asserting its own correctness) and the relocation of the rest into ⓘs. An **empty state** still
owes three things and no more: what would be here, why it is not, and what to do — it does not owe
a defence of the design. The full deletion criteria live in the demo's `DESIGN.md` ("The product
does not explain itself"), which is binding on every surface built against this contract.

---

### Shell and layout as rebuilt (2026-07-27, updated 2026-07-28)

Not numbered — none of this re-opens a D-series question, and the D-series is for decisions that
were *asked*. It is recorded here because the presentation decisions above (D11, D18–D21) were
made inside this layout and read wrong outside it.

**The detail region is three columns**: **queue · centre · context rail**. The rail is **348px**
(`--ds-w-context-rail`), collapsible to a labelled spine that says what is inside it
(`Context · 9 data · 6 captures`), with the collapsed preference applied only above the
three-column threshold. The split is by reading pattern (§D19): **live state in the centre** — the
run header, the timeline, the tabs and the tab body, with the log stream carrying the inline
decision and the failure record (D18 amendment) — and **reference in the rail**: Data, Evidence,
provenance and delegation links. **A decision and a failure never sit behind a collapse control or
a lone tab** — `Waiting on you` and `Failed` are the only two states allowed to shout. As of
2026-07-28 that invariant is honoured by the inline decision + one-line header state + corner
notice (not by a banner, which is deleted — see D18), by a failed run opening on Logs, and by the
write-state sentence rendering unconditionally in the stream.

**Measured effect of the split, at 1280×720:** chrome above the panels **190px → 117px**; each
panel **469px → 542px** tall; the tab body **123–215px → 213–335px**.

**Two breakpoints, and the panel region is a GRID (D195):**

| Width | Layout |
|---|---|
| **< 1180** | one scrolling stack — shape, then detail, then context. The rail degrades to a section, never to nothing. |
| **≥ 1180** | queue **`--ds-w-side-panel` (376px)**, a fixed track, + a detail cell taking `minmax(0,1fr)`. The detail cell splits itself again into shape · detail · context at 1280. |

**The queue and the context rail share ONE resting width**, and neither side panel grows
independently at wider viewports, so the centre stays the largest column at every size. 376 is 28px
wider than the former 348px rail and narrower than either former queue width — which is exactly what
buys the centre back the room the 400/470 analysis was fighting over. The visual oracle moved first
(doc 13 §1; the demo's own panel region, legacy
`hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc` `RebuildDemo.tsx:747-748`) and this table
had not followed.

**Grid, not flex, is normative here — it is what makes the empty case impossible.** The region was
authored as two `flex-1` children. `flex-1` distributes free space only among children that EXIST,
so with no run open the second child was not rendered, nothing claimed the space, and the queue
panel — a flex item with no width — shrank to its content. At 1440×900 that left a ~470px column of
rows and **~950px of empty black** in the middle of the surface this product is named after, at
every viewport since 1i-spine, through a dozen green gates and a frozen reference corpus that
photographed it. A grid cannot fail that way: its tracks exist whether or not anything is placed in
them. And **nothing selected is a STATE** — `No run open`, owing §9's three things and no more — not
an absent element.

The superseded numbers, kept because they remain the record of what was tried and why:

> **1180–1479** queue **400px**; **≥ 1480** queue **470px**, both measured rather than chosen.
> 1480 = 470 queue + 348 rail + gaps + padding, leaving the centre ~590px — the width at which a
> six-segment equal-width timeline still prints readable labels. 400 was the largest queue that kept
> the review's page-beside-fields layout side by side below 1480: the review's floor is a **464px
> centre** (label + value + provenance chip + confidence on one line) and centre = 884 − queue at
> 1280, so 470 gave 414 and stacked it. The cost was stated rather than hidden: at 1280 no queue
> width satisfied both — a queue that renders `Oath_Packet_Summer.pdf` whole needs ~475px, which
> puts the centre back under the review's floor. **One shared 376px resolves that trade by refusing
> to spend the width on either side panel.**

**A consequence worth pinning: inside the detail region, a layout switch keys on the COLUMN, not
the window.** The same 1280px viewport gives the centre 414px with the rail open and 728px with it
collapsed, so a viewport media query fires at the wrong moment in both directions. Container
queries, not `min-[Npx]:`, for anything inside the region. (Caught in the act: the two `Write
parked` resolutions were being forced side by side into a 414px column, each a ~200px box holding a
two-line sentence about whether a real UCPath termination exists.)

**The Workflow Panel has three modes**, persisted, cycled with `w`: **floating** (default — a
window over the panel region, costing no column; Escape or an outside click dismisses it to
`icon`), **icon** (nothing drawn over the content; the launcher carries the current workflow's
2-char code and the day's whole `Needs you` count across *every* panel), and **sidebar** (docked,
200px, always visible). Which panel you are in stays readable in all three because the Queue Panel
is titled by its workflow.

**`All workflows` is retired, and rail grouping is the descriptor's own `category`.** The
cross-panel rail entry, `ALL_WORKFLOWS`, is deleted; `rowsForWorkflow` always filters and the app
opens on a real panel (`DEFAULT_WORKFLOW`, read from the registry so a rename cannot point it at
nothing). An operator works one workflow at a time, and a queue mixing fourteen workflows forced
every row title to carry a workflow label to stay legible — which is the same redundancy that made
the per-row workflow chip worth deleting. Grouping in the panel comes from **each descriptor's own
`category`** (the eight real categories the registry serves), never a frontend list: the frontend
hardcodes only the display order, membership is the descriptor's, an unlisted category appends,
and an empty category drops. §10.1's one counting path (`countRows`) is untouched by all of this.

**A chunk harness is a step of its composition, never a peer workflow (D219, 2026-08-14).** The
operator's ruling — *"kuali finalization is a step in the separation workflow, not another workflow
itself"* — lands as ONE membership-aware rule in the same grouping module the category rule already
lives in (`dashboard/surfaces/workflow-category.ts`): inside its category group, an entry whose
served `role` is `chunk-harness` renders **nested and visually subordinate under its composition's
entry**, marked as a proving harness, and never as a sibling. The nested entries stay **always
visible** — a collapse-by-default disclosure would need an attention-forwarding rule so a hidden
harness's `Needs you` could not vanish, and visible-but-subordinate hides nothing and needs no such
rule. Every workflow-listing surface renders through the one rule — the Workflow Panel rail, the
Run Modal picker (its startable AND its "not startable" lists alike), and the Explorer — so no two
surfaces can disagree about what is a step and what is a workflow. Four consequences are decided
here rather than re-litigated per surface:

- **The wire serves the raw fact, display stays the frontend's** (the standing R2 D17/D18 split):
  the bootstrap workflow primitive gains a REQUIRED closed `role`
  (`standalone` / `composition` / `chunk-harness` + `of`), the schema refuses an `of` that does not
  name a served composition, and the module-side fact it projects is doc 02 §1.2.1's.
- **Counts do not roll up.** §10.1 already decides this: a badge beside an entry counts exactly the
  rows that entry's panel shows, and folding harness runs into the composition's badge would make
  the badge disagree with its own queue panel — D81's divergence class manufactured deliberately.
  Historical harness runs (the proving days') stay under the harness's own nested entry; the day's
  cross-panel `Needs you` total already contains every panel.
- **Run rows keep the harness's own label** on every surface (queue, activity, notifications) — the
  nested rail entry still names the harness, so a row titled by it stays legible — and archived
  rows' frozen labels are untouched (D179).
- **Startability does not move.** Chunks stay registered and independently runnable through the
  start-plan lane (each still owes/holds its own §3.2 controlled-commit proof); no doc 07 exit
  criterion names rail presence. Today all six separations entries declare `surfaces: {}`, so the
  picker lists them only under "not startable" — the nesting applies to whatever list a surface
  renders, not to what is in it.

**Amended same day (D220, 2026-08-14): the RAIL lists main workflows only.** On seeing the nested
presentation live, the operator ruled the harnesses "not needed at all — only the main workflows
should be there," and asked the same of `kuali-timekeeper-annotation`, which D219's model could
only call `standalone` (it proves the kernel, not a composition — doc 02 §1.2.1's new `proving`
arm is the fact that names this). So the Workflow Panel rail drops every entry whose role is
`chunk-harness` or `proving` — nested or top-level, the cross-category `separations-kronos-timecard`
included — and a category whose entries all dropped goes with them rather than rendering an empty
heading (`buildWorkflowRailGroups`, `dashboard/surfaces/shell.tsx`). D219's one-rule claim narrows
to the surfaces that still list them: the Run Modal picker (both lists) and the Explorer keep the
nested, harness-marked presentation, so proving work stays startable and documented. The
always-visible-nesting rationale (a hidden harness's `Needs you` must not vanish) is answered at
the rail's level instead: attention reaches the operator through the Status Bar's cross-panel
`Needs you` total and the notification inbox, neither of which is rail-scoped. Counts, labels,
registration and §3.2 obligations are all unmoved from D219.

**One composed action bar** replaces the two stacked bars above the queue. The status filters are
one *group* inside it, not a band of their own; the two composites (`All` / `Needs you`) are a
segmented control — a different shape for a different kind of thing — and a **zero-count status
pill recedes**: it drops its border, its fill and its label down to an icon and a faint `0`,
keeping its slot, its click target and its full accessible name (`Done with warnings` is 130px of
bar at rest; at zero it is 34px). The **collapsed launcher shows the attention count only**, with
its scope stated in its accessible name: a rule separates the current panel's code from the count,
and the count carries the `Needs you` composite's own eye glyph — the same one the Status Bar pill
wears — because the number is the day's whole `Needs you` across *every* panel, which is the point
of a control that is on screen when no per-workflow badge is.

**Row commands moved to a right-click context menu** (`ContextMenu`, opened by the platform's
Menu / Shift+F10 key and by `m` through `openContextMenuFor()`); the per-row `⋯` overflow button is
gone — a control whose only job is to admit there are more controls, costing a slot on every row.
The menu's items come from the object's served `actions[]` at the `menu` placement, so a command
the surface did not send is unreachable rather than hidden.

**One scrolling region per panel.** A panel's scroll track runs the panel's full height; a header,
an outcome line or a tab bar that must stay put is a *sticky* block inside the one region, never a
band stacked outside it that leaves the track a mid-panel segment. Queue rows are fixed at
`--ds-h-row` — no surface invents a row height.

**The catalog derives its tab lists from the panel's own source.** The row-and-panel catalog's
per-kind tab lists are computed from `tabsForPanelKind` — the same function the panel itself
calls — so the catalog can never again describe a tab set the panel does not render.

---

## 10. Round-8 obligations this doc owns (2026-07-26)

Four operator ratifications from 2026-07-24 land here. Each is stated as a contract, not a
preference, because each has a guard.

### 10.1 ONE projection owns every count (D81)

**The recorded bug.** The operator reports that in the legacy dashboard the per-workflow badges
"always error out" — matching the audit's bug class #7, count/badge divergence, with ≥4 separate
fixes over the project's life. The root cause is structural, not arithmetic: badges, the status
strip, and the queue list were each free to derive their own counts, so any two could disagree and
each had to be fixed independently.

**The contract.** There is exactly **one** server-side run/queue projection. **Workflow Panel
badges, Status Bar pills, and Queue Panel rows are three renderings of that one payload.** A count
is never computed a second time — not in React, not in a second endpoint, not in a "just for the
badge" aggregate. If a surface needs a number the projection does not yet expose, the projection
gains a field; it does not gain a sibling.

Consequences that follow and must not be re-litigated per surface: **collapse rules, hidden rows,
archived runs (§10.2), and delegated-member containment are applied once, inside the projection.**
**The Activity report (D180) is a range rendering of this same payload**, built inside the
projection for the same reason: a report that summed rows a second way could disagree with the day
it summarises. Its contract lives in doc 13 §6.7.
A member counted in a group is not also counted at top level because there is no second place that
could count it.

**Guard (doc 10).** `one-projection-counts` — any count/aggregate in a surface path that does not
originate from the projection payload fails. Backed by a fixture asserting Workflow Panel total,
Status Bar sum, and rendered Queue Row count are equal by construction for a seeded world that
includes hidden, archived, delegated, and rejected rows. *(The `?view=rebuild-demo` replica already
proves this shape: one `countRows()` feeds rail badges, Status Bar, and queue — divergence is
structurally unrepresentable there.)*

### 10.2 Versioning and archive-on-version-bump (D80)

**No archive folders, no compat shims — git is the archive.** Descriptors carry a version + content
fingerprint; a guard forces a bump on behavior change; **every run permanently stamps the workflow
version and the app version it ran with, at enqueue.**

**On a version bump, all runs of prior versions leave the dashboard.** Active surfaces, counts, and
filters only ever contain current-version runs; prior runs move to a read-only **Archive** (a
browsable view + on-disk store). A **dashboard/app update bumps the effective version of every
workflow**, because old runs may not be interpretable against new dashboard state.

The rule that makes this pay for itself: **an archived run is stored as self-contained data** — its
final projected row, its receipt, and evidence pointers — so rendering it requires **zero
old-version code**. No compat shims, no version fallbacks, exactly one rendering path in the
dashboard forever. That is the whole point; an archive that needed old code to read would recreate
the coupling the rebuild exists to remove.

Four hard rules:

1. **The write ledger is never archived.** What was filed in a real HR system stays forever,
   independent of run archival. Archiving is a *display* lifecycle; the ledger is an *audit* one.
2. **Relaunch from archive starts a fresh run on the current version** from the archived immutable
   input. It is never a resume of the old run — resume across a fingerprint change is exactly what
   D35 forbids.
3. **A bump cannot archive a non-terminal run.** Queued/parked runs must be terminalized first
   (cancelled, or for a parked write RESOLVED present/absent per §parked-intent resolution), and
   the bump flow lists them. **An unresolved possible-submit is never buried in an archive** — this
   is the write-safety carve-out and it is not negotiable for convenience.
4. **Hide/Unhide still exists** for same-version runs (reversible presentation tombstone, D49).
   Archive-on-bump is the automatic path; Hide is the manual one.

**D95 command naming:** this lifecycle is executed only through the `version-archive` family's
`plan-version-bump` and `apply-version-bump` actions. The run-family `bump` action in §2.4 remains
queue priority/claim order only and can never plan, apply, or imply version/archive work.

The scope of a bump is declared by whoever makes the change — single-workflow, multi-workflow, or
dashboard — and recorded in that update's change record (same store as fix records: what, why,
version, commit).

#### D179 — the archive model as-built (2i-G, 2026-08-09)

**The app version is the other half of the archive key, and it was not being kept.** The queue
projection stamped `deps.appVersion` — the build serving the PAGE — on every row, so the run-detail
"served by a different app build" comparison compared a value with itself and could never fire.
`RunRecord` now carries an `appVersion` stamped at the ONE enqueue point (`fanOutQueuedRuns`, and
the retry arm, which stamps the build it is enqueued under rather than inheriting the one it
retries). It is **read forward, never back-filled** (D133's rule): a run from before D179 reports
its absence with its reason, and an application-scope bump treats an unstamped run as prior-version
— the fail-closed reading, since it demonstrably is not the current build's.

**Authority schema v13** adds three tables, all insert-only in SQL rather than by convention,
because an archive whose rows could be rewritten is a WEAKER record than the live row it replaced:

| table | holds |
|---|---|
| `version_bump_applications` | the applied bump — charter §25's change record |
| `archived_runs` | one self-contained record per swept run, with its content digest |
| `archive_relaunches` | relaunch provenance, keyed by the FRESH run |

`version_plans` (released in v1, zero production rows because the family was deferred) gets its
first real shape under the same D164 precedent `artifact_outbox` set: it holds the exact
`VersionBumpPlan` rather than an opaque payload, and it moves `planned → applied` exactly once
under a CAS — the same discipline a start plan follows, because it is the same problem.

**An archived run is the FINAL PROJECTED ROW plus its detail, receipt, failure and evidence
POINTERS.** The kernel takes those payloads through an `ArchiveSnapshotSource` seam that the server
implements over the same run/queue projection and run-detail query the live surfaces render, so the
frozen bytes are the bytes the operator last saw rather than a second derivation of them. The
workflow LABEL is frozen into the record too: resolving it at read time would be a descriptor read
on the archived path, and falling back to the id would substitute a plausible value for one nobody
recorded. Evidence is pointers only — the content-addressed bytes, the checkpoints and the ledger
lines all stay exactly where they are.

**The three arms, and where each refusal is computed:**

- `plan-version-bump` mints an immutable plan **even when it cannot be applied**, because the
  charter's requirement is that the flow LISTS the blockers — the list is what the operator needs
  in order to clear it. An `application`-scope plan must name the RUNNING build; a scope nobody can
  verify could archive every run on the strength of a typo.
- `apply-version-bump` re-derives candidates **and blockers from authority inside the applying
  transaction**, never from the plan's copy: a run that went queued between review and apply is
  exactly the possible-submit the refusal exists to keep out of an archive. It refuses on
  `active-version-blockers` naming every blocking run by trace, workflow and state; on registry
  drift; and on an app build that moved since review. A refused apply leaves the plan `planned`, so
  the SAME reviewed plan applies once the blocker settles — a refusal is not a spent plan.
- `relaunch-archived-run` cites the record's content digest, resolves the CURRENT descriptor, and
  replans from the archived RAW submission through today's ingress and canonical schemas. It never
  replays the archived canonical value — that value was validated by a schema which has, by
  definition, since moved — and it is not a retry: the fresh run carries no `retryOf`, and neither
  side of the link is rewritten to record it.

**Archived rows leave every live read once, inside the projection**, beside hidden rows and member
containment (§10.1) — so a swept run leaves the queue, the workflow badge, the status pill, the
month calendar and the Activity report at the same instant, by construction.

**The Archive surface is read-only structurally.** No retry, no cancel, no hide, no resolution —
absent, not disabled, because a disabled control still claims the act exists. The one control is
Relaunch, and the archived-detail query resolves the registry for exactly one thing: whether a
current version exists to relaunch ONTO. `archive-invariants` proves the rest by reading a stored
record back with the descriptor list empty.

### 10.3 Operator-assigned run display names (D83)

Any run can be renamed by the operator. The label rides the **row and the receipt**; the trace id is
preserved underneath and remains the join key for spans, notes, and the ledger. A rename is a
command arm (D67), is actor-attributed (D75), and never mutates identity — it is presentation over
a stable id, exactly like the presentation-override layer (D16). Per D95, its payload is one strict
`displayName`: NFC-normalized, already trimmed, 1–120 Unicode code points, no control characters,
and no unknown keys.

### 10.4 Notification model (D79b + D86)

**Slimmed from the five-state lifecycle** (unread/read/acknowledged/snoozed/resolved + per-attempt
delivery records — that was multi-user incident tooling) **to read/unread + optional snooze.** The
inbox is **actor-keyed from day one** (D75 seam) even though there is one actor today.

Routing, ratified: **failed · gate-waiting · write-parked · repeating · storage** → **Ping**;
**verified-done** → **Inbox only**. Pings are silent. Retention: notes 30d, spans 30d, **ledger
forever**, artifacts + checkpoints until purge.

Unchanged and load-bearing: durability. A notification is a durable record first and a desktop
delivery second — **failed OS delivery still leaves an unread inbox item.** Desktop delivery may
never be the only alert.

---

## 11. The intake workspace — the surface contract (2i-E3, D173)

Doc 06 §2.2 owns the FLOW (upload → map → validate → run) and doc 06 §2.5 owns the invariant that
makes it safe. This section owns how that flow is presented, because three of its decisions are
surface decisions with consequences and one of them is the reason the surface exists at all.

### 11.1 Proposed against decided is a PLACE, not a colour

§2.5 forbids a suggestion ever being pre-applied, and the mechanism already exists — only
`confirm-intake-mapping` mints a binding, reachable from nothing but a press. The surface's job is
to make the same fact legible, and it spends its whole visual budget on it:

- a **decided** binding is a solid control in the row's own `Bound column` cell, carrying the
  file's real sample values beneath it — so the operator confirms what a column HOLDS rather than
  what it is called, which is the only defence against a correctly-named column of wrong data;
- a **proposal** is recessed and dashed, lives in a **different column** (`Suggested`), and always
  carries an explicit verb (`Use it`) plus the scorer's own reasons in words. An `ambiguous`
  proposal states its ambiguity and receives no visual preference, because picking one of two
  indistinguishable columns for the operator is the silent guess in miniature.

Two states that are never in the same place cannot be confused for one another. A tone would have
had to be learned; a position does not.

### 11.2 The grid's rows are the WORKFLOW's fields, never the file's columns

One row per declared intake target (doc 06 §2.2 step 2 in as many words). The workflow's
requirements are the fixed axis and the spreadsheet is the variable — turn it around and the grid's
shape depends on the export, and an operator can finish it without ever seeing a field the workflow
wanted. Unmapped required targets are therefore visible by construction rather than by a check.

### 11.3 It is a workspace at `?intake=<sessionId>`, not a dialog

The session is a durable row (D170). It survives reload, and mapping a dozen columns then reviewing
four hundred rejections takes minutes during which the operator will want to look at the queue.
Trapping a task whose whole state is already safe on the server is what a modal is for and this is
not that, so the workspace takes over the main region beside the existing queue/panel pair and is
abandonable at any moment; `?intake=new` opens it at the dropzone and the upload response replaces
that with the session's own id. The takeover HIDES the queue rather than dimming it — a
half-visible queue behind a takeover is the modal it deliberately is not.

Three bands, and the outcome band is `sticky bottom-0` on purpose: an operator scrolling a long
grid must always be able to read WHY Run is disabled, and a disabled button whose explanation is
off-screen is how a person concludes the product is broken.

### 11.4 Readiness is DERIVED for courtesy and JUDGED by the kernel

The band names the blockers it can see on the served wire — no header row settled, nothing bound,
an unvalidated mapping. That is a courtesy, never the authority: `enqueueReadiness` judges the
manifest the arm would actually write (doc 06 §5.2), and its refusal renders verbatim. A surface
that decided readiness itself would eventually disagree with the server about what is about to
happen, which on this product means disagreeing about whether real HR runs were filed.

Staleness needs no client arithmetic either. Every mapping arm sets `validation: {state:"none"}`,
so "the review you are looking at describes the current mapping" is a served fact.

### 11.5 The destructive act names its cost before it happens

Changing the sheet or the header row discards every binding, correction and exclusion (D170 — they
all named rows and columns under the old layout). The surface confirms first, with the counts, and
the confirmation ARRIVES rather than blinking in. Discovering it afterwards would be the definition
of a surprise.

### 11.6 Which control is in flight, not merely that one is

Every intake command is a round trip. Locking the surface while showing a spinner nowhere means the
operator presses `Use it` and the interface appears to do nothing, so the workspace tracks the
in-flight command's KEY and that control alone carries the spinner. Everything else disables.

### 11.7 As-built notes

- **`Dropzone` is a new DS primitive** (`primitives-form.tsx`): a real `<input type="file">` inside
  a `<label>`, so the drop target and the browse control are one control that the keyboard, the
  screen reader and touch all reach for free. It states what it takes and its size cap from the
  server's own constants, and it **never filters a dropped file** — `accept` is a picker hint, and
  a file the server would refuse is handed over so the server can refuse it BY NAME. Drag state is
  a counter, not a boolean, because `dragleave` fires when the pointer crosses into a child.
- **The transport grew `requestJsonResponse`.** The intake upload is the one route whose STATUS is
  the answer: `201` created a session for these bytes, `200` joined the open one they already have.
  Any other status throws — falling through to "refused" would report a server defect as the
  operator's bad file.
- **`Banner` forwards no unknown props**, so `data-demo-enter` spread onto it type-checks (a spread
  skips excess-property checking) and is silently dropped at runtime. Arriving surfaces wrap
  instead. Generalize the shape: a spread onto a component with explicit props is not a compile-time
  guarantee that the prop arrives.
- **The parity lane dismisses the floating workflow window for the intake states only.** The window
  covers the workspace's left edge — its target-field column and its stage tabs — and dismisses on
  the first click outside it, which is the operator's very first act on a takeover. The queue's
  references keep it, because the queue is what that window is FOR.
- **Deferred, with its reason.** There is no arm that sets a run-wide CONSTANT and none that REMOVES
  a binding, so the grid renders `constants` read-only (today always empty) and its column control
  offers no "unbind". Offering either would be a control that silently does nothing. person-lookup
  does not need a constant — `keepNonHdh` and `includeCrmDates` carry schema defaults — but the
  first workflow with a required non-column field (doc 06 §8's `effectiveDate`) will need the arm.

---

## 12. The capture phone surface — the surface contract (2i-F, D175)

Doc 06 §5.1 owns what capture DURABLY records and which routes exist; this section owns what the
person holding the phone sees. It is the only surface in this program rendered on a device the
operator does not sit at, and every decision below comes from that.

### 12.1 The use scene picks the theme, not the category

The operator dashboard is dark because it lives on a desk. The phone surface is **light**, because
its use scene is somebody standing at a filing cabinet or a front desk with a paper form in one
hand, often under a window. A dark UI at whatever brightness the phone happens to be on is the most
common way a capture flow becomes unreadable at the exact moment it is being used. Nothing is
restyled to achieve this: `tokens.css` already ships both themes behind `data-demo-theme`, so the
phone selects `paper-ink` and spends no new colour. The palette budget, the `--ds-*` layer, and the
tailwind ratchet are unchanged, and no operator surface moves.

### 12.2 It is ONE page whose bottom bar changes verb

Capture → review/reorder → finalize are three states of one page, not three pages and not a wizard.
The task is short, the durable session means a reload lands exactly where the operator was, and a
step indicator would spend the top of a small screen narrating a sequence the bottom bar already
states. The action bar is pinned in the thumb zone and is the only place a primary action ever
appears; what changes between states is its verb, not its position.

### 12.3 Order is meaning, so it is a numeral and a button — never a drag

Every photograph tile carries its page number as a large real numeral, because the durable record
enforces contiguous ordinals and the bundle IS the order. Reordering is explicit ▲/▼ controls, not
drag: a drag target inside a scrolling list on a touch screen is the classic failure mode, it
cannot be half-performed with a keyboard, and it announces nothing to a screen reader. Buttons are
reachable, announceable, and each one is a complete act.

### 12.4 The camera is the platform's, not ours

Photographs are taken through a real `<input type="file" accept="image/*" capture="environment">`
inside a `<label>` — the same real-input-in-a-label pattern the `Dropzone` primitive established
(D173). Building a viewfinder would mean re-implementing focus, exposure and orientation worse than
the phone already does, on the one surface where a bad photograph is the whole failure.

### 12.5 A failure is the server's own sentence, in reserved space

The error region is always in the DOM with its height reserved, so a refusal never jumps the layout
under a thumb that is already moving. It is a `role="alert"` and it renders the server's message
VERBATIM — the kernel's refusal, the projector's failure, the named upload rejection. The phone
composes no prose of its own and swallows no catch: the operator holding the phone is the person who
has to choose between Retry Finalize and Discard, and "something went wrong" decides nothing for
them. Colour is never the only carrier.

### 12.6 The QR is the operator's half, and the token exists once

Start Capture is a small control inside the existing dashboard. It calls the loopback-only session
route and renders the returned `phoneUrl` as an inline-SVG QR built by `src/domain/qr-code.ts` — a
pure encoder rather than a dependency, so the payload never leaves the process. The raw token exists
in exactly that one response and is rendered, never stored: the durable row has only its digest, and
the URL carries it in the FRAGMENT, which no server sees. A refused ingress renders its `message`
and `remediation` in place of the QR, because "capture is unavailable" without the reason is a dead
end an operator cannot act on.

### 12.7 As-built notes (2026-08-09)

- **The phone is a SEPARATE Vite entry**, `capture.html` over `src/dashboard/phone/`, not a route in
  the operator SPA. Serving the operator bundle over a public tunnel would ship the whole operator
  UI to the phone origin, and no route filter can un-send bytes. `build.manifest` is emitted so the
  ingress allowlist is generated from the phone entry's own asset closure rather than hand-listed.
  `dashboard-wire-boundary` now walks **every** `*.html` entry under `src/dashboard`, not just
  `index.html` — otherwise a second entry would silently escape D120's Node-built-in check — and a
  new arm proves the phone closure reaches no operator surface, client, or app module.
- **One transport owner per bundle.** `provider-capability-boundary` pinned `fetch` to
  `src/dashboard/client/**`; the phone legitimately needs its own, so
  `src/dashboard/phone/capture-client.ts` is named as the phone bundle's single transport owner
  rather than the rule being relaxed. Its error path returns a `CapturePhoneError` that names why a
  body was unreadable — the `fail-loud-catch-default` ratchet caught a `.catch(() => undefined)`
  there and was right to.
- **The camera stays the primary control even after the first photograph**, and Review is the quiet
  one on the left. Promoting Review was a hazard, not a taste question: Review and Send would then
  both be "primary, on the right", so a second tap from a thumb already travelling would finalize
  the bundle.
- **Motion is the house language, not a phone dialect.** The one authored moment — a photograph
  settling into the list — uses `--ds-dur-enter` and `--ds-travel-md`. An invented
  `--ds-phone-*` pair differing by 30ms and 2px would have been a second motion language that also
  needed its own `prefers-reduced-motion` block to stay honest; the house tokens already collapse.
  Press feedback is `active:scale-[0.97]`, not a 1px translate: a finger COVERS a 48px control, so
  the only visible feedback is at its edges.
- **Red is reserved for Discard.** Per-tile Remove was `danger`-toned, which put three red controls
  down the reorder list — louder than Send, inverting the attention ladder the token file is
  explicit about.
- **Parity: 15 references added** (five states × pixel/a11y/provenance) at one phone viewport in
  their own block, so the operator corpus is not multiplied. **12 moved, none silently**: the
  `intake-upload` triples, because the QR start control lives on that surface; the a11y diff is
  exactly the three lines it adds.
- **Pre-existing defect found and NOT fixed here:** the intake takeover renders a dark shell under
  the light theme, leaving the dropzone heading near-invisible. It is identical in the committed
  baseline and is a sibling of the `paper-ink`-renders-dark residual already deferred to 2j's corpus
  work; fixing it here would re-freeze references for a reason unrelated to capture.

---

## 13. The two reference takeovers — the surface contract (2i-G, D176/D177)

Doc 12 §5 owns what the explorer IS and §1.3 owns what the catalog IS; this section owns where they
sit and what they refuse to look like.

### 13.1 A read-only explorer must not look like an editor

The shape this category always ships is the workflow-builder canvas: draggable rounded nodes, bezier
edges, a palette down one side. On this surface that shape is a **lie** — it draws a mutation
affordance over a graph nobody may mutate, and doc 12 §5.1 rejected the free-form visual programmer
outright. It is refused.

What a reader actually arrives holding is an id or a failure location (`separations/ucpath-transaction
→ ucpath.smart-hr.ready-to-submit`), and what they must leave with is the exact node, contract, UI
ids, scenarios and source paths. So **the identifier is the interface**: every id on the page is a
`Chip`, which this system already renders monospaced and truncation-safe, and the page spends its
whole budget on them.

### 13.2 A structure rail beside a record column

The rail carries the graph — nodes in declaration order, with a controller's downstream nodes
**indented beneath it** so a branch case reads as "instead of" and a parallel branch as "alongside".
`dependsOn` alone cannot express that difference; collapsing them would make a branch look like a
fan-out that always runs. The record column carries the selected node's whole binding in one
uninterrupted read, because the question is a lookup and a lookup that hides half its answer behind
a second click is a worse index than the source tree.

Two properties of the rail are pinned by test rather than by intent: every node appears **exactly
once** whatever the control structure, and a node whose controller is declared *after* it still
appears — a node missing from the rail is a graph the surface failed to show, which is worse than
one drawn flat.

The split keys on the **column**, not the window (see §Shell and layout): this is a takeover whose
width changes with the workflow panel's mode. A container query cannot style its own container, so
the query is asked from a wrapper — asking from the same element is a query that never matches, and
it silently degrades to the stacked layout at every width.

### 13.3 One saturated mark, spent on consequence

Colour is restrained to the point of being an argument. Of six node kinds only **transaction** is
tinted, because it is the one fact on the page that can change a real HR system; in the catalog only
**observation** and a non-`observe` element `effect` are tinted, because an observation is what a
subject binding and a completion proof are checked against and an `external-commit` element is what
acts on a page. A page that colours six kinds six ways spends its whole colour budget on taxonomy
and has nothing left for consequence. In every case the word travels beside the glyph, so the tint
is never the only encoding.

### 13.4 They are takeovers, and precedence is resolved in one place

Both replace the queue at `?explore=<workflowId>` and `?catalog=<term>`, for §11.3's reason: a
half-visible queue behind a reference view is the modal it deliberately is not. Two keys rather than
one shared key, because the two are different scopes — the explorer opens on the ACTIVE workflow and
the catalog is system-scoped — and a shared key would make "which is open" ambiguous.

An **empty** `?catalog=` is meaningful: open, nothing typed. Presence rather than length is what
opens it. Three takeover keys can be present on one link, so `activeTakeover` resolves the winner in
ONE place (`intake` → `explore` → `catalog`): the operator's in-progress WORK outranks either
reference view. Leaving that to whichever JSX branch is tested first is how two surfaces come to
disagree about which of them is showing.

Entry is two `ghost` buttons in the panel's action bar beside `Import spreadsheet`. They are
secondary because neither is a command — neither takes an argument from the operator nor changes
anything.

### 13.5 As-built notes

- **`ChipRow` is the wrong primitive at this width, and that is not a criticism of it.** Its
  equal-width grid exists to stop an orphan in the queue's ~400px column. In a ~700px record column
  holding a dozen SHORT facts (`code pl`, `version 1`) `auto-fit` cuts seven 160px tracks and leaves
  every chip alone at the left of one; the shared ending edge is bought with gaps wide enough that
  the set stops reading as a set. Both surfaces pack their facts in a wrapping flex row instead, and
  the ragged right edge is the deliberate cost — the primitive's own note already says a row that is
  not a track of peers "is a flex row, and the chip is one item in it".
- **`--ds-w-explorer-measure` (1120px) is a reading measure, not a panel width.** A reference surface
  given the full 1400px of a takeover sprays its facts across the panel. The content sits at the
  panel's leading edge rather than centred, so the rail does not drift as the record column changes
  height.
- **A raw millisecond is arithmetic, not a fact.** `10002992` reads as `4h`, with the exact value on
  the chip's `title`: a contract review needs the millisecond, a glance needs the hour.
- **Motion is inherited, not extended.** Both takeovers arrive exactly as the intake takeover does
  (4px from above, `ds-motion-enter`) — two takeovers sharing one region and arriving from opposite
  edges read as two different products. The rail entry carries the house pressable pair
  (`dsMotion.fast` + `active:translate-y-px`), the same one `Button` and `Chip` use. The record swap
  and the live catalog filter are **deliberately unanimated**: one is list navigation and the other
  fires on every keystroke, and both are exactly where motion only adds latency.
- **The parity fixtures are the REAL projections.** A hand-written fixture graph would prove only
  that the surface can render a shape somebody typed, and doc 07's exit criterion is about the
  as-built graph. A change to the graph now moves these references, which is the drift signal the
  corpus exists to give.
