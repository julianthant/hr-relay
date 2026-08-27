# `src/dashboard/` — the operator dashboard (browser bundle)

Everything under this directory is reachable from a browser entry (`index.html`, `capture.html`),
so it may import only pure contracts from `src/domain/**` — never a Node built-in, never a server
module (`dashboard-wire-boundary` walks the closure and fails loud). `DESIGN.md` is binding for
anything visual: read it before building a surface.

## Layout

| Path         | Contents                                                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `app/`       | the app shell: `main.tsx` mounts `dashboard-app.tsx`; URL/nav state, global keys, command dispatch, panel-section hooks, `index.css` |
| `surfaces/`  | every operator surface — see the pairing rule below                                                                          |
| `ds/`        | the design system: tokens (`tokens.css`/`tokens.ts`), primitives (`primitives-*.tsx`), theme, and the ONE barrel `ui.tsx`     |
| `client/`    | the BFF client: transport, queries, commands, day-state subscription, typed errors                                            |
| `state/`     | React-side resource hooks over the client (`use-bootstrap`, `use-dashboard-day`, `use-run-detail`, `client-context`)          |
| `lib/`       | framework-free helpers (`utils.ts` for `cn`, `preference-storage.ts`)                                                        |
| `phone/`     | the token-scoped phone capture page — its own entry, its own closure (`capture.html`); may not reach `surfaces/`, `client/`, `app/` |

## The surface / model pairing rule (React Fast Refresh)

A module under `surfaces/` or `app/` with a `.tsx` extension **exports components only**. Its
hooks, pure folds, vocabularies (`Record`/array constants) and wire-derived types live in a sibling
`<surface>-model.ts` — e.g. `queue.tsx` / `queue-model.ts`, `shell.tsx` / `shell-model.ts`. Shared
pure modules that serve several surfaces stay as plain `.ts` beside them (`format.ts`,
`layout-metrics.ts`, `workflow-category.ts`).

**Why:** `@vitejs/plugin-react` treats a module as a Fast Refresh boundary only when every export is
a component or is reference-equal across re-evaluation. One exported helper, hook or object constant
makes the module refuse the update, and the invalidation climbs to `dashboard-app.tsx` — the whole
app remounts and loses its state on every save. `dashboard-refresh-boundary.test.ts` (ref frontend-backend-integration §8.14)
enforces the rule; `ds/ui.tsx` is out of its scope on purpose (one barrel for the whole system is
worth the occasional full remount when a primitive changes).

Type-only exports are erased and are legal anywhere. A module-private helper or constant inside a
`.tsx` file is fine; only **exports** decide the boundary.

## Commands

```bash
npm run dashboard   # BOTH in one terminal: the BFF (3938, /api/v1/* + the SSE day stream) and vite (5174); Ctrl+C stops both
npm run cli -- dashboard   # the BFF alone
npm run web         # the vite dev server alone (proxies /api to 3938 — ECONNREFUSED there just means no BFF is up)
npm run web:build   # production bundle into dist/dashboard (the parity lane builds this itself)
npm run test:parity # ref frontend-backend-integration §7 visual/a11y parity lane
```

## Ruled deviations from the rebuild-demo

Two shell affordances have no demo counterpart and STAY, ruled by **D272 item 3**
(`ref dashboard-surfaces` §10; the sheet is `docs/decisions/2026-08-25-03a-demo-fidelity-core.md`
item 3, answered A on 2026-08-26). They are recorded here so a later fidelity pass reads them as
decisions rather than as drift, and each site carries the same citation in code.

| Deviation | Where | Why it stays | Rejected |
|---|---|---|---|
| **Escape-clear in day search** — a first `Escape` clears a non-empty query; a second closes the dialog (ledger 1 A16) | `surfaces/day-search.tsx` | Clearing is the cheaper correction and the second press still reaches the dialog, so nothing the demo's Escape does is unavailable here | B — remove both for exactness |
| **`Import spreadsheet` in the toolbar's left group** (ledger 1 A174 / B141) | `app/dashboard-app.tsx` | It is the only served door into the intake workspace; the demo reaches intake from inside the Run Modal and `RunStartSurfaces` serves no such handoff, so deleting it strands the workspace | B — remove both for exactness · C — build the Run-Modal handoff first |

Three more are ruled by **D273 items 5–6** (`ref dashboard-surfaces` §"D273 — run detail"; the
sheet is ledger 2, `docs/plans/2026-08-21-03a-fidelity-2-run-detail.md` §R-C). Same rule: each site
carries the citation in code.

