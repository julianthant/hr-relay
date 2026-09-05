# Dashboard lessons

Moved verbatim from this directory's instruction pair on 2026-09-04. Search by the
affected surface/task/decision and read the relevant entries before changing the seam.
Historical entries retain their dates; current owning contracts supersede retired mechanisms.
When asked to record a lesson, reconcile it here rather than expanding `AGENTS.md`.

## Lessons learned

- **2026-09-03 — an attempt is a complete reading surface, not one side of a product-authored diff
  (D289 amendment, 2026-09-03).** Fold retries into one logical-item queue row with separately
  selectable attempt numbers; each attempt opens its own timeline, logs, receipt, failure, reuse and outcome. The dashboard
  must not compare two attempts automatically or revive a comparison-only request, state machine,
  panel, or parity scene. `retryOf` remains visible lineage so the operator can open the attempts
  and compare their facts directly. Until the queue projection stops emitting one top-level row per
  run, that folding is an explicit gap rather than behavior the docs may claim is built.

- **2026-09-03 — a wire the client "mirrors" is a wire the client can drift from.** The start-plan
  request/response schemas live ONLY in `src/domain/dashboard/start-plan.ts`; `client/commands.ts`
  imports them and exports `StartPlanResponse` as a type alias of `StartPlanWire`. Never redeclare a
  wire schema under `src/dashboard/` (the contract test refuses it). A domain leaf a browser bundle
  needs must not sit beside `node:crypto` — split it out (`domain/run/start-refusal.ts`). Correcting
  a fixture to the real closed vocabulary can move rendered parity references; that is a deliberate
  `test:parity:update`, never a widened schema.
- **2026-09-03 — a replayed cursor is not new state, and an ending the client cannot classify is
  not a network blip.** `subscription.ts` applied every snapshot and patch it parsed, so a resume
  replayed state the client already held — and the replay of a REMOVAL names a run the held day no
  longer carries, which `applyDashboardDayPatch` calls a protocol failure and this module answers by
  discarding the whole day and resnapshotting. So the resume contract §3.5 spells out was buying a
  full snapshot every time it worked correctly, and nothing could see it: every envelope was valid,
  every day on screen was right, and the only symptom was traffic. A PATCH at or below the held
  cursor now returns before any effect; hello's generation-change branch still clears that cursor,
  which is the ONE thing that lets a replacement generation's lower-numbered snapshot in — pin that
  arm, or the guard silently swallows a restarted hub's whole history. **And the guard's threshold
  is not the same for both kinds, because the first build applied it to snapshots too and that was
  its own defect (fixed 2026-09-03, same day).** `#notify` stamps every change of ONE projection
  batch with the same cursor, so a count-neutral member change beside a count-bearing one is served
  as `patch pc:N` then `snapshot pc:N`: the client applied the patch, held N, and dropped the
  snapshot — the half that carries the worker cards, the pools and the count rollups — leaving them
  stale behind a green Live dot with no later envelope able to correct them. A snapshot REPLACES the
  day rather than editing it, so re-applying one at the held cursor is idempotent by construction
  and only a snapshot from STRICTLY BEHIND is stale; a patch is an EDIT and keeps `<=`. **Before
  reusing an idempotence rule across two envelope kinds, ask whether they COMPOSE the same way** —
  and check what one producer batch can emit under one cursor. The other half was
  `stream.done.then(f, f)`: EOF and every rejection ran the same reconnect and the rejection VALUE
  was dropped on the floor, so an HTTP refusal or a protocol failure reconnected forever behind a
  dashboard that still looked live. Classification is by error KIND — only the transport's `network`
  kind reconnects — and deliberately NOT by `error.retryable`, which `httpError` copies straight off
  the wire body: honouring the server's hint about re-issuing ONE request would let a 503 that calls
  itself retryable rebuild the same endless loop. A value this client did not author is named as an
  unclassified stream rejection with its cause kept, never guessed into a retry. The fake transport
  in `subscription.test.ts` exists because both claims are about what the subscription DID with an
  envelope or an ending — how many days reached `onDay`, whether another stream was opened at all —
  and neither `day-state.ts` nor `transport.ts` can see that from its own side. That fake is also
  why the ENDINGS themselves needed their own proof one layer down: `client-transport.test.ts` now
  drives the real `openStream` for all three (a body erroring mid-read rejects `network`, a non-2xx
  stream response rejects `http`, `close()` RESOLVES), because a classification is only as true as
  what its producer actually produces. **The last of those three is why a handler may not be bound
  to a mutable `stream`**: an aborted stream resolves `done` indistinguishably from a server EOF, so
  every deliberate supersede — a gap resnapshot, a reset, a reconnect — scheduled a SECOND reconnect
  one microtask later, flapping `connecting -> reconnecting` and turning the fresh snapshot a gap
  demands into a resume. Each handler is bound to its own handle, and `reconnect`/`stop` release
  `stream` before closing it, so a superseded settlement is inert rather than merely late.

- **2026-09-02 — an empty open-session list is not an empty browser requirement set.** The Session
  Panel used `WorkerCard.browsers[]` for both facts, so a starting worker showed no browser systems
  until each child span opened. The worker now persists its loaded descriptor's ordered systems on
  the lease at launch—never re-derived from a potentially newer dashboard process—and
  `browserRequirements` carries that fact separately. `workerBrowserView` overlays exact observed
  sessions onto those stable slots, keeps unexpected observed sessions visible, and suppresses all
  slots on terminal cards. An unopened requirement says `Opens when needed` and never carries a
  session id, age or health word; only an observed open span may say `Not checked` and expose its
  exact session identity. Historical leases without the field say authority is unavailable.
  Because cards are lease authority and the projection's change triggers were spans, the BFF's
  span-tail tick now also reconciles the lease set and pool declarations and publishes a snapshot
  on any served move; heartbeats alone publish nothing. The same live check found pool spawns
  launching the inert `src/cli.ts` module (exit 0 before lease birth); the production launch now
  goes through `scripts/secure-env-bootstrap.ts cli`.

- **2026-09-02 — machine identity is not an approval card (D309).** The Separations identity-gate
  section is reachable only for a `name-resolved` packet, and its current ceremony requires the
  operator to type the EID. A supplied/read-back EID proceeds with machine-verification authority and
  no gate result, so the BFF refuses an impossible historical supplied-EID park by name instead of
  drawing it as approval work. The client never suppresses a gate from caller state and never labels
  a skipped gate as an operator decision.

- **2026-09-01 — a chip per fact is a table wearing borders, and the facts a row REPEATS belong
  one level up (the run Logs observed ledger).** An observed log row drew one bordered `Chip` per
  redacted value — twelve for a Kuali document read — each carrying its own direction icon, the
  whole `field · key` label (which for a leaf key printed `documentNumber · documentNumber`) and,
  for a served list, the raw JSON; with a warning `attempt 1` badge and the `KUALI` chip on every
  row under a heading that already named `kuali/read-separation-document`. Every chip was true and
  the operator's verdict was *"too cluttered"*. Four directions were drafted on a design canvas
  over the real run's facts before code moved (ledger, transcript, cards, digest); the operator
  chose the ledger. **What travels:** `logLedgerOf` in `log-panel-model.ts` folds a row into
  direction sections → fields → key/value facts, and `LedgerSection` in `log-panel.tsx` draws it as
  a two-column grid on the `--ds-w-chip-cell` track with a 2px rail and ONE caps label per
  direction; a nested field is a caps sub-head over keys shown without the repeated prefix; a list
  is a native `<details>` (count + clipped preview closed, one item per line open); the attempt
  rides one meta line at the row's top; the system chip moved into the sticky producer heading via
  `groupSystemOf`, which throws if a group's rows name two systems rather than picking one. **Two
  contracts held byte-for-byte on purpose**: the listitem's `aria-label` and each fact's `title`
  (`label: value`, the same string the chip carried) — the ledger and `logPillsOf` are asserted to
  produce identical `label: value` sequences, so the hover, the search and the screen cannot
  disagree. The parity spec now reads the direction tokens off the section labels instead of a
  per-fact pill. **And a redesign of one row kind must leave the other kinds' pixels alone**: the
  first pass grew the NOTE line's clock from `micro` to `meta` and dropped its `pl-5`, and 22
  frozen run-detail references went red for a row the redesign never meant to touch. No reference
  was re-frozen; the note and fence lines are back to their exact classes.

