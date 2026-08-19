# Queue-row findings

Records where a queue-row element the demo draws — or doc 03 §9 ratifies — cannot be powered
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
the `warnings` count (D22/D126) are SERVED and DRAWN; their records are deleted, and doc 03's
*Queue-row projection as-built delta* is where the contract now lives. `gateOpenedAt` (D12) and
`dryRun` (D6) are SERVED and still not drawn — each for a reason that is a design decision rather
than a wire gap — so both records stay below, rewritten to state exactly what is left and who owns
it. **The opening claim above no longer holds for those two:** the frontend is not 1:1 on them, and
neither gap closes by serving another field.

**Landed 2026-08-19, third pass — the ordinal, the class, the links and the outcome.** `runNumber`
(D230, durable on `RunRecord` behind schema v15), `priority`, `containment`, `linkedRuns[]`,
`facts[]`, `pipeline[].durationSec`/`executions` and `memberPreview` are SERVED; doc 03's
*"The second batch"* as-built delta owns their contracts. The records below are rewritten to state
only what is LEFT, and four of them are now about a missing PRODUCER rather than a missing field —
the field was deliberately not added, because a wire arm nothing can populate is the orphan
`wire-connectivity.test.ts` exists to catch.

**Landed 2026-08-14, second pass — per-row actions.** The "No per-row action controls" record is
deleted: `actions[]` is served per row (descriptor policy ∩ kernel preconditions, CAS-bound to
`rowRevision`, `queue-row-actions.ts`) and `FooterActions`/`RowContextMenu`/confirm-first all draw
it; doc 03's as-built delta owns the contract. The one remainder is NOT a regression of that
record: no `outcome`-placement descriptor is served because those are navigation-shaped and need
the linked-run wire fields — that half rides the "No linked-run chip" record below.

---

## Rename has a kernel command and no operator control

**Recorded:** 2026-08-14 · **Status:** recorded · **Owning doc:** doc 03 §1.2, §2.4

**Symptom.** `RunRecord.displayName` is durable, `rename` has been a kernel command since Phase
1c (`command-kernel.ts:1569`), the row serves and draws `displayName ?? title` with the demo's
"Named by you — subject is <subject>" tooltip — and no build gives the operator a way to SET it.
`KERNEL_ONLY_COMMANDS` records the display-name edit as an inline row field; only a CLI/API
caller can rename a run today.

