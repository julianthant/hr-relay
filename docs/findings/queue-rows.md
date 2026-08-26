# Queue-row findings

Records where a queue-row element the demo draws — or ref dashboard-surfaces §9 ratifies — cannot be powered
by what the BFF serves today. Verified 2026-08-14 by running the rebuild dashboard
(`localhost:5174`, real `separations` runs on day `2026-08-14`) beside the demo
(`localhost:5173/?view=rebuild-demo`, legacy `hr-automation@1bffbd6`) at 1440×900 and reading
both screenshots element by element.

**The frontend half is already 1:1.** `src/dashboard/surfaces/queue.tsx` is a faithful port of
`DemoQueue.tsx` — same grid, same chip shell, same footer band, same bands and digest. Every
record below is a MISSING WIRE FIELD or a MISSING PROJECTOR, not a rendering gap: each one is a
row the component would draw the moment the field arrives. Most are already batched on the
hookup ledger in `docs/plans/2026-08-13-detail-fidelity-audit.md` (rows *"`QueueBaseFields`
batch"* and *"queue/run action descriptors"*); they are restated here per record so a backend
session can take them one at a time.

Shared evidence for every record: `GET /api/v1/dashboard?day=2026-08-14` and
`QueueBaseFields` in `src/domain/dashboard/projection.ts`.

**Landed 2026-08-14 — four records worked, two deleted.** `liveMessage` on a failed row (D13) and
the `warnings` count (D22/D126) are SERVED and DRAWN; their records are deleted, and ref dashboard-surfaces's
*Queue-row projection as-built delta* is where the contract now lives. `gateOpenedAt` (D12) and
`dryRun` (D6) are SERVED and still not drawn — each for a reason that is a design decision rather
than a wire gap — so both records stay below, rewritten to state exactly what is left and who owns
it. **The opening claim above no longer holds for those two:** the frontend is not 1:1 on them, and
neither gap closes by serving another field. *(`dryRun` is now DRAWN — see the fourth pass below;
`gateOpenedAt` was drawn with D12's `Waiting on you · 10m` age.)*

**Landed 2026-08-19, third pass — the ordinal, the class, the links and the outcome.** `runNumber`
(D230, durable on `RunRecord` behind schema v15), `priority`, `containment`, `linkedRuns[]`,
`facts[]`, `pipeline[].durationSec`/`executions` and `memberPreview` are SERVED; ref dashboard-surfaces's
*"The second batch"* as-built delta owns their contracts. The records below are rewritten to state
only what is LEFT, and four of them are now about a missing PRODUCER rather than a missing field —
the field was deliberately not added, because a wire arm nothing can populate is the orphan
`wire-connectivity.test.ts` exists to catch.

**Landed 2026-08-14, second pass — per-row actions.** The "No per-row action controls" record is
deleted: `actions[]` is served per row (descriptor policy ∩ kernel preconditions, CAS-bound to
`rowRevision`, `queue-row-actions.ts`) and `FooterActions`/`RowContextMenu`/confirm-first all draw
it; ref dashboard-surfaces's as-built delta owns the contract. The one remainder is NOT a regression of that
record: no `outcome`-placement descriptor is served because those are navigation-shaped and need
the linked-run wire fields — that half rides the "No linked-run chip" record below.

**Landed 2026-08-19, fourth pass — the ROW DRAWS IT, and three records are deleted.** The third
pass above served seven fields and drew none of them; this pass is the consumption half, and ref dashboard-surfaces's
*"Drawing the second batch"* as-built delta owns where each one renders. Deleted:

- **"Rename has a kernel command and no operator control"** — closed by **D233**. It is not the
  inline row field the record and `KERNEL_ONLY_COMMANDS` both predicted: `rename` joined the served
  action vocabulary and is a `menu` descriptor the surface intercepts to collect its one value, which
  is the shape `resolve-gate` already uses. A member row is the one row that does not carry it.
- **"No run-number `#N` chip in the footer"** — closed. The chip is the footer's second segment and
  a SIBLING of the trace chip, never a substitute; a pre-v15 row draws no chip at all, and its reason
  rides the row's ⓘ.
- **"The `dry run` chip has its field and no tone to draw in"** — closed by **D232**, which is the
  DS decision the record asked for: a fifth semantic hue with a real light/dark pair, named for its
  MEANING rather than its colour, and drawn on the provenance bar too.

**What the fourth pass did NOT close, and why each is still below.** `reviewRunId`, `extractedCount`,
`preset`, `memberEid`, `groupNoun` and `rejectedCount` all still have no producer at any layer —
drawing is not what they were waiting for. The `subtitle` record is a semantic mismatch in what an
existing field is FILLED with, which no amount of rendering settles.

**Swept 2026-08-20 (B8).** Every producer claim above was re-verified at HEAD — each of those six
names appears in `src/` zero times, or once inside a comment explaining its own absence — and each
record's `Status:` line now states its disposition and its trigger. The `subtitle` record is
dispositioned WON'T-FIX as stated: the mismatch is not a defect, because D109 retains
`title`/`subtitle` as the exact operator-authored text the confirmation surface showed. Four records
stay open, each against a commit somebody will write.

---

## `reviewRunId` has no model to serve from (the linked-run CHIP is done)

**Recorded:** 2026-08-14 · **Updated:** 2026-08-19 · **Status:** OPEN — `linkedRuns[]` is SERVED
**and DRAWN**; only `reviewRunId` is left and it has NO PRODUCER, blocked on the trigger named below
(re-verified 2026-08-20: `grep -r reviewRunId src` → 0 hits) · **Owning doc:** ref dashboard-surfaces §9 D6, D10, D13

**Symptom.** Nearly every demo row carries a full-width chip under the title routing to a
related run — `Oath Upload · running ↗`, `OCR Review · done ↗` — which is how a linked child
and its parent stay one thought across two panels. The rebuild draws exactly one arm of that
band, `ParentBackChip`, and it is gated on `lineage.state === "child"`; all six of today's rows
are `root`, so the band never appears.

**Demo element.** `PanelRedirectChip` (:1099) and `LinkedReviewChip` (:1159).

**What landed and DRAWS (D231).** `QueueBaseFields.linkedRuns[]`, named for what it carries rather than for
ids it does not: each entry is `{ runId, workflowId, label, panelKind, status }`, resolved through
the same status function every row's own status comes from, so the chip can print `Name · status`
without the client re-deriving a status from the day payload. `containment` (`root | member |
linked`) is served beside it, and the member and linked partitions are disjoint by construction.
The list is EMPTY for every registered workflow today — no descriptor declares a `child-run` node
that fans out to a separately-panelled run — which is an honest zero the projector fills the moment
such a child appears in the fold. The chip is drawn: `PanelRedirectChip` is now ONE component
serving both directions — the route back to the run that delegated this one and the route forward to
a run this one delegated — so neither direction can drift into a different shape.

**What did NOT land: `reviewRunId`.** There is no model to serve it from. `reviewRunId` is a
demo-FIXTURE concept that was never ratified into the run model: nothing in `src/` writes a
"this run reviews that packet" edge, and the nearest real thing — `descriptor.capabilities.review`
and the `review` run-detail section — is a review PANEL on one run, not a run that reviews another.
The field was deliberately not added to the wire, because an arm nothing can populate is the orphan
`wire-connectivity.test.ts` exists to catch. **What closes it:** the first workflow that declares an
OCR-review child, which is the same 2h producer `RunDetailSectionResponseSchema#review` and
`#people` are already declared-unserved against in `config/pending-wire-bindings.json`. Note this is
the same gap the composition taxonomy record in [workflow-taxonomy.md](workflow-taxonomy.md)
approaches from the rail's side: a chunk run and the composition that ran it are currently
unrelated rows.

---

## No extracted-people count (the FACT CHIPS are done)

**Recorded:** 2026-08-14 · **Updated:** 2026-08-19 · **Status:** OPEN — `facts[]` is SERVED **and
DRAWN** in the demo's `FactChipView` shape; only `extractedCount` is left and it has NO PRODUCER,
blocked on the trigger named below (re-verified 2026-08-20: no `peopleCount`/`extractedCount`
anywhere in `src/`) · **Owning doc:** ref dashboard-surfaces §9 D7

**Symptom.** A demo row's chip band carries the run's own so-what — `signed 2:24 PM` on a
finished oath, `6 people` on a packet still at OCR review (which is D7, ratified: *"a packet
still at OCR review shows its extracted count"*). The rebuild has no equivalent, so a settled
row states its status and nothing about its outcome.

**Demo element.** `FactChipView` (:168) and the `Users` + count chip (:1030).

**What landed and DRAWS.** `QueueBaseFields.facts[]`, in the demo's `FactChipView` shape (`label` + `value`),
read from the run's ALREADY-DERIVED evidence receipt's `output` facts — which is literally *"the
same values the receipt prints"*, and reading them rather than re-flattening the terminal result is
what keeps the chip and the Receipt tab from being two derivations of one answer. A leaf becomes a
chip only where its redacted value is `allowed` and primitive; both exclusions are counted into the
absent `reason`, which keeps four states apart that an empty band would collapse.

**What did NOT land: `extractedCount`.** Nothing in `src/` computes how many people an OCR packet
holds — there is no `peopleCount` anywhere, the `people` run-detail section has no producer
(`config/pending-wire-bindings.json` declares it unserved against 2h), and the terminal result is an
opaque schema-bound value the projector may not go fishing in. Inventing a count from an array
length inside somebody's result would be exactly the guess D7 needs to not make: D7 says a packet at
OCR review shows *its* extracted count, and no run in this tree has one. **What closes it:** the
first OCR/packet workflow whose declared result names the count, at which point it is either its own
field or one more `facts[]` chip — and `facts[]` already carries it if the workflow declares it as a
result leaf.

---

## `subtitle` carries a prose run note, not an external identifier

**Recorded:** 2026-08-14 · **Status:** DISPOSITIONED 2026-08-20 (B8 sweep) — **won't-fix as
stated; the identifier half is tracked by the member-identity record below** · **Owning doc:**
ref dashboard-surfaces §1.2

**The disposition, and why it needs no new decision.** The record asks for `subtitle` to hold a
short external identifier, the way the demo's third footer segment does. That is refused on a rule
this tree already carries: **D109 retains `title`/`subtitle` as the exact text the confirmation
surface showed**, so the value is operator-AUTHORED, and re-purposing the slot would silently
discard what somebody typed — D233's rename lesson (*"applying yesterday's over today's discards
somebody's edit"*) one field over. The prose note is not a wrong value in the wrong place; it is the
right value in a slot the demo used for something else.

The half that IS a real gap — an external identifier for a run — is not this field, and it is
already recorded with its trigger under *"Member identity, group nouns and the rejected count"*
below: serving one needs a declared `identifierProjection` beside `subjectProjection`, proven
against the producing node's output schema, and no descriptor declares one. **That is the trigger
for the identifier; there is no trigger for this record, because nothing is waiting on a producer.**

The presentation question the record held open ("does a three-line prose note belong in a queue
footer at all") was answered by the wrap fix below and by DESIGN.md's footer rule — facts wrap, they
never truncate. Nothing further is owed.

**Symptom.** The demo's footer subtitle slot holds a short external identifier — an EID
(`10620118`) or a document id (`os-142012-b410`) — which is why it sits inline between the
trace chip and the timing. This projection serves the run's NOTE there instead: one of today's
rows carries *"re-read 1 — chunk 6b: the first run refused on a Playwright strict-mode
violation in the Person Org settle wait (D213); reading the document again on the fixed
driver"* — 1096 px of prose in a 375 px card.

**Demo element.** The third footer segment.

**Missing wire.** Not a missing field — a semantic mismatch in what `subtitle` is filled with,
plus the absence of a distinct external-identifier field (the demo's `eid` / `itemId`-shaped
value) for the slot the layout was designed around.

**Frontend half, fixed 2026-08-14.** The segment carried the demo's `whitespace-nowrap`, so the
long note neither wrapped nor ellipsized — the card's `overflow-hidden` cut it mid-word with no
signal that anything was cut. It now wraps (`min-w-0 break-words`), which is DESIGN.md's stated
footer rule (*"A row footer's facts WRAP; they never truncate … so a run with a queue note
takes a second line instead of cutting its trace id to `1…`"*) and is pixel-identical on a
demo-shaped short subtitle. The row is readable; whether a three-line prose note belongs in a
queue footer at all is the backend question this record holds open.

## Priority and preset on a queue row (inherited by the archive)

**Recorded:** 2026-08-19 · **Status:** OPEN — the `priority` half LANDED and DRAWN 2026-08-19;
`preset` has NO PRODUCER at any layer, blocked on the trigger named below (re-verified 2026-08-20:
no descriptor declares `presets`) · moved here from [archive.md](archive.md) when that file was
cleared to zero (Track B5).

**Updated 2026-08-19 — the PRIORITY half is landed AND DRAWN; `preset` has no producer at any
layer.** `QueueBaseFields.priority` is served from the run envelope (D95's `bump` target) with no
absent arm, and the archive inherits it. It renders in the provenance bar's ⓘ rather than as a chip,
which is the demo's own disposition for it (*"the same two words on every row an operator starts on
their own machine, so they cost a chip each to say nothing"*), with the bullet stating why the value
matters. So the demo element below is half satisfied by design: `Chip label="priority"` is
deliberately NOT a chip here, and only `preset` is outstanding. `preset` was NOT added: it does not exist as run data anywhere — no
descriptor in `src/workflows/` declares `presets`, `StartPlanRecordSchema` has no field for the
choice, `RunEnvelopeSchema` never carries one, and `run.queued` does not stamp one. Serving it would
mean a wire arm that can only ever be absent. **What closes it:** the preset has to be recorded
where the operator makes the choice and carried forward the way `priority` already is —
`StartPlanIngressSchema` → `StartPlanRecordSchema` → `RunEnvelopeSchema` → `run.queued` → the queue
wire — and until the first descriptor declares a preset there is nothing for that chain to carry.

- **Symptom:** the demo's identity chip row shows `priority` and `preset` beside version, app,
  trace, by and attempt; the served row shows neither. The archive INHERITS the gap, because an
  archived row is a frozen copy of `QueueSurfaceWire` — so this is a queue-row record, not an
  archive one, and fixing it here fixes both.
- **Demo element:** `Chip label="priority"` and `Chip label="preset"` in the run summary.
- **Missing wire field:** `QueueBaseFields` carries neither.
- **Where it would come from:** the start plan holds the preset and the priority the operator
  chose; both would have to reach `QueueSurfaceWire` at projection time. Read-forward per D133 —
  a run enqueued before the field existed reports its absence with the reason, and rows archived
  from then on carry it forward automatically, exactly as `dryRun` did (commit 446e7d7).
- **`dryRun` LANDED, `priority`/`warnings`/`displayName`/`subtitle` DID NOT reach the archived
  detail (corrected 2026-08-21).** `dryRun` was served on `QueueBaseFields` 2026-08-14 (446e7d7),
  and is present on `detail.row` — but `archive.tsx` reads it nowhere (`grep -n dryRun
  src/dashboard/surfaces/archive.tsx` → 0 hits). The same is true of `priority`, `warnings`,
  `displayName` and `subtitle`: all five are served on `detail.row` and read by nothing in
  `archive.tsx` (ledger 3 AR62, AR67, AR95, AR96, AR121, AR123). Drawing them on the archived
  detail is Track F's sibling unit F3's, not this file's.

---

## Member identity, group nouns and the rejected count — no producer, deliberately not served

**Recorded:** 2026-08-19 · **Status:** OPEN — three deliberate non-servings, each blocked on a
named producer-trigger below (re-verified 2026-08-20: `memberEid`/`groupNoun`/`rejectedCount` appear
nowhere in `src/` but in one comment explaining the absence) · **Owning doc:** ref dashboard-surfaces §9, ref frontend-backend-integration §3.2

Three fields from the wire-hookup ledger's `QueueBaseFields` batch were assessed while serving the
rest (D230/D231) and deliberately NOT added, because each would be a wire arm nothing in this tree
can populate.

- **Member `eid` / external identifier.** The demo's footer subtitle is `eid ?? trace`, and the
  rebuild has no EID on any run surface: `eid` exists only inside the identity-gate packet, and all
  five declared `subjectProjection`s point at a NAME, not an identifier. Serving `memberEid` would
  need a second declared address — an `identifierProjection` beside `subjectProjection`, proven
  against the node's real output schema the same way — and no descriptor declares one. Note the
  related `subtitle` record above: the slot the layout was designed around is a separate question
  from where the identifier comes from.
- **`groupNoun`.** The noun a counted anchor titles itself with (`5 separations`). It is a
  DESCRIPTOR declaration, and no registered workflow in this tree is `operation`-shaped at all, so a
  declared noun would be shaped by a sample of zero — D186's argument, one level down. `title`
  already carries whatever the descriptor's `presentation.title` composed, and `memberPreview` now
  names who is in the group. **What closes it:** the first operation-shaped workflow.
- **`rejectedCount`.** A submission the parent could not turn into work never becomes a run:
  `fanOutQueuedRuns` refuses the WHOLE fan-out inside the caller's transaction (so nothing partial
  is left behind to count), and a start-plan refusal rides the plan as data. The count that does
  exist lives on the intake session and the start plan, neither of which is a queue row. This is the
  same reason `containment` has no `rejected` arm (D231), and both close together with the first
  producer that writes a rejected CHILD ROW.