- **2026-09-01 — a surface with no demo counterpart is drift even when every fact on it is true
  (D305, the Session Panel restored to the demo's strip).** The drawer had grown two things the demo
  never had: per-workflow pool BANDS (`Separations · no pool declaration · 0 active · pool v0 ·
  Plan workers`, `Member 1` cards, dashed unmet cards) and a virtualized session-membership list
  under them printing every queue row of the day by session id with `No current worker card claims
  this run`. Every line was a served fact and each had a decision behind it (D271's controls, P4's
  authority join) — and the operator's verdict on sight was *"this session panel looks very
  different from the demo's. make it the same."* Three things travel. **Port the demo's component,
  then fit the contract INSIDE it, not around it**: `SessionCard` and `AddWorkersDialog` came across
  with provenance, and D271's whole body (basis, excess list, unmet roster with spawns, outcome
  notice) fits inside the dialog the demo already had — the bands were that contract given a home
  before the `+` had a CAS basis to open on (D269 served it). **Retiring a surface is not losing its
  facts**: the membership join is the card's identity-popover facts, the session id is on the queue
  row, the unmet declaration is a bar chip plus the dialog's roster; say where each fact went, in
  the ruling. **A line the demo's card does not carry earns its place only by an a11y rule** — the
  `NO SESSION RECORDED` line and the tile's `open 55m 4s` (truncated to `open 5…` in a half-width
  tile) both went behind the existing `AuthorityDetails` route, which is the one thing the card
  keeps that the demo's lacks, because DESIGN.md bans a hover-only identity. The unit that mounts
  and presses the real panel (`session-panel-pool-press.test.ts`) now opens the dialog through the
  bar's `+` and steps the count; the parity lane's `pool-control-touch-target.spec.ts` serves a
  declared pool so the roster has a spawn to measure. The `+` is on the bar under every view, so
  every a11y reference gained one `button "Add workers"` line and the corpus was re-frozen once,
  with that diff reviewed.

- **2026-09-01 — a dense key/value record wants a table, not a stack of flex pairs.** The Explorer
  arm record (D304) drew eight facts as `FactRow`s with nothing between them; at two or three
  wrapping lines of ids per value, the reader lost which line belonged to which label. `RecordTable`
  / `RecordRow` in `surfaces/explorer.tsx` draw it as the ds `Table` with `<th scope="row">` labels
  in the shared 7rem caps column and a hairline per row. Only the arm record changed; node-level
  rows keep `FactRow`. Refreeze `explorer-transaction` when touching it — its a11y tree carries a
  `table` per arm.
