# The D12/D13 coexistence design — `reference/dashboard-surfaces.md` §5.1–§5.4, as it stood

**Superseded by D88/D89/D93 (2026-07-31) — do not implement.** What answers these questions now is
`reference/dashboard-surfaces.md` §5 (the cross-repo runtime boundary as a live contract: two
repositories, no shared module graph, the one-machine distinctness the tests prove, D216's single
narrowing) and `docs/rebuild/05-cut-over.md` (the phase: stop, drain, back up, repoint, the
rollback window). Preserved verbatim, including its own `<details>` framing, because it is the
record of WHY continuous lift, per-run engine generations and a scoped dashboard flip were
rejected — and a rejected design deleted is a design somebody proposes again.

Verified absent from the tree on 2026-08-21, which is what makes the supersession structural rather
than declarative: `grep -rn 'liftLegacy\|compat/\|temp_src' src/` returns nothing, `RunRecord`
carries no `engine` or `cutoverGeneration` field (`src/domain/run/record.ts`), and
`config/legacy-capabilities.json` sets `proxyDispositionAllowed: false`, which makes §5.4's
"proxied long tail" not merely unbuilt but forbidden.

One sentence of this block was cited from OUTSIDE it as if live — §5.3's *"every enqueue stamps
`(engine, cutoverGeneration)` in the authoritative run record"*. It never shipped and never will;
the run record's authority story is `reference/dashboard-surfaces.md` §2.3 and `ref workflow-model`.

---

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
| data diffs on re-emits | **no successor event — D254 retired `span.patched`.** The lift's own reason for the row (a legacy re-stamp must fold into details, never identity) is satisfied structurally instead: no arm but `run.queued` names an identity attribute, so a re-stamp has nowhere to land |
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
