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

**Recorded:** 2026-08-14 · **Status:** triaged 2026-08-14 — blocked on the queue row: the archived
row is a frozen copy of `QueueSurfaceWire`, so these land there first (`dryRun` LANDED on
`QueueBaseFields` 2026-08-14 — commit 446e7d7; rows archived from now on carry it forward
automatically, D133 read-forward, never back-filled). `priority`/`preset` remain queue gaps with
no record yet; add them to `queue-rows.md` when worked.

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

## Logs, Data and People tabs

**Recorded:** 2026-08-14 · **Status:** triaged 2026-08-14 — decide-first. This is an archive-MODEL
decision (freeze section payloads beside the row, or state that an archived run keeps counts and
not rows), i.e. a doc 03 §10.2 ratification plus a schema-version question on the immutable
archived record — not a projection edit. Awaiting that ratification.

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

## Write-ledger Action/Confirmation await a declared presentation reading

**Recorded:** 2026-08-14 · **Status:** recorded · (narrowed 2026-08-15 — the read-through LANDED)

- **What landed (6317366):** `ledgerPartitions` pointers are now populated at archive time (they
  were a `[]` stub — the card was structurally empty) and resolved at READ time against the live
  ledger via `createLedgerReadThrough`; the card fills System / Instance / key / confirmed-at, and
  every unresolvable pointer is a visible named-absence row (`partition-missing` /
  `sequence-missing` / `line-malformed` / `sequence-mismatch`), never dropped.
- **What remains:** the demo's `Action` and `Confirmation` columns render reasoned absences. A
  ledger entry declares neither leaf and its `proof` is schema-bound per commit contract, so
  reading a field name out of it is the guess D204 bans. `LEDGER_PRESENTATION_DECLARATIONS`
  (`src/domain/archive/ledger-resolution.ts`) is the declared per-contract mapping table, empty
  until each commit contract declares which of its proof/output leaves IS the action label and the
  confirmation number. One entry per contract closes this for that contract's lines.
- **Also open:** no end-to-end test archives a run that actually filed a ledger line — needs a
  world with real write intents.

## Workflow short code

**Recorded:** 2026-08-14 · **Status:** triaged 2026-08-14 — deferred to the workflow-taxonomy
question ([workflow-taxonomy.md](workflow-taxonomy.md)): a short code is a descriptor presentation
attribute that several surfaces want (the Activity per-workflow table records the same need), so
it should be decided once there, then frozen into archived records like the label.

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

**Recorded:** 2026-08-14 · **Status:** triaged 2026-08-14 — decide-first, per the standing rule a
frontend feature the plans do not list is not built. Needs an operator decision landing a line in
doc 03 §10.2 (with the redaction posture stated: the export carries exactly the display-redacted
detail wire and nothing more) before anyone builds it.

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