- **2026-09-01 — a record that re-heads the thing it is about, and a chip on a value that cannot
  survive a cut, are the same two defects the table above had, one screen lower (D304, the
  Explorer's arm record).** The `TaskRecord` under the contract re-printed the arm's verb, id and
  title that the card head had just printed, restated the Outputs head's policy in two rows
  (`Freshness`, `Provenance`), and drew every catalog id, error code and source path as a `Chip` —
  whose own docstring says a fact that cannot survive truncation is not a chip. Six ids ended in
  `…` and lived on `title`. Three things travel. **Fixing a surface's shape once is not fixing the
  surface**: after D302 the same repetition and the same clipping were still on screen, below the
  fold, and the operator found them by scrolling. Sweep the whole panel for the defect class before
  closing the ruling. **A toned chip is a chip that earned it**: `Write safety`'s warning tones and
  the unresolved-source warning carry the fact, so they stay chips, while `store kuali · kind
  browser` carries nothing a wrapping line does not. And **a `>value<` text-node search is the pin
  for "printed whole"**: the render test finds each id as its own text node and reads back to its
  opening tag to prove the span is neither `whitespace-nowrap` nor `truncate` — presence alone would
  pass a clipped chip, since clipping is paint, not DOM.

- **2026-09-01 — a reference surface that prints every fact on every row prints nothing anyone
  can follow, and the honest fix is the shape the spec already had one door over (D303, the UI
  catalog as rail + record).** The Selectors view drew each of 118 entries as a seven-line block of
  identical grey chips: five entries per screen, `system` / `owner` / both evidence refs repeated on
  every row of a system, `used by` repeated five times on one row, and screens flattened beside the
  elements that live on them. Every chip was true and `ref operator-trust` §5.8's rule — provenance
  beside the id, never behind a disclosure — was honoured to the letter, which is exactly why nobody
  could read it. The operator's verdict was *"too messy, I don't know how to follow through in it."*
  Three directions were drafted on a design canvas over the real kuali rows before any code moved:
  a two-line ledger that kept both refs beside every id, the Explorer's rail + record, and one sheet
  per screen. The operator chose the rail. **The bend is stated, not smuggled**: the rail keeps
  `verifiedAt` on every row at the id's weight, the record prints both refs whole and never
  collapsed, and §5.8 now says so — a redesign that quietly weakens a ratified rule is drift wearing
  a new coat.

  Four things travel. **A nested id may drop its parent's prefix only as DISPLAY**: `railDisplayId`
  strips `${screen}.` when the id carries it, and the catalog has page states that do not
  (`ucpath.person-org.search-ready` under `ucpath.person-org.search`), so the test finds one of each
  and the row's `title` plus the record always carry the whole id. **A heading is not a hit**: a
  search draws a screen whenever one of its entries matches, so the record must open on the term's
  first MATCH, and the first build opened on the heading — found by the surface test, not the fold
  test, because the fold returned the right rows and the surface picked `rows[0]`. **A request made
  under one search term is retired by the next**: the record's "on the same screen" chips select
  entries the current term does not draw, so a request is honoured while the rail draws it OR while
  its term stands, and `resolveCatalogSelection` takes the term as an argument rather than trusting
  a stale id. **And the fold's provenance stays a throw**: an entry whose `screen` the catalog does
  not serve is a generator defect, and the rail names it by id rather than inventing a heading.

- **2026-09-01 — a column whose fact varies per row in the demo and per ARM here is the demo's
  shape holding a fact it was not made for (D302, the Explorer's contract table).** The node
  panel's `Recorded` column printed `from live · fresh unbounded · override audited` on every output
  row — 21 chips for one arm policy — and `System` printed the node's own chip nine times, with rows
  swinging between one and three lines as the chips wrapped. Every row was true. The demo's third
  column carries what ONE RUN recorded, which genuinely differs row to row; this tree lays no run
  over the graph, so the same slot held a per-arm policy and the table repeated it. **Before porting
  a column, ask whether its fact VARIES per row on this wire; if it does not, it is a head, not a
  cell.** The fix is structural rather than a narrower chip: one `Card` per arm, the side's fact once
  on an `Inputs`/`Outputs` group head, and a row draws only its DEPARTURE from that head. Three things
  travel. **The head's default is derived from the arm's declared policies and the server's per-field
  derivation stays the row's authority** — `contractFieldGroups` compares them facet by facet, so a
  `byField` rule is one chip on the one row it names, and a row whose state contradicts the head (the
  wire does not forbid it) is a warning chip by name, never folded in. **A boundary assertion is only
  as good as the element it names**: the EX114 pencil pin asserted no `</td>` between mark and path,
  and a list row has no `</td>` anywhere, so the old pin would have passed vacuously — it names
  `</li>` now, and any change to the row element has to move it again. And **the proof is a count**:
  no fold can see that a policy is printed once per side rather than once per row, so the render
  test counts the bound's occurrences against the number of output rows.

- **2026-09-01: a deviation that names its own expiry is a promise, and discharging it is a
  different act from reversing it (D296, the Run Modal's spreadsheet method).** `Import spreadsheet`
  had sat in the queue toolbar as a RULED deviation since D272 item 3, with a comment at the site
  saying exactly why it stayed *and* exactly when it would go: *"it goes when the run modal grows the
  handoff."* Building that handoff is what closed it, so the ledger row is struck as **discharged**
  and its rejected arm C — *build the Run-Modal handoff first* — is marked LANDED. That distinction
  is the whole entry: a row struck as "reversed" tells the next reader the reasoning was wrong and
  invites them to re-open it, and this reasoning was right for two months. **Write the expiry into
  the deviation when you rule it**, and the pass that meets the condition knows it is finishing work
  rather than overturning it.

  Two more travel. **A served capability beats a workflow-id check, even when exactly one workflow
  has it.** Person Lookup is the only registered module with an intake projection, so
  `workflowId === "person-lookup"` would have passed every test in this commit and offered a dead
  door the day a second module declares one — or, worse, offered it on a workflow whose intake the
  kernel refuses BY NAME. `start.spreadsheetIntake` is projected from `BootstrapModuleView.intake`,
  the same registry `command-kernel.ts` refuses against, so the modal cannot offer a door the server
  would close. The negative control is what proves it: the separations picker must draw NO method
  tablist, asserted in the parity lane beside the reference that photographs the door.

  And **a stage rail is a claim about what is reachable.** The demo walks its spreadsheet method
  through `Input → Options → Confirm` with each stage's controls suppressed, which it can afford
  because it serves a sheet list and a `Confirm` that names the chosen sheet. This tree serves
  neither — the arm's whole act is the drop, and the mapping, the review and the enqueue belong to
  the workspace (D298 moved only the FILE) — so `runStartStages` returns `["Input"]` for that arm. Numbering two stages an operator walks through
  empty is `DESIGN.md`'s own empty scaffolding wearing a progress indicator.

- **2026-09-01 (D298): a panel that DESCRIBES a control, above a button whose only job is to reach
  that control, is one screen too many — and the second screen is where the sentinel lived.**

  D296 shipped `Import a spreadsheet` as an `EmptyState` reading *"The intake workspace takes the
  file, maps its columns…"* over an `Open the intake…` primary, defended on the ground that a file
  picker in the dialog would land the operator "past the mapping step". That defence was wrong about
  the surface it protected: `intake.tsx`'s `resource.state === "empty"` arm IS a dropzone, and a
  drop there skips no mapping — it opens the session and the mapping grid comes up. So the paragraph
  described a zone one click away, and the primary existed to travel that click. **Check what the
  destination's first screen actually is before writing a panel about it.**

  Two things travel from the fix. **Deleting the second screen deletes its address.** The workspace
  could open with nothing in it, so `?intake=` needed a sentinel (`INTAKE_NEW = "new"`) to say
  "opened, no session yet" — and that sentinel then had to be special-cased in `dashboard-app.tsx`,
  in the parity corpus (`intake-upload`), and in four unit tests. Moving the upload into the dialog
  made `sessionId` REQUIRED, and the whole sentinel went with it: `?intake=` is now always a session
  id. A route key with one magic value is usually a second screen wearing a URL.

  And **when a control moves, its labels are the thing that quietly goes stale.** The dropzone
  carried the workflow name (*"Drop a spreadsheet of people for {label}"*) and the workspace's
  header comment said so in as many words — *"`workflowLabel` is not lost with it, it stays on the
  upload label below"*. Moving the zone would have left the mapping grid naming no target at all, so
  the label moved to the header's `meta` slot in the same commit. `INTAKE_ACCEPT`,
  `INTAKE_DROPZONE_HINT` and `intakeDropzoneLabel` now live in `intake-model.ts` because two
  surfaces draw the zone: two copies of "up to 25 MB" is how one of them ends up lying about a cap
  the other already raised.

- **2026-09-01: two `ml-auto` do not stack, they SPLIT — and a segmented composite that
  lets its segments carry the height grows by its own padding (the Top Bar centre cluster).**
  The operator filed the search field + date navigator as looking wrong. Measuring the bar
  named three separate defects that all read as one raggedness. **(1) Three control heights in
  a 44px band**: the view switcher painted 30px, the search field 28, the date navigator 24 —
  the switcher because it wrapped `h-sm` segments in a `p-hair` bordered box, which is exactly
  the growth `DESIGN.md`'s layout rules already forbid (*"a control that WRAPS others takes the
  height itself and its segments fill it with `h-full`"*). The rule existed; the one composite
  that predated it was never brought under it, and nothing measures a height, so it stood.
  **(2) A boxed field beside three naked glyphs**: the search trigger drew `border-strong` on
  `surface-2` while the date navigator drew no fill and no border at all, so a pair that does
  one job (what you are looking at) read as two species. **(3) A 212px void at 1440**: the
  search trigger carried `ml-auto` and so did the icon cluster, and two `ml-auto` siblings in
  one flex row do not both push right — they divide the free space between them. The pair
  beached in the middle-right with a dead zone before the icons, and its centre of gravity slid
  on every resize because only one half of the cluster was `flex-1`.

  What travels: **a shared frame is the fix for a species mismatch, not a restyle of one side.**
  `SEGMENTED_FRAME` is now the one `--ds-h-md` / `--ds-border` / `surface-2` box the view
  switcher and the date stepper both wear, and the search trigger reads the same pair — so the
  three centre controls cannot drift apart again without editing one constant. **And a bar's
  slack belongs to a GROUP, never to a member**: search and the date are one `flex-1
  justify-end` span, which is what leaves the bar the two anchors it actually has. The arrows
  became plain buttons rather than `IconButton` for the same reason the switcher's segments are
  — `IconButton` is a square at a fixed `size-*`, and a segment carrying its own size is the
  defect — carrying `aria-label` + `title` explicitly, because those are the only things it
  guaranteed that were worth keeping. **Accessible names were held byte-identical on purpose**,
  so the parity lane's semantic half does not move and only the pixel half needs re-freezing.

- **2026-09-01: demoting a URL key is a claim in TWO directions, and a placement that has been
  reversed three times needs a decision rather than an edit (D295, the UI catalog into Settings).**
  The catalog stopped being a takeover and became `Settings -> Help -> UI catalog`, which sounds like
  a render-site move and is mostly a ROUTE change. `?catalog=` used to be a takeover key in its own
  right — presence opened the surface — and it still has to carry the search term, so it survives as
  a subordinate of `?settings=ui-catalog`. **A subordinate key enforced at the call sites is a
  subordinate key until the next call site**: clearing it in Settings' `onClose` and in each view
  switch is four edits that a fifth `setRoute` can forget, and the symptom is silent — a URL naming a
  search for a page that is not open, which no gate can see because both keys are individually valid.
  It is gated in `parseRoute` AND `routeToSearch` instead, on the same condition, so the pair
  round-trips and the rule has one home. The negative control is the test that matters: a bare
  `?catalog=kuali` must parse to `{ start: false }`, and a term held beside `?settings=storage` must
  never be written back.

  Two more travel. **A section inside a takeover may not keep the takeover's chrome.** The catalog
  carried its own `TakeoverFrame` and its own `Close the UI catalog` button; inside Settings both are
  duplicates — a second frame steals the arrival focus contract `TakeoverFrame`'s JSDoc decides once,
  and a second exit is the duplicate-door problem the Activity report's *missing* back button was
  ruled on for. `UiCatalogSection` takes no `onClose` **prop at all**, so the duplicate is
  unrepresentable rather than merely unused. And **check the plan before moving a surface**: the
  toolbar door being deleted here reverses D281 item 2, which was ratified five days earlier and
  names "reverses D275.1 a third time" as a REJECTED option. The move is still the right one, and
  what makes it a decision rather than a fourth drift is that the door goes because the takeover
  goes — the catalog gains a destination instead of losing one. `docs/rebuild/reference/decisions.md`
  and ref dashboard-surfaces §9.5.3 carry it; the superseded items are struck in place rather than
  rewritten, because a reader arriving at D281 item 2 needs to be told where it went.

- **2026-08-27: a "you are here" control with no value for "nowhere in here" will be made to lie
  (unit U3, UF-SET-2).** `ShellViewSwitcher`'s prop was typed `ShellView` — the four segments it
  draws — so `dashboard-app.tsx` had nothing to hand it when a takeover the switcher does not name
  (Settings, intake, the catalog) owned the main region. It handed over `"queue"`, and wrote a
  docstring defending the choice: *"lighting nothing would be the switcher claiming the operator is
  nowhere."* The result was `Dashboard` and the gear both `aria-pressed`, at a moment when the
  dashboard was covered by a takeover. The demo has never had the problem because its switcher reads
  the app's FULL view union and simply matches nothing (legacy `1ec1d870`
  `src/dashboard/components/dev/rebuild-demo/DemoShell.tsx:560-573`).

  **The type was the defect, not the fallback.** A narrowed prop makes the absent state unspeakable,
  and an unspeakable state comes out as the nearest speakable one — which is exactly the shape the
  root CLAUDE.md's fail-loud rule describes for data. It applies to UI state too: a pressed segment
  is an assertion about where the operator is, and a plausible-but-wrong one is worse than none.
  `ShellViewSelection = ShellView | "none"` is the missing value, and `shellViewOf` in
  `app/url-state.ts` is exhaustive over `ActiveTakeover`, so a seventh takeover fails to compile
  rather than quietly inheriting an arm.

- **2026-08-27: the demo is the design authority for everything it covers, and a tension in its copy
  is an operator question, not a licence to re-author (units U3 → U4b, UF-SET-26).** U3 ported the
  demo's per-system host notes into `settings-model.ts`'s `SYSTEM_HOST_PRESENTATION` and stopped at
  two of them: `onbase` and `i9` read *"No test host is provisioned…"*, which the SERVED `Test`
  column also says. U3 reasoned from the root CLAUDE.md's fail-loud rule — an authored constant that
  restates served state goes on restating it after the state changes — invented the rule *"a note
  describes the SYSTEM, never this deployment's config"*, wrote replacement prose for both, and
  added a `/provisioned/i` test to hold the rule in place. **The operator overruled all of it in
  U4b.** Both notes are now the demo's sentences byte for byte, the rule test is deleted, and
  `settings-status-sections.test.ts` pins the two ported strings instead.

  The reasoning was not wrong; the authority was. The demo's copy is a decision already taken, and a
  worker deriving a rule from a general principle does not get to overturn it — the observation
  ("this constant could contradict the column beside it the day a sandbox is provisioned") is worth
  raising, and raising it is the whole move. **Port what the demo covers verbatim; author only where
  the demo has no counterpart, and mark those entries `// authored — no demo counterpart` so the
  next reader can tell the two apart at a glance.** Here that is `new-kronos` / `old-kronos`
  (the demo carried one undifferentiated `kronos`) and `sharepoint` (absent from the demo).

  The same commit is the argument for two label maps over one. `SYSTEM_LABEL`
  (`system-chip-model.ts`) is the CHIP's treatment — `UCPATH`, `NEW KRONOS`, shouted at chip size in
  a dense row — and reusing it in a table beside prose is how `NEW-KRONOS` ends up in a sentence.
  One vocabulary, two treatments, and neither substitutes for the other.

- **2026-08-26: a ledger row can be wrong in both directions at once, and the direction nobody
  checks is "it says this landed" (unit V1, the Track F vocabulary sweep across all three 03a
  fidelity ledgers).** The sweep set out to port 24 + 37 + ~120 open word rows and found almost all
  of them already ported — by units F1 and F5 through F14, each of which landed the code, wrote a
  citation at the site, and did not come back to the row. So three sheets read as ~200 unanswered
  operator questions while the tree carried answers with commits behind them. **A fidelity ledger
  whose rows are not written back stops being a ledger and becomes a to-do list that regenerates
  itself**: the next pass re-opens closed questions, and the pass after that re-ports code that is
  already correct. The rule this unit is the argument for is the one the repo already states for
  decisions — the disposition lands in the same commit as the code that earned it — and it applies
  to the row, not only to the D-entry.

  Three things travel. **The stale direction is the dangerous one.** IN101's row read
  `exact — ported 2026-08-26` and the rejection badge still printed `cell-coercion` and
  `cross-field` at the operator holding the spreadsheet. A row that says OPEN when the work is done
  wastes a pass; a row that says PORTED when it is not means nobody will ever look again — and no
  gate could see it, because a badge printing a valid enum is grammatical, stable and photographs
  fine. Its fix is a `Record` total over `RowRejectSchema` in both directions, so a seventh arm is a
  typecheck failure rather than a badge falling back to its own identifier, and the test's negative
  control is precisely that fallback.

  **"Delete the unreachable arm" is only half a ruling; the other half is the record.** The
  Explorer's four graph-less arms (EX13/EX18/EX20/EX23) were correctly absent and looked exactly
  like four things nobody had got to. What closes them is a comment naming the schema clause that
  makes them unreachable — beside an assertion that the clause still holds, so a relaxed `.min(1)`
  fails loudly instead of blanking a panel. **An absence with no citation is indistinguishable from
  an oversight**, which is this directory's own D11 lesson landing on a second surface.

  And **an exception is a claim that has to be true of THIS wire, not a preference.** Four of the
  retained divergences survive because the demo's version would be false here: a `.min(1)` title
  makes both of the rename dialog's fallbacks unreachable, `dependsOn` is a real declaration a
  descriptor may omit so the demo's unconditional `always` would invent an edge, the bump record's
  `maxLength` is the durable schema's own limit rather than a chosen one, and the demo's `Cancel`
  belongs to a dialog D173 replaced with a workspace. Each is stated at its site AND in its row —
  the pair is the point, because a comment alone is invisible to the next audit and a row alone is
  invisible to the next editor.

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
  (D274 item 7, unit F13, ledger 3 §7 CP2–CP21).** *Historical: D294 (2026-08-31) retired mobile
  Capture Mode, so `capture-start.tsx`, the phone bundle and the capture routes are all gone; the
  reading below is kept for the shape it records, not as a description of this tree.*
  `capture-start.tsx` had handed the operator a QR
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
- **2026-08-26: a binding document that points at an artifact nobody in the checkout can open has
  been unenforceable the whole time, and the guard that catches the port is the one nobody wrote it
  for (D274 item 3, unit F14c, ledger 3 UK146–UK158).** `DESIGN.md` is binding on every surface in
  this tree, and it told the reader three separate times to skim `DemoUiKit.tsx` and open
  `kit.html`. Neither existed here. The document's own header disclosed that as a deferral — added
  only when Track F went looking, 2026-08-21 — and for the whole span before it, the instruction
  read as a normal instruction and simply could not be followed. **A binding document is only as
  binding as its most-followed sentence, and a sentence naming a file that is not in the tree is a
  dead end that costs the reader more than silence would**: the fallback ("skim `ds/primitives-*.tsx`
  directly") is exactly the un-curated read the specimen page exists to replace. The page is built
  now (`kit/kit-page.tsx`, `kit.html`, `kit/main.tsx`) and the header names where it lives here and
  how to open it, because the port also moved both the filename and the URL — a document that said
  "it exists now" without saying "at a different path, on a different port" would have replaced one
  dead end with another.

  Three things travel. **A specimen page's entire value is that it draws the REAL primitives**, so
  the claim needs a guard rather than a convention: `dashboard-wire-boundary` arm (16) holds
  `kit.html`'s closure to `kit/**` + `ds/**` + `lib/**` + the pure domain contract `ds` already
  reads. A reach into `surfaces/` would present one surface's composition of a primitive as the
  primitive's own behaviour; a reach into `client/` would put a served fact on a page whose whole
  premise is that it serves none. Both are more misleading than an absent page.

  **The guard nobody wrote for this caught the real defect.** The port's Workflow `<Select>`
  carried `<option value="separations">` — legacy's real workflow ids — and arm (3) forbids a
  registered id as a string literal anywhere under `src/dashboard`. Nothing on a specimen page
  branches on that value, and the reflex is to read the hit as a false positive and reach for an
  exemption. **A rule that admits "but this page is only a demo" is a rule that admits the next
  page too** — the values carry a `specimen-` prefix instead, which also survives `onboarding` and
  `oath` becoming ids, and both are on the plan. The visible LABELS, which are what the specimen
  actually specimens, are legacy's verbatim.

  And **an unbuilt page is a page the parity corpus can never photograph.** Legacy's `kit.html` is
  dev-server-only by design; here the lane serves `dist/dashboard` as static files, so leaving it
  out of `rollupOptions.input` would have shipped a specimen page that renders perfectly for a
  developer and does not exist for P1. It is a third build entry, and the same arm now checks that
  every `*.html` the walker guards is also a rollup input — nothing else in this tree would have
  said so. Two smaller ports are decisions to be MORE truthful than the source: `kit/main.tsx`
  throws on a missing container where legacy's `if (root)` paints nothing (indistinguishable from a
  page whose CSS failed), and the dirty `ValueField` is a real controlled field rather than
  `onChange={() => {}}` — a specimen of "typed over, not yet committed" that discards what you type
  is a specimen of a broken control.

- **2026-08-26: a ruling that names a CONDITION is not a verdict, a mark keyed by
  half its identity marks the wrong row, and a touch floor put on the control
  somebody reviewed is the token's own lesson inverted (D275 items 5–6 / D276
  items 4–5, unit F14b, ledger 3 groups 24 and 32–34).**

  **The condition.** D275 item 5 reads *"Explorer shows demo facts unless an
  extra enters its owning contract"*, and six Explorer extras sat OPEN for weeks
  because that sentence names a door and no one had opened it. It is not a
  question awaiting an answer — it is a ratified rule with an unbuilt clause, and
  the work is to WRITE the clause. `ref operator-trust` §5.2.1 now admits the six
  as a deliberately CLOSED list, each entry saying what the fact is for, so the
  next fidelity pass reads them as ratified rather than re-opening them. **When a
  decision's text names the condition under which something may stay, implementing
  the condition is implementation, not a new ruling** — and the list has to be
  closed, because an open one admits the seventh extra silently.

  **The key.** The Explorer's contract table draws one row per `side:path` and its
  correctable-marks map was keyed by path alone, so an OUTPUT path whose string
  also spells an INPUT path on the same node penciled BOTH — telling the operator
  they may correct a value the node READ. Nothing upstream forbids the collision:
  the kernel matches `nodeId + fieldPath` and the wire's `editableFields` carries
  no side at all, so **the surface was the only party that knew, and it was the
  one throwing the information away**. The side is not a stylistic choice either —
  ref data-intake-and-edit-data §6.3 re-parses an edit against the producing
  contract's OUTPUT schema, so an allowlisted path is by construction a written
  value, and an input-only path is a save the kernel WILL refuse. It is named in
  the warning Banner rather than penciled, because a pencil there promises
  something the product does not do. Both new cases were run red against the old
  keying; a mark that draws on every matching row passes any presence assertion.

  **The premise.** That pin's own header said *"no descriptor in this build
  allowlists a field yet"*. `person-lookup` allowlists three fields on
  `crm-dates` and the pencil draws for them today, so the negative control's
  `assert.deepEqual(node.editableFields, [])` was one node-ordering change away
  from passing for the wrong reason. **A precondition a test needs must be
  ASSERTED by the test's own selector, not asserted about whatever index 0
  returned** — `nodeWithNoEditableFields` finds a node that satisfies it or
  throws.

  **The floor.** Two toolbar `ghost` doors were reviewed at 28px against a 44px
  finger, and the reflex fix is to grow those two. `--ds-h-toolbar` exists
  precisely because growing the control at its call site is how a row of 24
  acquired a 30, so the floor went on the TOKEN under `pointer: coarse` — the
  `--ds-h-member-line` pattern — and `--ds-h-bar` moved with it so the family
  keeps its 4px of air. Measured in a real engine, with the fine-pointer paint
  asserted at exactly 28 as the negative control: **that gate is the whole reason
  no photographed reference moves**, and without it the coarse rules could be
  ungated and nobody would know until the corpus went red.

  **And two ports that are decisions to change LESS than the ledger asked.**
  UK144 (`DsStep.trailing`) reads as a primitive broadened past the demo, and the
  ruling rejects broadening *without a contract* — but the column draws a SERVED
  measured duration with a named absence, so deleting it to match a demo whose
  steps carry no measured span would delete a fact. It stays and the docstring
  becomes the contract. SE46's demo banner collapses authority and backup into
  one binary `mode`; this wire serves them apart, and a stale backup is not a
  read-only volume — so the banner lands ABOVE the two health lines as the
  verdict rather than instead of them. **Before porting a shape, check whether
  the shape can hold every fact you currently have.** UK141 went the other way
  and was genuinely rolled back: a row that opens a panel discloses, and
  `dsMotion.fast` + `--ds-surface-3` are the press vocabulary a COMMAND earns —
  the same argument unit F6 recorded for the timeline segment. It got in
  unreviewed because `:active` is transient and no stored screenshot can see it.

- **2026-08-26: a reference page's kinds must be READ OFF the schema, and a mark placed away from
  the value it is about is a mark nobody reads (D274 item 4 / D275 items 1 and 6 / D276 items 2 and
  5, unit F14, ledger 3 §3 and §4).** Two surfaces, and the same shape twice: a fact the product
  held and did not put where it is read.

  **The catalog.** The demo's row-and-panel catalog authors its vocabulary beside the product — 8
  row variants, 3 containment kinds, a rollup precedence chain, 4 panel kinds — and D274 item 4
  rules that this tree builds only what it SERVES. So every kind on `surfaces/row-catalog.tsx` comes
  off a schema: the four `surfaceKind` arms off the queue wire's own discriminant, containment and
  panel kind off `.options`, and each kind's tab strip off the new `sectionsForPanelKind`, which
  derives from the SAME `sectionsCompatible` rule `RunDetailWireSchema` enforces. **A `Record` keyed
  by the schema's union is what makes that structural** — a fifth arm is a typecheck failure, not a
  page that silently documents four of five — and the ORDER array beside it is the one place an arm
  can still be dropped without the compiler noticing, which is why a test pins that the two agree.
  Three things travel. **The negative control is the test that matters**: a `tabsForPanelKind` that
  returned every tab for every kind passes "the wire accepts each tab I draw" and fails only the
  test that names the refused pairings. **An arm that cannot fire is a check that cannot fail** —
  the catalog row's scenario list has no empty arm because `scenarios` is `.min(1)`, and the
  Explorer's `{label} declares no nodes` is deleted because `nodes` is `.min(1)`; both claims are
  ASSERTED at the site rather than assumed, so a relaxed schema fails loudly instead of blanking a
  panel. And **the absences are RENDERED, not commented**: a reference page that quietly omits what
  the demo names is indistinguishable from one nobody finished, so `UNSERVED_VOCABULARY` states each
  one with the producer that is missing. It takes the page's own specimen chrome rather than a
  `Banner` — every banner tone carries `role="status"`, and five live regions announcing five
  STANDING facts on mount would read as five things that just happened.

  **The mark.** The Explorer drew its editable-field pencil on chips in two `FactRow`s below the
  contract table, reversing the demo's own argument that editability is a property of a FIELD. It
  is in the field's own cell now, and **the claim is entirely about placement, so no fold can make
  it** — the pin is `renderToStaticMarkup` asserting no `</td>` between the mark and the path, with
  an unmarked node as the negative control, because a pencil rendered unconditionally satisfies any
  presence assertion and is a mark on every field in the product. Removing the chip row then
  exposed what the chip row had hidden: **an allowlisted path with no contract row used to have a
  chip to sit in and now has no row**, so it is named in a warning Banner rather than dropped — a
  descriptor exporting a field for correction its own contract does not declare is a defect, and
  rendering it as "nothing is correctable here" is the fail-loud rule inverted into display.

  And **a copy port is a decision about whose question is being answered**: the posture notes said
  what the DESCRIPTOR declares where the operator asks what a run does to a system of record, and
  the empty-contract line explained what a control node IS where the reader of a contract table
  needs to know that no value moves.

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
  now `docs/rebuild/findings/dashboard-projection.md`. That divergence is also why the receipt's own `result`
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
  enforcement if something SUPPLIES its precondition, so the capture phone-host gate's producer was
  pinned by the guard beside the gate's own behaviour rather than assumed (that gate went with D294
  on 2026-08-31; the shape outlives it).

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

