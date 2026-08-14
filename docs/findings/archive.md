# Archive surface — wire gaps

Recorded while porting the rebuild-demo's `DemoArchive.tsx`
(legacy `hr-automation@1bffbd658db34ce84a08e69484db3a40b3658d6e`,
`src/dashboard/components/dev/rebuild-demo/DemoArchive.tsx` + `demo-archive-wire.ts`)
onto the served `/api/v1/archive` wire (`src/domain/dashboard/archive.ts`, D179).

Each record names a demo element the ported surface could NOT render, the wire field that is
missing, and where a fix would come from. Nothing here was approximated on the surface — an
invented value on the one record whose job is to be trustworthy is the failure mode this program
exists to prevent.

Owning docs for triage: `docs/rebuild/03-tracker-dashboard.md` §10.2 (D80/D179) and
`docs/rebuild/13-frontend-backend-integration.md` §5 / line 131.

## Change record behind a sweep (what moved, why, and the commit)

**Recorded:** 2026-08-14 · **Status:** recorded

- **Symptom:** every sweep on this surface can say WHO applied it and WHEN, and nothing about WHY.
  The section-header popover and the detail's "Archived by" card both print an explicit sentence
  naming the absence instead.
- **Demo element:** `BumpSectionRow`'s ⓘ popover and `BumpRecordCard` render `record.what`,
  `record.why`, `record.by`, `record.commit`, `record.kind` (`major`/`minor`) and
  `record.fromVersion → record.toVersion`.
- **Missing wire field:** `ArchiveSweepWire` carries `applicationId`, `versionPlanId`, `scope`,
  `targetVersion`, `appliedAppVersion`, `appliedIdentities`, `appliedBy`, `appliedAt`,
  `archivedCount` — no narrative, no commit, no bump KIND, no from-version.
- **Where it would come from:** doc 03 §10.2 already requires it — "the scope of a bump is declared
  by whoever makes the change … and recorded in that update's change record (same store as fix
  records: what, why, version, commit)", and doc 13 line 131 lists "major/minor version planning".
  The `plan-version-bump` payload (`VersionArchiveCommandRequestSchema`) has no `kind` or change-
  record fields, so the store, the command payload and the wire all need the same three or four
  leaves. The `from` half is derivable from `archived_runs`' identities; `what`/`why`/`commit`/
  `kind` are authored input that nothing currently collects.

## Dry-run, priority and preset on an archived run

**Recorded:** 2026-08-14 · **Status:** recorded

- **Symptom:** an archived rehearsal is indistinguishable from an archived filing on the identity
  chip row. The ported ChipRow shows version / app / trace / by / attempt and stops.
- **Demo element:** `Chip label="priority"`, `Chip label="preset"`, and the
  `dry run — wrote nothing` chip in `ArchivedRunDetail`'s summary; `dry run` also rides the LIST
  row as a hazard chip.
- **Missing wire field:** neither `ArchiveEntryWire`, `ArchivedRunDetailWire` nor the frozen
  `QueueSurfaceWire` row carries `dryRun`, `priority` or `preset`.
- **Where it would come from:** the run envelope holds `dryRun` (doc 09 §3 — it is the safety
  boundary a live run is judged by) and the start plan holds the preset/priority the operator
  chose. Both would have to reach `QueueSurfaceWire` first, since the archived row is a frozen copy
  of it — which means this is a QUEUE-row gap that the archive inherits (see
  `docs/findings/queue-rows.md`).

## Test-instance hazard on a LIST row, and the instance filter

**Recorded:** 2026-08-14 · **Status:** recorded

- **Symptom:** the toolbar has three controls where the demo has four; there is no way to ask
  "which archived runs touched a test instance?", and a list row cannot warn that one did. The
  DETAIL can — `row.resolvedInstances` is on the frozen queue row — so the fact exists and is
  simply not on the index.
- **Demo element:** the `Any instance / Production only / Touched a test instance` `<Select>`, and
  `archivedRunTouchedTest(run)`'s ⚠ on the name cell.
