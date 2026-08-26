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

## Lessons learned

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