- **2026-08-27: a page that REPLACES the window is not a region sitting on one — and four copies of
  a wrapper are four chances to drift, so the fix is one component, not one edit per surface (UI-1
  U2; audit rows UF-SET-1/4/5, UF-AR-3, UF-EX-2, UF-AC-2; D272 item 1 / D274 item 5 / D275 item 2).**
  Settings, Archive, Explorer and the Activity report had each rooted in a `Panel` — the REGION
  container: border, `--ds-radius-lg`, `--ds-surface-1` — inside a
  `px-[--ds-shell-inset] pb-[--ds-space-base]` div in `dashboard-app.tsx`'s takeover switch. The
  route half of the takeover conversion had landed (none of them is a `Dialog`, all four have a back
  path and a history entry) and the GEOMETRY half had not, so the most-opened pages in the product
  arrived as 1416px cards floating in a 12px gutter while the demo's own containers are full-bleed at
  `x=0, w=viewport, y=44`. **`Panel` is the tell**: reaching for the region container to root a page
  is how the card gets there, and it reads as correct at every review because the primitive is the
  right one — for a region. Three things travel. **The wrapper was duplicated SIX times** (intake and
  the UI catalog carry it too), which is why the change had to become `TakeoverFrame` in
  `ds/primitives-layout.tsx` rather than four edits: the same file also held four hand-rolled copies
  of `useDsEnterTransition` plus the two `data-[demo-enter=from]:` classes, and removing the card one
  surface at a time would have left the motion behind to diverge. D275 item 2 asks for exactly one
  shared wrapper, and one component is the only thing that can be audited as one. **The
  accessibility tree is the proof the port was geometric only**: all four roots were already a
  `section` with their own `aria-label`, `TakeoverFrame` keeps both, and the 40-reference parity
  re-freeze changed 40 `.png` files and not a single `.a11y.yml` or `.meta.json` — if a wrapper
  change moves an a11y reference, it was never only a wrapper change. **Two takeovers are
  deliberately NOT converted**: the demo covers neither intake nor the UI catalog, so their geometry
  has no ruled target, and converting them would have been an unruled change wearing a refactor's
  clothes. They still hand-roll `Panel` + the arrival; adopting `TakeoverFrame` is the follow-up the
  moment a ruling exists (audit row **UF-FU-1**).