**What a fix involves.** The inline rename field (demo `DemoRunIdentity.tsx`'s dialog) wired to
the existing `rename` command — a UI session's work, no wire or kernel change. *(Replaces the
"title is a document number" record, whose wire halves — subject-derived `title` via the
descriptor's declared `subjectProjection`, and served `displayName` — both landed 2026-08-14;
that record's claim that `displayName` had "no producer at all" was wrong.)*

---

## No run-number `#N` chip in the footer — WIRE HALF LANDED 2026-08-19 (D230)

**Recorded:** 2026-08-14 · **Updated:** 2026-08-19 · **Status:** the wire half is SERVED; the chip
is a UI session's line · **Owning doc:** doc 03 §1.2, §"The second batch"

**Symptom.** The demo footer reads `2:18 PM · #1 · 10620118`; the second segment is the run's
ordinal for that workflow (`DemoQueue.tsx:709`, `#{row.run}`; the same value is printed on the
rename dialog's meta line beside subject/trace/elapsed, `DemoRunIdentity.tsx:433`).

**Demo element.** The bordered `#N` chip, second segment of the footer provenance line.

**Missing wire.** `QueueBaseFields.runNumber`.

**What landed (D230).** Exactly that: `RunRecord.runNumber`, a per-workflow monotonic ordinal
assigned at enqueue from `nextWorkflowRunNumber` inside the inserting transaction, promoted to a
mirrored `tasks.run_number` column with `UNIQUE (workflow, run_number)` by schema v15, and served as
`QueueBaseFields.runNumber` with a D133 read-forward absent arm for every run enqueued before v15.
`queue.tsx` does not draw it yet — that is the remaining half, and it is a UI line, not a wire gap.

**Deviation kept in the meantime.** `queue.tsx` draws the **trace id** in that chip slot
instead. That is deliberate and stays: the trace id is the run's name in every log, receipt and
support conversation, the demo's own comment says it is the last thing that may be cut, and a
chip that would otherwise be empty is worse than one carrying the id an operator actually
greps. Now that `runNumber` is served the two are siblings, not substitutes — and the trace id is
also what the footer keeps drawing for a pre-v15 run, whose ordinal is honestly absent.

---

## The `dry run` chip has its field and no tone to draw in

**Recorded:** 2026-08-14 · **Updated:** 2026-08-14 · **Status:** diagnosed — the WIRE half landed,
the chip needs a DS decision · **Owning doc:** doc 03 §1.2, doc 09 (dry run)

**What landed.** `QueueBaseFields.dryRun` is served on every row, read from the run envelope (D6's
one home for the flag, and the same bit `executeDryRun`/`executeTransaction` turns on). There is no
absent arm by design.

**What still does not render.** Nothing draws it. The demo's chip is VIOLET
(`DemoQueue.tsx:437`, titled *"this rehearsal reads the systems and writes nothing"*) and
`ROW_CHIP_TONE` in `queue.tsx` has exactly three tones — `neutral`, `info`, `warning`. There is no
violet in `tokens.css`, and the one token that carried the name was deliberately re-derived to
amber (`--log-violet: #f79009; /* unconfirmed / parked — warning, not a category */`). Drawing the
chip in `info` would put it in the same tone as the `test` chip it sits beside, which is the one
pair a glance has to separate.

**What a fix involves.** A DS decision — either a fourth row-chip tone with its own light/dark
token pair, or a ratified reason the rehearsal chip shares a tone with `test`. That is a UI
session's call, not a backend one; the field is served and the chip is one line the moment the tone
exists.

---

## No linked-run chip — the LINK half landed 2026-08-19 (D231); `reviewRunId` did not

**Recorded:** 2026-08-14 · **Updated:** 2026-08-19 · **Status:** `linkedRuns[]` is SERVED;
`reviewRunId` has no model to serve from · **Owning doc:** doc 03 §9 D6, D10, D13

**Symptom.** Nearly every demo row carries a full-width chip under the title routing to a
related run — `Oath Upload · running ↗`, `OCR Review · done ↗` — which is how a linked child
and its parent stay one thought across two panels. The rebuild draws exactly one arm of that
band, `ParentBackChip`, and it is gated on `lineage.state === "child"`; all six of today's rows
are `root`, so the band never appears.

**Demo element.** `PanelRedirectChip` (:1099) and `LinkedReviewChip` (:1159).

**What landed (D231).** `QueueBaseFields.linkedRuns[]`, named for what it carries rather than for
ids it does not: each entry is `{ runId, workflowId, label, panelKind, status }`, resolved through
the same status function every row's own status comes from, so the chip can print `Name · status`
without the client re-deriving a status from the day payload. `containment` (`root | member |
linked`) is served beside it, and the member and linked partitions are disjoint by construction.
The list is EMPTY for every registered workflow today — no descriptor declares a `child-run` node
that fans out to a separately-panelled run — which is an honest zero the projector fills the moment
such a child appears in the fold.

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

## No fact chips and no extracted-people count — FACTS landed 2026-08-19; the COUNT did not

**Recorded:** 2026-08-14 · **Updated:** 2026-08-19 · **Status:** `facts[]` is SERVED;
`extractedCount` has no producer · **Owning doc:** doc 03 §9 D7

**Symptom.** A demo row's chip band carries the run's own so-what — `signed 2:24 PM` on a
finished oath, `6 people` on a packet still at OCR review (which is D7, ratified: *"a packet
still at OCR review shows its extracted count"*). The rebuild has no equivalent, so a settled
row states its status and nothing about its outcome.

**Demo element.** `FactChipView` (:168) and the `Users` + count chip (:1030).

**What landed.** `QueueBaseFields.facts[]`, in the demo's `FactChipView` shape (`label` + `value`),
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

**Recorded:** 2026-08-14 · **Status:** recorded · **Owning doc:** doc 03 §1.2

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

**Recorded:** 2026-08-19 · **Status:** recorded · moved here from
[archive.md](archive.md) when that file was cleared to zero (Track B5).

**Updated 2026-08-19 — the PRIORITY half landed; `preset` has no producer at any layer.**
`QueueBaseFields.priority` is served from the run envelope (D95's `bump` target) with no absent arm,
and the archive inherits it. `preset` was NOT added: it does not exist as run data anywhere — no
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
- **Already closed:** `dryRun` LANDED on `QueueBaseFields` 2026-08-14 (446e7d7) and the archived
  detail draws it.

---

## Member identity, group nouns and the rejected count — no producer, deliberately not served

**Recorded:** 2026-08-19 · **Status:** recorded · **Owning doc:** doc 03 §9, doc 13 §3.2

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
