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

**Landed 2026-08-14, second pass — per-row actions.** The "No per-row action controls" record is
deleted: `actions[]` is served per row (descriptor policy ∩ kernel preconditions, CAS-bound to
`rowRevision`, `queue-row-actions.ts`) and `FooterActions`/`RowContextMenu`/confirm-first all draw
it; doc 03's as-built delta owns the contract. The one remainder is NOT a regression of that
record: no `outcome`-placement descriptor is served because those are navigation-shaped and need
the linked-run wire fields — that half rides the "No linked-run chip" record below.

---

## The title is a document number, not a subject

**Recorded:** 2026-08-14 · **Status:** recorded · **Owning doc:** doc 03 §1.2, §9 D15

**Symptom.** Every rebuild row reads `Separation 4502` / `Separation 4524`. Every demo row
reads a person — `Priya Anand`, `Marcus Boone`, `Lena Hoffmann` — or the file the run is about
(`Oath_Packet_Summer.pdf`). Three of today's six rows are the SAME document number, so the
column the operator scans distinguishes nothing.

**Demo element.** The row title (`row.displayName ?? row.title`), plus its
`title="Named by you — subject is <subject>"` tooltip when the operator has renamed the run.

**Missing wire.** A subject-derived `title`, and `QueueBaseFields.displayName` (the operator's
own name for a run — it rides the row AND the receipt in the demo).

**Where it would come from.** The projector already reads the run's identity; the subject's name
is resolved by the identity chunk mid-run, so the honest shape is a title that starts as the
document number and is REPLACED once the subject node has a checkpoint — never a blank and
never a guess. `displayName` is a separate operator-authored durable field with no producer at
all.

---

## No run-number `#N` chip in the footer

**Recorded:** 2026-08-14 · **Status:** recorded · **Owning doc:** doc 03 §1.2

**Symptom.** The demo footer reads `2:18 PM · #1 · 10620118`; the second segment is the run's
ordinal for that workflow (`DemoQueue.tsx:709`, `#{row.run}`; the same value is printed on the
rename dialog's meta line beside subject/trace/elapsed, `DemoRunIdentity.tsx:433`).

**Demo element.** The bordered `#N` chip, second segment of the footer provenance line.

**Missing wire.** `QueueBaseFields.runNumber`.

**Where it would come from.** A per-workflow monotonic ordinal assigned at enqueue and retained
on `RunRecord` — it must be durable, because deriving it from the day's row order would give
the same run a different number on a different day's page.

**Deviation kept in the meantime.** `queue.tsx` draws the **trace id** in that chip slot
instead. That is deliberate and stays: the trace id is the run's name in every log, receipt and
support conversation, the demo's own comment says it is the last thing that may be cut, and a
chip that would otherwise be empty is worse than one carrying the id an operator actually
greps. When `runNumber` lands, the two are siblings, not substitutes.

---

## The gate age is served and the pill refuses to draw it (D12)

**Recorded:** 2026-08-14 · **Updated:** 2026-08-14 · **Status:** diagnosed — the WIRE half landed,
the render half is an operator call · **Owning doc:** doc 03 §9 **D12**, and doc 03's
*Queue-row projection as-built delta*

**What landed.** `QueueBaseFields.gateOpenedAt` is now served: present only on an
`awaiting-approval` row (a schema refinement refuses it anywhere else), sourced from the gate's own
`gate.opened` span — the same record the run-detail decision notice reads — with authority's
`lifecycle.parkedAt` as a documented fallback and `updatedAt` explicitly excluded. `HeaderChips`
computes the age against the bootstrap-calibrated `nowIso` and passes it to `StatusBadge`.

**What still does not render, and why it is not a bug to fix here.** `StatusPill`
(`src/dashboard/ds/primitives-status.tsx`) suppresses `age` for the `waiting` status, on a recorded
operator direction: *"Was `Waiting on you · age` in solid amber. Operator: drop the timer, and every
waiting tag becomes the blue `Review` pill — the word names the work, not the wait."*
`awaiting-approval` maps to exactly that status, so the row hands a real age to a pill that draws
none.

**The open question is an OPERATOR call, not an implementation one.** D12 is ratified and unamended
(*"an aging gate is the most actionable fact in the queue"*); the DS suppression is a later operator
direction recorded only in a code comment. One of the two has to give, and D126's rule — the
visible design is settled and is not to be relitigated by a session — means a backend session may
not decide it. Either D12 gets an amendment naming the direction that superseded its queue-row
half, or the `waiting` arm comes out of `StatusPill`'s age filter. The wire is ready for the second
either way.

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

## No linked-run chip

**Recorded:** 2026-08-14 · **Status:** recorded · **Owning doc:** doc 03 §9 D6, D10, D13

**Symptom.** Nearly every demo row carries a full-width chip under the title routing to a
related run — `Oath Upload · running ↗`, `OCR Review · done ↗` — which is how a linked child
and its parent stay one thought across two panels. The rebuild draws exactly one arm of that
band, `ParentBackChip`, and it is gated on `lineage.state === "child"`; all six of today's rows
are `root`, so the band never appears.

**Demo element.** `PanelRedirectChip` (:1099) and `LinkedReviewChip` (:1159).

**Missing wire.** `QueueBaseFields.linkedRunIds` and `reviewRunId`, each resolvable to a target
panel + the target's own status (the chip prints `Name · status`).

**Where it would come from.** The delegation manifest / linked-child records the kernel already
writes. Note this is the same gap the composition taxonomy record in
[workflow-taxonomy.md](workflow-taxonomy.md) approaches from the rail's side: a chunk run and
the composition that ran it are currently unrelated rows.

---

## No fact chips and no extracted-people count

**Recorded:** 2026-08-14 · **Status:** recorded · **Owning doc:** doc 03 §9 D7

**Symptom.** A demo row's chip band carries the run's own so-what — `signed 2:24 PM` on a
finished oath, `6 people` on a packet still at OCR review (which is D7, ratified: *"a packet
still at OCR review shows its extracted count"*). The rebuild has no equivalent, so a settled
row states its status and nothing about its outcome.

**Demo element.** `FactChipView` (:168) and the `Users` + count chip (:1030).

**Missing wire.** `QueueBaseFields.facts[]` and `extractedCount`.

**Where it would come from.** The run's terminal result — the same values the receipt prints.
The demo's `FactChipView` shape (label + value + growth behaviour) is the oracle for the field.

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