- **2026-08-27: a takeover that replaces the window has to take FOCUS with it, and the wrapper is the
  only place that scales (UI-1 U4a; D275 item 2).** All four takeovers were Radix `Dialog`s. A dialog
  moves focus in on open and hands it back on close for free — so when D272 item 1 / D274 item 5 made
  them routed pages, BOTH halves became manual work, and only one half got done: unit F4b
  re-implemented the close arm (`settingsCloseFocusTargetId`) and nothing re-implemented the open arm.
  The failure is invisible until someone presses Tab. The page swaps, the operator's focus stays on a
  door that is no longer on screen, and the next Tab restarts at the top of the shell — a keyboard
  operator cannot reach the page they just opened. **`TakeoverFrame` focuses ITSELF** (`tabIndex={-1}`
  plus a mount effect), not a control inside it, and the deciding fact is that **the Activity report
  deliberately has no `Back to the dashboard` button** (the demo's own rule, ported): an `initialFocus`
  ref the surfaces point at their Back button would have given three takeovers a contract and the
  fourth silence, which is the four-copies drift in a new costume. Focusing the labelled `section` also
  announces the PAGE rather than one button on it, and one Tab from there reaches whatever that
  takeover's first control is (verified live: Settings → `Back to the dashboard`). **And the ring you
  did not opt into is still a ring.** This was reasoned to move no pixel — the frame carries no
  `ds-focus` class, `.ds-focus:focus-visible` is opt-in, and the base layer's `*` rule sets an outline
  COLOUR with no width or style. Every clause true, and the parity lane failed anyway: 38 references,
  2548 pixels each, tracing the frame's perimeter. The ring was **Chromium's own**
  `:focus-visible { outline: auto }` wearing that `*` rule's colour — a programmatic focus with no
  preceding pointer interaction MATCHES `:focus-visible`, so every takeover opened with a 2px ring
  around the whole page. `outline-none` on the frame is the fix and it is correct rather than a
  cover-up: `tabIndex={-1}` means the operator can never navigate TO it, so an indicator there points
  at nothing they can act on, and what announces the arrival is the region's accessible NAME. **The
  lesson generalises**: "this element has no ring class" is not the same claim as "this element paints
  no ring", and only the reference corpus can tell them apart. With it the 40-reference takeover
  corpus is byte-identical. Same pass: the root's `min-w-0` was dropped as provably inert (the frame is a
  COLUMN-flex item under `main`, so `min-width: auto` is never the constraint) and `overflow-hidden`
  was KEPT with a live-verified note — measured at 1440x900 on all four with an over-wide and an
  over-tall child forced in, it changes no layout at all (the shell root already owns the viewport
  clip); its one job is stopping an overflowing child painting across the frame's bottom edge at
  y=863, where the sessions bar is.