- **Missing wire field:** `ArchiveEntryWire` has no `resolvedInstances`.
- **Where it would come from:** copy the frozen row's `resolvedInstances` (or a boolean derived
  from it) onto the index entry when the archive index projects. No new authority data is needed —
  the value is already inside `archived_runs`.

## Logs, Data and People tabs

**Recorded:** 2026-08-14 · **Status:** recorded

- **Symptom:** the archived detail renders two tabs (Summary, Evidence) where the demo renders five.
  The archived run's log lines, data points and member rows are not readable at all.
- **Demo element:** `<Tab value="logs" count={run.logs.length}>`, `<Tab value="data">`,
  `<Tab value="people">` and their panels — the log-level list, the read/write data points with
  `correctedFrom` provenance, and the per-member outcome table.
- **Missing wire field:** `ArchivedRunDetailWire.detail` is a `RunDetailWire`, which carries only
  `context: { dataFacts, evidenceFacts, attempts }` (COUNTS) and `availableSections` (NAMES). The
  archive wire deliberately serves no fetchable sections for an archived run ("no action
  descriptors, no sections to fetch"), and the live section endpoints resolve against a live run.
- **Where it would come from:** a decision, not a field. Either the archive snapshot freezes the
  section PAYLOADS beside the row (which is what doc 03 §10.2's "self-contained data" arguably
  implies for notes/people, and what makes the section readable with the registry emptied), or
  §10.2 states that an archived run keeps its counts and not its rows. Doc 13 line 131 says "old
  receipts/captures/timelines", which names three of the five and is silent on logs, data and
  people.

## Evidence tiles — label, step, system, captured-at, retention

**Recorded:** 2026-08-14 · **Status:** recorded

- **Symptom:** the Evidence tab lists raw ids in chips. An operator cannot tell what a capture was
  OF, when it was taken, or whether its bytes still exist.
- **Demo element:** `EvidenceTile` — an aspect-correct thumbnail placeholder, a kind badge
  (`error`/`confirmation`/…), `item.label`, `item.step`, `item.system`, `item.capturedAt`,
  `item.ref`, `item.retention` (`retained`/`purged`) with its date, and an Open / "What it was"
  button into `CaptureLightbox`.
- **Missing wire field:** `ArchivedEvidencePointersSchema` is `artifactIds`, `checkpointNodeIds`,
  `writeIntentIds`, `ledgerPartitions` — ids only, no descriptive leaf and no retention state.
- **Where it would come from:** the artifact store already holds kind/label/step/system/capturedAt
  per artifact id, and the retention sweep knows what it purged. D179's "evidence is pointers only"
  is about the BYTES; a pointer that cannot say what it points at is a weaker record than intended.
  Either widen the pointer to a described pointer, or serve an archived-artifact lookup.

## Per-attempt history

**Recorded:** 2026-08-14 · **Status:** recorded

- **Symptom:** the detail can say "1 attempt" and nothing about what each attempt did. On a run
  that failed twice before settling, the archive cannot show the shape of the retry.
- **Demo element:** the `Attempts` card — one row per attempt with `#ordinal`, a `StatusPill`, that
  attempt's own `traceId`, its `at`, and a one-line `note`.
- **Missing wire field:** `RunIdentityWireSchema.attempt` and `ContextSummaryWireSchema.attempts`
  are counts. There is no per-attempt array anywhere on the archived detail.
- **Where it would come from:** the span stream carries `(runId, attempt, spanPath)` (D74's lesson),
  so the attempt history is derivable at archive time. It would be a new frozen array on the
  archived record, and it is the same value the LIVE run detail does not serve either.

## Write-ledger action and confirmation number

**Recorded:** 2026-08-14 · **Status:** recorded

- **Symptom:** the "Write ledger — never archived" card lists `system / partition date / line
  sequence`. It cannot name the ACTION filed or the confirmation number returned — which is exactly
  what the relaunch confirmation needs in order to say "this run already filed X".
- **Demo element:** the ledger `<Table>` with `System / Action / Confirmation / Instance`, and
  `deriveRelaunchPlan(run).alreadyFiled` reusing the same rows inside the relaunch dialog's danger
  banner.
- **Missing wire field:** `ArchivedEvidencePointers.ledgerPartitions` is
  `{ system, date, sequence }`.
- **Where it would come from:** the ledger line itself holds the action and the confirmation
  (`src/infra/ledger/`); the pointer intentionally names the LINE rather than copying it, because
  the ledger is never archived. A read-through — "resolve these pointers against the live ledger" —
  would keep that property and still fill the card.

## Per-step durations in the archived timeline

**Recorded:** 2026-08-14 · **Status:** recorded

- **Symptom:** the step timeline shows label + state and no elapsed time per step.
- **Demo element:** the `Step timeline` card's right-hand `step.durationLabel` column.
- **Missing wire field:** `TimelineEventWireSchema` carries `at` (the instant the event was
  recorded), not a duration. Differencing consecutive events would measure the gap BETWEEN events,
  which is not the step's own duration, so nothing was computed.
- **Where it would come from:** the executor's `span.ended` already measures each task span (D124
  made the run-level `endedAt` explicit for exactly this reason); a per-event `durationMs` union
  (present / reasoned absence) on the timeline wire would serve the live run detail too.

## Retention dates for the row and its evidence

**Recorded:** 2026-08-14 · **Status:** recorded

- **Symptom:** the Retention popover states the three rules D179 actually guarantees and prints no
  DATE. The demo names when the row is purged and when the images are.
- **Demo element:** `run.retention.rowPurgeAt`, `run.retention.evidencePurgeAt` and the
  `N of M still retained` count in the "Snapshot provenance & retention" card, plus the popover's
  "90 days from the run's end" sentence.
- **Missing wire field:** neither the archive index nor the archived detail carries a retention
  block.
- **Where it would come from:** doc 03 §10.4 fixes the retention policy (notes 30d, spans 30d,
  ledger forever, artifacts + checkpoints until purge) and the sweep in `src/core/` computes the
  purge instants. Serving the computed dates per record — rather than restating a policy the
  surface would then be free to get wrong — is the shape that matches D179.

## Workflow short code

**Recorded:** 2026-08-14 · **Status:** recorded

- **Symptom:** a list row reads `EID 10873698 · Person Lookup v1` where the demo reads
  `Tomás Rivera · pl v3.0`, and the version registry has no code column. At 800 rows the long label
  costs the name column real width.
- **Demo element:** `run.workflowCode` on the row's name cell, in the sweep header's
  `bumpNameLabel`, and as the registry table's leading token.
- **Missing wire field:** no short code exists anywhere in the rebuild — not on the descriptor, not
  on the wire. `workflowId` (`separations-kuali-read`) is the only short-ish handle and it is not
  short.
- **Where it would come from:** a descriptor field, frozen into the archived record like the label
  already is (D179 freezes the label precisely so the archive never resolves a descriptor). This is
  a workflow-taxonomy question as much as an archive one — see
  `docs/findings/workflow-taxonomy.md`.

## Export an archived run

**Recorded:** 2026-08-14 · **Status:** recorded

- **Symptom:** the archived detail's panel header has no Export control; the demo's does.
- **Demo element:** `<Button icon={<Download/>}>Export</Button>` in `ArchivedRunDetail`'s
  `PanelHeader`, writing `archive-<traceId>.json` from `exportArchivedRunJson(run)` and toasting.
- **Missing wire field:** none — the payload it would write is exactly the `ArchivedRunDetailWire`
  the surface already holds. This is recorded as a FEATURE, not a data gap.
- **Where it would come from:** a plan decision. Doc 03 §10.2 and doc 13 §5 do not list an export
  control on this surface, and the standing rule is that a frontend feature the plans do not list
  is not built. It is a plausible audit-request affordance (the demo's own rationale) and needs a
  line in doc 03 §10.2 before it exists here. Note the redaction question comes with it: the
  detail wire is already redacted for display, so an export of it inherits that and nothing more.