| Deviation | Where | Why it stays | Rejected |
|---|---|---|---|
| **`Saving…` on the commit arm while a save is in flight** (ledger 2 C71) | `surfaces/context-rail.tsx` | The demo's save is a synchronous mock and this one is a real `run/edit-checkpoint` round trip. A control that looks identical mid-flight invites the second press D272's own after-dispatch lesson is about; the label IS the pending state, so the fact reaches a screen reader on the control's accessible name rather than through decoration | B — suppress the async state for exactness |
| **The Data section's `aria-label` is its VISIBLE label** (ledger 2 C16) | `surfaces/context-rail.tsx` | The demo's region says `Data` under a visible `Extracted fields` — a mismatch it inherited when its own visible label changed and its region name did not. Porting it would put two names on one region and undo the one-expression rule this bundle ratified for WCAG 2.5.3 (`intake.tsx`'s review checkbox). `DATA_SECTION_LABEL` feeds both halves so they cannot drift | A — port `aria-label="Data"` verbatim |
| **The unattributed ledger group takes no `Well` and no band** (ledger 2 C51/C54) | `surfaces/context-rail.tsx` | The demo has no counterpart because it always knows the step. The chrome ENCODES the step, so a group that has none has nothing to encode and an empty band would be D252's made-up heading in a quieter form. Its rows keep the dividers, which separate values rather than name a producer | B — give it a band with an invented or blank heading |

Neither is permanent: the import button goes when the run modal grows the handoff. The Escape-clear
is deliberately NOT a `shortcuts-model.ts` entry — the legend's own *When they fire* rules say an
open dialog owns the keyboard including Escape, and listing a per-dialog refinement as a global
binding would contradict them.

## Lessons learned

- **2026-08-26: a surface that re-reads what it just changed unmounts the only thing that says it
  changed anything (unit F10e, the defect F10d found and reported rather than fixed).** Applying a
  version bump made `ArchiveWorkspace` re-read the archive index, the re-read set the `index`
  resource back to `"loading"`, and the loading arm renders a skeleton IN PLACE OF `VersionsView` —
  which is where VB43's `applied` record lives, captured at dispatch because the plan is gone by the
  time the result lands. So the success banner and its `Open the archive` door existed, were pinned
  by two test files, and were never reliably on screen for a single frame. **Every fold and every
  render test in the family stayed green, because a surface that redraws after a command looks
  exactly like one that reported success** — the only thing that can see it is a press, which is why
  `archive-bump-round-trip-press.test.ts` is the third file in the unit lane to mount React (after
  `session-panel-pool-press.test.ts` and `run-start-dialog.test.ts`) and why its first case is the
  whole round trip rather than the banner alone.

  Three things travel. **The fix is the house rule, already written down twice**: a resource already
  on screen keeps its last value while the next read is in flight (`useRunDetail`, then
  `useCaptureSession`) — the FIRST read still loads, because a skeleton and a stale answer are
  different claims and only one of them is honest before anything has been read. Lifting the banner
  state above the remount boundary was the other candidate and is strictly worse: it does not
  survive a re-read that FAILS either, since the failed arm replaces the whole body too, and it
  spreads one surface's dispatch record across two components to work around a refresh that should
  not have been blanking the surface in the first place. **Rendering stale buys a window, and the
  window has a control in it**: for as long as the re-read is in flight the wire on screen still
  lists the plan that was just applied, so `Apply the bump` stood directly under `The bump was
  applied` — a control contradicting the sentence above it. The dispatch record carries the
  `versionPlanId` now and that one plan stands down until the re-read that no longer carries it
  lands. And **the banner's clear is a REMOUNT, so check what else the fix keeps mounted**: leaving
  the versions view still drops it, which is what should happen, and that arm is pinned rather than
  assumed now that a nearby unmount was load-bearing by accident.

  Still true of `detail`: the run-detail pane blanks to a skeleton on the same nonce. Its relaunch
  banner lives in the workspace and survives, so nothing is lost today — but it is the same one-line
  rule, unapplied, and it wants the identity comparison `useRunDetail` uses rather than this one's
  bare "already loaded".

- **2026-08-26: the codes were in the index the whole time, and a ported pixel constant is a claim
  about a VOCABULARY (unit F10c, ledger 3 §1/§8 — the archive family's remaining ruled rows).**
  Forty rows, six of which were code. Three things travel.

  **A "we do not have that field" row is worth one more look at the payload.** The sweep head
  printed `person-lookup v2 → 0.1.0` where the demo prints `pl v2 → 0.1.0`, and F10 left it open
  because `ArchiveSweepWire.appliedIdentities` carries workflow IDs and no code — which is true, and
  is not the same as the index not having them. It has them TWICE, with two different meanings:
  `versionState` carries the registry's code beside the version it is the code OF, so it answers the
  identity a sweep moved runs ONTO, and every archived run froze its own code beside the version it
  RAN (D242), so the entries answer identities the registry no longer holds. **Which source answers
  an identity is not a preference, it is the identity**: the join key is
  `(workflowId, descriptorVersion)` precisely so no code is ever carried across a version it was not
  true at, which is the silently-wrong derivation `ArchivedWorkflowCodeWireSchema`'s own docstring
  refuses. The fixture is what found the shape — the first key was "the archived run's version", and
  `appliedIdentities` names the version moved TO, so it missed every time and every sweep would have
  degraded to its workflow ID while looking completely reasonable.

  **A ported constant carries the assumptions of the tree it was measured in.** The demo's frozen log
  level column is `w-[46px]` because its levels are `info` / `warn` / `error`. This wire's enum is
  `info` / `warning` / `error`, and `WARNING` in caps overran the column and sat on top of its own
  message. Every fold assertion passed — the words were all present and in order — and only the
  screenshot said so, which is the third time in this directory that the capture taken to PROVE a
  port found the defect underneath it. The width is sized to the longest word this wire serves and
  the column does not truncate, because a clipped level is exactly the fact the column exists for.

  **A fact drawn under the wrong heading reads as complete.** The capture tile's badge printed
  `tile.kind` in a tone keyed off `tile.origin`, so an ordinary screenshot of a failed step wore
  danger red while an operator-requested one wore neutral: colour and word came from two different
  facts, both true, and only their PAIRING was a lie. The word is the origin now, `kind` joined the
  artifact's other physical facts, and `ARCHIVED_CAPTURE_ORIGIN_TONE` is total over the served enum
  in both directions so a sixth origin is a typecheck failure. The same shape one card over: three
  run-wide counts — attempts, data facts, evidence facts — sat under a card headed `Decision`, each
  already owned by a section that derives it from the FROZEN sections while `context` is the run
  detail's own count. Two sources for one fact, and where a section was never frozen its owner prints
  the REASON, which is a better answer than a number the archive cannot corroborate. They are gone;
  a removal is the hardest row to pin, so the test asserts their absence.

  Two more worth knowing. **Applying a bump settled in silence** — the index re-read, the plan left
  `plans`, the registry redrew, and nothing said the act had happened. `settleCommandResult` already
  answered `applied` and only its refusal half had a component, which is a shape worth grepping for
  elsewhere. Its banner needs the DISPATCH record as well as the verdict, because the plan is gone by
  the time the result lands and the verdict alone belongs to whichever command the surface last
  issued. `Open the archive` is offered only where a bump archived something — a minor bump archives
  nothing (D274 item 2), and a door onto no new rows is worse than no door; a generation-1 plan that
  recorded no kind KEEPS the door, because `undefined` is not `minor` and suppressing it would hide
  the runs that plan really did archive. And **a demo arm can be unrepresentable rather than
  unbuilt**: VB47's code-less refusal cannot arrive here, since `CommandResultSchema`'s `rejected`
  arm requires a `CommandRejectionCode` — recorded in the row so the next reader meets a decision
  instead of a gap.

  **And the same defect, one file over, found by the row that pointed at it.** AR133's disposition
  runs through `FailureRecordHead`, and the head's `record <uuid>` was a `Chip` — `w-fit`, clipping,
  with no `title` at all. That is worse than the pointer-only fact this directory has now fixed three
  times: `record aa11bb22-0…` in the archive's ~400px rail left the id an operator must quote in a
  bug report reachable by NOBODY. It rides the head's `MetaLine` beside the permanence sentence,
  which is there for exactly this reason; the `code` chip stays, because a rejection code survives
  truncation and a uuid does not. **When a fix moves one fact out of a clipping token, check what
  else is still in there** — the sentence and the id were side by side and only one of them was
  looked at.

- **2026-08-26: a wire that splits one flag into two arms has done half the work — the SURFACE is
  where the split survives or dies, and a geometry the parser refused has no shape to draw
  (D274 item 7, unit F13, ledger 3 §7 CP2–CP21).** `capture-start.tsx` had handed the operator a QR
  and then silence since D175: no phase, no page count, no expiry, no unreadable-page alert, no
  contact sheet, while the phone on the desk filled with pages nothing on screen acknowledged. No
  gate could see it, because **a door with nothing behind it is a perfectly good door** — the QR
  scans, the phone works, and the missing half is only visible beside the demo panel that is
  entirely about the desktop. The producer had landed the day before (F12) and `queries.ts` called
  neither route; `config/pending-wire-bindings.json` was carrying the gap as a DECLARATION, which is
  the mechanism working — the guard fails in both directions, so the declaration had to be deleted
  in the same commit that consumed it.

  Four things travel. **The interesting arm is the one the demo did not have.** F12 serves
  `unreadable` (the finalize bundler's own parse refusing the recorded bytes) and `unavailable` (the
  artifact failing read-back or its integrity check) as two arms precisely so "the check failed"
  cannot impersonate "the page is bad" — and a surface is free to undo that with one `.filter()`.
  They are two banners with two tones and two INSTRUCTIONS, and the instruction is the half that
  matters: telling an operator to re-photograph a form because a disk read failed is worse than
  saying nothing, and the negative control is that the two sentences may never read the same.
  **A page whose bytes would not parse has no served shape, and the tile may not invent one.** The
  frame draws each page's own `pixelWidth/pixelHeight`; the failure arms carry no ratio at all,
  because letterboxing them to a plausible US Letter would be this surface fabricating the one thing
  it exists to look at. (A SQUARE stands in — visibly not a page at 0.77, and close enough in height
  that the sheet still reads as one grid; the first build used `--ds-h-lg` and the screenshot showed
  a sheet with no baseline.) **The same word can mean something else on this side of the wire**:
  the demo's `ready` meant *ready to finalise* and here it is the durable `finalized` state, and its
  `blocked` meant *a page cannot be read* while here it is the FINALIZATION failing — the schema
  pins `phase` to the state machine alone, so an unreadable page moves no phase and its only signal
  is its own banner. Porting either label verbatim would have been true-looking and wrong. And
  **four demo facts have no producer and are ABSENT rather than optional** (device label, pairing
  code, a page's arrival instant, its filename, a focus score): the ⓘ names them out loud, so the
  next reader meets a decision instead of an oversight, and the test asserts the accessible name
  WHOLE so none of them can leak back in as a plausible blank.

  Two more from the same pass. **Capture is the one live thing here the day stream does not carry**
  — a capture session is not a run, so no SSE envelope moves when a page lands. The reads poll, and
  the hook says so: it stops at a terminal phase, and a failed read keeps ticking while the surface
  keeps SAYING it failed, because re-issuing the same GET is a retry but "the request died" and "the
  session is empty" may never draw identically. **And the selection has to LATCH.**
  `listActive` serves `open`/`finalizing`/`failed`, so a capture that finalizes — the successful
  ending — leaves the list at the exact moment the operator wants to read it; recomputing "the
  newest active session" each tick would jump them off it, so the id is adopted into state once and
  a departed session is still read by id and still named in the picker.

  **And the screenshot found the third thing twice, in one shape**: a fact printed at the far end of
  the thing it qualifies. The `Pages received` count and the ⓘ both wore the demo's `ml-auto`, which
  is right in a ~600px modal and wrong in an ~830px column — the count sat 800px from its own noun
  and the ⓘ 1,300px from the words it explains. Both are against their labels now; the picker keeps
  the right edge, because a picker IS a row's trailing control.

  What is NOT drawn, and why: no page BYTES, so no thumbnail — the production byte path is doc 04's
  deferral and every frame here is a served shape holding an icon. No retake-in-place control: `PUT
  /api/v1/capture/phone/photos/:photoId` exists and no client implements it (ledger 3 CP45), so the
  banner says *remove it on the phone and photograph it again*, which is what the phone can actually
  do. The panel is scoped to its intake screen's workflow — a served field, so a scope rather than a
  hidden fact.

- **2026-08-26: a head composed in ONE consumer's JSX is a head the second consumer loses in
  silence, and a vocabulary of three tones is a vocabulary of two when the palette paints two
  (D273 item 8, unit F8c, the review of F8b).** Five findings, and three things travel.

  **The head.** F8b put the record's three head facts — the run's own `summary`, its `code`, its
  permanence — into `log-panel.tsx`'s JSX. The archive's failure card is the record's SECOND
  consumer and draws `FailureDetailBody` alone, so it lost all three the same day: an archived
  failed run printed its write state, its remediation and its diagnosis under a bare
  `Failure record` label, with the one sentence the run wrote about itself nowhere on the page.
  Nothing failed and no gate could see it, because **a card with no head is perfectly
  grammatical** — the defect is only visible beside the surface that has one. `FailureRecordHead`
  lives in `trust.tsx` beside the body it heads, and the `available` / unserved fork stays with
  the panel, because only the live stream can hold a record the projection refused. The pin is the
  archive card rendered directly (`ArchivedFailureCard` is exported for it, like
  `InlineFailureRecord` before it), with a transient/permanent pair as the negative control: a head
  hard-coded to one arm passes any single case.

  **The tone.** `WRITE_STATE_TONE` named three tokens — success, `--ds-status-parked-fg`,
  `--ds-status-waiting-fg` — and the last two are the SAME amber in both themes, here and in the
  demo it is ported from, where `parked`'s own violet was re-derived to amber years ago. So the map
  claimed a distinction the screen has never drawn. `unknown` takes `--ds-status-waiting-fg`
  outright now: **a second token name for one colour is the `--log-violet` rot in a new place**, a
  name that outlives the colour it was picked for and then lies to the next reader. No hue was
  invented — D232's budget is one accent and five semantic hues, the fifth was bought outright for
  `dry run`, and nothing left is honest for "the write outcome is unknown". Nothing is lost because
  **colour was never the carrier**: the three arms' sentences differ, and the `FailureWriteStateTone`
  vocabulary keeps all three arms so a palette that later buys `parked` a hue changes one line
  rather than re-deriving which arm deserved it. The test reads `ds/tokens.css` — the same move
  `archive-window.test.ts` makes for row heights — and fails if any two tones drawn here resolve to
  one colour in either theme.

  **And the two a11y findings are this directory's own lessons, landing again.** `aria-label` on the
  record's role-less `<div>` named nothing (HTML-AAM computes no name for a generic element) — the
  timeline segment's lesson, one surface later, and worse here because the container is focusable
  on purpose: the outcome bar's `Open failure` lands on it, so the record announced nothing at the
  moment of arrival. It is `role="group"` now. `What this run left behind` was a bare `<div>` with a
  caps label while its sibling `What is safe to retry` was a named `<section>` — **weaker semantics
  on the louder fact**, and it is now the same `<section>`, its visible label and its accessible
  name from one expression. The fifth finding is `Chip`'s own docstring quoted back at it:
  `permanent — the same input will fail again` is a sentence, it clipped inside a `w-fit` token and
  recovered the cut on `title` alone, and **a fact reachable by pointer and by nobody else is a fact
  the product does not have** (the third time in this directory). It is a `MetaLine` under the chip
  row — still in the head, because a fact that decides whether the operator presses retry cannot
  wait for a disclosure. The screenshot then found what the diff could not, again: loose in the
  head's wrapping row, the danger triangle took a line of its own above the summary in the
  archive's ~400px rail, so the glyph and the sentence are one nested item.

- **2026-08-26: a record that says the CATEGORY instead of the FACT reads as complete, and the tone
  a wire does not serve is a judgement somebody has to make out loud (D273 item 8, unit F8b,
  ledger 2 §R-E).** The failure record's head said the constant `This run failed` — which the status
  pill, the outcome bar and the danger tint had each already said — while the one sentence the run
  wrote about itself, the served `summary`, waited a line below in body copy. Nothing was missing
  and nothing could fail: a head that names the category is grammatical, sufficient-looking and
  wrong only beside the demo. **When a surface holds a served sentence and prints a constant over
  it, the constant is the defect even though it is true.** The category arm survives in exactly one
  place — the record the projection could not serve, where "this run failed" is the whole of what is
  known — and the render test pins that this arm grows no code, no permanence and no write state,
  because an unserved record that looks like a served one is the fail-loud rule inverted into
  display.

  Four things travel. **A boolean with one drawn arm is a fact with no opposite.** `transient` is
  required on the wire and drew the bare word `transient` when true and NOTHING when false, so
  *permanent — the same input will fail again*, the reading whose whole job is to stop the operator
  pressing retry, was indistinguishable from a record nobody had classified. Both arms are stated
  now; silence is not the opposite of a warning. **A tone the wire does not carry still has to be
  decided, totally, in one place.** The demo keys its write-state colour off a served
  `tone: none | unknown | other`; this wire serves a six-arm enum and no tone, so `FAILURE_WRITE_STATE`
  makes the mapping once and the test asserts it covers `WriteStateSchema` in BOTH directions — a
  seventh arm is a typecheck failure, never a silent default. Only `not-attempted` takes the settled
  colour: `prepared` reaches no target system and still gets the cautious one, because a staged
  intent is a durable row and a fence somebody may have to clear, and **a tone that is wrong in the
  reassuring direction is the only one that can put a duplicate termination into UCPath.**
  **The disclosure's contract is a NEGATIVE claim, so the test that matters asserts both halves at
  once**: on a closed record the diagnosis is gone AND the write-state block and the remediation
  ladder are still there. Either half alone passes for the wrong reason — a disclosure that hides
  nothing satisfies the second, one that hides everything satisfies the first — and D18's rule is
  precisely that only diagnosis may sit behind a press. And **a count of one is a sentence, not a
  blank**: `sameFingerprintSeen` drew only when `> 1`, so "this has never happened before" and
  "nobody counted" occupied the same empty space. D141's refusal is about the LIST of other runs and
  survives untouched — the repeat arm states the count and nothing else, and the test's negative
  control is that it leaks no `last`, no window and no trace.

  **And the screenshot found what the diff could not, again.** `remediation Operat…` — a `Chip` is
  `w-fit` and clips, so beside a sentence that wanted the width it gave its own up and recovered the
  cut on `title` alone, which is a fact reachable by pointer and by nobody else. It is `shrink-0`
  now. The same pass is why the permanence chip is known to survive 1024: it was checked in a real
  engine rather than argued about from a class list.
- **2026-08-26: a fact printed at the far end of the thing it qualifies is a fact the reader of that
  thing does not have — and the screenshot that proves the port is the one that finds the defect
  underneath it (D273 item 7, unit F8a, ledger 2 rows D8/D9/D11/D17/D24/D29/D39).** Seven receipt
  rows, and every single one was a fact this tree ALREADY SERVED. `confidence` was on the wire and
  rendered as one bare word at the bottom of the body, so the operator reading `Done` in the verdict
  band had no way to know nothing had been read back; the demo's three `CONFIDENCE_COPY` sentences
  had no counterpart at all. The write KIND was folded into a sentence, the completion criterion had
  no glyph, and the section whose whole job is saying what is still uncertain said it with the single
  word "load-bearing" — and said NOTHING in the false case, so a declared-harmless warning and an
  unclassified one rendered identically. **None of these is a missing feature; each is a served value
  drawn where nobody reads it, which no wire audit and no typecheck can see.** Four things travel.

  **The scatter is the finding, so the fix is a fold, not a move.** The demo's one identity line had
  become three lines in three places here (`completed` on the band, `receipt`/`run` in a section
  header, `attempt`/`retry of`/`generated` at the body's foot), and relocating any one of them would
  have made four. `receiptIdentityItems` composes the whole line once and each fact has exactly one
  home at a time — on the band when a band exists, under the absence when it does not.
  `ReceiptEvidenceBody` takes `bandCarriesIdentity` rather than losing the facts outright, because
  the ARCHIVE mounts the same body with no band and dropping them there would be the same defect in
  a second place.

  **A deliberate non-port needs a record with teeth.** D273 rules the demo's `receiptInvariant`
  Banner OUT — but the audit's complaint was never that the check is missing, it was that nothing
  wrote down why it cannot fire, which makes a decision indistinguishable from an oversight. The
  reasoning is now a comment at the omission's own site AND
  `receipt-invariant-unrepresentable.test.ts`, which pins every clause the schema refuses. A comment
  alone goes quietly false the day the invariant is relaxed; a test does not.

  **And the capture is not a formality.** The screenshot taken to PROVE the port immediately showed
  two things no test could. A `Receipt` caps label sitting directly on top of the body's own `INPUT`
  caps label with nothing between them — the section had existed only to head the meta line row D9
  moved, and its emptiness was invisible in the diff. And, at the bottom of the same frame,
  `result partial` under a band reading a green `verified-done`: the run outcome and the receipt
  derive the same verdict two ways and disagree, which is D268's defect one level further out and is
  now `docs/findings/dashboard-projection.md`. That divergence is also why the receipt's own `result`
  deliberately STAYS on the trailing line instead of being suppressed as a duplicate of the band —
  **before you delete a fact as redundant, check that the two sources actually agree.**

  What is NOT drawn, and why: the dry-run Banner (row D13) is a served cue this unit could not land,
  because `dryRun` reaches `ReceiptView` only through `log-panel.tsx`'s call site, which a parallel
  unit owned. It is a one-line prop away and is deliberately NOT stubbed as an optional flag
  defaulting to false — that would print "not a rehearsal" about a run nobody asked.

- **2026-08-26: a restated pixel constant is a claim about a class list, and a KIND that decides
  nothing reads exactly like a KIND that decides something (D274–D276, unit F10, ledger 3 §1/§8).**
  Two halves of the archive family, and the same shape twice — a fact the surface HELD and did not
  make true.

  **The window.** D274 item 1 ruled the archive's 800-row virtualization in. The demo's mechanic
  ports whole (one flat item list, a collapsed sweep costing one item, two spacer `<tr>`s instead of
  transforms so the table stays a real table with its sticky `<thead>`), but the LIBRARY does not:
  `@tanstack/react-virtual` estimates heights and corrects by measuring, and here both row kinds have
  a KNOWN height, so `windowArchiveTable` is exact arithmetic over a prefix sum with no estimator to
  be wrong. What that buys is also what it costs — **the spacers are only correct while the declared
  heights are the real ones.** The sweep head was `h-auto`, i.e. 52px because its content happened to
  be; it is `--ds-h-archive-sweep` now, and `archive-window.test.ts` reads `ds/tokens.css` and asserts
  both constants equal the values set on the elements. A spacer a few pixels short of the rows it
  stands in for is a table that slides under its own scrollbar, and no typecheck, lint or fold test
  could ever have seen it. Two smaller rules travel. **An unmeasured viewport renders everything, not
  nothing** — "nothing is visible" and "we have not looked yet" are different facts, and only one of
  them should blank a list. And **an elastic overscroll is clamped while a non-finite measurement
  throws**: WebKit really does report a negative `scrollTop`, and the visible top of the content
  genuinely is 0 there, but `NaN` is not a scroll position and windowing from it would silently empty
  the table. This is the archive's own window and is NOT D9's proposed shared `ds/` primitive.

  **The kind.** Until F9, `VersionBumpChangeRecordSchema.kind` was a pure label — nothing branched on
  it — so the surface had honestly dropped the word MAJOR from every sentence that needed it. F9 made
  it behavioural (`resolveBumpEffect`; a minor plan listing a candidate or a blocker is now
  zod-unrepresentable), and the interesting part is what that does to the DRAWING. `versionState` is
  kind-agnostic: the same numbers reach both arms and only their meaning changes. So the minor arm may
  not render an empty candidate list beside an empty blocker list, because **an empty list reads as
  "we looked and found none", which is a claim about this scope rather than about minor bumps.**
  `resolveBumpKindEffect`'s minor arm therefore carries no `blockers` and no `archivable` key at all —
  the facts survive under `unaffected` / `wouldHaveArchived`, and the banner states the RULE
  ("nothing can block a minor bump, because nothing is archived") with the in-flight count labelled as
  what a MAJOR bump would have faced. The blocker table's resolution head is parameterised the same
  way, with a third arm for a generation-1 plan that recorded no kind at all: neither head is true of
  it, so it gets its own. **A fixture is a claim too** — `fixture-archive.ts` held a `minor` plan with
  a blocking run, which the durable schema now refuses outright, and it drew a screen reading "a minor
  bump archives no run at all" above a table demanding that run be resolved first. The wire schema
  still admits that plan; `VersionBumpPlanWireSchema` carries no D274 refinement, and that gap is
  named rather than closed here.

  **And a disabled control is not the only way to hide a rule.** VB41's argument ported: the primary
  is never disabled, because a greyed-out button hides the one refusal this flow exists to enforce.
  But the first build put the resulting refusal below the fold of a scrolling dialog body, under the
  button that produced it — **an answer the operator cannot see is the dead button in a different
  coat**, so it scrolls itself into view. The refusal is composed locally and says so: the schema that
  refuses an empty `what` is the same schema on both sides of the wire, so dressing it as a server
  round trip would be a lie, and naming the empty fields is something a round trip could not do
  better anyway.
- **2026-08-26: two whole sections were missing because one server array said `["storage"]`, and the
  fix that made them appear was a list, not a renderer (D274 item 6, unit F11, ledger 3 SE40–SE42).**
  Settings → System hosts and Settings → Workflow capabilities had no code anywhere and no gate could
  say so: `buildSettingsNav` renders whatever `settingsSections` lists, the takeover names a served
  section it cannot render, and both of those arms worked perfectly over a list of one. The data was
  already in the process the whole time — the resolved config knows every system's entry host, and
  the descriptor registry knows every graph's dry-run posture, its gates, its Edit Data policy — so
  the absent thing was never authority, it was the SENTENCE that says these exist. **When a surface
  is driven by a served list, the list is the feature**: check what the server puts in it before
  concluding a section is unbuilt, and remember that a one-element list makes every "what if it is
  not here" arm look proven.

  Four things travel. **A wire that carries prose has two authors for one screen**: the capability
  rows carry a state, a node id and a count, and `settings-model.ts` owns every label, meaning and
  sentence — the same split that keeps `categoryId` raw on the bootstrap. It also settles the label
  question: the capability wire carries NO workflow label, because the bootstrap already serves one
  and a page holding two names for one workflow will eventually show both. **A read must apply the
  write path's refusal, or it advertises something the product will refuse.** `listSystemEntryHosts`
  drops a `test` URL that is not DISTINCT from production for exactly the reason
  `resolveSystemEntryUrl` throws on it — a page that printed it would be promising a sandbox every
  run asking for it is turned away from, which is the fail-loud rule inverted into display. **A
  refusal is not an empty table.** "No test host is configured" and "we could not ask the server"
  occupy the same blank space and only one of them is ever true, so the failed arm names the failure
  and says *nothing below is missing — nothing below was asked for*; the negative control in
  `settings-status-sections.test.ts` is that a refusal must NOT contain the words `none provisioned`.
  And **`break-all` belongs to the value, never to the cell**: put on the `TD` so a deep PeopleSoft
  route would wrap, it also reached the absence beside it and rendered `none pro / visioned` — a
  screenshot caught it and no test could, because the words were all present and in order.

  What is deliberately NOT drawn: the demo's other twelve capability columns (roster, workers,
  presets, phone capture, duplicate check, multi-file, merge, sub-selections, member outcomes,
  delegation …). No descriptor in this tree declares any of them, and D274 item 4's rule for that
  case is to build the served vocabulary and name the boundary in the banner rather than mint a
  column that is wrong silently. The bootstrap's `systemInstances[].test` is also untouched: it says
  a run cannot SELECT a test instance, which is still true — this page states the hosts and offers no
  picker, so the two facts do not contradict.

- **2026-08-26: a finding named three things in one breath, half of it landed, and the half that
  did not had no row of its own to be missed from (D273 item 5, unit F7, ledger 2 C51).** R6 f.1
  asked the Data ledger for "the step LEVEL, a `Well` per step, a recessed caps band and divided
  rows". D252 delivered the levels — correctly, and with the harder half of the work, the served
  `origin.nodeId` grouping — and the chrome was simply not mentioned again. Nothing regressed and no
  gate could see it, because the *surviving* half is self-consistent: a caps label over some rows is
  a perfectly ordinary heading, and only the demo beside it says the hierarchy was supposed to be
  drawn rather than labelled. **When a finding names a structure and a treatment in one sentence,
  they are two rows — split them at the point of ratification, or the treatment becomes the thing
  nobody can prove is absent.** Two more travel from the same pass. **Chrome is a claim about the
  content it wraps**: the ledger's unattributed group takes neither Well nor band, because the band
  encodes the step and a group with none has nothing to encode — an empty band would have been
  D252's own refusal (never invent the heading) restated in a quieter register. And **the group's
  BODY takes the rail's own surface back**, so the pair reads as one banded ledger rather than as a
  card inside a panel; a Well drawn all the way through would have been the nested container the
  craft floor bans, and would have said "these values are inset" when the true fact is "these values
  share a producer".

  The same commit's other half is the refusal (D273 item 6, C55/C57/C70). **A surface that HOLDS the
  reassuring fact and does not say it is the fail-loud rule's failure mode in display form.** A
  refused save kept every draft — `save()` has done so since D253 — and drew one uncoded red span,
  so the operator saw a red line and no statement that their work survived. It now says the count,
  says what was not done, and carries the server's code where there is one; the arm with no code
  says so rather than inventing one. Three habits behind that. **A third ceremony is not
  automatically a third parameter**: `refused-notice-model.ts` exists because two near-identical
  copies drifted, and the reflex was to add a `checkpoint-edit` arm to it — but two of that notice's
  three clauses are false here (the held work is drafts ABOVE the control, not "your answer below",
  and the count is a fact a dialog does not have), and parameterizing a shared string until it is
  the union of three ceremonies is how the drift it fixed got in. **The count is captured at
  DISPATCH, not read at render**: the operator keeps typing while a command is in flight, so "your
  3 edits are still here" has to be a fact about the save that was refused. And **C70's duplicate
  resolves toward the VISIBLE half, always** — the blocked reason was on the primary's `title` and
  in a sentence under the dock, and it is the tooltip that goes, because a reason reachable only by
  pointer is a fact the product does not have (D272 items 8–9, landing a second time on a second
  surface).

- **2026-08-26: a reason that lives only on `title` is a fact the product does not have, and the
  two places this modal kept one had already stopped being the same code (D272 items 8–9, unit F5,
  ledger 1 rows C48/C81).** `LockedValue` puts its `reason` on `title`, so both of the Run Modal's
  locked values — the parser CONSTANTS under *How this run is shaped* and the active-run policy in
  the rail — stated why they were locked to a mouse and to nobody else. It was invisible on the
  1440x900 parity reference for months and no gate could see it: the reason WAS in the props, the
  prop WAS rendered, and the test that would have caught it is the one that strips `title=` before
  asserting. That strip is now the assertion (`run-start-kit-render.test.ts`) — **when a fact is
  supposed to be reachable without a pointer, the test has to remove the pointer first**, exactly
  the way the touch-target guards measure a real hit box rather than a class list. The other half is
  that the two sites were a hand-rolled pair: identical label span, identical `LockedValue`, and only
  one of them was ever going to be re-read. They are one `LockedFact` now, and the second render case
  exists to say so.

  Three more from the same port. **A stale-result clear belongs to the REQUEST, not to each
  control's `onChange`.** The demo calls `setResult(null)` from inside every control it draws
  (`DemoRunStart.tsx:882,893`) and the rebuild had copied only half of that — the three controls
  cleared the plan and left the settled result banner standing over a request that no longer existed.
  Enumerating the missing calls would have fixed today's three and not tomorrow's fourth, so the
  invalidation is derived from ONE `startRequestFingerprint` covering every field the server binds
  the plan token to; a control added later cannot forget a line that does not exist. Its negative
  control is instance-key ORDER, which must NOT re-plan — a `useState` artefact is not an operator
  decision, and re-fingerprinting on it would throw away a live token for nothing. **A group's
  numbers are a reading path, so a group that is not drawn may not keep its number**: the rail always
  drew *02 Safety & mode* with a disabled Dry run reading "not declared by this workflow" and froze
  Destination at `03`, which left a gap at every workflow that declares no flags. `DESIGN.md:305`'s
  offer-disabled rule is written for an OPTION inside a control, not for the group around it —
  `runControlGroups` decides both membership and numbering in one fold, and contiguity is asserted
  rather than the two literal lists. And **a banner whose state has no exit is not an honest state**:
  the `conflict` arm named a moved contract while D253 refuses a re-send of the same envelope
  identically, so the operator was told what happened and given nothing to do about it. The demo's
  own cure ports directly (`Reload the form`) because the rebuild has the same one — drop the spent
  plan token, return to Input, and let the next `POST /start-plans` read the version the server
  actually serves.

  What is NOT drawn, and stays a `builds:` line rather than a plausible constant: the plan card is
  the demo's shape with only the fields `StartPlanResponse.planned[]` serves — no role, panel,
  containment, born-as status or note — and the applied/rejected banners keep their client-authored
  titles because `CommandResult` serves no headline, detail, settlement clock or actor. C28's
  `"No workflow"` title and C94's zero-system Well keep their honest empty states unchanged, which is
  the half of D272 item 9 that is a decision to change nothing.

  **Amended 2026-08-26 (unit F5b, the review of the ports above).** Nine findings, and four things
  generalize. **An invalidation rule holds only for state that has already LANDED.** C109's
  fingerprint effect was correct and complete, and it could still be beaten: an in-flight
  `submitStartPlan` / `executeCommand` that settled AFTER the edit re-landed its answer on top of the
  state the effect had just cleared, and the operator was looking at a plan for text that was no
  longer in the box. Every dispatch now captures the fingerprint it was made for and drops a
  settlement whose identity has moved — and the ref that answers "what is the request now" is updated
  in the SAME effect that does the clearing, which is what makes the ordering self-healing: whichever
  of the two wins the race, nothing stale survives it. Dropping a superseded `applied` costs no
  record, because `applied` is a receipt that the request was accepted and the queue changes only
  from the authoritative projection (ref frontend-backend-integration §0.5) — this surface never was
  where an enqueued run is kept. **Clearing a settled banner without clearing the STAGE it is the
  content of leaves the rail naming a step over an empty region**, and the control that was just
  pressed unmounts under the operator's focus, which lands on `document.body` and restarts the dialog
  at its first control on the next Tab. `Close`, `Dismiss` and `Reload the form` are one
  `returnToInput` now — C72 rules the WORD on the button, not the act behind it, and after all three
  the plan token in the form is spent. **A `title` is not a second rendering of a fact, it is a
  second READING of it**: `LockedFact` was passing its reason to `LockedValue` (which puts it on
  `title`) *and* drawing the `<p>` that exists to replace that tooltip, so a screen reader said the
  same sentence twice — the fix to C48/C81 had left the defect it removed still in the props. The
  pin is a count, not a presence: the reason must occur exactly ONCE. And **`Chip`'s own docstring
  was the review finding**: "if a fact cannot survive truncation it is not a chip — put it on the
  row's `MetaLine`, where it can wrap." A plan row's match key and trace id are exactly that, and
  they were chips, recovering the cut on `title` alone. The two assertions that catch it are the
  absent `title=` and the absent `whitespace-nowrap`, because a fact moved into a second clipped
  token would pass the first one on its own.

  The other half is a lane. `run-start-dialog.test.ts` is the SECOND file in the unit lane to render
  and press React (`session-panel-pool-press.test.ts` was the first), for the same reason: the folds
  were pinned and the WIRING between them was not, so deleting C109's whole `useEffect` and re-adding
  C107's removed `stage === "input" &&` gate both stayed green across the entire suite. An absence —
  a gate that is deliberately not there — cannot be pinned by any fold. Two mechanics are worth
  copying. **Never hand a DOM node to `assert.equal`**: `assert.equal(element, null)` spends the whole
  test budget inside `util.inspect` walking a live tree and takes the worker process out with it, so
  the only report is `Worker exited unexpectedly` — compare identities to a boolean first. And **a
  `click()` in jsdom moves no focus**, so a focus assertion after a press is vacuous unless the press
  helper calls `focus()` the way a pointer or a Tab would.
- **2026-08-26: `aria-label` on a bare `<span>` names nothing, and the class that reveals a
  disclosure is dead the moment its group loses its last focusable child (D273 item 2, unit F6).**
  The run-detail timeline's segments were `<span aria-label={stepAriaLabel(step)}>`. Two independent
  failures rode in that one element and neither could show up in a diff, a typecheck or a fold test.
  HTML-AAM computes no accessible name for a generic element with no role, so the sentence the code
  so carefully composed — *"Find person — done, took 4s"* — reached nobody; and the member
  disclosure below it opens on `group-focus-within:block`, which cannot fire in a group whose only
  interactive child was replaced by a span, so **the whole D225 grouping was pointer-only.** The
  first defect made the second invisible: an audit reading the markup sees an `aria-label` and
  concludes the fact is reachable. Three things travel. **A disclosure trigger is a control** —
  the demo's own note (`DemoLogPanel.tsx:574-619`) is that the segment takes a hover tint and
  deliberately no press dip, because it discloses rather than commits, and that is still a
  `<button type="button">`. **`group-focus-within` is a claim about a SIBLING**, so it silently
  decays when an unrelated element changes tag — grep for the class when you convert any element
  inside a `group`. And **a wait may not vanish for want of a slot**: the same pass restored the
  orphan-gate segment (B57), whose whole reason for existing is that `gate.openedAt` is served
  whether or not any step happens to carry the `blocked` state, and a surface holding a fact it does
  not draw is the fail-loud rule's failure mode in display form. The same commit's other half is
  the axis (B60/B61): it printed the first→last event SPAN under the word `elapsed`, so a run parked
  for an hour after four seconds of work reported an hour of work — **two numbers that are both
  real are not interchangeable, and the label is what decides which one you owe.** It names the
  measured WORKING sum and the WAITING age separately now, and a half with nothing behind it does
  not print: `workingSec` is `undefined` rather than `0` when nothing was measured, because *"did no
  work"* and *"nothing measured it"* are different claims and only one of them is true.

  **The proof lane, and its gap.** The three decisions are pure exported folds
  (`timelineSegmentUnmeasured`, `timelineHasOrphanGate`, `timelineAxisTotals`) and the MARKUP half
  is a `renderToStaticMarkup` test, because no fold can see whether the component consumed it —
  each was run against a mutation of the code it pins. Worth knowing for the next pass:
  **`tests/parity/helpers/fixture-day.ts` serves no `timeline.steps` at all**, so every parity
  reference photographs the read-forward per-EVENT strip and D225's categorical strip — the one this
  work changed — has never been in a screenshot. That is why the render test is the load-bearing
  proof here and not a belt-and-braces extra.

- **2026-08-26: a control the server derives must be NAMED by the surface, and a summary flag beside
  the list it summarises is a second source for one fact (D271, Session Panel pool controls).** The
  panel's scale-down is a `plan-worker-count` carrying one number, and the kernel derives which
  members that stops — canonical indices `N+1..MAX`, whose running ones must each be covered by a
  bounded graceful stop. There is no wire arm carrying explicit indices, so D271's *"a scale-down
  names the explicit member indices"* is honoured by the SURFACE naming them from the same
  derivation and making the operator confirm that list, not by inventing a payload. Three things
  travel. **When the bundle must restate a kernel constant** — `src/dashboard/**` cannot import
  `src/core` — restate it and PIN it: `SESSION_POOL_MAX_WORKERS` and `poolMemberWorkerId` are
  asserted equal to `MAX_WORKERS_PER_POOL` and `poolWorkerId` in `worker-pool-controls.test.ts`, so
  raising the cap on one side alone fails a test instead of offering a size the supervisor refuses.
  **A derived list beats a derived flag**: the intent first carried a `scaleDown` boolean beside its
  `excess` list, and the button rendered from the flag while the sentence rendered from the list —
  which is how *"Stop 0 members and plan 1"* was drawn, in danger red, for a plan that stops
  nothing. The flag is gone; everything the popover says now comes off `excess.filter(running)`.
  And **the CAS basis travels with the view, never re-read at the composer**: `expectedVersion` is
  the pool version the operator was looking at (`0` for a workflow with no row), so a stale basis
  produces the `conflict` the CAS exists for — drawn in the band with the live version, never
  retried, because the decision was made against a count that has since moved.

  What is NOT served, and therefore not drawn: per-worker supervisor ownership
  (`supervised` / `external`), the stop escalation policy and its observed stages, and any
  "awaiting birth" phase. The panel says so in the band's authority-details popover rather than
  hiding controls it cannot justify hiding — **absence of a fact is not permission to guess the
  control's outcome**, and the server's refusal by name stays the authority. The same rule made the
  thrown-post arm `unknown` rather than "nothing was sent" (unit F2d): once the envelope is on the
  wire, the process effect may already have run.

  **Amended 2026-08-26 (unit W4b, the review of the controls above).** Nine findings, and four
  things generalize. **The unit lane MAY render and press React — when the claim is a dispatched
  payload rather than a pixel.** Every fold under these controls was pinned and the WIRING between
  them was not: nothing could see which `expectedVersion` `shell.tsx` hands the composer on a press,
  or how many presses it takes to send one, and both have been wrong here before.
  `session-panel-pool-press.test.ts` mounts the real panel under `jsdom` (declared per-file; Radix's
  positioner takes two measurement-free stubs) and presses the real buttons. The standing rule that
  behaviour belongs to the parity lane still holds for anything about layout — a payload is not
  layout. **A touch floor taken as `min-h` costs none of the containment argument an `::after`
  overlay costs**, because a control in a flex row grows the ROW; that is why the queue member
  toggle needed two lessons about clipping and reach and these controls needed none. It is still
  MEASURED in a real engine (`tests/parity/pool-control-touch-target.spec.ts`), with the
  fine-pointer case in the same file as its negative control — the same measurement returning 24px
  proves neither assertion is vacuous and that the coarse rules are gated. **`AuthorityDetails` is
  drawn for a `flex-1 truncate` host**: its 44px target hangs on a negative margin over the value's
  truncation point, so a control put beside a content-width label sits on the label's own text. That
  is why the live worker card's identity route rides its SUBLINE — the header label is content-width
  — while the unmet and retained cards, whose labels are `flex-1`, carry it in the header. And **a
  popover that recovers a clipped value can clip it again**: the fact list was `nums` + `break-all`
  for everyone, which is right for a 40-character id and renders a sentence as `this i / ndex`, so a
  fact declares its `kind`.

- **2026-08-26: the destination a deleted control was traded for is the one nobody checks was built
  (D272 item 1 / D274 item 5, unit F4).** The top bar's keyboard glyph was deleted on the operator's
  own instruction — *"we already have help in settings"* — and Settings → Help → Keyboard was never
  built, so `DemoShortcutsLegend` had **zero callers** and the whole keyboard legend was reachable
  from nowhere. Nothing failed, because the surviving half of a two-half change is self-consistent:
  a deleted glyph looks exactly like a glyph that was never there. Building the destination exposed
  the second defect immediately: **`/` was bound in `day-search.tsx` and missing from
  `shortcuts-model.ts`, under a doc comment in that same file asserting the legend already carried
  it.** A registry that nothing renders cannot be wrong in any way a reader will notice, so it drifts
  freely and its own rule — *a binding that is not here is unreachable from Help* — enforces nothing.
  Two habits travel. **When a change is justified by a destination, land both halves in one commit or
  book the missing half as a task with the deletion's D-number on it**; "for the X that owns it next"
  in a component's doc comment is not a task and expires silently. And **an unrendered vocabulary is
  an unverified one**: prefer wiring the surface that reads it, even minimally, over leaving a
  correct-looking array nothing consumes. The same commit removed `ShortcutsPopover` for the same
  reason its own comment gave for keeping it — its stated future arrived (Settings → Help) and
  renders the registry directly, and the rejected alternative (option C, restore the top-bar glyph)
  is the only thing that would have wanted it back.
- **2026-08-26: a CSS custom property reaches a portal-free provider viewport only through DOM
  ancestry, and the theme root was one level too low (D272 item 2, ledger rows A168/A169/A170).**
  `ToastProvider` renders its viewport as a **fragment sibling** of its children, not through a
  portal — so with `<TooltipProvider><ToastProvider>` wrapping the app's themed root div, the
  viewport was not a descendant of that div and inherited none of its custom properties.
  `--ds-toast-inset-bottom` resolved to nothing, the viewport silently took its own
  `var(--ds-space-loose)` fallback, and every toast in the product sat on top of the Session bar —
  visible the moment the page booted, and **invisible to typecheck, to lint and to every unit test**,
  because a `var()` fallback is a legal value. The variable and the nesting are ONE fix: setting the
  property without moving the root, or moving the root without setting the property, both leave the
  screen exactly as it was. Two things travel. **A `var(--x, fallback)` is a silent fallback of
  exactly the kind this repo bans elsewhere** — it cannot distinguish "the shell chose the gutter"
  from "the shell's value never arrived", so check where the CONSUMER sits in the tree, not only
  that the producer set it. And **moving an app root moves every attribute on it**: `data-parity-ready`
  stayed on the inner element while `data-demo-theme` went up, so the parity theme assertion that
  read the theme *through* the readiness flag started reading `null`; it selects `[data-app-root]`
  now, which is the element the comment always claimed it meant ("the one that wins the cascade").
- **2026-08-26: a `<label for>` names an `<input>` and does NOT name a `<button role="checkbox">`, so
  the DS `Checkbox` ships every one of its controls nameless.** Intake's rejection acknowledgement —
  the gate that holds the plan closed until the operator has seen every non-valid row — resolved with
  an EMPTY accessible name, verified against the built bundle: the control is a Radix
  `Checkbox.Root`, which renders a `<button>` whose only content is an `aria-hidden` indicator, and
  HTML-AAM computes a `button`'s native name from its SUBTREE, never from an associated label. The
  visible text was right there in `<label for>`, the label click even toggled the box, and a screen
  reader still announced "checkbox" and nothing else. `intake.tsx` now passes one `reviewLabel`
  expression to BOTH `label` and `aria-label` so the two cannot drift (WCAG 2.5.3). Two things
  generalize. **The label being clickable proves nothing about the name** — geometry, hit-testing and
  naming are three independent claims, and this one passed the first two while failing the third.
  And **a locator that never matches can only report the test timeout**: the parity case spent the
  full 120 s deadline inside `locator.evaluate` saying nothing about the cause, so the spec now
  asserts `toHaveCount(1)` on the named role FIRST and the missing name names itself. `ds/Checkbox`
  itself is still unfixed — every other checkbox in this bundle has the same empty name, and the fix
  belongs with the deliberate parity re-freeze, since naming them all rewrites the a11y references.
- **2026-08-26: three ways a queue control can be short of the truth, and only one of them was
  visible in the diff (unit F2, queue fidelity review).** All three were the same shape — a value
  the surface HELD and did not make reachable. (1) `bulkPlans` was composed by filtering `surfaces`
  by the selection, so a selected id whose row had left the day fell out of the plan and out of
  every count downstream: `Cancel 3 · 1 skipped` under `6 selected`, with two rows accounted for
  nowhere. Not sent AND not disclosed is the omission the fail-loud rule forbids, and the fix is
  structural rather than a caption — `planBulkVerbs` now takes the WHOLE selection and returns the
  difference as its own `unavailable` bucket, `selectedIds` is required rather than defaulted from
  `rows` (a default reinstates the drop at the next call site that forgets it), and
  `bulkUnavailableIds` throws on the inverse. **A count and its explanation must be derived from the
  same input**: the strip's "none of the N selected rows serves cancel" was computed from a
  different N than the one it printed. (2) The member line's toggle was 24px against a 44px touch
  floor, and the obvious fix was a hazard: at the line's 28px pitch a 44px overlay reaches into the
  rows above and below, so a tap near a boundary marks the WRONG member. **When a target cannot grow
  without overlapping its neighbours, grow the PITCH** — `--ds-h-member-line` is 44px under
  `@media (pointer: coarse)`, both well heights derive from it, and the parity corpus renders at
  `pointer: fine` so no reference moved. **Amended 2026-08-26 (unit F2c): that fix was 44px in the
  class list and 44 x 24 on screen, and only a real engine said so.** Two ancestors took the height
  back. The toggle sits in the member line's NAME cell, which carries `truncate` — `overflow: hidden`
  clips an absolutely-positioned descendant, and the cell is exactly as tall as the 24px of paint it
  holds, so the width survived and the height did not (`MEMBER_TOUCH_TARGET_HOST` lifts the clip under
  the coarse gate; `overflow-y` cannot be un-clipped alone, CSS computes the other axis to `auto`).
  Then the un-clipped 44px target centred on a line with **43px of content** — the well is `divide-y`,
  so every line but the last spends 1px of its own border box on the hairline — and hung half a pixel
  over the row above, where `elementFromPoint` resolves to THIS toggle inside the NEIGHBOUR's row. The
  coarse line is now `calc(44px + var(--ds-border-w))`. **A touch floor is a claim about the engine's
  hit box, not about a class list**: measure both axes, in a real engine, or the guard passes while a
  finger gets half the target. And **when a token is a target's size, remember what the border box
  already spends** — `h-44` with a 1px divider is a 43px target. (3) A `Chip` clips its paint and put the whole value on
  `title` alone — reachable by mouse, by nobody else, which DESIGN.md bans outright. The row already
  had the sanctioned Popover, so the fix cost no new chrome: `rowInfoFacts` composes absent reasons
  and PRESENT values into one fold and the ⓘ prints the value unclipped (`break-words`, not a second
  truncation). Two habits carried all three: the decision landed as a **pure exported fold** because
  this tree renders no React in the unit lane, and each test was **run against a mutation of the
  code it pins** — the touch-target guard was proved by ungating one `after:` utility, the fact fold
  by having it print the label instead of the value.

  **Amended again 2026-08-26 (unit F2d): fixing a target creates targets, and a fix's OWN neighbours
  are the next defect.** Four more, all downstream of the three above. (a) The member toggle's 44px
  overlay was CENTRED, so it reached ~10px back across the name button `--ds-space-tight` to its
  left: a tap on the end of a truncated name toggled the checkbox instead of selecting the row — the
  same wrong-act-on-the-right-row error as the pitch bug, in the axis nobody had measured. It is
  anchored to the toggle's LEFT edge now and spends its 44px going right, where only inert subtitle
  text sits. **Containment is a claim about every direction the box grows in**, and the probe that
  catches it is an adjacent-TARGET probe (what does the neighbour's last pixel resolve to), not a
  size assertion. (b) The name button beside it was 16px tall inside a 44px line — **growing a line
  for one control does not give the height to the others on it.** (c) The ⓘ from (3) above was
  itself 20px: **a control introduced to fix a reachability defect inherits the floor of the thing it
  replaced.** Its overlay needed the title LINE grown too, because the card is `overflow-hidden` and
  clips whatever the line does not hold — F2c's lesson landing a second time, on a different clip.
  (d) The toolbar's refusal sentence was `truncate` with no ⓘ to recover it: **the row's popover
  route does not exist on a toolbar, so a clipped sentence there is unreachable on every pointer** —
  it wraps, and the band takes `min-h` instead of `h` so it has somewhere to wrap to. And one that
  is not about pixels at all: the one-command route's chained `.catch` titled every post-dispatch
  throw `Nothing was recorded`, **a negative the client cannot know** — the envelope is already on
  the wire and the fulfilment arm's own guards throw only after a result came back, so an operator
  who believes it re-issues a command that may have landed. Both stages now settle through
  `commandFailureToast`, and the after-dispatch arm says the result is unknown and names the one
  thing that resolves it. (The bullet above says this tree renders no React in the unit lane. It
  does for COPY: `queue-bulk-band-sentence.test.ts` runs the real toolbar through
  `renderToStaticMarkup`, which is what pinned the tense and the absent `truncate` here — a
  sentence composed across three JSX branches has no fold to test.)
- **2026-08-26: two near-identical components do not drift apart evenly — one of them goes stale and
  keeps saying the true thing, and the other quietly stops (D273 items 9–10, 03a ledger F22/F35).**
  `park-resolve.tsx` and `identity-approve.tsx` each carried a `RefusedNotice`: same two arms, same
  code/no-code split (`rejected` always carries a code, `conflict` never does), same enter
  transition. The gate copy's uncoded arm said *"The gate is still open and your answer below is
  untouched"*; the park copy's said *"Nothing was recorded and your answer below is untouched"* —
  which is the banner's own TITLE, three lines up, in place of the one fact the operator opened the
  dialog to learn. Nothing failed. **A duplicate is not two copies of one thing; it is two things
  that happen to agree today**, and the one that stops agreeing is the one nobody re-read.
  `refused-notice.tsx` + `refused-notice-model.ts` are the merged pair, with the ONE clause that
  genuinely differs — *what is still true after the refusal* — carried by a `ceremony` parameter.
  Four rules travel. **Parameterize the fact, not the sentence**: the clause is stated twice per
  ceremony (`sentence` and `clause`) rather than case-folded from one form, because a fold that
  lower-cases the first character works until the first standing fact that begins with a proper noun.
  **The negative control is the test that matters** — the pinned case is "the two ceremonies never
  read the same", because if the parameter stopped arriving both strings would still be grammatical
  English and nothing else in the suite could fail. **Merging two copies means picking the right
  one, out loud**: the park copy wrapped its children in a `role="alert"` inside a `danger` Banner
  that already carries one, so a screen reader said the sentence twice and every
  `getByRole("alert")` there was ambiguous — the gate copy's reading won, and the render proves it
  (`alerts-in-dialog=1`). And **the defect the diff cannot show is the one the render shows**: both
  copies interpolated the server's message straight into the product's sentence, and a `conflict`
  message ends in no period, so the screenshot read `…replaces it The write is still parked…` as one
  broken sentence. Same commit's other half is D273 item 9 — the park dialog's footer `meta` slot
  reprinted `runId · rev · generation` under a fence Well that already carried `generation` as a
  chip. **Repeating a fenced fact in a quieter type a few hundred pixels below its own chip teaches
  the eye that the chip row is not the whole truth.** The gate dialog's footer meta is untouched:
  D273 ruled on the park footer, and "while I was in here" is not a ruling.

- **2026-08-21: an HTTP status decided by reading an error MESSAGE is a protocol keyed on prose, and
  every surface that renders a refusal inherits the mistake (Track D row D2, audit C3).** The BFF's
  `failureStatus` classified every throw by substring — four phrases meant 404, `"is not available"`
  meant 409, `"degraded"` meant a retryable 500 — so rewording an operator-facing sentence moved its
  status, a new producer phrasing the same refusal differently silently got a 500, and NOTHING in
  the gate family could fail when either happened. The kind now travels with the throw
  (`src/server/failures.ts`: `TargetNotFoundError` / `SectionUnavailableError` /
  `ProjectionDegradedError`) and `routes/failure-status.ts` maps by `instanceof`. Two things
  generalize past this file. **The negative control is the test that matters**: the pinned case is a
  plain `Error` wearing each retired phrase answering 500, because the arm that used to be wrong is
  the arm nobody would write a test for. And **a mapping worth testing is worth extracting** — the
  function moved out of `api.ts` into its own module for no reason other than that the claim ("a
  reworded refusal cannot move a status") is about the mapping, not about any one route, and a test
  that has to compose a whole app to reach it would have been written against one route and left the
  rest unpinned. The same commit's other half is the shape D181 named: a scope gate is only
  enforcement if something SUPPLIES its precondition, so the capture phone-host gate's producer is
  now pinned by the guard beside the gate's own behaviour, not assumed.

- **2026-08-20: a fetched value is a fact about the MOMENT it was fetched, and three surfaces here
  read one as if it were standing (D256/D257 and §9.22 item 3).** The first time this dashboard was
  driven against a real composed run, all three of its defects were the same mistake: the right KIND
  of fact, read from the wrong INSTANCE of it. `boot.serverClock.now` is the instant one bootstrap
  fetch happened at, and every live elapsed computed against it, so the whole screen's clock stopped
  at page load — a parked run read `0s` for two minutes, because the tab predated the run and
  `elapsedSecondsBetween`'s clamp turned a negative difference into a plausible zero. The run-detail
  wire is the run as of the last thing the operator clicked, and nothing re-read it from the day
  stream, so an open panel said `Queued` beside a row saying `Done · took 8m 20s` and never offered
  the receipt. And `boot.descriptorHash` is the whole descriptor SET's hash, compared against ONE
  run's `contractFingerprint`, so the "shape moved" hazard was on for every run ever drawn. Three
  rules travel. **A page's now must be DERIVED, not received**: keep the server's instant as the
  authority and add the browser's monotonic time since it arrived (`state/served-clock.ts`) — one
  hook, called once, passed down, because a component reading its own `Date.now()` puts a second
  clock on one screen. **A surface that renders a live thing needs a live key**: the day stream
  already carries every run's `rowRevision`, so following it is a dependency, not a poll. And
  **before comparing two hashes, check they are the same kind of hash** — this one could never be
  equal, and a warning that can never NOT fire trains the eye past the one that matters. Two habits
  that made the fixes safe are worth copying: the parity lane pins the OTHER half of the clock
  (`installFrozenMonotonic` + `assertMonotonicFrozen` in `tests/parity/helpers/app-driver.ts`), so a
  ticking elapsed renders exactly the fixture's served instant and no reference moved; and every
  decision landed as a pure exported fold (`deriveServedNow`, `planRunDetailFollow`,
  `classifyRunShape`) because this tree renders no React in the unit lane, so anything left inside a
  component is pinned only by a screenshot.
- **2026-08-20: a `.then()` that handles one refusal arm calls the other one success (D253).** Two
  surfaces here — the Context rail's Data save and the notification bell — branched on
  `result.state === "rejected"` and let the CAS `conflict` arm fall through to the code that runs on
  success. The rail closed its editor, cleared the drafts and reported a correction saved that the
  kernel refused. **All nine command-issuing surfaces in this directory now settle through
  `app/command-result.ts`'s `settleCommandResult`** (Track D row D3, 2026-08-21 — this bullet said
  so on the day D253 landed, while seven of the nine still enumerated the arms by hand, which is
  exactly why the correction was BOOKED as a row rather than left to be discovered by whoever
  believed it). `command-result-exhaustive.test.ts`
  holds it in two arms: a module may not name one refusal arm without the other (both `===` and
  `!==` count; `archive.tsx`'s negated early return is exhaustive and clean), AND a module that
  calls `.executeCommand(` must import the fold — the second arm exists because a module naming
  NEITHER arm passed the first one while landing every refusal on its success path.

  **When you add a surface that posts a command, read the result through the fold — do not
  re-enumerate the arms.** The fold answers `applied` or `refused`, and a refusal carries both the
  composed one-slot `problem` sentence AND the server's own `message` / `code` / `currentVersion`,
  so drawing a refusal in your own components costs you nothing and never re-decides the verdict.
  What the fold does NOT own is COPY: `problem` adds the version sentence, `message` is the wire's
  own, and the seven surfaces D3 converted deliberately kept `message` because the parity corpus
  photographs one of their refusals.
- **2026-08-20: the rail's "we cannot serve this" comments were about the checkpoint row, not the
  descriptor (D252).** `context-rail.tsx` recorded direction and system as unservable for years. The
  checkpoint row genuinely carries neither — but the node that wrote it declares a task contract
  (`effect`) and the store implementing that task declares the system, and both reach the run-detail
  query through `RunDetailDescriptorView.dataOrigins`, composed at the root because a descriptor may
  not reach a store (D106). If a surface comment here says a fact has no producer, check the
  descriptor and the module before believing it.
- **2026-08-21: "the bundle already carries it" is an argument about ONE source that quietly costs a
  whole composition root — and the IMPORT is what makes the bundle a source (D264 row D11, amending
  D251).** D251 (below) refused three run-modal wire rows because `summary`, `enqueue` and
  `surfaces.inputRun` are plain data on `AnyWorkflowDescriptor`, and serving them would give one
  surface two sources for one value. The two-sources rule was right and the price was never
  measured. A descriptor's plain data does not travel alone: `WORKFLOW_DESCRIPTORS` pulls every
  registered workflow's whole graph, node specs, task contracts and the `src/base/**` builders that
  mint them, so the browser downloaded the composition root to render three fields — **1,114,214
  bytes, 753,197 after the import was deleted.** The fields now ride `WorkflowStartWireSchema` on the
  boot document, projected at the composition root from the same descriptor the daemon plans with,
  so there is still exactly one source. Three things travel. **Serving a fact does not change where
  its bytes came from**: the redaction audit demanded an origin for seven new free-text leaves and
  every one is `repository-authored`, because a descriptor constant is a developer's sentence
  whichever side of the wire it is read on — a guard asking that question at the moment a field
  crosses onto a wire is the guard working. **The rule is held by a CLOSURE arm, not a lint on
  import lines** (`dashboard-wire-boundary` (15)): one shared helper re-exporting a descriptor puts
  the whole tuple back with nothing in the diff that reads like a registry import, which is arms
  (13)/(14)'s lesson a third time. And **a served fact retires a client default**: the modal's
  `enqueue: descriptor?.enqueue ?? "reject-active"` was a fail-closed guess standing in for a fact
  the server always had, so `enqueue` is REQUIRED on the block and the `??` is gone. `run-start.tsx`
  needed no edit — the composed `RunStartWorkflow` is identical field for field.

- **2026-08-20: a fact the browser bundle already carries does not need a wire, and booking one as
  "unserved" invents backend work nobody owes (D251 — see the D264 amendment above; the sentence
  "`surfaces/run-start.tsx` composes its catalogue from `WORKFLOW_DESCRIPTORS`" is no longer true of
  this tree, and the rest of the entry stands).** Three run-modal rows sat on the detail-audit
  ledger as wire gaps — the workflow's own sentence, its active-run policy, and the reason an
  unstartable workflow is not offered. All three were already reachable: `surfaces/run-start.tsx`
  composes its catalogue from `WORKFLOW_DESCRIPTORS`, and `summary`, `enqueue` and `surfaces.inputRun`
  are plain data on `AnyWorkflowDescriptor`. Serving them a second time over the bootstrap would give
  one surface two sources for one value, which ref frontend-backend-integration §8.2 already forbids. The unstartable reason was
  worse than unserved: `dashboard-app.tsx` had been composing it since the picker landed and the
  surface dropped it, under a comment claiming the tree served none — **a false deferral comment is
  the same defect as a missing feed, and it is the harder one to find, because it tells the next
  reader not to look.** Two rules travel. Before booking a wire row, check whether the descriptor
  bundle answers it. And when a demo control has no server that would honour it — the demo's
  `Active-run policy` select against a `descriptor.enqueue` the planner reads with no per-start
  override — draw the FACT read-only in the control's slot rather than the control: an operator choice
  the server ignores is a wrong value about what is being started.