- **2026-09-01 — A `var(--ds-…)` nobody defined is not an error, it is a surface that paints nothing.**
  The run-detail timeline's step disclosure carried `bg-[var(--ds-bg-raised)]` for its whole life.
  There is no `--ds-bg-raised` in `tokens.css` and there never was; CSS DROPS a declaration whose
  custom property does not resolve, so the hover card floated over the strip fully transparent and its
  member rows read straight through the queue row beneath them. Nothing caught it: `typecheck` sees a
  string, `lint` sees a string, the tailwind arm checks the palette / z-index / motion / alt rules and
  none of those is "does this name exist", and the parity corpus photographs resting states — a card
  that only exists under `:hover` is in no reference. It surfaced from a screenshot. Four more were
  sitting in the tree beside it (`--ds-bg`, `--ds-bg-inset`, `--ds-text-lg`, `--ds-status-warning-fg`),
  which is the tell that this is a CLASS and not a typo: a plausible token name is exactly what a
  writer invents when they know the scale's shape but not its spelling. `design-token-references.test.ts`
  now holds every `var(--ds-…)` under `src/dashboard/**` against `tokens.css`, with a named allowlist
  for the two a component legitimately writes into an inline `style` at runtime
  (`--ds-panel-head-h`, `--ds-toast-inset-bottom`) — and the allowlist is itself asserted against the
  module claimed to write it, so "declared in JS" cannot become the escape hatch. **Verify a floating
  surface by RENDER**, not by reading the class list: the proof here was hovering the segment in the
  parity fixture and reading `getComputedStyle(...).backgroundColor` in both themes.

- **2026-09-01 — a rule ported without its FACT SET is a rule applied to something it never
  covered, and the fix was not a better truncation but the right SURFACE.** The operator's report
  was *"the queue row does not look like the one from the demo"*: a FINISHED row whose footer had
  grown to FOUR lines, `took 24m 48s` stranded on its own under two lines of prose while the retry
  control floated beside the first. The footer had been written to `DESIGN.md`'s rule verbatim — *"A
  row footer's facts WRAP; they never truncate … so a run with a queue note takes a second line
  instead of cutting its trace id to `1…`"* — with `break-words`, and the rule is right. It is
  stated over the DEMO's fact set, `time · #run · trace · timing`: four short tokens, where the
  demo's `subtitle` IS the trace (`DemoQueue.tsx:715` prints `row.subtitle`, and the fixture value
  is `se-140211-9f3a`). This projection serves the trace as its own chip AND the start plan's
  `subtitle` beside it, and a real one was an operator's sentence — `re-read 1 — operator requested
  fresh 4568 rehearsal after resume freshness refusal`, from
  `separations/descriptor.ts`'s re-read arm, whose `reason` is `z.string().max(200)`.

  **Two treatments were tried in the footer and BOTH were wrong**, which is the tell that the slot
  was wrong rather than its CSS. `nowrap` alone let the card's `overflow-hidden` cut the value
  mid-word with nothing on screen saying anything was cut. `break-words` gave the four-line footer.
  Truncating (`min-w-0 truncate`, the third try) only moved the damage: it kept the trace whole and
  bounded the row at two lines, but it still spent a provenance segment on prose and still cut the
  operator's sentence.

  What travels: **ask what KIND of fact a slot holds before styling it.** Across the whole product
  `subtitle` is the workflow's own name (already drawn as the workflow chip — printed twice on one
  card), a start option (`with CRM dates`), an attribution (`Filed by …`), or an ordinal plus free
  text. Not one of the four is provenance. The operator's own rule settled it: **the row surface
  carries what the run PRODUCED — status, outcome facts, warnings, timing, trace — and context about
  how the run came to BE lives in the ⓘ.** That is this file's charter for the ⓘ (*"It EXPLAINS; it
  never HIDES"*) read from the other side: nothing load-bearing moves INTO it, and a fact that is
  not load-bearing need not be on the row at all. The segment is gone; `rowInfoFacts` carries the
  present subtitle into the popover unclipped, and the demo's `showId` guard moved there with it
  because the footer that held it no longer reads the field. **The footer can no longer GROW** —
  four bounded segments, so no descriptor can reflow a row by writing a longer string, which no
  truncation could have promised.

  **Reproduce a row report before diagnosing it**: the four-line footer was photographed by patching
  the parity day fixture's failed row with the operator's own subtitle and screenshotting it, which
  is also what ruled OUT the two things the screenshot appeared to show — the title is `--ds-fg`
  (`#fafafa` sampled), not red, and the solid `Failed` chip is the demo's own `tier: "solid"`.
  **And check where a field can actually go before proposing it**: the first proposal was to promote
  these into `facts[]`, which cannot hold them — `#facts()`
  (`run-queue-projection.ts:1398`) derives that array from the run's evidence receipt output, only
  once the run is terminal and only after redaction, while a subtitle is known at enqueue and shows
  on a queued row. `Subtitle` remains a developer word in operator copy; renaming it is open.

  **The ⓘ then lost two more things on the operator's second ruling** — *"dont put unnecessary
  explanations in there … dont put the extracted values from run in there"*: the panel-kind and
  containment paragraphs (product copy, identical on every row of a kind) and the run's `facts[]`
  (its receipt output, already on the row as chips — so the ⓘ had been a second copy of the row).
  What is left is the subtitle and D230's absence reasons. Known cost, recorded in the fold's doc:
  the fact chips are back to `title` as their only un-clipped route; if that ever costs a value,
  the fix is an affordance on the chips, not run output back inside the ⓘ.

  **And a one-line change to row height tripped a touch guard on a control nobody could touch.**
  `run-captures.spec.ts`'s `foreignOverlaps` counted a queue row's ⓘ against the receipt's
  `Download` at 390px — a row scrolled OUT of the queue list's `overflow-hidden` box, with a
  non-zero rect and `visibility: visible` and no paint. `ownsTarget` had already proved every
  point of the box resolved to `Download`. The guard's candidate filter now requires a control to
  WIN the hit-test at its centre or an edge midpoint (a half-clipped control stays; a clipped or
  covered one goes); the rectangle test itself is unchanged, because a painted neighbour inside the
  box is still a fault even when this control owns every point — the neighbour's own finger-box
  overlaps it. Both arms were proved by mutation: a clipped ghost no longer counts, and a painted
  neighbour placed under `Download` still fails on `foreignOverlaps`, not `ownsTarget`. The
  temptation was to hit-test the intersection instead, which reads as stricter and is not: a
  control that wins a point inside the box has already failed `ownsTarget`, so that version could
  never fire on its own.
- **2026-09-01 — the parity lane's four minutes were `workers: 1`, and `fullyParallel` was the half
  that mattered.** Measured: 289 tests, 233s of a 237s span INSIDE tests at ~0.8s each, build and
  bundle digest ~1s; so nothing to trim per test and everything to gain from width. But `--workers`
  alone would not have moved it — with `fullyParallel: false` a FILE stays on one worker, and
  `dashboard-reference.spec.ts` (198 tests, 158s) is two thirds of the lane by itself. Five workers
  fully parallel: 57–60s twice, 289/289, zero counted pixels under `maxDiffPixels: 0`. The one
  thing parallelism opened was the build: every spec calls `ensureParityBundle()` in `beforeAll`,
  which on a stale bundle would have had five workers run `web:build` into one `dist/dashboard` at
  once — so the build moved to `globalSetup` (`helpers/global-setup.ts`), which runs once before a
  worker exists, and the per-spec calls now only prove the stamp. Servers were already safe:
  every fixture binds port 0 and the seeded adapter takes a `mkdtemp` state root. The cadence rule
  under Commands is the other half of the fix — a lane that runs after every small edit is slow
  at any speed.
- **2026-09-01 — parity fixture INPUT cannot be one of the lane's mutable reference OUTPUTS.** The
  diagnostic gallery once read its screenshot bytes from `tests/parity/references/`; with five
  fully-parallel update workers, one worker could import the old bytes while another rewrote that
  file, leaving the a11y and PNG corpus describing different byte lengths and digests. Gallery
  evidence now comes from a deterministic synthetic PNG in `tests/fixtures/`, and an architecture
  test prevents `fixture-day.ts` from reading the reference corpus again.
- **2026-09-01 — D306's dashboard defaults are Headed with browser screenshot capture on.** A new or
  reset Start Run modal presents those values before planning; selecting Headless or disabling capture
  remains an explicit per-run choice that is persisted unchanged. Historical and programmatic omissions
  keep the compatibility behavior owned by `ref clock-config-secrets`; the dashboard never omits either
  field.
- **2026-09-01 — fixed and editable Run Options share one field shell and grid by operator ruling.**
  Fixed workflow values use a disabled native select with their reason visible below it; Priority and
  Browser mode remain enabled selects. The disabled state carries the lock semantics while one
  two-column grid keeps every value control aligned.
- **2026-09-01 — the queue footer's `#N` is the ATTEMPT, and the trace id is text, not a chip.** The
  rebuild had read the demo's `#{row.run}` as the run's ordinal within its workflow and drawn it
  beside a second, outlined chip for the trace id plus a fourth `attempt N` segment — three
  provenance segments where the demo has one chip and one string (`DemoQueue.tsx:695-717`). The
  operator ruled the number is the attempt count, so the footer is now `time · #attempt · trace ·
  duration`: `#1` is drawn on every row (a slot that appears only on re-runs would shift the trace
  id sideways between neighbours), the trace id is plain `fg-secondary` text, and the present
  workflow ordinal moved into the ⓘ (`rowInfoFacts`, "Run number") beside its already-recorded
  absence arm. Re-freezing this touched 216 references because every start modal and takeover
  captures the queue behind it. The `took` prefix on a settled row went the same way: the operator
  ruled the duration stands bare, as the demo's `row.duration` does; D124's arithmetic
  (`endedAt − startedAt`, never `now`) is unchanged and the terminal status beside the number is
  what tells a settled duration from a live one.
- **2026-09-01 — the Steps screen's omission form validates with the DESCRIPTOR's schema, not a copy
  of it (D307).** `foldStepOmissionFacts` reads each control's raw draft into the shape its declared
  kind names — and nothing more — then hands the whole candidate to `stepOmissionFactsSchema(form)`,
  the same schema the plan service and the run envelope parse with. Restating the MM/DD/YYYY or
  eight-digit regexes in the surface would let the screen refuse a fact the server accepts, or accept
  one it refuses; it also cost nothing to discover that `text-list` declares no minimum, so an empty
  box is a valid empty list rather than a refusal the screen invented. Two consequences worth
  keeping: the facts sent are `parsed.data`, never the candidate, because the declared schemas
  TRANSFORM (a `text` fact is trimmed) and the operator must confirm the same bytes the server
  receives; and the request fingerprint carries the RAW drafts, so a half-typed date already clears a
  settled plan instead of leaving one standing over `06/3`. The cascade (`forces`) has exactly one
  application point — `toggleStepSelection` recomputes it against the NEW selection, and a second
  deletion inside the uncheck branch was a line no mutation could turn red. Finally, `omittedSteps`
  on the plan response is reconciled as a SET against what the dialog sent, and a mismatch disables
  Start with both lists named: a plan token that describes a different run is not a run to start
  hopefully.

- **2026-09-01 — a delegated MEMBER and a delegated CHILD are two different narrowings, and D308's
  🗑 needs the wider one.** `queue-row-actions.ts` already carried both facts: `isMember` is
  `surfaceKind === "operation-member"` (one line of a group's tally), and `isChild` is the exact
  projection of `envelope.parent !== undefined`. `rename` is narrowed by `isMember`, and for a
  presentation-only verb that is right — the reason is row shape, not the kernel, because
  `displayName` replaces the title on the row it rides. `delete` looks like the same case and is
  not: `executeDelete` refuses EVERY run whose `envelope.parent` is set ("delete the group"),
  because the kernel takes the tree leaves-first from its anchor. A `linked` child is a child that
  is not a member, so an admission written against `isMember` would have drawn a 🗑 on rows the
  kernel refuses on every single click — the one failure this module exists to make impossible.
  When mirroring a kernel precondition, mirror the field the kernel reads, not the nearest fact
  that happens to be true for the row you were looking at. The delete confirm's idempotency
  sentence is unconditional for the same family of reason: this projector knows the run is
  terminal, not whether it reached a fenced write, and a warning that appeared only when the row
  looked like it had written would be a guess about write-safety authority.
- **2026-09-01 — two doors on one panel footer share one result slot, and an applied DELETE has
  nowhere to land (D308).** The Archive's archived-run detail now carries a 🗑 Delete beside D179's
  Relaunch. Three things that were not obvious from the relaunch it copies. **One:** `ArchiveWorkspace`
  held a single `result` plus a `relaunched: string | undefined` keyed to the run — with a second door
  that pair is ambiguous, so it became `acted: { runId, action }` and every answer is drawn only for
  the door that asked. **Two:** a REFUSED footer command drew nothing at all before this. The applied
  banner was the detail's only answer, so `schema-mismatch` — the one refusal both doors are built to
  produce, and the reason each cites `archiveFingerprint` — left the operator's click looking like it
  had never happened; `ArchivedCommandRefusal` now draws it through D253's fold, never off
  `result.state`. **Three:** an applied delete removes the record this pane is READING, so
  `onCommand` gained an `onApplied` hook that returns the selection to the ledger beside the re-read
  it already ordered. Without it the re-read answers a successful delete with "That archived run could
  not be read", which is a failure sentence for a success. The delete deliberately has NO availability
  arm on the wire: the relaunch's exists because a retired descriptor makes a relaunch impossible and
  the reason is undiscoverable from the record, while the kernel's own delete admission (a
  non-terminal delegated member) would have to be re-derived here as a second, drifting copy of a rule
  the refusal pane already reports honestly.
