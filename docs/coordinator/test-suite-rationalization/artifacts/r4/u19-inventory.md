# R4 u19 — dashboard unit inventory

## Scope and baseline

The intake baseline was the coordinator-reserved commit `a638e8c3543199f9baa93e18113ec4eeb716bdb5`.
The exact command was:

```text
/usr/bin/time -p npx vitest run --project unit tests/unit/dashboard --reporter=json --outputFile=/tmp/r4-dashboard-baseline.json --passWithNoTests=false
```

It passed 104 result files and 1,056 cases in 42.62 seconds wall time. Of those, 103 files and
1,044 cases live below `tests/unit/dashboard/`; the extra result is the dashboard-owned root file
`tests/unit/dashboard-wire.test.ts` with 12 cases. The baseline JSON had SHA-256
`ebd82ef11227a41d4849e29d8b2f55ef69f77adf33dc11c31522f2147ad21a9b`.

The directory split was 82 Node files / 786 cases and 21 jsdom files / 258 cases. Summed Vitest
per-file durations were 8.384 seconds for Node and 23.402 seconds for jsdom; the three slowest
files were `run-captures-app.test.ts` (7.787 seconds / 41 cases), `run-start-dialog.test.ts`
(5.017 seconds / 26 cases), and `explorer-edit-dialog.test.ts` (3.512 seconds / 8 cases).

## Assertion classification

Every collected assertion inherits one of the following owners from its file. Mixed files are
listed in every applicable row; their titles make the specific arm explicit in verbose output.

| Classification | File families | Required oracle |
| --- | --- | --- |
| Pure decision | `*-model`, ordering, timing, grouping, view-selection, edit-policy, rename-draft, proof-contract, queue facts/bands/gates | Literal/domain output or named refusal in Node |
| DOM wiring | all 21 jsdom files: presses, focus, blur, Escape, lifecycle cleanup, request races, disclosures, dialogs | Real React root plus native DOM event/focus state |
| Visual/layout | design-token references, region breakpoints, shell structure, member/scope touch-target source-token tests | Real browser geometry/pixels; only the two touch-target source-token families were duplicate |
| Accessibility semantics | primitive names, roles, labels, `aria-controls`/`aria-expanded`, semantic regions in render/component files | Static markup for generic semantics; jsdom for stateful semantics; browser accessibility tree where rendered layout is material |
| Server/projection transition | `*-client`, transport, result feed, seeded BFF, day splice, run follow, identity ceremony, settings/storage and capture reads | Strict wire parser plus request/projection transition; T2 for real authority effects |
| Fixture duplication | parity, archive evidence, diagnostic HTTP, run-capture and seeded fixture contract files | Strict fixture construction/closed boundary, not product behavior |

No two runtime cases had the same full test title. The read-only inventory found no assertion-free
or unambiguously cannot-fail test. The only exact browser-geometry overlaps were:

1. seven cases in `queue-touch-target.test.ts`, whose member/name/info geometry is more strongly
   owned by `tests/parity/member-touch-target.spec.ts`;
2. the one case in `top-bar-search-a11y.test.ts`, which tested no accessibility semantics and is
   more strongly owned by `tests/parity/top-bar-search-touch-target.spec.ts`.

Seventeen root unit files also touch dashboard contracts or storage/command composition. They stay
outside this run because their owning seam is not a dashboard component/model test: `archive-model`,
`archive-wire-model`, `command-kernel`, `dashboard-wire`, `dry-run-scenario-composition`,
`idempotency-key-privacy`, `notification-backfill-gap`, `notification-gate-park`,
`notification-inbox`, `operator-xlsx-export`, `receipt-derivation-binding`,
`run-queued-span-step-omission`, `separations-composition-wire`, `sqlite-authority-database`,
`storage-diagnostic-redaction`, `storage-span-authority-reconciliation`, and
`workflow-recipe-conformance`.

## Authority drift for R7

`guards-and-tests.md` still says 25 dashboard files / nine jsdom files and describes five Vitest
projects. Intake truth is 103 directory files / 21 jsdom files, while `vitest.config.ts` declares
three projects. R4 does not edit this cross-run authority; R7 owns reconciliation.

## Complete assertion ledger

The following ledger has exactly one row for each of the 1,056 collected intake assertions. Columns
are classification, disposition, retained owner, intake file, and full behavior title. Codes are
`PD` pure decision, `DW` DOM wiring, `VL` visual/layout, `AS` accessibility semantics,
`SP` server/projection transition, and `FD` fixture duplication. This makes the broad family
summary above auditable at assertion granularity.

```text
SP	keep	dashboard-wire.test.ts	dashboard-wire.test.ts	dashboard wire primitives parses recursively strict bootstrap, day, and detail resources
SP	keep	dashboard-wire.test.ts	dashboard-wire.test.ts	dashboard wire primitives keeps version, fingerprint, generation, revision, cursor, and identities distinct
SP	keep	dashboard-wire.test.ts	dashboard-wire.test.ts	dashboard wire primitives binds every served action to the row's own revision, once per key
SP	keep	dashboard-wire.test.ts	dashboard-wire.test.ts	dashboard wire primitives refuses a served chunk harness whose composition is not in the same document
SP	keep	dashboard-wire.test.ts	dashboard-wire.test.ts	dashboard wire primitives keeps queue surfaces flat and operation-only membership coherent
SP	keep	dashboard-wire.test.ts	dashboard-wire.test.ts	dashboard wire primitives rejects incompatible panel sections, open terminal gates, and duplicate detail identities
AS	keep	dashboard-wire.test.ts	dashboard-wire.test.ts	dashboard wire primitives D259 — a replayed step names the checkpoint it replayed, and measures nothing
PD	keep	dashboard-wire.test.ts	dashboard-wire.test.ts	lazy detail and artifact resources correlates every lazy section with a closed payload
PD	keep	dashboard-wire.test.ts	dashboard-wire.test.ts	lazy detail and artifact resources requires opaque content-addressed artifact metadata and explicit missing states
PD	keep	dashboard-wire.test.ts	dashboard-wire.test.ts	lazy detail and artifact resources requires strict nonempty unique capture memberships and identical bundle kinds across tiles
PD	keep	dashboard-wire.test.ts	dashboard-wire.test.ts	subscription snapshots, patches, and resets parses every correlated snapshot and patch arm
SP	keep	dashboard-wire.test.ts	dashboard-wire.test.ts	subscription snapshots, patches, and resets rejects topic/payload mismatches, wrong arms, and identity/revision drift
VL	keep	activity-render.test.ts	activity-render.test.ts	the rendered Activity axes (DCR1) shows distinct people while retaining Unread as its own workflow column
VL	keep	activity-render.test.ts	activity-render.test.ts	the rendered Activity axes (DCR1) names unavailable people evidence instead of painting it as zero
DW	keep	activity-render.test.ts	activity-render.test.ts	the rendered Activity axes (DCR1) keeps a measured zero distinct from the unavailable arm
PD	keep	archive-bump-applied.test.ts	archive-bump-applied.test.ts	the applied-bump banner says how many runs left, and offers the archive after a major bump
PD	keep	archive-bump-applied.test.ts	archive-bump-applied.test.ts	the applied-bump banner offers NO archive door after a minor bump, which archives nothing
PD	keep	archive-bump-applied.test.ts	archive-bump-applied.test.ts	the applied-bump banner keeps the door for a generation-1 plan that recorded no kind
PD	keep	archive-bump-applied.test.ts	archive-bump-applied.test.ts	the applied-bump banner distinguishes a replay from a fresh application, by the SETTLEMENT's verdict
SP	keep	archive-bump-applied.test.ts	archive-bump-applied.test.ts	the applied-bump banner draws the title from the `replayed` prop alone, not from any re-read wire state
AS	keep	archive-bump-round-trip-press.test.ts	archive-bump-round-trip-press.test.ts	the applied-bump banner survives the index re-read its own success triggers still names the sweep and offers the door once the re-read has landed
DW	keep	archive-bump-round-trip-press.test.ts	archive-bump-round-trip-press.test.ts	the applied-bump banner survives the index re-read its own success triggers opens the ledger through the door with the standing filter cleared
SP	keep	archive-bump-round-trip-press.test.ts	archive-bump-round-trip-press.test.ts	the applied-bump banner survives the index re-read its own success triggers does not offer the same plan for a second apply while the stale index still lists it
DW	keep	archive-bump-round-trip-press.test.ts	archive-bump-round-trip-press.test.ts	the applied-bump banner survives the index re-read its own success triggers clears the banner when the operator leaves the view it belongs to
VL	keep	archive-capture-origin-tone.test.ts	archive-capture-origin-tone.test.ts	ARCHIVED_CAPTURE_ORIGIN_TONE covers the served origin vocabulary exactly, both directions
VL	keep	archive-capture-origin-tone.test.ts	archive-capture-origin-tone.test.ts	ARCHIVED_CAPTURE_ORIGIN_TONE spends danger only where the SUBJECT may be wrong
SP	keep	archive-capture-resource-client.test.ts	archive-capture-resource-client.test.ts	the archived capture resource client binds the requested ids and abort signal to the exact resource request
SP	keep	archive-capture-resource-client.test.ts	archive-capture-resource-client.test.ts	the archived capture resource client refuses a strict resource response for a foreign run identity
SP	keep	archive-capture-resource-client.test.ts	archive-capture-resource-client.test.ts	the archived capture resource client refuses a strict resource response for a foreign artifact identity
SP	keep	archive-capture-resource-client.test.ts	archive-capture-resource-client.test.ts	the archived run client refuses a strict archived detail for a foreign requested run
DW	keep	archive-delete-door.test.ts	archive-delete-door.test.ts	D308 — the archived delete's confirm copy names what leaves, what the released key costs, and that there is no undo
AS	keep	archive-delete-door.test.ts	archive-delete-door.test.ts	D308 — the archived delete's confirm copy names the WORKFLOW the run wrote to, not a database noun
DW	keep	archive-delete-door.test.ts	archive-delete-door.test.ts	D308 — the archived run's delete door gates the send behind the confirm: opening it posts nothing
DW	keep	archive-delete-door.test.ts	archive-delete-door.test.ts	D308 — the archived run's delete door cancelling the confirm sends nothing and leaves the record selected
DW	keep	archive-delete-door.test.ts	archive-delete-door.test.ts	D308 — the archived run's delete door composes `delete-archived-run` citing the digest the page was served
DW	keep	archive-delete-door.test.ts	archive-delete-door.test.ts	D308 — the archived run's delete door returns to the ledger on `applied`, and the ledger no longer lists the run
SP	keep	archive-delete-door.test.ts	archive-delete-door.test.ts	D308 — the archived run's delete door draws the kernel's `schema-mismatch` refusal and stays on the record
DW	keep	archive-delete-door.test.ts	archive-delete-door.test.ts	D308 — the archived run's delete door warns, before the press, that a run which filed keeps its key only until now
PD	keep	archive-detail-render.test.ts	archive-detail-render.test.ts	the Decision card (AR150) is still drawn, with the gate it is about
PD	keep	archive-detail-render.test.ts	archive-detail-render.test.ts	the Decision card (AR150) borrows none of the run-wide counts its neighbours own
PD	keep	archive-detail-render.test.ts	archive-detail-render.test.ts	the Decision card (AR150) still gives the Attempts card its own section
AS	keep	archive-detail-render.test.ts	archive-detail-render.test.ts	the sweep record card's name (unit F10d finding 1) pairs the full identity onto the accessible name, not just the pointer-only title
PD	keep	archive-detail-render.test.ts	archive-detail-render.test.ts	a skipped step whose span recorded no reason (D307) draws the served absent reason beside the step that did not run
PD	keep	archive-detail-render.test.ts	archive-detail-render.test.ts	a skipped step whose span recorded no reason (D307) still draws the closed vocabulary when the span DID record a reason
PD	keep	archive-detail-render.test.ts	archive-detail-render.test.ts	a skipped step whose span recorded no reason (D307) leaves a step that RAN with no note at all
VL	keep	archive-detail-render.test.ts	archive-detail-render.test.ts	the frozen log line (AR163) sizes the level column for the LONGEST word this wire serves
VL	keep	archive-detail-render.test.ts	archive-detail-render.test.ts	the frozen log line (AR163) puts the clock and the level in fixed columns, so messages share one x
VL	keep	archive-detail-render.test.ts	archive-detail-render.test.ts	the frozen log line (AR163) draws the level column's SIZE from ds-text-caps alone (unit F10d finding 4)
PD	keep	archive-detail-render.test.ts	archive-detail-render.test.ts	the frozen log line (AR163) prints the level as a WORD, so the tint is never its only carrier
PD	keep	archive-detail-render.test.ts	archive-detail-render.test.ts	the frozen log line (AR163) gives each level its own tint
FD	keep	archive-evidence-fixture.test.ts	archive-evidence-fixture.test.ts	the archive-evidence fixture serves the exact resource download over real HTTP from an ephemeral port
FD	keep	archive-evidence-fixture.test.ts	archive-evidence-fixture.test.ts	the archive-evidence fixture refuses foreign capture ids over real HTTP without falling through to static bytes
FD	keep	archive-evidence-fixture.test.ts	archive-evidence-fixture.test.ts	the archive-evidence fixture keeps the default HTTP archive corpus isolated from evidence and static substitutes
FD	keep	archive-evidence-fixture.test.ts	archive-evidence-fixture.test.ts	the archive-evidence fixture preserves ordinary static files and missing-file 404s beside the exact HTTP artifact route
FD	keep	archive-evidence-fixture.test.ts	archive-evidence-fixture.test.ts	the archive-evidence fixture leaves the broad archive corpus unchanged unless the evidence scenario is selected
FD	keep	archive-evidence-fixture.test.ts	archive-evidence-fixture.test.ts	the archive-evidence fixture does not reuse the broad corpus fingerprint for a different archived record
FD	keep	archive-evidence-fixture.test.ts	archive-evidence-fixture.test.ts	the archive-evidence fixture projects the exact sealed durable record into both the evidence detail and index
FD	keep	archive-evidence-fixture.test.ts	archive-evidence-fixture.test.ts	the archive-evidence fixture refuses foreign run and artifact ids even inside the evidence scenario
FD	keep	archive-evidence-fixture.test.ts	archive-evidence-fixture.test.ts	the archive-evidence fixture serves the exact frozen capture bytes and metadata through its own archive route
PD	keep	archive-open-door-query.test.ts	archive-open-door-query.test.ts	the applied-bump banner's door (unit F10d finding 2) clears the standing filter before switching back to the runs ledger
PD	keep	archive-open-door-query.test.ts	archive-open-door-query.test.ts	the applied-bump banner's door (unit F10d finding 2) the walker sees the pattern it forbids (negative control)
VL	keep	archive-render.test.ts	archive-render.test.ts	the windowed archive table names its true size to assistive tech ports the five measured archive column widths through their demo-shaped classes
DW	keep	archive-render.test.ts	archive-render.test.ts	the windowed archive table names its true size to assistive tech does not retain the demo-only row hook on archived runs
AS	keep	archive-render.test.ts	archive-render.test.ts	the windowed archive table names its true size to assistive tech sets aria-rowcount from the flat item list, not the mounted slice
AS	keep	archive-render.test.ts	archive-render.test.ts	the windowed archive table names its true size to assistive tech gives every mounted row a 1-based aria-rowindex over the FULL list
DW	keep	archive-render.test.ts	archive-render.test.ts	the windowed archive table names its true size to assistive tech keeps the window's own rowIndex offset when a section is collapsed
DW	keep	archive-render.test.ts	archive-render.test.ts	the capture viewer's Previous/Next walk never drops focus keeps focus on Previous once the walk reaches the first capture
DW	keep	archive-render.test.ts	archive-render.test.ts	the capture viewer's Previous/Next walk never drops focus keeps focus on Next once the walk reaches the last capture
DW	keep	archive-render.test.ts	archive-render.test.ts	the capture viewer's Previous/Next walk never drops focus does not advance past either end
DW	keep	archive-render.test.ts	archive-render.test.ts	returns focus to the actual archived capture opener after button
DW	keep	archive-render.test.ts	archive-render.test.ts	returns focus to the actual archived capture opener after Escape
SP	keep	archive-render.test.ts	archive-render.test.ts	the archived capture viewer's read-time resource state explicitly loads the requested archived image eagerly
DW	keep	archive-render.test.ts	archive-render.test.ts	the archived capture viewer's read-time resource state reserves the same preview shell through resource loading, decode and failure with unrecorded dimensions
DW	keep	archive-render.test.ts	archive-render.test.ts	the archived capture viewer's read-time resource state reserves the same preview shell through resource loading, decode and failure with frozen dimensions
DW	keep	archive-render.test.ts	archive-render.test.ts	the archived capture viewer's read-time resource state reserves a separate readiness-caption lane without covering retained imagery
DW	keep	archive-render.test.ts	archive-render.test.ts	the archived capture viewer's read-time resource state offers a verified image download without replacing frozen metadata or inventing purge
DW	keep	archive-render.test.ts	archive-render.test.ts	the archived capture viewer's read-time resource state declares both dimensions of the coarse-pointer touch floor on every capture footer action and its header close
DW	keep	archive-render.test.ts	archive-render.test.ts	the archived capture viewer's read-time resource state withholds the verified-image claim until the browser has loaded and decoded the image
DW	keep	archive-render.test.ts	archive-render.test.ts	the archived capture viewer's read-time resource state keeps decode-rejection visible after metadata verification
VL	keep	archive-render.test.ts	archive-render.test.ts	the archived capture viewer's read-time resource state keeps zero-width visible after metadata verification
VL	keep	archive-render.test.ts	archive-render.test.ts	the archived capture viewer's read-time resource state keeps zero-height visible after metadata verification
DW	keep	archive-render.test.ts	archive-render.test.ts	the archived capture viewer's read-time resource state ignores an old image decode resolve after the next image is ready
DW	keep	archive-render.test.ts	archive-render.test.ts	the archived capture viewer's read-time resource state ignores an old image decode reject after the next image is ready
DW	keep	archive-render.test.ts	archive-render.test.ts	the archived capture viewer's read-time resource state ignores an old image decode resolve after the close-reopen image is ready
DW	keep	archive-render.test.ts	archive-render.test.ts	the archived capture viewer's read-time resource state ignores an old image decode reject after the close-reopen image is ready
DW	keep	archive-render.test.ts	archive-render.test.ts	the archived capture viewer's read-time resource state requires a fresh A decode after navigating A to non-image B to A
DW	keep	archive-render.test.ts	archive-render.test.ts	the archived capture viewer's read-time resource state requires a fresh A decode after navigating A to undecoded-image B to A
DW	keep	archive-render.test.ts	archive-render.test.ts	the archived capture viewer's read-time resource state preserves current metadata after an old resource resolve across next
DW	keep	archive-render.test.ts	archive-render.test.ts	the archived capture viewer's read-time resource state preserves current metadata after an old resource reject across next
DW	keep	archive-render.test.ts	archive-render.test.ts	the archived capture viewer's read-time resource state preserves current metadata after an old resource resolve across close-reopen
DW	keep	archive-render.test.ts	archive-render.test.ts	the archived capture viewer's read-time resource state preserves current metadata after an old resource reject across close-reopen
DW	keep	archive-render.test.ts	archive-render.test.ts	the archived capture viewer's read-time resource state keeps a verified-metadata image load failure visible instead of claiming a broken image is verified
DW	keep	archive-render.test.ts	archive-render.test.ts	the archived capture viewer's read-time resource state keeps frozen capture metadata readable for missing, corrupt, and unavailable resource results
DW	keep	archive-render.test.ts	archive-render.test.ts	the archived capture viewer's read-time resource state keeps frozen capture metadata readable when byte verification reports corruption
SP	keep	archive-render.test.ts	archive-render.test.ts	the archived capture viewer's read-time resource state keeps frozen capture metadata readable when the resource request itself is unavailable
DW	keep	archive-render.test.ts	archive-render.test.ts	the archived capture viewer's read-time resource state offers non-image bytes for download without fabricating an inline preview
SP	keep	archive-render.test.ts	archive-render.test.ts	the archived capture viewer's read-time resource state aborts and ignores the prior capture request before the next capture can render it
DW	keep	archive-render.test.ts	archive-render.test.ts	the archived capture viewer's read-time resource state aborts and ignores a closed capture request when the same dialog is reopened
DW	keep	archive-render.test.ts	archive-render.test.ts	the archived capture viewer's read-time resource state does not reuse an already-decoded image as success after a close and reopen of the same capture
SP	keep	archive-render.test.ts	archive-render.test.ts	the archived capture viewer's read-time resource state refuses a foreign URL from an injected reader even when the response repeats the requested ids
DW	keep	archive-render.test.ts	archive-render.test.ts	the archived capture viewer's read-time resource state refuses a foreign runId from an injected reader before exposing a download
DW	keep	archive-render.test.ts	archive-render.test.ts	the archived capture viewer's read-time resource state refuses a foreign artifactId from an injected reader before exposing a download
PD	keep	archive-sweep-name.test.ts	archive-sweep-name.test.ts	archiveWorkflowCodes answers the identity a sweep moved runs ONTO from the registry row
PD	keep	archive-sweep-name.test.ts	archive-sweep-name.test.ts	archiveWorkflowCodes answers the identity a run RAN from that run's frozen code
PD	keep	archive-sweep-name.test.ts	archive-sweep-name.test.ts	archiveWorkflowCodes never carries a code across a version it was not true at
PD	keep	archive-sweep-name.test.ts	archive-sweep-name.test.ts	archiveWorkflowCodes lets the archive's frozen copy win over the registry at one identity
PD	keep	archive-sweep-name.test.ts	archive-sweep-name.test.ts	archiveWorkflowCodes carries no entry whose code was never frozen
PD	keep	archive-sweep-name.test.ts	archive-sweep-name.test.ts	archiveSweepName prints the short code, and degrades to the workflow ID when none was frozen
PD	keep	archive-sweep-name.test.ts	archive-sweep-name.test.ts	archiveSweepName carries a SECOND fact on the hover, never a copy of its own cell (AR82)
PD	keep	archive-sweep-name.test.ts	archive-sweep-name.test.ts	the sweep head draws the joined name puts the code in the cell and the scope on the title
VL	keep	archive-sweep-name.test.ts	archive-sweep-name.test.ts	the sweep head draws the joined name truncates the sweep id in the trace column
PD	keep	archive-sweep-name.test.ts	archive-sweep-name.test.ts	archiveSweepFacts states the WHOLE sweep id, so the trace cell's title is not its only route (AR84)
AS	keep	archive-sweep-name.test.ts	archive-sweep-name.test.ts	archiveSweepFacts names the archived-nothing case rather than printing an empty range
PD	keep	archive-sweep-name.test.ts	archive-sweep-name.test.ts	archiveSweepFacts carries the FULL identities the head's short codes stand in for (unit F10d finding 1)
PD	keep	archive-view-model.test.ts	archive-view-model.test.ts	archive index facts keeps warning presence and absence distinct
PD	keep	archive-view-model.test.ts	archive-view-model.test.ts	archive index facts labels every queue status through the design-system vocabulary
PD	keep	archive-view-model.test.ts	archive-view-model.test.ts	archive index facts keeps the done and partial filter labels visibly distinct
PD	keep	archive-view-model.test.ts	archive-view-model.test.ts	archived detail identity and relaunch facts uses a served display name and subtitle, with only the title's verified fallback
PD	keep	archive-view-model.test.ts	archive-view-model.test.ts	archived detail identity and relaunch facts folds both priorities without a default
PD	keep	archive-view-model.test.ts	archive-view-model.test.ts	archived detail identity and relaunch facts derives only the relaunch cautions the frozen row proves
PD	keep	archive-view-model.test.ts	archive-view-model.test.ts	archived detail identity and relaunch facts names an applied relaunch from the available arm and refuses the impossible arm
PD	keep	archive-view-model.test.ts	archive-view-model.test.ts	version-bump labels folds both recorded kinds and the read-forward absence
PD	keep	archive-view-model.test.ts	archive-view-model.test.ts	version-bump labels names frozen source versions and preserves the archived-nothing arm
PD	keep	archive-view-model.test.ts	archive-view-model.test.ts	version-bump labels maps every non-terminal authority state and fails loud for terminal
PD	keep	archive-view-model.test.ts	archive-view-model.test.ts	the archived capture viewer (D274 item 10) prints every fact the frozen tile holds, in reading order
PD	keep	archive-view-model.test.ts	archive-view-model.test.ts	the archived capture viewer (D274 item 10) keeps an absent step, system and pixel size as three DIFFERENT reasons
PD	keep	archive-view-model.test.ts	archive-view-model.test.ts	the archived capture viewer (D274 item 10) never claims the bytes are still there, or gone
AS	keep	archive-view-model.test.ts	archive-view-model.test.ts	the version-bump dialog's kind semantics (D274 item 2) gives a MAJOR bump the assessment's runs, exactly as resolveBumpEffect does
AS	keep	archive-view-model.test.ts	archive-view-model.test.ts	the version-bump dialog's kind semantics (D274 item 2) gives a MINOR bump no candidates and no blockers — and keeps the facts under names that say so
AS	keep	archive-view-model.test.ts	archive-view-model.test.ts	the version-bump dialog's kind semantics (D274 item 2) parameterises the resolution head, including the plan that recorded no kind
AS	keep	archive-view-model.test.ts	archive-view-model.test.ts	the version-bump dialog's kind semantics (D274 item 2) names the parked-write half of a blocker set separately
AS	keep	archive-view-model.test.ts	archive-view-model.test.ts	the version-bump dialog's kind semantics (D274 item 2) resolves every non-terminal state and refuses a terminal one
AS	keep	archive-view-model.test.ts	archive-view-model.test.ts	the version-bump dialog's kind semantics (D274 item 2) says what each scope moves, and never calls a one-workflow bump 'several'
PD	keep	archive-view-model.test.ts	archive-view-model.test.ts	the change record the primary button can be pressed without (VB41) composes a complete record, absent commit included
PD	keep	archive-view-model.test.ts	archive-view-model.test.ts	the change record the primary button can be pressed without (VB41) refuses an empty record BY NAME, with the code a bug report would quote
PD	keep	archive-view-model.test.ts	archive-view-model.test.ts	the change record the primary button can be pressed without (VB41) names only the field that is actually missing
VL	keep	archive-window.test.ts	archive-window.test.ts	the archive table's declared row heights restates exactly what the tokens set on the two row kinds
VL	keep	archive-window.test.ts	archive-window.test.ts	the archive table's declared row heights gives each item kind its own height
PD	keep	archive-window.test.ts	archive-window.test.ts	flattenArchiveTable puts heads and runs in ONE sequence, head first
PD	keep	archive-window.test.ts	archive-window.test.ts	flattenArchiveTable makes a collapsed sweep cost ONE item, however many runs it holds
PD	keep	archive-window.test.ts	archive-window.test.ts	windowArchiveTable renders EVERY item while the viewport is unmeasured, with no spacers
PD	keep	archive-window.test.ts	archive-window.test.ts	windowArchiveTable holds only the visible items plus the overscan, at 800 rows
PD	keep	archive-window.test.ts	archive-window.test.ts	windowArchiveTable keeps the two spacers and the window exactly covering the list
PD	keep	archive-window.test.ts	archive-window.test.ts	windowArchiveTable scrolls the window down the list rather than growing it
VL	keep	archive-window.test.ts	archive-window.test.ts	windowArchiveTable clips the overscan at the ends rather than reaching past the list
PD	keep	archive-window.test.ts	archive-window.test.ts	windowArchiveTable clamps an elastic overscroll to the top rather than refusing it
PD	keep	archive-window.test.ts	archive-window.test.ts	windowArchiveTable refuses a measurement that is not a number, instead of blanking the table
PD	keep	archive-window.test.ts	archive-window.test.ts	windowArchiveTable windows an empty list to nothing
SP	keep	bulk-dispatch.test.ts	bulk-dispatch.test.ts	planBulkVerb — the intersection and the named skips (D235) puts retry before irreversible cancel on the strip
PD	keep	bulk-dispatch.test.ts	bulk-dispatch.test.ts	planBulkVerb — the intersection and the named skips (D235) splits a mixed selection into the eligible intersection and the named skipped rows
SP	keep	bulk-dispatch.test.ts	bulk-dispatch.test.ts	planBulkVerb — the intersection and the named skips (D235) uses the server's label when every eligible row agrees, and the strip's own noun when they disagree
PD	keep	bulk-dispatch.test.ts	bulk-dispatch.test.ts	planBulkVerb — the intersection and the named skips (D235) offers only verbs with at least one eligible row
PD	keep	bulk-dispatch.test.ts	bulk-dispatch.test.ts	planBulkVerb — selected rows the day no longer serves names a selected id with no served row instead of dropping it
PD	keep	bulk-dispatch.test.ts	bulk-dispatch.test.ts	planBulkVerb — selected rows the day no longer serves states the unavailable rows in the confirm body, beside the skipped ones
PD	keep	bulk-dispatch.test.ts	bulk-dispatch.test.ts	planBulkVerb — selected rows the day no longer serves refuses a plan whose whole selection has left the day, naming why
PD	keep	bulk-dispatch.test.ts	bulk-dispatch.test.ts	planBulkVerb — selected rows the day no longer serves throws when a candidate row is not in the selection it claims to plan for
PD	keep	bulk-dispatch.test.ts	bulk-dispatch.test.ts	the complete bulk result vector (D235) keeps every outcome bucket, including zeros, and distinguishes a clean pass
PD	keep	bulk-dispatch.test.ts	bulk-dispatch.test.ts	the complete bulk result vector (D235) requires review for every partial vector, including an unattempted remainder
SP	keep	bulk-dispatch.test.ts	bulk-dispatch.test.ts	composeBulkRunCommand — a plan with nothing eligible refuses (D235) refuses an empty selection and a selection where nothing serves the verb, with different reasons
SP	keep	bulk-dispatch.test.ts	bulk-dispatch.test.ts	composeBulkRunCommand — a plan with nothing eligible refuses (D235) composes a best-effort envelope whose bulk identity seeds the child identities
PD	keep	bulk-dispatch.test.ts	bulk-dispatch.test.ts	the confirm copy and the frozen subjects (D235) states the count, the per-run transition, and how many rows are left alone
VL	keep	bulk-dispatch.test.ts	bulk-dispatch.test.ts	the confirm copy and the frozen subjects (D235) freezes one subject per eligible target so the result band can name runs after the page moves on
VL	keep	chip-semantics.test.ts	chip-semantics.test.ts	Chip — shared fact semantics keeps the label, full hover value, and single-line clipping contract together
SP	keep	client-transport.test.ts	client-transport.test.ts	day-state patch application (D81: apply, never derive) replaces by identity, keeps counts untouched, and dedupes stale revisions
SP	keep	client-transport.test.ts	client-transport.test.ts	day-state patch application (D81: apply, never derive) treats a patch for an unheld run as a protocol failure, never an insert
SP	keep	client-transport.test.ts	client-transport.test.ts	typed queries and error normalization posts a strict XLSX selection and returns its evidenced attachment headers with bytes
SP	keep	client-transport.test.ts	client-transport.test.ts	typed queries and error normalization encodes and parses the strict cross-date search contract
SP	keep	client-transport.test.ts	client-transport.test.ts	typed queries and error normalization rejects malformed and unknown cross-date search response bodies
SP	keep	client-transport.test.ts	client-transport.test.ts	typed queries and error normalization accepts a non-empty page from the measured search corpus
SP	keep	client-transport.test.ts	client-transport.test.ts	typed queries and error normalization rejects every result outside the measured search corpus
SP	keep	client-transport.test.ts	client-transport.test.ts	typed queries and error normalization refuses an invalid cross-date search query before sending it
SP	keep	client-transport.test.ts	client-transport.test.ts	typed queries and error normalization parses a valid day and rejects a contract-violating body as a schema error
SP	keep	client-transport.test.ts	client-transport.test.ts	typed queries and error normalization carries the server's typed wire error through as an http error
SP	keep	client-transport.test.ts	client-transport.test.ts	typed queries and error normalization normalizes transport failure as a retryable network error and validates requests before sending
SP	keep	client-transport.test.ts	client-transport.test.ts	typed queries and error normalization sends command mutations with the exact transport Origin and JSON media type
SP	keep	client-transport.test.ts	client-transport.test.ts	typed queries and error normalization surfaces an operator-ingress 403 command refusal as an HTTP error
SP	keep	client-transport.test.ts	client-transport.test.ts	typed queries and error normalization surfaces an operator-ingress 415 command refusal as an HTTP error
SP	keep	client-transport.test.ts	client-transport.test.ts	typed queries and error normalization parses only the command route's declared non-success result statuses
SP	keep	client-transport.test.ts	client-transport.test.ts	typed queries and error normalization keeps bulk 409 as an HTTP error even with a valid bulk result body
SP	keep	client-transport.test.ts	client-transport.test.ts	typed queries and error normalization keeps non-command 409 as an HTTP error even with a valid query body
SP	keep	client-transport.test.ts	client-transport.test.ts	typed queries and error normalization keeps non-command 422 as an HTTP error even with a valid query body
SP	keep	client-transport.test.ts	client-transport.test.ts	typed queries and error normalization keeps undeclared command 500 as an HTTP error even with a valid command result body
SP	keep	client-transport.test.ts	client-transport.test.ts	resumable subscription protocol applies snapshot then count-neutral patches, and resumes with Last-Event-ID after a drop
SP	keep	client-transport.test.ts	client-transport.test.ts	resumable subscription protocol forces a fresh snapshot on a cursor gap by reconnecting without Last-Event-ID
SP	keep	client-transport.test.ts	client-transport.test.ts	resumable subscription protocol clears state and resubscribes on reset-required
SP	keep	client-transport.test.ts	client-transport.test.ts	resumable subscription protocol stops loudly on a malformed envelope instead of ignoring it
SP	keep	command-guard-surfacing.test.ts	command-guard-surfacing.test.ts	dispatchCommand's settlement handler surfaces its own guards still has guards worth catching
SP	keep	command-guard-surfacing.test.ts	command-guard-surfacing.test.ts	dispatchCommand's settlement handler surfaces its own guards terminates the chain in a `.catch`, which is the only handler a throw from the fulfilment arm can reach
PD	keep	command-guard-surfacing.test.ts	command-guard-surfacing.test.ts	the two promise shapes, driven with the real guard and the real handler the two-arm `.then(a, b)` this replaced loses the guard entirely
PD	keep	command-guard-surfacing.test.ts	command-guard-surfacing.test.ts	the two promise shapes, driven with the real guard and the real handler the chained `.then(a).catch(b)` reports the guard's own sentence through the danger toast
SP	keep	command-guard-surfacing.test.ts	command-guard-surfacing.test.ts	the two promise shapes, driven with the real guard and the real handler still routes a transport rejection to the same handler, which the chained form must not lose
SP	keep	command-result-feed.test.ts	command-result-feed.test.ts	command result feed settlement (D253) refuses to create persistent failure context for an applied command
SP	keep	command-result-feed.test.ts	command-result-feed.test.ts	command result feed settlement (D253) preserves both refusal arms and their distinct server facts
SP	keep	command-result-feed.test.ts	command-result-feed.test.ts	the applied-command toast (D253) draws the applied receipt from the settlement and the surface's own context
SP	keep	command-result-feed.test.ts	command-result-feed.test.ts	the applied-command toast (D253) throws rather than falling silent when handed a refusal
SP	keep	command-result.test.ts	command-result.test.ts	settleCommandResult (D253) settles both landing arms as applied, and says which was a replay
SP	keep	command-result.test.ts	command-result.test.ts	settleCommandResult (D253) settles a CAS conflict as a REFUSAL carrying the server's own version
SP	keep	command-result.test.ts	command-result.test.ts	settleCommandResult (D253) carries a conflict's `currentVersion` as a NUMBER, for a surface that lays it out itself
SP	keep	command-result.test.ts	command-result.test.ts	settleCommandResult (D253) keeps a conflict's `message` UNCOMPOSED — it is the wire's sentence, not the fold's
SP	keep	command-result.test.ts	command-result.test.ts	settleCommandResult (D253) passes a kernel rejection's own sentence through UNCHANGED
SP	keep	command-result.test.ts	command-result.test.ts	settleCommandResult (D253) carries EVERY rejection code the kernel can send, verbatim
SP	keep	command-result.test.ts	command-result.test.ts	settleCommandResult (D253) keeps the two refusals distinguishable — they are different operator acts
SP	keep	command-result.test.ts	command-result.test.ts	settleCommandResult (D253) answers `refused` for BOTH refusal arms and `applied` for neither
SP	keep	command-result.test.ts	command-result.test.ts	commandFailureToast — where the command died decides what may be claimed says nothing was SENT before dispatch, carrying the client's own reason verbatim
SP	keep	command-result.test.ts	command-result.test.ts	commandFailureToast — where the command died decides what may be claimed refuses to claim anything about the server after dispatch, and says what to do instead
SP	keep	command-result.test.ts	command-result.test.ts	commandFailureToast — where the command died decides what may be claimed keeps the two stages DISTINGUISHABLE, which is the whole finding
SP	keep	command-result.test.ts	command-result.test.ts	commandFailureToast — where the command died decides what may be claimed survives a throw that is not an Error, rather than printing `[object Object]` at the operator
DW	keep	context-rail-render.test.ts	context-rail-render.test.ts	the refused-save copy (C55 / C57, D273 item 6) counts the held drafts and agrees with its own verb
DW	keep	context-rail-render.test.ts	context-rail-render.test.ts	the refused-save copy (C55 / C57, D273 item 6) never reads the same for the two arms — the parameter has to arrive
DW	keep	context-rail-render.test.ts	context-rail-render.test.ts	the refused-save copy (C55 / C57, D273 item 6) refuses to compose a reassurance about no edits at all
DW	keep	context-rail-render.test.ts	context-rail-render.test.ts	a refused save is drawn with its code (C55 / C57, D273 item 6) prints the SERVED code, the outcome and the held drafts on the coded arm
DW	keep	context-rail-render.test.ts	context-rail-render.test.ts	a refused save is drawn with its code (C55 / C57, D273 item 6) says there is nothing to quote on the uncoded arm rather than inventing one
SP	keep	context-rail-render.test.ts	context-rail-render.test.ts	a refused save is drawn with its code (C55 / C57, D273 item 6) keeps the server's sentence and the product's in separate blocks
DW	keep	context-rail-render.test.ts	context-rail-render.test.ts	a refused save is drawn with its code (C55 / C57, D273 item 6) announces once — one alert, not a nested pair
DW	keep	context-rail-render.test.ts	context-rail-render.test.ts	a refused save is drawn with its code (C55 / C57, D273 item 6) draws nothing at all when no save was refused
DW	keep	context-rail-render.test.ts	context-rail-render.test.ts	the step group's own chrome (C51, D273 item 5) gives every attributed step a Well, a recessed band and divided rows
DW	keep	context-rail-render.test.ts	context-rail-render.test.ts	the step group's own chrome (C51, D273 item 5) gives the unattributed group no band, because it has no step to name
DW	keep	context-rail-render.test.ts	context-rail-render.test.ts	the step group's own chrome (C51, D273 item 5) puts the system chip on the band and not on each row
AS	keep	context-rail-render.test.ts	context-rail-render.test.ts	the rail's words (C16 / C32, D273 item 5) names the direction with the demo's own pair
DW	keep	context-rail-render.test.ts	context-rail-render.test.ts	the rail's words (C16 / C32, D273 item 5) gives the Data section ONE name, read by its region and its label alike
DW	keep	context-rail-render.test.ts	context-rail-render.test.ts	the blocked commit arm states its reason exactly once (C70, D273 item 6) keeps the reason readable with every tooltip stripped
DW	keep	context-rail-render.test.ts	context-rail-render.test.ts	the blocked commit arm states its reason exactly once (C70, D273 item 6) says it once, not once on screen and once on a title
DW	keep	context-rail-render.test.ts	context-rail-render.test.ts	the blocked commit arm states its reason exactly once (C70, D273 item 6) draws the resting commit label, not the in-flight one
DW	keep	context-rail-render.test.ts	context-rail-render.test.ts	dismissing a refusal restores focus, it does not drop it (finding 1) moves focus to the Save control before the refusal unmounts
AS	keep	context-rail-render.test.ts	context-rail-render.test.ts	a refused save's toast does not repeat the banner's alert (finding 2) mounts the banner as the one role="alert" and the toast as role="status"
PD	keep	cross-date-search-ui.test.ts	cross-date-search-ui.test.ts	the Top Bar corpus search starts a bounded Separations corpus query from the typed term
VL	keep	cross-date-search-ui.test.ts	cross-date-search-ui.test.ts	the Top Bar corpus search requires the opaque snapshot token before a corpus page can reach the control
SP	keep	cross-date-search-ui.test.ts	cross-date-search-ui.test.ts	the Top Bar corpus search keeps a wire-schema refusal typed without echoing response detail
SP	keep	cross-date-search-ui.test.ts	cross-date-search-ui.test.ts	the Top Bar corpus search redacts non-schema and unsafe continuation failures before they enter UI state
PD	keep	cross-date-search-ui.test.ts	cross-date-search-ui.test.ts	a cross-date search result opens its exact run in its partition rather than the current day
VL	keep	day-search-control.test.ts	day-search-control.test.ts	the Top Bar corpus request debounces input and prevents an old settlement from painting over the newer query
SP	keep	day-search-control.test.ts	day-search-control.test.ts	the Top Bar corpus request keeps unexpected failure detail out of both corpus and this-day UI
SP	keep	day-search-control.test.ts	day-search-control.test.ts	the Top Bar corpus request renders a redacted continuation refusal when a later page repeats a durable run
SP	keep	day-state-splice.test.ts	day-state-splice.test.ts	D4 — applyDashboardDayPatch splices one row (audit P1) replaces the named row with NO whole-day re-parse and leaves every other row reference-equal
SP	keep	day-state-splice.test.ts	day-state-splice.test.ts	D4 — applyDashboardDayPatch splices one row (audit P1) removes the named row with NO whole-day re-parse, keeping the survivors reference-equal
SP	keep	day-state-splice.test.ts	day-state-splice.test.ts	D4 — applyDashboardDayPatch splices one row (audit P1) refuses a patch naming a run this snapshot does not hold — replace and remove alike
SP	keep	day-state-splice.test.ts	day-state-splice.test.ts	D4 — applyDashboardDayPatch splices one row (audit P1) refuses a shape-mismatched patch rather than splicing it, and leaves the held day untouched
SP	keep	day-state-splice.test.ts	day-state-splice.test.ts	D4 — applyDashboardDayPatch splices one row (audit P1) keeps the FRESHER row when a resume replays a stale revision, and parses nothing
VL	keep	design-token-references.test.ts	design-token-references.test.ts	dashboard design tokens defines every --ds-* custom property the surfaces read
VL	keep	design-token-references.test.ts	design-token-references.test.ts	dashboard design tokens keeps the runtime-declared allowlist honest
VL	keep	detail-region-breakpoints.test.ts	detail-region-breakpoints.test.ts	the detail region's breakpoints spells only the two thresholds the constants name
VL	keep	detail-region-breakpoints.test.ts	detail-region-breakpoints.test.ts	the detail region's breakpoints keys on the COLUMN, never on the window
VL	keep	detail-region-breakpoints.test.ts	detail-region-breakpoints.test.ts	the detail region's breakpoints derives both thresholds from the shell the region sits in
SP	keep	diagnostic-bundle-client.test.ts	diagnostic-bundle-client.test.ts	E29 diagnostic bundle client and fixture route forwards an optional diagnostic read signal without adding one to ordinary reads
SP	keep	diagnostic-bundle-client.test.ts	diagnostic-bundle-client.test.ts	E29 diagnostic bundle client and fixture route keeps manifest and attachment links owned by transport base http://127.0.0.1:3938
SP	keep	diagnostic-bundle-client.test.ts	diagnostic-bundle-client.test.ts	E29 diagnostic bundle client and fixture route keeps manifest and attachment links owned by transport base https://dashboard.example/owned-base/
SP	keep	diagnostic-bundle-client.test.ts	diagnostic-bundle-client.test.ts	E29 diagnostic bundle client and fixture route refuses unsafe resource identity  before returning any URL
SP	keep	diagnostic-bundle-client.test.ts	diagnostic-bundle-client.test.ts	E29 diagnostic bundle client and fixture route refuses unsafe resource identity ../../latest before returning any URL
SP	keep	diagnostic-bundle-client.test.ts	diagnostic-bundle-client.test.ts	E29 diagnostic bundle client and fixture route refuses unsafe resource identity https://foreign.example/id before returning any URL
SP	keep	diagnostic-bundle-client.test.ts	diagnostic-bundle-client.test.ts	E29 diagnostic bundle client and fixture route refuses unsafe resource identity 00000000-0000-4000-8000-000000000001?redirect=elsewhere before returning any URL
VL	keep	diagnostic-bundle-client.test.ts	diagnostic-bundle-client.test.ts	E29 diagnostic bundle client and fixture route preserves HTTP 404 TARGET_NOT_FOUND without parsing error prose
SP	keep	diagnostic-bundle-client.test.ts	diagnostic-bundle-client.test.ts	E29 diagnostic bundle client and fixture route preserves HTTP 500 DIAGNOSTIC_BUNDLE_CORRUPT without parsing error prose
SP	keep	diagnostic-bundle-client.test.ts	diagnostic-bundle-client.test.ts	E29 diagnostic bundle client and fixture route preserves HTTP 500 DIAGNOSTIC_BUNDLE_BYTES_MISSING without parsing error prose
SP	keep	diagnostic-bundle-client.test.ts	diagnostic-bundle-client.test.ts	E29 diagnostic bundle client and fixture route GETs one strict bundle by its exact id and gives the browser the manifest route
SP	keep	diagnostic-bundle-client.test.ts	diagnostic-bundle-client.test.ts	E29 diagnostic bundle client and fixture route serves the fixture's actual download response and rejects wrong ids and malformed wire bodies
SP	keep	diagnostic-bundle-client.test.ts	diagnostic-bundle-client.test.ts	E29 diagnostic bundle client and fixture route rejects a strict response whose bundle identity differs from the requested id
SP	keep	diagnostic-bundle-trust-model.test.ts	diagnostic-bundle-trust-model.test.ts	diagnostic bundle trust readback keeps the requested identity and a named error when a client seam returns a foreign bundle
PD	keep	diagnostic-bundle-trust-model.test.ts	diagnostic-bundle-trust-model.test.ts	diagnostic screenshot gallery vocabulary keeps a screenshot label bounded to the bundle-local ordinal
VL	keep	diagnostic-bundle-trust-model.test.ts	diagnostic-bundle-trust-model.test.ts	diagnostic screenshot gallery vocabulary keeps the TARGET_NOT_FOUND authority vocabulary without parsing error prose
PD	keep	diagnostic-bundle-trust-model.test.ts	diagnostic-bundle-trust-model.test.ts	diagnostic screenshot gallery vocabulary keeps the DIAGNOSTIC_BUNDLE_BYTES_MISSING authority vocabulary without parsing error prose
PD	keep	diagnostic-bundle-trust-model.test.ts	diagnostic-bundle-trust-model.test.ts	diagnostic screenshot gallery vocabulary keeps the DIAGNOSTIC_BUNDLE_CORRUPT authority vocabulary without parsing error prose
PD	keep	diagnostic-bundle-trust-model.test.ts	diagnostic-bundle-trust-model.test.ts	diagnostic screenshot gallery vocabulary keeps the SECTION_UNAVAILABLE authority vocabulary without parsing error prose
PD	keep	diagnostic-bundle-trust-model.test.ts	diagnostic-bundle-trust-model.test.ts	diagnostic screenshot gallery vocabulary keeps an unrecognized or network re-read failure unverified
PD	keep	diagnostic-bundle-trust-model.test.ts	diagnostic-bundle-trust-model.test.ts	diagnostic screenshot gallery vocabulary names only a successful exact readback as a browser load or decode failure
PD	keep	diagnostic-bundle-trust-model.test.ts	diagnostic-bundle-trust-model.test.ts	diagnostic screenshot gallery vocabulary refuses a changed bundle digest after an image failure even when the artifact id remains indexed
PD	keep	diagnostic-bundle-trust-model.test.ts	diagnostic-bundle-trust-model.test.ts	diagnostic screenshot gallery vocabulary requires the selected screenshot's full identity on the exact reread, not mere id membership
FD	keep	diagnostic-fixture-http.test.ts	diagnostic-fixture-http.test.ts	diagnostic fixture over real HTTP refuses an undeclared fixture variant instead of silently serving the default PNG
FD	keep	diagnostic-fixture-http.test.ts	diagnostic-fixture-http.test.ts	diagnostic fixture over real HTTP serves the restricted JPEG as one exact wire, durable manifest and byte identity
FD	keep	diagnostic-fixture-http.test.ts	diagnostic-fixture-http.test.ts	diagnostic fixture over real HTTP leaves the default PNG, wire and manifest byte-exact and does not leak the JPEG variant
FD	keep	diagnostic-fixture-http.test.ts	diagnostic-fixture-http.test.ts	diagnostic fixture over real HTTP refuses nonmember bundle and artifact URLs for undefined
FD	keep	diagnostic-fixture-http.test.ts	diagnostic-fixture-http.test.ts	diagnostic fixture over real HTTP refuses nonmember bundle and artifact URLs for restricted-jpeg
SP	keep	diagnostic-gallery-origin.test.ts	diagnostic-gallery-origin.test.ts	diagnostic gallery fixture origin keeps the browser origin stable while binding each run to its own server
PD	keep	diagnostic-gallery-origin.test.ts	diagnostic-gallery-origin.test.ts	diagnostic gallery fixture origin preserves the exact path and query for /assets/dashboard-a1.js
PD	keep	diagnostic-gallery-origin.test.ts	diagnostic-gallery-origin.test.ts	diagnostic gallery fixture origin preserves the exact path and query for /assets/font.woff2
PD	keep	diagnostic-gallery-origin.test.ts	diagnostic-gallery-origin.test.ts	diagnostic gallery fixture origin preserves the exact path and query for /events/v1?day=2026-08-04
PD	keep	diagnostic-gallery-origin.test.ts	diagnostic-gallery-origin.test.ts	diagnostic gallery fixture origin preserves the exact path and query for /api/v1/diagnostic-bundles/bundle/manifest
PD	keep	diagnostic-gallery-origin.test.ts	diagnostic-gallery-origin.test.ts	diagnostic gallery fixture origin preserves the exact path and query for /api/v1/diagnostic-bundles/bundle/attachments/artifact
PD	keep	diagnostic-gallery-origin.test.ts	diagnostic-gallery-origin.test.ts	diagnostic gallery fixture origin preserves the exact path and query for /assets/a%20b.png?key=a%2Fb&key=c+z
VL	keep	diagnostic-gallery-origin.test.ts	diagnostic-gallery-origin.test.ts	diagnostic gallery fixture origin refuses a non-fixture target https://127.0.0.1:49123
VL	keep	diagnostic-gallery-origin.test.ts	diagnostic-gallery-origin.test.ts	diagnostic gallery fixture origin refuses a non-fixture target http://foreign.test:49123
VL	keep	diagnostic-gallery-origin.test.ts	diagnostic-gallery-origin.test.ts	diagnostic gallery fixture origin refuses a non-fixture target http://127.0.0.1
VL	keep	diagnostic-gallery-origin.test.ts	diagnostic-gallery-origin.test.ts	diagnostic gallery fixture origin refuses a non-fixture target http://127.0.0.1:0
VL	keep	diagnostic-gallery-origin.test.ts	diagnostic-gallery-origin.test.ts	diagnostic gallery fixture origin refuses a non-fixture target http://127.0.0.1:49123/path
VL	keep	diagnostic-gallery-origin.test.ts	diagnostic-gallery-origin.test.ts	diagnostic gallery fixture origin refuses a non-fixture target http://127.0.0.1:49123?query=1
VL	keep	diagnostic-gallery-origin.test.ts	diagnostic-gallery-origin.test.ts	diagnostic gallery fixture origin refuses a non-fixture target http://user@127.0.0.1:49123
SP	keep	diagnostic-gallery-origin.test.ts	diagnostic-gallery-origin.test.ts	diagnostic gallery fixture origin refuses a request outside its exact browser origin http://foreign.test/api/v1/bootstrap
SP	keep	diagnostic-gallery-origin.test.ts	diagnostic-gallery-origin.test.ts	diagnostic gallery fixture origin refuses a request outside its exact browser origin https://dca2-gallery.localhost/
SP	keep	diagnostic-gallery-origin.test.ts	diagnostic-gallery-origin.test.ts	diagnostic gallery fixture origin refuses a request outside its exact browser origin http://dca2-gallery.localhost:49123/
SP	keep	diagnostic-gallery-origin.test.ts	diagnostic-gallery-origin.test.ts	diagnostic gallery fixture origin refuses a request outside its exact browser origin http://user@dca2-gallery.localhost/
SP	keep	diagnostic-gallery-origin.test.ts	diagnostic-gallery-origin.test.ts	diagnostic gallery fixture origin refuses a request outside its exact browser origin http://dca2-gallery.localhost/#fragment
PD	keep	diagnostic-gallery-origin.test.ts	diagnostic-gallery-origin.test.ts	diagnostic gallery fixture origin serves exact fixture manifest and image bytes through the nondefault client base
PD	keep	diagnostic-screenshot-model.test.ts	diagnostic-screenshot-model.test.ts	a diagnostic screenshot resource admits no thumbnail until visible and keeps loading distinct from a decoded image
PD	keep	diagnostic-screenshot-model.test.ts	diagnostic-screenshot-model.test.ts	a diagnostic screenshot resource keeps an attachment recheck alive across lightbox close without sharing another image's failure
SP	keep	diagnostic-screenshot-model.test.ts	diagnostic-screenshot-model.test.ts	a diagnostic screenshot resource aborts the owned fetch and ignores a delayed reread after its parent is disposed
PD	keep	diagnostic-screenshot-model.test.ts	diagnostic-screenshot-model.test.ts	a diagnostic screenshot resource does not start a deferred read whose parent was already disposed
PD	keep	diagnostic-screenshot-model.test.ts	diagnostic-screenshot-model.test.ts	a diagnostic screenshot resource offers a download only after decode or an identity-verified browser-only failure
PD	keep	diagnostic-screenshot-model.test.ts	diagnostic-screenshot-model.test.ts	a diagnostic screenshot resource names JPEG downloads as JPEG and PNG downloads as PNG
PD	keep	diagnostic-screenshot-model.test.ts	diagnostic-screenshot-model.test.ts	a diagnostic screenshot resource refuses absent dimensions, unsupported image media or ambiguous attachment identity before rendering
PD	keep	diagnostic-screenshot-model.test.ts	diagnostic-screenshot-model.test.ts	a diagnostic screenshot resource resets the resource owner when either id or its captured identity changes
PD	keep	diagnostic-screenshot-model.test.ts	diagnostic-screenshot-model.test.ts	a diagnostic screenshot resource does not let a canceled rejection poison a later owner's successful read
PD	keep	diagnostic-screenshot-model.test.ts	diagnostic-screenshot-model.test.ts	a diagnostic screenshot resource publishes live typed and unknown recheck failures without treating a thrown read as a successful verification
SP	keep	diagnostic-screenshot-model.test.ts	diagnostic-screenshot-model.test.ts	a diagnostic screenshot resource ignores duplicate failures, foreign request completion and late decode events while rechecking
DW	keep	diagnostic-screenshot-terminal.test.ts	diagnostic-screenshot-terminal.test.ts	retains the browser-only terminal warning, not a loading status, after closing during verification
AS	keep	ds-checkbox-name.test.ts	ds-checkbox-name.test.ts	ds/Checkbox — the control carries an accessible name names the button from its own label span, not from the <label for>
AS	keep	ds-checkbox-name.test.ts	ds-checkbox-name.test.ts	ds/Checkbox — the control carries an accessible name names from the label alone — the description is not folded into the name
VL	keep	ds-checkbox-name.test.ts	ds-checkbox-name.test.ts	ds/Checkbox — the control carries an accessible name keeps the visible label wired to the same control, so the click target still toggles
PD	keep	edit-policy.test.ts	edit-policy.test.ts	editPolicyFor is editable only when field, run, and live status all agree
PD	keep	edit-policy.test.ts	edit-policy.test.ts	editPolicyFor the field's own lock wins with its own reason — it is the most specific
PD	keep	edit-policy.test.ts	edit-policy.test.ts	editPolicyFor the run-level lock covers every row alike
SP	keep	edit-policy.test.ts	edit-policy.test.ts	editPolicyFor the live signal locks a section the server served editable
PD	keep	edit-policy.test.ts	edit-policy.test.ts	editPolicyFor carries a staged correction through to the policy
PD	keep	edit-policy.test.ts	edit-policy.test.ts	liveLockReasonOf stays quiet exactly while the run remains resumable
AS	keep	edit-policy.test.ts	edit-policy.test.ts	liveLockReasonOf names the moved state for everything else
PD	keep	edit-policy.test.ts	edit-policy.test.ts	groupEntriesByStep (D252) groups by the NODE, keeps arrival order, and re-joins a step whose rows are not adjacent
PD	keep	edit-policy.test.ts	edit-policy.test.ts	groupEntriesByStep (D252) collects every unattributable entry into ONE trailing group with no step
PD	keep	edit-policy.test.ts	edit-policy.test.ts	groupEntriesByStep (D252) distinguishes two steps that record a field of the SAME label
AS	keep	edit-policy.test.ts	edit-policy.test.ts	freshnessNoteOf (D252) states the limit and the write it protects, and names the override policy
PD	keep	edit-policy.test.ts	edit-policy.test.ts	freshnessNoteOf (D252) says NOTHING when the bound cannot bite — the executor's own two skips
PD	keep	edit-policy.test.ts	edit-policy.test.ts	freshnessNoteOf (D252) falls back to seconds below a minute rather than rounding a real bound to zero
AS	keep	evidence-source-meta.test.ts	evidence-source-meta.test.ts	evidenceSourceMeta names the input's fingerprint, cut to the product's one id length
AS	keep	evidence-source-meta.test.ts	evidence-source-meta.test.ts	evidenceSourceMeta names the task and the instant a system observation was made
AS	keep	evidence-source-meta.test.ts	evidence-source-meta.test.ts	evidenceSourceMeta names the task and the instant a replayed checkpoint recorded
AS	keep	evidence-source-meta.test.ts	evidence-source-meta.test.ts	evidenceSourceMeta names the gate, its approver and its instant — authority's values, not a payload's
PD	keep	evidence-source-meta.test.ts	evidence-source-meta.test.ts	evidenceSourceMeta names what an operator correction superseded
PD	keep	evidence-source-meta.test.ts	evidence-source-meta.test.ts	evidenceSourceMeta counts a derived fact's upstream entries, singular and plural
PD	keep	evidence-source-meta.test.ts	evidence-source-meta.test.ts	evidenceSourceMeta returns one full Input fingerprint even when its field is unresolved
PD	keep	evidence-source-meta.test.ts	evidence-source-meta.test.ts	evidenceSourceMeta omits a footer without an input source and rejects conflicting run fingerprints
PD	keep	evidence-source-meta.test.ts	evidence-source-meta.test.ts	evidenceSourceMeta never renders a source as its discriminant alone — every arm carries a fact
PD	keep	explorer-arm-record.test.ts	explorer-arm-record.test.ts	D304 — the arm record is drawn inside the arm's card heads each arm exactly once
PD	keep	explorer-arm-record.test.ts	explorer-arm-record.test.ts	D304 — the arm record is drawn inside the arm's card draws the record AFTER the arm's field groups, inside the same card
PD	keep	explorer-arm-record.test.ts	explorer-arm-record.test.ts	D304 — the arm record is drawn inside the arm's card no longer draws Freshness or Provenance rows — they are the Outputs head
VL	keep	explorer-arm-record.test.ts	explorer-arm-record.test.ts	D304 — the arm record is drawn inside the arm's card draws error codes and UI ids as wrapping text, never inside a single-line token
PD	keep	explorer-arm-record.test.ts	explorer-arm-record.test.ts	D304 — the arm record is drawn inside the arm's card groups UI ids by kind with the kind named once per line
SP	keep	explorer-client.test.ts	explorer-client.test.ts	the explorer and catalog queries GET both routes and parse the real projections
SP	keep	explorer-client.test.ts	explorer-client.test.ts	the explorer and catalog queries fails loud on a body outside the contract rather than rendering half of it
SP	keep	explorer-client.test.ts	explorer-client.test.ts	the explorer and catalog queries surfaces the server's own refusal when the catalog is stale
SP	keep	explorer-client.test.ts	explorer-client.test.ts	the explorer and catalog queries posts the complete served-base draft to the Explorer validation door
SP	keep	explorer-client.test.ts	explorer-client.test.ts	the explorer and catalog queries sends the reviewed Explorer apply envelope only through the typed command client
SP	keep	explorer-client.test.ts	explorer-client.test.ts	the graph panel's derivations draws the real person-lookup graph in declaration order and counts its FIELDS
SP	keep	explorer-client.test.ts	explorer-client.test.ts	the graph panel's derivations counts a commit arm's INPUT fields as writes, and never its prepare twin's
SP	keep	explorer-client.test.ts	explorer-client.test.ts	the graph panel's derivations reports a graph with no transaction node as changing no system of record
SP	keep	explorer-client.test.ts	explorer-client.test.ts	the graph panel's derivations puts the boundary on the FIRST transaction node, never on the last
SP	keep	explorer-client.test.ts	explorer-client.test.ts	the graph panel's derivations draws NO boundary when a transaction honours no dry run — there is no rehearsal to bound
SP	keep	explorer-client.test.ts	explorer-client.test.ts	the graph panel's derivations names a control edge by its case and leaves a plain dependency to read `always`
SP	keep	explorer-client.test.ts	explorer-client.test.ts	the graph panel's derivations never prints `always` between two nodes the descriptor did not connect
SP	keep	explorer-client.test.ts	explorer-client.test.ts	the graph panel's derivations reads a node's system off its own bindings, and never calls a mini-store a system
SP	keep	explorer-client.test.ts	explorer-client.test.ts	the UI catalog search matches nothing away when the query is empty
SP	keep	explorer-client.test.ts	explorer-client.test.ts	the UI catalog search NARROWS on a second term rather than widening
SP	keep	explorer-client.test.ts	explorer-client.test.ts	the UI catalog search finds an entry by its id, its system, and its kind
SP	keep	explorer-client.test.ts	explorer-client.test.ts	the UI catalog search is case-insensitive, so a pasted id matches however it was capitalised
SP	keep	explorer-client.test.ts	explorer-client.test.ts	the explorer and catalog route keys round-trips both keys through the query string
SP	keep	explorer-client.test.ts	explorer-client.test.ts	the explorer and catalog route keys treats an EMPTY catalog value as open-with-no-term, not as absent
SP	keep	explorer-client.test.ts	explorer-client.test.ts	the explorer and catalog route keys drops a catalog term that no open catalog section would read
SP	keep	explorer-client.test.ts	explorer-client.test.ts	the explorer and catalog route keys addresses Archive's real version registry as the Explorer's destination
SP	keep	explorer-client.test.ts	explorer-client.test.ts	the explorer and catalog route keys drops an empty explore value, because a workflow id is never blank
SP	keep	explorer-client.test.ts	explorer-client.test.ts	the explorer and catalog route keys resolves ONE takeover when a link carries several
PD	keep	explorer-contract-groups.test.ts	explorer-contract-groups.test.ts	D302 — contractFieldGroups lifts the side's shared fact to the group returns Inputs then Outputs, with inputs bound and read outputs under the arm's default
PD	keep	explorer-contract-groups.test.ts	explorer-contract-groups.test.ts	D302 — contractFieldGroups lifts the side's shared fact to the group draws ONE chip for the one facet a byField rule changes, and leaves the rest alone
SP	keep	explorer-contract-groups.test.ts	explorer-contract-groups.test.ts	D302 — contractFieldGroups lifts the side's shared fact to the group states unknown on the head when the arm declares no policy, carrying the server's reason
PD	keep	explorer-contract-groups.test.ts	explorer-contract-groups.test.ts	D302 — contractFieldGroups lifts the side's shared fact to the group prepare and commit arms state their side once, from the arm's effect
PD	keep	explorer-contract-groups.test.ts	explorer-contract-groups.test.ts	D302 — contractFieldGroups lifts the side's shared fact to the group names a row whose STATE contradicts its head as a warning, never folds it in
PD	keep	explorer-contract-groups.test.ts	explorer-contract-groups.test.ts	D302 — NodeDetail draws each side's fact once prints the read arm's freshness bound once per arm, not once per output row
PD	keep	explorer-contract-groups.test.ts	explorer-contract-groups.test.ts	D302 — NodeDetail draws each side's fact once heads each side with its count and no longer prefixes rows with the side
DW	keep	explorer-edit-dialog.test.ts	explorer-edit-dialog.test.ts	DCC5 Explorer edit dialog opens icon and category editors with their served allowlisted value
DW	keep	explorer-edit-dialog.test.ts	explorer-edit-dialog.test.ts	DCC5 Explorer edit dialog drops a ready validation that resolves after the editor draft changes
VL	keep	explorer-edit-dialog.test.ts	explorer-edit-dialog.test.ts	DCC5 Explorer edit dialog drops a ready validation after the workflow target switches
DW	keep	explorer-edit-dialog.test.ts	explorer-edit-dialog.test.ts	DCC5 Explorer edit dialog returns to enabled validation after closing an in-flight review and ignores its late response
DW	keep	explorer-edit-dialog.test.ts	explorer-edit-dialog.test.ts	DCC5 Explorer edit dialog reports an acknowledged command with failed readback as applied but unverified
DW	keep	explorer-edit-dialog.test.ts	explorer-edit-dialog.test.ts	DCC5 Explorer edit dialog treats a foreign conflict command result as unknown, not not-applied
DW	keep	explorer-edit-dialog.test.ts	explorer-edit-dialog.test.ts	DCC5 Explorer edit dialog treats a foreign rejected command result as unknown, not not-applied
DW	keep	explorer-edit-dialog.test.ts	explorer-edit-dialog.test.ts	DCC5 Explorer edit dialog returns keyboard focus to the exact field-row edit door on close
PD	keep	explorer-edit-review.test.ts	explorer-edit-review.test.ts	DCC5 Explorer validation review identity builds icon and category drafts from their served initial values
PD	keep	explorer-edit-review.test.ts	explorer-edit-review.test.ts	DCC5 Explorer validation review identity rejects a validation result after its editor generation was invalidated
VL	keep	explorer-edit-review.test.ts	explorer-edit-review.test.ts	DCC5 Explorer validation review identity rejects a ready validation after a target or command reason changed
VL	keep	explorer-edit-review.test.ts	explorer-edit-review.test.ts	DCC5 Explorer validation review identity requires the exact acknowledged command id and Explorer target revision
SP	keep	explorer-edit-review.test.ts	explorer-edit-review.test.ts	DCC5 Explorer validation review identity requires the generated command id for applied, conflict, and rejected result arms
PD	keep	explorer-edit-review.test.ts	explorer-edit-review.test.ts	DCC5 Explorer validation review identity requires readback descriptor bases as well as the reviewed presentation
PD	keep	explorer-editable-field-row.test.ts	explorer-editable-field-row.test.ts	EX114 — the pencil marks the field's own row puts the presentation edit door on its exact served field row
PD	keep	explorer-editable-field-row.test.ts	explorer-editable-field-row.test.ts	EX114 — the pencil marks the field's own row draws the mark inside the contract row of the path the descriptor allows
PD	keep	explorer-editable-field-row.test.ts	explorer-editable-field-row.test.ts	EX114 — the pencil marks the field's own row draws no mark on a node whose descriptor allowlists nothing
PD	keep	explorer-editable-field-row.test.ts	explorer-editable-field-row.test.ts	EX114 — the pencil marks the field's own row no longer draws the correctable paths a second time below the table
PD	keep	explorer-editable-field-row.test.ts	explorer-editable-field-row.test.ts	EX114 — the pencil marks the field's own row marks the OUTPUT row and never the input row that spells the same path
PD	keep	explorer-editable-field-row.test.ts	explorer-editable-field-row.test.ts	EX114 — the pencil marks the field's own row names an input-only allowlisted path rather than marking its read row
PD	keep	explorer-editable-field-row.test.ts	explorer-editable-field-row.test.ts	EX114 — the pencil marks the field's own row refuses to swallow an allowlisted path that has no contract row
PD	keep	explorer-scenario-groups.test.ts	explorer-scenario-groups.test.ts	D299 — scenarios group by their first path segment titles each group with the leading segment and leaves the rest to the row
PD	keep	explorer-scenario-groups.test.ts	explorer-scenario-groups.test.ts	D299 — scenarios group by their first path segment splits on the FIRST slash, so a deeper id keeps every segment after it
PD	keep	explorer-scenario-groups.test.ts	explorer-scenario-groups.test.ts	D299 — scenarios group by their first path segment keeps the WHOLE id on the row, because that is what a failure resolves to
PD	keep	explorer-scenario-groups.test.ts	explorer-scenario-groups.test.ts	D299 — scenarios group by their first path segment carries each row's own source rather than the group's first
PD	keep	explorer-scenario-groups.test.ts	explorer-scenario-groups.test.ts	D299 — scenarios group by their first path segment re-orders nothing: a group sits where its first member sat
PD	keep	explorer-scenario-groups.test.ts	explorer-scenario-groups.test.ts	D299 — scenarios group by their first path segment throws on an id with no segment rather than titling a card with the whole thing
VL	keep	failure-record-model.test.ts	failure-record-model.test.ts	FAILURE_WRITE_STATE — the write-state sentence and its tone (E8/E9) covers every arm the wire can serve, in both directions
VL	keep	failure-record-model.test.ts	failure-record-model.test.ts	FAILURE_WRITE_STATE — the write-state sentence and its tone (E8/E9) gives the settled tone to `not-attempted` ALONE
VL	keep	failure-record-model.test.ts	failure-record-model.test.ts	FAILURE_WRITE_STATE — the write-state sentence and its tone (E8/E9) does not call a staged-but-uncommitted write 'nothing written'
VL	keep	failure-record-model.test.ts	failure-record-model.test.ts	FAILURE_WRITE_STATE — the write-state sentence and its tone (E8/E9) parks the unknown outcome rather than colouring it as a wait
PD	keep	failure-record-model.test.ts	failure-record-model.test.ts	failurePermanence — the head's permanence chip (E6) states the transient reading
SP	keep	failure-record-model.test.ts	failure-record-model.test.ts	failurePermanence — the head's permanence chip (E6) states the PERMANENT reading, which is the one that says do not retry
PD	keep	failure-record-model.test.ts	failure-record-model.test.ts	failurePermanence — the head's permanence chip (E6) never lets the two arms read the same
PD	keep	failure-record-model.test.ts	failure-record-model.test.ts	failureFingerprintHistory — the fingerprint's history (E30) says so on a first sighting instead of drawing a blank
PD	keep	failure-record-model.test.ts	failure-record-model.test.ts	failureFingerprintHistory — the fingerprint's history (E30) states the count, and only the count, on a repeat
PD	keep	failure-record-model.test.ts	failure-record-model.test.ts	failureFingerprintHistory — the fingerprint's history (E30) names no other run — D141's refusal survives the port
SP	keep	failure-record-model.test.ts	failure-record-model.test.ts	failureFingerprintHistory — the fingerprint's history (E30) throws on a count the projection cannot produce
DW	keep	failure-record-render.test.ts	failure-record-render.test.ts	the failure record's head (E2/E4/E5/E6) leads with the run's own summary, its code and its permanence
SP	keep	failure-record-render.test.ts	failure-record-render.test.ts	the failure record's head (E2/E4/E5/E6) says the OPPOSITE permanence when the wire says transient
SP	keep	failure-record-render.test.ts	failure-record-render.test.ts	the failure record's head (E2/E4/E5/E6) keeps the category arm for the record the wire could NOT serve
DW	keep	failure-record-render.test.ts	failure-record-render.test.ts	the archived failure card (unit F8c finding 1) says the run's own summary, its code and its permanence — the same head the live record leads with
SP	keep	failure-record-render.test.ts	failure-record-render.test.ts	the archived failure card (unit F8c finding 1) states the OPPOSITE permanence when the wire says transient
AS	keep	failure-record-render.test.ts	failure-record-render.test.ts	the record's accessible structure (unit F8c findings 3/4) gives the record's frame a role, so its aria-label names something
AS	keep	failure-record-render.test.ts	failure-record-render.test.ts	the record's accessible structure (unit F8c findings 3/4) gives the write-state block the same semantics as the sibling it sits beside
VL	keep	failure-record-render.test.ts	failure-record-render.test.ts	the permanence reading (unit F8c finding 5) never clips the permanence sentence, and never hides it on a title
VL	keep	failure-record-render.test.ts	failure-record-render.test.ts	the permanence reading (unit F8c finding 5) never clips the failure record's id, and never hides it on a title
DW	keep	failure-record-render.test.ts	failure-record-render.test.ts	the diagnostic disclosure (E15) hides DIAGNOSIS and nothing else while it is closed
DW	keep	failure-record-render.test.ts	failure-record-render.test.ts	the diagnostic disclosure (E15) offers the diagnosis as a real control, not a hover
AS	keep	failure-record-render.test.ts	failure-record-render.test.ts	the diagnostic disclosure (E15) names the OPPOSITE act once it is open, and reveals the diagnosis
DW	keep	failure-record-render.test.ts	failure-record-render.test.ts	the diagnostic disclosure (E15) re-hides the diagnosis on a second press
AS	keep	failure-record-render.test.ts	failure-record-render.test.ts	the write-state block (E8/E9) gives the sentence its own labelled, bordered frame
VL	keep	failure-record-render.test.ts	failure-record-render.test.ts	the write-state block (E8/E9) colours the six arms by what they left behind, not one weight for all
VL	keep	failure-record-render.test.ts	failure-record-render.test.ts	the write-state block (E8/E9) paints no distinction the palette cannot draw
DW	keep	failure-record-render.test.ts	failure-record-render.test.ts	the classification, once disclosed (E5/E6) draws `code` ONCE and permanence nowhere — both are head facts now
VL	keep	failure-record-render.test.ts	failure-record-render.test.ts	the observed subject reads as the thing that is wrong (E22) tones the OBSERVED half in danger and leaves the expected half alone
PD	keep	global-keys.test.ts	global-keys.test.ts	stepSelection — the j/k arithmetic (R3 finding 8) moves one place in each direction
PD	keep	global-keys.test.ts	global-keys.test.ts	stepSelection — the j/k arithmetic (R3 finding 8) CLAMPS at both ends rather than wrapping — the demo's own arithmetic
PD	keep	global-keys.test.ts	global-keys.test.ts	stepSelection — the j/k arithmetic (R3 finding 8) lands on the first row when nothing is selected, in EITHER direction
PD	keep	global-keys.test.ts	global-keys.test.ts	stepSelection — the j/k arithmetic (R3 finding 8) answers nothing on an empty queue instead of an invented id
PD	keep	global-keys.test.ts	global-keys.test.ts	stepSelection — the j/k arithmetic (R3 finding 8) treats a selection the list no longer holds as no selection
PD	keep	global-keys.test.ts	global-keys.test.ts	nextAttention — the `n` binding (R3 finding 8) goes to the next attention row AFTER the selection
PD	keep	global-keys.test.ts	global-keys.test.ts	nextAttention — the `n` binding (R3 finding 8) WRAPS to the first when the selection is past the last one
PD	keep	global-keys.test.ts	global-keys.test.ts	nextAttention — the `n` binding (R3 finding 8) starts at the first when nothing is selected
PD	keep	global-keys.test.ts	global-keys.test.ts	nextAttention — the `n` binding (R3 finding 8) answers nothing — never a row that does not need you — when none do
PD	keep	global-keys.test.ts	global-keys.test.ts	attentionRunIds — the band and the key cannot disagree selects exactly the NEEDS YOU band's rows, in the drawn order
SP	keep	global-keys.test.ts	global-keys.test.ts	composeCommandRequest — the run family composes a legal envelope for retry
SP	keep	global-keys.test.ts	global-keys.test.ts	composeCommandRequest — the run family composes a legal envelope for cancel
SP	keep	global-keys.test.ts	global-keys.test.ts	composeCommandRequest — the run family composes a legal envelope for bump
SP	keep	global-keys.test.ts	global-keys.test.ts	composeCommandRequest — the run family REFUSES both park resolutions rather than double-routing them
SP	keep	global-keys.test.ts	global-keys.test.ts	composeCommandRequest — the identity gate (ref write-safety §14.4) composes an approval from SERVED facts only, and the kernel's schema accepts it
SP	keep	global-keys.test.ts	global-keys.test.ts	composeCommandRequest — the identity gate (ref write-safety §14.4) REFUSES a rejection nobody authored — the reason is the operator's own (D226)
SP	keep	global-keys.test.ts	global-keys.test.ts	composeCommandRequest — the identity gate (ref write-safety §14.4) REFUSES an approval nobody authored when the server asked for a choice — §14.6 risk 1
SP	keep	global-keys.test.ts	global-keys.test.ts	composeCommandRequest — the identity gate (ref write-safety §14.4) REFUSES when the section is absent or unavailable, naming which
AS	keep	identity-ceremony.test.ts	identity-ceremony.test.ts	identityCeremonyFor — the server names the ceremony (ref write-safety §14.6 risk 1) derives all three shapes from real packet inputs, never from a constant
AS	keep	identity-ceremony.test.ts	identity-ceremony.test.ts	identityCeremonyFor — the server names the ceremony (ref write-safety §14.6 risk 1) maps each shape to its own control, and a rejection to its own
AS	keep	identity-ceremony.test.ts	identity-ceremony.test.ts	identityCeremonyFor — the server names the ceremony (ref write-safety §14.6 risk 1) REFUSES an approvalShape this build has no control for — it never falls back to one click
AS	keep	identity-ceremony.test.ts	identity-ceremony.test.ts	identityCeremonyFor — the server names the ceremony (ref write-safety §14.6 risk 1) REFUSES a packet whose shape and candidate count contradict each other
SP	keep	identity-ceremony.test.ts	identity-ceremony.test.ts	identityDraftProblem — the bounds, stated where the value is typed asks for a candidate before it will let one be sent
SP	keep	identity-ceremony.test.ts	identity-ceremony.test.ts	identityDraftProblem — the bounds, stated where the value is typed asks for eight digits, and then for an EID THE PACKET SHOWED
SP	keep	identity-ceremony.test.ts	identity-ceremony.test.ts	identityDraftProblem — the bounds, stated where the value is typed asks for a rejection reason, and accepts one that is only whitespace-padded
SP	keep	identity-ceremony.test.ts	identity-ceremony.test.ts	identityDraftProblem — the bounds, stated where the value is typed carries the unsupported reason through as the problem, so the send stays blocked
SP	keep	identity-ceremony.test.ts	identity-ceremony.test.ts	composeCommandRequest — the three ceremonies reach the real command endpoint (D226) composes a CHOSEN candidate under the server's own chosenFrom label
SP	keep	identity-ceremony.test.ts	identity-ceremony.test.ts	composeCommandRequest — the three ceremonies reach the real command endpoint (D226) composes a TYPED EID, and the label still comes off the served option
SP	keep	identity-ceremony.test.ts	identity-ceremony.test.ts	composeCommandRequest — the three ceremonies reach the real command endpoint (D226) composes a REJECTION with the operator's own trimmed reason and the bound digest
SP	keep	identity-ceremony.test.ts	identity-ceremony.test.ts	composeCommandRequest — the three ceremonies reach the real command endpoint (D226) still composes the ONE ceremony whose answer is a served fact
SP	keep	identity-ceremony.test.ts	identity-ceremony.test.ts	composeCommandRequest — the three ceremonies reach the real command endpoint (D226) REFUSES an EID the packet never showed, even with an answer supplied
SP	keep	identity-ceremony.test.ts	identity-ceremony.test.ts	composeCommandRequest — the three ceremonies reach the real command endpoint (D226) REFUSES when the answer and the control pressed disagree
SP	keep	identity-ceremony.test.ts	identity-ceremony.test.ts	composeCommandRequest — the three ceremonies reach the real command endpoint (D226) REFUSES an unsupported ceremony outright — no payload, no send
SP	keep	intake-client.test.ts	intake-client.test.ts	the intake upload's status IS the outcome reads 201 as created and 200 as joined, over the same wire
AS	keep	intake-client.test.ts	intake-client.test.ts	the intake upload's status IS the outcome sends the workflow and the file name as query, and the bytes as the body
SP	keep	intake-client.test.ts	intake-client.test.ts	the intake upload's status IS the outcome returns a 422 refusal with the server's own code and words
SP	keep	intake-client.test.ts	intake-client.test.ts	the intake upload's status IS the outcome throws on a status outside {201, 200, 422} rather than calling it a refusal
SP	keep	intake-client.test.ts	intake-client.test.ts	the intake upload's status IS the outcome refuses a 422 whose body is outside the wire-error contract
SP	keep	intake-client.test.ts	intake-client.test.ts	the intake session read parses through the session wire schema and encodes its id
SP	keep	intake-client.test.ts	intake-client.test.ts	the intake session read fails loud when the server sends something the contract does not admit
PD	keep	intake-model.test.ts	intake-model.test.ts	IN95 / IN99–IN122 — rejection review uses the demo's one vocabulary and one eligibility door pins every visible label in the table, editors, review acknowledgement and Well summaries
PD	keep	intake-model.test.ts	intake-model.test.ts	IN95 / IN99–IN122 — rejection review uses the demo's one vocabulary and one eligibility door refuses malformed editor labels instead of minting unstable control context
PD	keep	intake-model.test.ts	intake-model.test.ts	IN95 / IN99–IN122 — rejection review uses the demo's one vocabulary and one eligibility door refuses the client-side Run offer until the exact served rejection set is acknowledged
PD	keep	intake-model.test.ts	intake-model.test.ts	IN95 / IN99–IN122 — rejection review uses the demo's one vocabulary and one eligibility door revokes an acknowledgement when authority serves a newer session version
PD	keep	intake-model.test.ts	intake-model.test.ts	IN95 / IN99–IN122 — rejection review uses the demo's one vocabulary and one eligibility door does not require a review when the validated session has no rejected rows
PD	keep	intake-model.test.ts	intake-model.test.ts	intake evidence lists stay locally bounded without hiding rows bounds every page while preserving exact access to every source row
PD	keep	intake-model.test.ts	intake-model.test.ts	intake evidence lists stay locally bounded without hiding rows refuses an out-of-range page instead of rendering a false empty state
PD	keep	intake-model.test.ts	intake-model.test.ts	intake evidence lists stay locally bounded without hiding rows keeps every remaining row reachable when the current final page shrinks away
PD	keep	intake-model.test.ts	intake-model.test.ts	intake evidence lists stay locally bounded without hiding rows refuses a malformed prior page instead of hiding it behind a shrink reset
PD	keep	intake-model.test.ts	intake-model.test.ts	IN53 — a header candidate's rank, in the one place D173 left for it prints the row 1-based, the rank at two places, and the row's own cells after it
PD	keep	intake-model.test.ts	intake-model.test.ts	IN53 — a header candidate's rank, in the one place D173 left for it keeps the rank a RANK — 1 reads 1.00, never 100%
PD	keep	intake-model.test.ts	intake-model.test.ts	IN53 — a header candidate's rank, in the one place D173 left for it draws every candidate the parity fixture serves, each carrying its rank
PD	keep	intake-model.test.ts	intake-model.test.ts	IN82 — a proposal's reason and its rank are one thought parenthesises the score after the reasons, in the scorer's own order
PD	keep	intake-model.test.ts	intake-model.test.ts	IN82 — a proposal's reason and its rank are one thought has a word for every reason the real scorer produced on the fixture
VL	keep	intake-model.test.ts	intake-model.test.ts	IN8 / IN9 — the layout every decision on the screen is fenced against echoes the header row 1-based and the fingerprint's first eight
VL	keep	intake-model.test.ts	intake-model.test.ts	IN8 / IN9 — the layout every decision on the screen is fenced against keeps the full fenced fingerprint available behind the compact footer value
VL	keep	intake-model.test.ts	intake-model.test.ts	IN8 / IN9 — the layout every decision on the screen is fenced against is ABSENT before a header row is settled — there is no layout to name yet
AS	keep	intake-model.test.ts	intake-model.test.ts	IN121 — a correction is listed, and the half nothing serves is not invented names the field the operator corrected and the value they put there
SP	keep	intake-model.test.ts	intake-model.test.ts	IN121 — a correction is listed, and the half nothing serves is not invented never spells an ORIGINAL — `IntakeRowCorrectionSchema` carries none
SP	keep	intake-model.test.ts	intake-model.test.ts	IN126 / IN127 / IN131 — the manifest block, from the wire and nowhere else draws the source with its digest, terminal fingerprints, artifact and the manifest's own instant
SP	keep	intake-model.test.ts	intake-model.test.ts	IN126 / IN127 / IN131 — the manifest block, from the wire and nowhere else keeps each full opaque identifier available behind the dense manifest rows
SP	keep	intake-model.test.ts	intake-model.test.ts	IN126 / IN127 / IN131 — the manifest block, from the wire and nowhere else reads `created` off the MANIFEST, never off the upload that preceded it
SP	keep	intake-model.test.ts	intake-model.test.ts	IN126 / IN127 / IN131 — the manifest block, from the wire and nowhere else keeps the terminal creation instant when the prior-rerun view is absent
SP	keep	intake-model.test.ts	intake-model.test.ts	IN126 / IN127 / IN131 — the manifest block, from the wire and nowhere else names a pre-D171 file as one that predates the field, never as a blank
PD	keep	intake-model.test.ts	intake-model.test.ts	IN123 / IN125 — a manifest identity is reserved before it is committed says reserved, never committed, while a validated session holds its preflight identity
AS	keep	intake-model.test.ts	intake-model.test.ts	IN123 / IN125 — a manifest identity is reserved before it is committed names the absent legacy arm instead of inventing a manifest identity
SP	keep	intake-model.test.ts	intake-model.test.ts	IN123 / IN124 / IN128–IN136 — a terminal manifest is rendered from its terminal projection keeps the committed id, all fingerprints, derived totals and disposition rows together
SP	keep	intake-model.test.ts	intake-model.test.ts	IN123 / IN124 / IN128–IN136 — a terminal manifest is rendered from its terminal projection keeps a valid row's full evidence available to its detail disclosure
PD	keep	intake-model.test.ts	intake-model.test.ts	IN139 / IN142 / IN143 — rerun is a named absence, or its exact changed evidence keeps a source with no earlier manifest as an explicit empty state
PD	keep	intake-model.test.ts	intake-model.test.ts	IN139 / IN142 / IN143 — rerun is a named absence, or its exact changed evidence preserves axes, membership, and hash-only changed inputs without exposing parsed values
PD	keep	intake-model.test.ts	intake-model.test.ts	IN139 / IN142 / IN143 — rerun is a named absence, or its exact changed evidence keeps the full prior manifest and changed-axis hashes in one detail disclosure
PD	keep	intake-model.test.ts	intake-model.test.ts	IN139 / IN142 / IN143 — rerun is a named absence, or its exact changed evidence keeps each membership input hash whole behind its compact row
SP	keep	intake-model.test.ts	intake-model.test.ts	the rejection badge names what an operator can act on answers every kind the schema can serve, and no kind it cannot
SP	keep	intake-model.test.ts	intake-model.test.ts	the rejection badge names what an operator can act on never falls back to the wire's own discriminant
PD	keep	log-panel-model.test.ts	log-panel-model.test.ts	observed log presentation fold fails loud with run and cursor when a live page omits strict rows
PD	keep	log-panel-model.test.ts	log-panel-model.test.ts	observed log presentation fold keeps every strict row kind in sequence order even when observations share a timestamp
PD	keep	log-panel-model.test.ts	log-panel-model.test.ts	observed log presentation fold groups only contiguous producer rows and retains the note as a note
PD	keep	log-panel-model.test.ts	log-panel-model.test.ts	observed log presentation fold keeps the served 200-row page bound complete in one contiguous producer group
SP	keep	log-panel-model.test.ts	log-panel-model.test.ts	observed log presentation fold preserves redaction and retry facts without assigning a fence a page direction or system
PD	keep	log-panel-model.test.ts	log-panel-model.test.ts	observed log presentation fold lays an observed row out as a ledger: direction once per section, field prefixes dropped, lists kept whole
PD	keep	log-panel-model.test.ts	log-panel-model.test.ts	observed log presentation fold searches notes and the observed pill label and value, never a fabricated fence detail
PD	keep	log-panel-model.test.ts	log-panel-model.test.ts	observed log presentation fold appends an immutable next page without altering the first snapshot
PD	keep	log-panel-model.test.ts	log-panel-model.test.ts	observed log presentation fold rejects returned rows that reverse sequence within one continuation page
SP	keep	log-panel-model.test.ts	log-panel-model.test.ts	observed log presentation fold rejects a continuation that begins below the requested cursor offset
PD	keep	log-panel-model.test.ts	log-panel-model.test.ts	observed log presentation fold rejects a returned next cursor from a different immutable snapshot
SP	keep	log-panel-model.test.ts	log-panel-model.test.ts	observed log presentation fold accepts a strictly increasing continuation on the requested immutable snapshot
PD	keep	log-panel-model.test.ts	log-panel-model.test.ts	observed log presentation fold refuses a duplicated append instead of silently losing or reordering evidence
PD	keep	log-panel-model.test.ts	log-panel-model.test.ts	observed log presentation fold refuses a continuation launched for a different cursor than the current snapshot owns
PD	keep	notification-inbox-model.test.ts	notification-inbox-model.test.ts	notification inbox model keeps the pinned gap visible outside every ordinary filter
PD	keep	notification-inbox-model.test.ts	notification-inbox-model.test.ts	notification inbox model counts a pinned ping as visible content under the Pings filter
FD	keep	parity-fixtures.test.ts	parity-fixtures.test.ts	intake fixture corpus keeps suggestions out of bindings, which is the whole §2.5 invariant
FD	keep	parity-fixtures.test.ts	parity-fixtures.test.ts	intake fixture corpus covers every source row exactly once across valid, rejected and excluded
FD	keep	parity-fixtures.test.ts	parity-fixtures.test.ts	intake fixture corpus exercises the rejection kinds an operator actually has to decide about
FD	keep	parity-fixtures.test.ts	parity-fixtures.test.ts	intake fixture corpus redacts a rejected cell by its canonical field's declared transform
AS	keep	parity-fixtures.test.ts	parity-fixtures.test.ts	parity fixture corpus keeps D81 count semantics: statusCounts recount exactly from non-member surfaces
FD	keep	parity-fixtures.test.ts	parity-fixtures.test.ts	parity fixture corpus serves a detail wire and a logs section for every named fixture run
FD	keep	parity-fixtures.test.ts	parity-fixtures.test.ts	parity fixture corpus conserves every operation rollup
FD	keep	parity-fixtures.test.ts	parity-fixtures.test.ts	parity fixture corpus emits only schema-legal SSE envelopes
FD	keep	parity-fixtures.test.ts	parity-fixtures.test.ts	parity fixture corpus serves the corpus over real HTTP from an ephemeral port
PD	keep	park-resolution-split.test.ts	park-resolution-split.test.ts	the banner's park-resolution split hands the two write resolutions to ParkResolutions and nothing else
PD	keep	park-resolution-split.test.ts	park-resolution-split.test.ts	the banner's park-resolution split keeps the write resolutions OUT of the banner pills
PD	keep	park-resolution-split.test.ts	park-resolution-split.test.ts	the banner's park-resolution split partitions the banner placement — every descriptor in exactly one list
SP	keep	park-resolution-split.test.ts	park-resolution-split.test.ts	the banner's park-resolution split reads the PLACEMENT, not just the command — a park verb elsewhere is not a banner resolution
PD	keep	park-resolution-split.test.ts	park-resolution-split.test.ts	the banner's park-resolution split carries the SERVED detail sentence through, which is why these are cards
PD	keep	post-dispatch-toast-siblings.test.ts	post-dispatch-toast-siblings.test.ts	dispatchBulk's rejection arm (the selection band's bulk post) no longer claims Nothing was recorded from a post-dispatch throw
PD	keep	post-dispatch-toast-siblings.test.ts	post-dispatch-toast-siblings.test.ts	dispatchBulk's rejection arm (the selection band's bulk post) — driven, the honest fold titles it Result unknown, never Nothing was recorded
PD	keep	post-dispatch-toast-siblings.test.ts	post-dispatch-toast-siblings.test.ts	stopWorker's rejection arm (the Session Panel's Stop, D249) no longer claims Nothing was recorded from a post-dispatch throw
PD	keep	post-dispatch-toast-siblings.test.ts	post-dispatch-toast-siblings.test.ts	stopWorker's rejection arm (the Session Panel's Stop, D249) — driven, the honest fold titles it Result unknown, never Nothing was recorded
AS	keep	preflight-client.test.ts	preflight-client.test.ts	preflight rerun dashboard client accepts only the server's complete semantic report
SP	keep	preflight-client.test.ts	preflight-client.test.ts	preflight rerun dashboard client rejects invented, missing, reordered, and wrong mandatory/authority reports before Settings can render them
PD	keep	proof-contract.test.ts	proof-contract.test.ts	the served proof contract (ref write-safety §4.1, D245) covers every registered commit contract — there is at least one
PD	keep	proof-contract.test.ts	proof-contract.test.ts	the served proof contract (ref write-safety §4.1, D245) describes every registered commit contract's completion proof
SP	keep	proof-contract.test.ts	proof-contract.test.ts	the served proof contract (ref write-safety §4.1, D245) round-trips a real proof through the form and back into the contract's own schema
SP	keep	proof-contract.test.ts	proof-contract.test.ts	the served proof contract (ref write-safety §4.1, D245) parses every described field list through the served wire schema
PD	keep	proof-contract.test.ts	proof-contract.test.ts	the served proof contract (ref write-safety §4.1, D245) pins literals as fixed and never as an operator input
PD	keep	proof-contract.test.ts	proof-contract.test.ts	shapes the proof describer refuses by name refuses a non-object root with the path and the reason
PD	keep	proof-contract.test.ts	proof-contract.test.ts	shapes the proof describer refuses by name refuses an optional leaf with the path and the reason
PD	keep	proof-contract.test.ts	proof-contract.test.ts	shapes the proof describer refuses by name refuses a nullable leaf with the path and the reason
PD	keep	proof-contract.test.ts	proof-contract.test.ts	shapes the proof describer refuses by name refuses an array leaf with the path and the reason
PD	keep	proof-contract.test.ts	proof-contract.test.ts	shapes the proof describer refuses by name refuses a union leaf with the path and the reason
PD	keep	proof-contract.test.ts	proof-contract.test.ts	shapes the proof describer refuses by name refuses a float leaf with the path and the reason
PD	keep	proof-contract.test.ts	proof-contract.test.ts	shapes the proof describer refuses by name refuses a permissive object with the path and the reason
PD	keep	proof-contract.test.ts	proof-contract.test.ts	shapes the proof describer refuses by name refuses an object three levels deep with the path and the reason
PD	keep	proof-contract.test.ts	proof-contract.test.ts	shapes the proof describer refuses by name refuses an empty object with the path and the reason
SP	keep	proof-contract.test.ts	proof-contract.test.ts	shapes the proof describer refuses by name describes a refined leaf and flags that the server checks more
PD	keep	proof-contract.test.ts	proof-contract.test.ts	shapes the proof describer refuses by name carries a regex source and an instant's own format
PD	keep	proof-contract.test.ts	proof-contract.test.ts	the client-side refusal, per field (D245) refuses an empty answer as evidence rather than as a formatting slip
AS	keep	proof-contract.test.ts	proof-contract.test.ts	the client-side refusal, per field (D245) names the contract's own pattern, the option list, and the bound
PD	keep	proof-contract.test.ts	proof-contract.test.ts	the client-side refusal, per field (D245) reports EVERY problem at once, so one look at the page fixes them all
PD	keep	proof-contract.test.ts	proof-contract.test.ts	the client-side refusal, per field (D245) builds the nested object a dotted path names
AS	keep	proof-contract.test.ts	proof-contract.test.ts	what the proof form calls each field (D245) humanises the schema's own path and never renames the field
PD	keep	proof-contract.test.ts	proof-contract.test.ts	what the proof form calls each field (D245) prints the contract's own constraint, verbatim where it is a pattern
PD	keep	queue-bulk-band-sentence.test.ts	queue-bulk-band-sentence.test.ts	the selection band's refusal, when a selection yields no bulk plan says the rows have LEFT THE DAY when every selected row is gone, and claims nothing about actions[]
PD	keep	queue-bulk-band-sentence.test.ts	queue-bulk-band-sentence.test.ts	the selection band's refusal, when a selection yields no bulk plan uses the SINGULAR when exactly one selected row has left the day
PD	keep	queue-bulk-band-sentence.test.ts	queue-bulk-band-sentence.test.ts	the selection band's refusal, when a selection yields no bulk plan counts only the rows STILL on the day in the mixed case, and discloses the rest
PD	keep	queue-bulk-band-sentence.test.ts	queue-bulk-band-sentence.test.ts	the selection band's refusal, when a selection yields no bulk plan uses the SINGULAR verb when exactly one selected row is still on the day
PD	keep	queue-bulk-band-sentence.test.ts	queue-bulk-band-sentence.test.ts	the selection band's refusal, when a selection yields no bulk plan adds no `A further …` tail when nothing left the day
PD	keep	queue-bulk-band-sentence.test.ts	queue-bulk-band-sentence.test.ts	the selection band's refusal, when a selection yields no bulk plan says nothing at all when nothing is selected — a caption on an absence is not a refusal
PD	keep	queue-bulk-band-sentence.test.ts	queue-bulk-band-sentence.test.ts	the outcome band's third bucket speaks in the PAST about rows that were already gone when the batch was sent
PD	keep	queue-bulk-band-sentence.test.ts	queue-bulk-band-sentence.test.ts	the outcome band's third bucket agrees with itself in the SINGULAR too
VL	keep	queue-bulk-band-sentence.test.ts	queue-bulk-band-sentence.test.ts	the selection band's refusal is READABLE, not merely present puts the sentence in no `truncate` span — a toolbar has no popover to recover a clipped reason
PD	keep	queue-checked-by-you.test.ts	queue-checked-by-you.test.ts	checked by you — local triage only (ledger 1 B57/B80) toggles an immutable local set and counts only members in the displayed group
PD	keep	queue-checked-by-you.test.ts	queue-checked-by-you.test.ts	checked by you — local triage only (ledger 1 B57/B80) starts empty on a fresh client load instead of restoring authority-like state
PD	keep	queue-gate-age.test.ts	queue-gate-age.test.ts	queueGateAge (ledger 1 B31) measures the SERVED gate instant against the panel's calibrated now
SP	keep	queue-gate-age.test.ts	queue-gate-age.test.ts	queueGateAge (ledger 1 B31) answers nothing for a row the server dated no gate on
AS	keep	queue-gate-age.test.ts	queue-gate-age.test.ts	the row's accessible name carries the age reads `{title} — {status} · {age}` (DemoQueue.tsx:818)
AS	keep	queue-gate-age.test.ts	queue-gate-age.test.ts	the row's accessible name carries the age leaves an ungated row's name exactly as it was
VL	keep	queue-gate-age.test.ts	queue-gate-age.test.ts	the row's accessible name carries the age renders the production QueueRow press target with the composed gate age
PD	keep	queue-ordering.test.ts	queue-ordering.test.ts	sortQueueBand — `attention` (R3 finding 1) ranks by status, in the demo's own order
PD	keep	queue-ordering.test.ts	queue-ordering.test.ts	sortQueueBand — `attention` (R3 finding 1) breaks a rank tie with the NEWEST first
PD	keep	queue-ordering.test.ts	queue-ordering.test.ts	sortQueueBand — `attention` (R3 finding 1) leaves the three named orders alone
PD	keep	queue-ordering.test.ts	queue-ordering.test.ts	member ordering (R3 finding 13) ranks doneWarnings with parked, and sinks cancelled below a clean done
SP	keep	queue-ordering.test.ts	queue-ordering.test.ts	member ordering (R3 finding 13) keeps the projection's own order inside one rank
PD	keep	queue-row-info-facts.test.ts	queue-row-info-facts.test.ts	the ⓘ carries the subtitle, and carries it whole carries a present subtitle's FULL value — the row shows it nowhere else
PD	keep	queue-row-info-facts.test.ts	queue-row-info-facts.test.ts	the ⓘ carries the subtitle, and carries it whole drops a subtitle that only repeats the row's title
PD	keep	queue-row-info-facts.test.ts	queue-row-info-facts.test.ts	the ⓘ excludes the run's extracted values lists no outcome fact, however many the receipt produced
PD	keep	queue-row-info-facts.test.ts	queue-row-info-facts.test.ts	the ⓘ excludes the run's extracted values does not explain an outcome's ABSENCE either
SP	keep	queue-row-info-facts.test.ts	queue-row-info-facts.test.ts	the ⓘ's absence arms reports NOTHING absent when the server served every field
PD	keep	queue-row-info-facts.test.ts	queue-row-info-facts.test.ts	the ⓘ's absence arms reports the subtitle's own absence, and only it
PD	keep	queue-row-info-facts.test.ts	queue-row-info-facts.test.ts	the ⓘ's absence arms reports the live message's own absence, and only it
PD	keep	queue-row-info-facts.test.ts	queue-row-info-facts.test.ts	the ⓘ's absence arms reports the run number's own absence, and only it
PD	keep	queue-row-info-facts.test.ts	queue-row-info-facts.test.ts	the ⓘ's absence arms reports a GROUP's missing member preview, and only for a group
PD	keep	queue-row-info-facts.test.ts	queue-row-info-facts.test.ts	the ⓘ's absence arms never asks a non-group for a member preview it does not carry
PD	keep	queue-row-info-facts.test.ts	queue-row-info-facts.test.ts	the ⓘ's absence arms lists every absence in the order the popover draws them
VL	remove-duplicate	parity/member-touch-target.spec.ts	queue-touch-target.test.ts	the member line's touch target declares a 44px overlay, anchored to the control's left edge, only on a coarse pointer
VL	remove-duplicate	parity/member-touch-target.spec.ts	queue-touch-target.test.ts	the member line's touch target positions the overlay, which an `after:` without `relative` would hang off the page instead
VL	remove-duplicate	parity/member-touch-target.spec.ts	queue-touch-target.test.ts	the member line's touch target un-clips the cell the overlay hangs in, on a coarse pointer and nowhere else
VL	re-home/split	icon-button-semantics.test.ts	queue-touch-target.test.ts	the member line's touch target actually reaches the rendered button
VL	remove-duplicate	parity/member-touch-target.spec.ts	queue-touch-target.test.ts	the member line's OTHER control gives the name button 44px of height on a coarse pointer and nothing on a fine one
VL	remove-duplicate	parity/member-touch-target.spec.ts	queue-touch-target.test.ts	the row ⓘ's touch target declares the same 44px overlay, centred, only on a coarse pointer
VL	remove-duplicate	parity/member-touch-target.spec.ts	queue-touch-target.test.ts	the row ⓘ's touch target grows the LINE too, because the card's `overflow-hidden` clips whatever the line does not hold
PD	keep	receipt-action-proof-render.test.ts	receipt-action-proof-render.test.ts	the commit row's write-proof block draws the fenced system and the key digest, cut through shortHash with the whole value on title
PD	keep	receipt-action-proof-render.test.ts	receipt-action-proof-render.test.ts	the commit row's write-proof block draws every redacted proof value beside the write — the document verbatim, the person last-4
PD	keep	receipt-action-proof-render.test.ts	receipt-action-proof-render.test.ts	the commit row's write-proof block draws the D20 confirmation verdict and the D21 read-back verdict as full sentences
PD	keep	receipt-action-proof-render.test.ts	receipt-action-proof-render.test.ts	the commit row's write-proof block puts no proof block under the prepare row
PD	keep	receipt-action-proof-render.test.ts	receipt-action-proof-render.test.ts	the explicit-absent arms — named, never blank a composition-2 commit with no proof says authority holds none
PD	keep	receipt-action-proof-render.test.ts	receipt-action-proof-render.test.ts	the explicit-absent arms — named, never blank a composition-1 receipt says it predates the capture — a different sentence, not the same blank
VL	keep	receipt-body-cues.test.ts	receipt-body-cues.test.ts	writeActionBadgeTone (D17) gives `commit` — the arm that changed a real record — the one tone that reads as news
VL	keep	receipt-body-cues.test.ts	receipt-body-cues.test.ts	writeActionBadgeTone (D17) leaves every arm that filed nothing neutral
VL	keep	receipt-body-cues.test.ts	receipt-body-cues.test.ts	writeActionBadgeTone (D17) is total over the served kinds
PD	keep	receipt-body-cues.test.ts	receipt-body-cues.test.ts	verificationMark (D24) reads `verified` and `present` as the obligation MET
PD	keep	receipt-body-cues.test.ts	receipt-body-cues.test.ts	verificationMark (D24) reads `absent` as answered-and-unmet, not as unknown
PD	keep	receipt-body-cues.test.ts	receipt-body-cues.test.ts	verificationMark (D24) reads the two verdicts that answered nothing as uncertain
PD	keep	receipt-body-cues.test.ts	receipt-body-cues.test.ts	verificationMark (D24) is total over the served verdicts
PD	keep	receipt-body-cues.test.ts	receipt-body-cues.test.ts	writeProofConfirmation (D20) a `receipt` completion proved by the commit's own path IS the system's own confirmation record
VL	keep	receipt-body-cues.test.ts	receipt-body-cues.test.ts	writeProofConfirmation (D20) a probe-sourced proof under a `receipt` completion is still the system's record — a probe reads the target system
PD	keep	receipt-body-cues.test.ts	receipt-body-cues.test.ts	writeProofConfirmation (D20) a verify-backed completion states the demo's fallback — the system issues no confirmation number, the read-back is the proof
PD	keep	receipt-body-cues.test.ts	receipt-body-cues.test.ts	writeProofConfirmation (D20) an operator-attested proof NEVER wears the system's-own-receipt check — a human's attestation is not the system's record
PD	keep	receipt-body-cues.test.ts	receipt-body-cues.test.ts	writeProofConfirmation (D20) a durable-intent proof is a prior settled write's record — never a fresh confirmation for this commit
PD	keep	receipt-body-cues.test.ts	receipt-body-cues.test.ts	writeProofConfirmation (D20) is total over every (completion, proofSource) pair, states never share a sentence, and only system-sourced proofs confirm
PD	keep	receipt-body-cues.test.ts	receipt-body-cues.test.ts	writeProofReadBack (D21) a verify-backed proof from the normal path WAS read back by the independent verify read
PD	keep	receipt-body-cues.test.ts	receipt-body-cues.test.ts	writeProofReadBack (D21) a `receipt` completion's normal path made NO independent check — and says so instead of staying silent
VL	keep	receipt-body-cues.test.ts	receipt-body-cues.test.ts	writeProofReadBack (D21) a probe-sourced proof is a read of the target system, whatever the completion declares
PD	keep	receipt-body-cues.test.ts	receipt-body-cues.test.ts	writeProofReadBack (D21) an operator attestation and a prior durable proof are both NOT a read-back, each for its own stated reason
PD	keep	receipt-body-cues.test.ts	receipt-body-cues.test.ts	writeProofReadBack (D21) is total over every (completion, proofSource) pair, and every distinct verdict carries a distinct sentence
PD	keep	receipt-body-cues.test.ts	receipt-body-cues.test.ts	writeProofAbsence — the explicit-absent arm the UI must NAME a composition-1 receipt predates the capture; a composition-2 absence means authority holds no proof
PD	keep	receipt-body-cues.test.ts	receipt-body-cues.test.ts	uncertaintySentence (D29) says WHY a load-bearing warning stops the run reading as done
PD	keep	receipt-body-cues.test.ts	receipt-body-cues.test.ts	uncertaintySentence (D29) says what a non-load-bearing warning cannot touch — the arm that used to render as nothing
PD	keep	receipt-body-cues.test.ts	receipt-body-cues.test.ts	uncertaintySentence (D29) never collapses either arm to the bare word that was the finding
DW	keep	receipt-comparison.test.ts	receipt-comparison.test.ts	D289 receipt comparison render renders every authority fact arm without treating protected data as a comparable value
DW	keep	receipt-comparison.test.ts	receipt-comparison.test.ts	D289 receipt comparison render keeps withheld data free of raw values and any difference or absence claim
DW	keep	receipt-comparison.test.ts	receipt-comparison.test.ts	D289 receipt comparison render keeps no-prior, unavailable, refusal, and unexpected failure distinct
DW	keep	receipt-comparison.test.ts	receipt-comparison.test.ts	D289 typed failure fold classifies only the closed unavailable and authority-refusal codes away from retryable UI errors
VL	keep	receipt-comparison.test.ts	receipt-comparison.test.ts	D289 synchronous target ownership paints loading or not-comparable instead of ready A when selection changes synchronously to B
VL	keep	receipt-comparison.test.ts	receipt-comparison.test.ts	D289 client integration does not request a comparison when the selected receipt has no exact retry target
DW	keep	receipt-comparison.test.ts	receipt-comparison.test.ts	D289 client integration keeps an unexpected client failure in the explicit error arm
DW	keep	receipt-comparison.test.ts	receipt-comparison.test.ts	D289 client integration keeps the comparison retry in the keyboard order after an unexpected read failure
SP	keep	receipt-comparison.test.ts	receipt-comparison.test.ts	D289 client integration never lets a stale receipt-comparison response bind after selecting another retry
PD	keep	receipt-identity-line.test.ts	receipt-identity-line.test.ts	receiptConfidenceChip says what `verified` MEANS, and reads as chrome
PD	keep	receipt-identity-line.test.ts	receipt-identity-line.test.ts	receiptConfidenceChip warns on `partial`, and names which half read back
PD	keep	receipt-identity-line.test.ts	receipt-identity-line.test.ts	receiptConfidenceChip warns on `unknown`, and says nothing was read back
PD	keep	receipt-identity-line.test.ts	receipt-identity-line.test.ts	receiptConfidenceChip gives every served arm a sentence — a bare word is the finding, not the fix
PD	keep	receipt-identity-line.test.ts	receipt-identity-line.test.ts	receiptIdentityItems leads with the demo's four facts, in the demo's order
SP	keep	receipt-identity-line.test.ts	receipt-identity-line.test.ts	receiptIdentityItems prints `retry of` between the attempt and the run id when the receipt carries one
AS	keep	receipt-identity-line.test.ts	receipt-identity-line.test.ts	receiptIdentityItems names the failure record beside the receipt on a failed run
PD	keep	receipt-identity-line.test.ts	receipt-identity-line.test.ts	receiptIdentityItems keeps `generated` and `completed` as two distinct instants
PD	keep	receipt-identity-line.test.ts	receipt-identity-line.test.ts	receiptIdentityItems carries the terminal instant alone when no receipt was served
PD	keep	receipt-identity-line.test.ts	receipt-identity-line.test.ts	receiptIdentityItems returns nothing at all when neither fact exists — no placeholder segments
PD	keep	receipt-identity-line.test.ts	receipt-identity-line.test.ts	ReceiptView — confidence must render somewhere, even with no band (row D8, finding 1) prints the confidence fact when the run has NOT terminalized but a receipt is already available
PD	keep	receipt-identity-line.test.ts	receipt-identity-line.test.ts	ReceiptView — confidence must render somewhere, even with no band (row D8, finding 1) does NOT repeat confidence in the body once a band exists to carry it
PD	keep	receipt-identity-line.test.ts	receipt-identity-line.test.ts	ReceiptView — the dry-run banner (row D13) draws the rehearsal banner when the run really was a dry run
PD	keep	receipt-identity-line.test.ts	receipt-identity-line.test.ts	ReceiptView — the dry-run banner (row D13) draws nothing when the run genuinely was not a dry run
PD	keep	receipt-identity-line.test.ts	receipt-identity-line.test.ts	ReceiptView — the dry-run banner (row D13) draws nothing when the call site genuinely does not know — never defaults to a claim
PD	keep	receipt-invariant-unrepresentable.test.ts	receipt-invariant-unrepresentable.test.ts	the receipt invariant is unrepresentable, so the demo's banner cannot fire (D11) admits a receipt that meets the invariant — the control
PD	keep	receipt-invariant-unrepresentable.test.ts	receipt-invariant-unrepresentable.test.ts	the receipt invariant is unrepresentable, so the demo's banner cannot fire (D11) refuses `verified-done` on anything but verified confidence
PD	keep	receipt-invariant-unrepresentable.test.ts	receipt-invariant-unrepresentable.test.ts	the receipt invariant is unrepresentable, so the demo's banner cannot fire (D11) refuses `verified-done` over an unresolved MANDATORY fact
PD	keep	receipt-invariant-unrepresentable.test.ts	receipt-invariant-unrepresentable.test.ts	the receipt invariant is unrepresentable, so the demo's banner cannot fire (D11) refuses `verified-done` over a mandatory obligation whose verdict answered nothing
PD	keep	receipt-invariant-unrepresentable.test.ts	receipt-invariant-unrepresentable.test.ts	the receipt invariant is unrepresentable, so the demo's banner cannot fire (D11) refuses `verified-done` carrying any warning at all
PD	keep	receipt-invariant-unrepresentable.test.ts	receipt-invariant-unrepresentable.test.ts	the receipt invariant is unrepresentable, so the demo's banner cannot fire (D11) refuses `verified-done` carrying a failure id
PD	keep	receipt-invariant-unrepresentable.test.ts	receipt-invariant-unrepresentable.test.ts	the receipt invariant is unrepresentable, so the demo's banner cannot fire (D11) refuses a `verified` obligation that cites no evidence — the read-back is what earns the word
PD	keep	refused-notice-model.test.ts	refused-notice-model.test.ts	refusedNoticeCopy keeps each ceremony's ratified coded outcome exactly
PD	keep	refused-notice-model.test.ts	refused-notice-model.test.ts	refusedNoticeCopy states what is still TRUE of each ceremony in the uncoded arm
PD	keep	refused-notice-model.test.ts	refused-notice-model.test.ts	refusedNoticeCopy never gives the two ceremonies the same sentence
PD	keep	refused-notice-model.test.ts	refused-notice-model.test.ts	refusedNoticeCopy does not repeat the banner title inside the body
SP	keep	refused-notice-model.test.ts	refused-notice-model.test.ts	refusedNoticeCopy composes no template slot for the server's own sentence
PD	keep	refused-notice-model.test.ts	refused-notice-model.test.ts	refusedNoticeCopy names what did not happen
PD	keep	rename-draft.test.ts	rename-draft.test.ts	the rename draft rule accepts an ordinary name and trims what the operator typed around it
PD	keep	rename-draft.test.ts	rename-draft.test.ts	the rename draft rule treats surrounding whitespace as typing, not as a refusal
PD	keep	rename-draft.test.ts	rename-draft.test.ts	the rename draft rule refuses an empty draft, and a draft that is empty once trimmed
SP	keep	rename-draft.test.ts	rename-draft.test.ts	the rename draft rule refuses past the schema's own 120 code points, counted in code points
PD	keep	rename-draft.test.ts	rename-draft.test.ts	the rename draft rule refuses control characters, which is how a pasted line break arrives
PD	keep	rename-draft.test.ts	rename-draft.test.ts	the rename draft rule refuses a decomposed name rather than normalising it on the operator's behalf
SP	keep	rename-draft.test.ts	rename-draft.test.ts	the rename draft rule agrees with RunDisplayNameSchema in both directions
SP	keep	row-catalog-model.test.ts	row-catalog-model.test.ts	row/panel catalog — the vocabulary is read off the schemas names every row surface kind the queue wire can discriminate, exactly once
SP	keep	row-catalog-model.test.ts	row-catalog-model.test.ts	row/panel catalog — the vocabulary is read off the schemas names every containment arm, in the schema's own order
SP	keep	row-catalog-model.test.ts	row-catalog-model.test.ts	row/panel catalog — the vocabulary is read off the schemas names every panel kind, in the schema's own order
SP	keep	row-catalog-model.test.ts	row-catalog-model.test.ts	row/panel catalog — the vocabulary is read off the schemas gives every specimen prose that is not the empty string
SP	keep	row-catalog-model.test.ts	row-catalog-model.test.ts	row/panel catalog — a tab strip the product would refuse cannot be drawn draws only tabs whose section the run-detail wire accepts on that panel kind
PD	keep	row-catalog-model.test.ts	row-catalog-model.test.ts	row/panel catalog — a tab strip the product would refuse cannot be drawn omits the tab whose section that panel kind may NOT advertise
PD	keep	row-catalog-model.test.ts	row-catalog-model.test.ts	row/panel catalog — a tab strip the product would refuse cannot be drawn draws the tabs in the panel's own TAB_ORDER, never a second copy of it
PD	keep	row-catalog-model.test.ts	row-catalog-model.test.ts	row/panel catalog — a tab strip the product would refuse cannot be drawn prints the panel's own word for a tab, never a second copy of it
PD	keep	row-catalog-model.test.ts	row-catalog-model.test.ts	row/panel catalog — a tab strip the product would refuse cannot be drawn lists only sections the run-detail section enum declares
SP	keep	row-catalog-model.test.ts	row-catalog-model.test.ts	row/panel catalog — a tab strip the product would refuse cannot be drawn derives the ceiling from the wire rule rather than from a second list
AS	keep	row-catalog-model.test.ts	row-catalog-model.test.ts	row/panel catalog — the absences are stated, not implied names the demo vocabulary this build cannot serve, with a reason each
SP	keep	row-catalog-model.test.ts	row-catalog-model.test.ts	row/panel catalog — the absences are stated, not implied states no rollup arm the projection does not serve
PD	keep	row-catalog-model.test.ts	row-catalog-model.test.ts	catalog view routing accepts the two views and drops anything else
PD	keep	row-catalog-model.test.ts	row-catalog-model.test.ts	catalog view routing defaults to the panel this key has always opened
PD	keep	row-timing.test.ts	row-timing.test.ts	queue row timing (D124) shows a settled run's DURATION, not the time since it started
PD	keep	row-timing.test.ts	row-timing.test.ts	queue row timing (D124) does not move as the browser clock advances past a terminal run
PD	keep	row-timing.test.ts	row-timing.test.ts	queue row timing (D124) keeps live elapsed for a run that is genuinely still in flight
PD	keep	row-timing.test.ts	row-timing.test.ts	queue row timing (D124) keeps counting for a parked run — blocked and awaiting-approval have not ended
PD	keep	row-timing.test.ts	row-timing.test.ts	queue row timing (D124) shows no timer at all for a run that has started nothing
PD	keep	row-timing.test.ts	row-timing.test.ts	queue row timing (D124) renders an explicit unknown — never `now` — when a terminal row carries no end instant
PD	keep	row-timing.test.ts	row-timing.test.ts	queue row timing (D124) refuses a status that is not part of the served queue vocabulary
DW	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures shows verified capture controls in the Logs body before the Receipt is opened
DW	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures keeps a capture read refusal visible and keyboard-reachable in Logs
SP	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures keeps current request failure local without manufacturing empty captures
DW	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures keeps PDF bytes download-only with their full declared page count
DW	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures mounts JPEG Preview, JPEG Download, then data Download in receipt order
DW	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures closes selection when its tab is replaced and does not reopen it
DW	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures closes selection when its revision is replaced and does not reopen it
SP	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures keeps current revision success when its preceding read later resolves
SP	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures keeps current revision success when its preceding read later rejects
DW	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures keeps a reopened image ready when the detached decoder later resolves
DW	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures keeps a reopened image ready when the detached decoder later rejects
DW	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures closes the selected capture on run replacement even when the artifact id is shared
DW	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures keeps captures beside the full receipt body without creating a Screenshots tab
DW	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures does not frame unexpected-state as failure even when the run failed
DW	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures does not frame subject-mismatch as failure even when the run failed
DW	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures does not frame recovery-park as failure even when the run failed
SP	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures does not frame operator-request as failure even when the run failed
DW	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures retains metadata and download through load error
DW	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures retains metadata and download through decode rejection
DW	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures retains metadata and download through synchronous decoder refusal
DW	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures retains metadata and download through zero dimensions
DW	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures keeps a same-image load error authoritative after its pending decoder resolves
DW	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures renders a local refusal for wrong section through the actual parser
DW	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures renders a local refusal for foreign run through the actual parser
DW	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures renders a local refusal for empty list through the actual parser
DW	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures renders a local refusal for missing origins through the actual parser
DW	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures keeps current run success when a replaced run later resolves
DW	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures keeps current run success when a replaced run later rejects
DW	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures keeps one app-owned read across Logs and Receipt when it later resolves
DW	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures keeps one app-owned read across Logs and Receipt when it later rejects
DW	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures aborts its pending read on whole-app unmount
DW	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures refuses decoded dimensions that disagree with the exact served image metadata
VL	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures frames tile with the exact solid danger token only for literal failure while preserving all mixed origins
VL	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures frames preview with the exact solid danger token only for literal failure while preserving all mixed origins
DW	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures opens the exact native image and waits for its decoder before exposing readiness
DW	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures refuses available captures without their advertised lazy section
SP	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures refuses a list whose count differs from the requested detail availability
DW	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures keeps an authority availability error local and visible without fetching
DW	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures refuses missing live availability instead of treating archived compatibility as an empty list
DW	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures downloads the exact non-image capture and retains every origin and byte fact under a short receipt
DW	keep	run-captures-app.test.ts	run-captures-app.test.ts	actual DashboardApp run captures shows the served absence in Logs without speculative capture reads and keeps Receipt canonical
FD	keep	run-captures-fixture.test.ts	run-captures-fixture.test.ts	serves the advertised exact generic JPEG and data captures over owned ephemeral HTTP
FD	keep	run-captures-fixture.test.ts	run-captures-fixture.test.ts	records exact immutable artifact exchanges without crediting API or static traffic
FD	keep	run-captures-fixture.test.ts	run-captures-fixture.test.ts	serves the exact PNG with all five closed origins and dimensions from its real bytes
FD	keep	run-captures-fixture.test.ts	run-captures-fixture.test.ts	refuses generic artifact path /artifacts/v1/00000000-0000-4000-8000-00000000c999 without static-file substitution
FD	keep	run-captures-fixture.test.ts	run-captures-fixture.test.ts	refuses generic artifact path /artifacts/v1/not-an-artifact-id without static-file substitution
FD	keep	run-captures-fixture.test.ts	run-captures-fixture.test.ts	refuses generic artifact path /artifacts/v1/00000000-0000-4000-8000-00000000c102/extra without static-file substitution
FD	keep	run-captures-fixture.test.ts	run-captures-fixture.test.ts	refuses generic artifact path /artifacts/v1/00000000-0000-4000-8000-00000000c102/extra.json without static-file substitution
FD	keep	run-captures-fixture.test.ts	run-captures-fixture.test.ts	refuses generic artifact path /artifacts/v1/not-an-artifact-id/extra without static-file substitution
FD	keep	run-captures-fixture.test.ts	run-captures-fixture.test.ts	keeps generic evidence opt-in and preserves original run, section and Archive facts
FD	keep	run-captures-fixture.test.ts	run-captures-fixture.test.ts	preserves ordinary API and named static assets beside the generic byte namespace
FD	keep	run-captures-fixture.test.ts	run-captures-fixture.test.ts	keeps each diagnostic bundle owned by one run while allowing same-run artifact sharing
DW	keep	run-captures-lifecycle.test.ts	run-captures-lifecycle.test.ts	frames only literal failure origins and uses the configured coarse-pointer floor
SP	keep	run-captures-lifecycle.test.ts	run-captures-lifecycle.test.ts	never commits an old capture before passive effects on requested run replacement
SP	keep	run-captures-lifecycle.test.ts	run-captures-lifecycle.test.ts	never commits an old capture before passive effects on loaded revision replacement
DW	keep	run-captures-lifecycle.test.ts	run-captures-lifecycle.test.ts	never commits an old capture before passive effects on inactive tab replacement
VL	keep	run-comparison-client.test.ts	run-comparison-client.test.ts	run receipt comparison client accepts a server-derived prior receipt only when the selected four-field target matches
SP	keep	run-comparison-client.test.ts	run-comparison-client.test.ts	run receipt comparison client rejects a schema-valid response with a foreign selected retry, workflow, or current receipt
SP	keep	run-comparison-client.test.ts	run-comparison-client.test.ts	run receipt comparison client refuses a schema-valid comparison for a foreign run id
SP	keep	run-comparison-client.test.ts	run-comparison-client.test.ts	run receipt comparison client refuses a malformed or expanded selected tuple before transport
SP	keep	run-detail-captures-client.test.ts	run-detail-captures-client.test.ts	DCA3/D292 capture client rejects a foreign initial run's capture capability
SP	keep	run-detail-captures-client.test.ts	run-detail-captures-client.test.ts	DCA3/D292 capture client rejects a foreign lazy capture list
SP	keep	run-detail-captures-client.test.ts	run-detail-captures-client.test.ts	DCA3/D292 capture client rejects a different strict section returned for a captures request
SP	keep	run-detail-captures-client.test.ts	run-detail-captures-client.test.ts	DCA3/D292 capture client preserves all served origins and byte facts
SP	keep	run-detail-captures-client.test.ts	run-detail-captures-client.test.ts	DCA3/D292 capture client refuses missing provenance
SP	keep	run-detail-captures-client.test.ts	run-detail-captures-client.test.ts	DCA3/D292 capture client refuses empty provenance
SP	keep	run-detail-captures-client.test.ts	run-detail-captures-client.test.ts	DCA3/D292 capture client refuses unknown kind provenance
SP	keep	run-detail-captures-client.test.ts	run-detail-captures-client.test.ts	DCA3/D292 capture client refuses actor leakage provenance
SP	keep	run-detail-captures-client.test.ts	run-detail-captures-client.test.ts	DCA3/D292 capture client refuses failure leakage provenance
SP	keep	run-detail-captures-client.test.ts	run-detail-captures-client.test.ts	DCA3/D292 capture client refuses duplicate provenance
SP	keep	run-detail-captures-client.test.ts	run-detail-captures-client.test.ts	DCA3/D292 capture client forwards the optional fourth abort signal to the lazy request
SP	keep	run-detail-captures-client.test.ts	run-detail-captures-client.test.ts	DCA3/D292 capture client builds only exact DCA1 artifact byte URLs
DW	keep	run-detail-decision-cue.test.ts	run-detail-decision-cue.test.ts	B91 — the open decision card prints the age AND the clock carries both halves of the wait
DW	keep	run-detail-decision-cue.test.ts	run-detail-decision-cue.test.ts	B91 — the open decision card prints the age AND the clock F6b item 4 — carries no opacity-85 on the age/clock meta line
VL	keep	run-detail-decision-cue.test.ts	run-detail-decision-cue.test.ts	F6b item 2 — the liveness dot pairs its colour with a word says `live` for a running surface and pulses rather than relying on hue alone
VL	keep	run-detail-decision-cue.test.ts	run-detail-decision-cue.test.ts	F6b item 2 — the liveness dot pairs its colour with a word says `idle` for every non-running status and does not pulse
DW	keep	run-detail-decision-cue.test.ts	run-detail-decision-cue.test.ts	A3/A13 — the provenance bar uses the demo's identity wording prints the bare shape tag with no invented noun in front of it
DW	keep	run-detail-decision-cue.test.ts	run-detail-decision-cue.test.ts	A3/A13 — the provenance bar uses the demo's identity wording keeps Config and Attempt out of the mounted provenance popover
DW	keep	run-detail-decision-cue.test.ts	run-detail-decision-cue.test.ts	C4 — one owner for the rail's expansion reads its header word from the OWNER's value, not a second copy
SP	keep	run-detail-follow.test.ts	run-detail-follow.test.ts	the open panel follows its run (D257) holds while the run is not moving — a follow is not a poll
SP	keep	run-detail-follow.test.ts	run-detail-follow.test.ts	the open panel follows its run (D257) settles a MOVED revision through the coalescing window
SP	keep	run-detail-follow.test.ts	run-detail-follow.test.ts	the open panel follows its run (D257) keeps up across a burst, adopting the LATEST served revision each time
SP	keep	run-detail-follow.test.ts	run-detail-follow.test.ts	the open panel follows its run (D257) adopts a run SWITCH at once — the switch already refetched
SP	keep	run-detail-follow.test.ts	run-detail-follow.test.ts	the open panel follows its run (D257) follows nothing for a run the open day does not hold
SP	keep	run-detail-follow.test.ts	run-detail-follow.test.ts	the open panel follows its run (D257) keys on the SERVED revision while the state lags a switch, so one open is one read
DW	keep	run-detail-timeline-render.test.ts	run-detail-timeline-render.test.ts	B41 — the timeline segment is reachable by keyboard renders each segment as a button so the disclosure's focus-within can fire
DW	keep	run-detail-timeline-render.test.ts	run-detail-timeline-render.test.ts	B44 — an unmeasured segment that ran is dimmed dims the segment with no duration and leaves the measured one alone
AS	keep	run-detail-timeline-render.test.ts	run-detail-timeline-render.test.ts	B50 — the disclosure names the category's own state prints a Status row above the member list
DW	keep	run-detail-timeline-render.test.ts	run-detail-timeline-render.test.ts	B57 — a homeless wait still gets a segment draws the orphan segment when no step records the wait
DW	keep	run-detail-timeline-render.test.ts	run-detail-timeline-render.test.ts	B57 — a homeless wait still gets a segment draws no orphan segment when a step IS blocked
DW	keep	run-detail-timeline-render.test.ts	run-detail-timeline-render.test.ts	B57 — a homeless wait still gets a segment draws no orphan segment for a run with no open gate
AS	keep	run-detail-timeline-render.test.ts	run-detail-timeline-render.test.ts	B60/B61 — the axis prints both halves and no longer claims a span names the working sum, not the first-to-last elapsed
DW	keep	run-detail-timeline-render.test.ts	run-detail-timeline-render.test.ts	B60/B61 — the axis prints both halves and no longer claims a span adds the waiting half only while a gate is open
DW	keep	run-detail-timeline-render.test.ts	run-detail-timeline-render.test.ts	B60/B61 — the axis prints both halves and no longer claims a span prints no working half when nothing was measured
AS	keep	run-detail-timeline-render.test.ts	run-detail-timeline-render.test.ts	F6b item 1 — the read-forward strip's segment names itself computes an accessible name via role="img", not a bare aria-label
AS	keep	run-detail-timeline-render.test.ts	run-detail-timeline-render.test.ts	F6b item 3 — the disclosure trigger names what it controls pairs aria-controls with the member card's own id, both arms present statically
AS	keep	run-detail-timeline-render.test.ts	run-detail-timeline-render.test.ts	F6b item 3 — the disclosure trigger names what it controls flips aria-expanded to true on focus and back to false on blur
PD	keep	run-detail-timeline.test.ts	run-detail-timeline.test.ts	B44 — the untimed segment dims only where a measurement is missing dims a segment that ran and recorded no duration
PD	keep	run-detail-timeline.test.ts	run-detail-timeline.test.ts	B44 — the untimed segment dims only where a measurement is missing does not dim a measured segment
PD	keep	run-detail-timeline.test.ts	run-detail-timeline.test.ts	B44 — the untimed segment dims only where a measurement is missing does not dim a state that already says why it has no duration
PD	keep	run-detail-timeline.test.ts	run-detail-timeline.test.ts	B57 — an open gate that no segment carries still gets a segment reports the orphan when no segment records the wait
PD	keep	run-detail-timeline.test.ts	run-detail-timeline.test.ts	B57 — an open gate that no segment carries still gets a segment reports no orphan when a segment IS blocked
PD	keep	run-detail-timeline.test.ts	run-detail-timeline.test.ts	B57 — an open gate that no segment carries still gets a segment reports no orphan when there is no open gate
PD	keep	run-detail-timeline.test.ts	run-detail-timeline.test.ts	B57 — an open gate that no segment carries still gets a segment reports the orphan for a gated run with no segments at all
AS	keep	run-detail-timeline.test.ts	run-detail-timeline.test.ts	B60/B61 — the axis names the working half and the waiting half sums the measured durations rather than spanning first to last
AS	keep	run-detail-timeline.test.ts	run-detail-timeline.test.ts	B60/B61 — the axis names the working half and the waiting half reports no working time when NOTHING was measured
AS	keep	run-detail-timeline.test.ts	run-detail-timeline.test.ts	B60/B61 — the axis names the working half and the waiting half reports no working time for a run with no segments
AS	keep	run-detail-timeline.test.ts	run-detail-timeline.test.ts	B60/B61 — the axis names the working half and the waiting half carries the open gate's age against the served clock
AS	keep	run-detail-timeline.test.ts	run-detail-timeline.test.ts	B60/B61 — the axis names the working half and the waiting half carries no wait for a resolved or absent gate
PD	keep	run-shape-hazard.test.ts	run-shape-hazard.test.ts	the run-shape hazard (§9.22 item 3) is SILENT when the run's fingerprint is the one its workflow is served under
PD	keep	run-shape-hazard.test.ts	run-shape-hazard.test.ts	the run-shape hazard (§9.22 item 3) WARNS, naming the shape now serving, when that workflow's descriptor moved
PD	keep	run-shape-hazard.test.ts	run-shape-hazard.test.ts	the run-shape hazard (§9.22 item 3) does not compare a run against the whole-SET hash, which is what made it always warn
PD	keep	run-shape-hazard.test.ts	run-shape-hazard.test.ts	the run-shape hazard (§9.22 item 3) says a workflow this build does not register is UNSERVED, not moved
SP	keep	run-start-dialog.test.ts	run-start-dialog.test.ts	a settlement that arrives after the request moved is DROPPED does not land a plan for text the operator has already edited away
SP	keep	run-start-dialog.test.ts	run-start-dialog.test.ts	a settlement that arrives after the request moved is DROPPED does not land a result for a plan the operator has already edited away
DW	keep	run-start-dialog.test.ts	run-start-dialog.test.ts	C109 — a plan outlives nothing that shaped it, in the dialog drops the plan when a run control moves under it
DW	keep	run-start-dialog.test.ts	run-start-dialog.test.ts	C109 — a plan outlives nothing that shaped it, in the dialog drops a settled result banner when the typed text moves under it
DW	keep	run-start-dialog.test.ts	run-start-dialog.test.ts	D293 keeps D285 and removes only per-start destination keeps Options and the separate Steps screen while omitting destination controls
DW	keep	run-start-dialog.test.ts	run-start-dialog.test.ts	browser presentation is an immutable Run Options choice offers both modes, defaults to headed with screenshots on, and submits an explicit override
DW	keep	run-start-dialog.test.ts	run-start-dialog.test.ts	the compact confirmation keeps the exact input basis summarizes what was typed after the result settles
DW	keep	run-start-dialog.test.ts	run-start-dialog.test.ts	the compact confirmation keeps the exact input basis summarizes what was typed at Confirm
DW	keep	run-start-dialog.test.ts	run-start-dialog.test.ts	every exit from a settled banner returns the form to Input Close resets the stage with the result, and puts focus back in the box
VL	keep	run-start-dialog.test.ts	run-start-dialog.test.ts	every exit from a settled banner returns the form to Input Reload the form drops the spent token, returns to Input and focuses the box
DW	keep	run-start-dialog.test.ts	run-start-dialog.test.ts	D296 — the spreadsheet method is the intake workspace's one door offers both methods for a spreadsheet-capable workflow, and typed is the default
DW	keep	run-start-dialog.test.ts	run-start-dialog.test.ts	D296 — the spreadsheet method is the intake workspace's one door the spreadsheet arm collapses the rail to Input and IS the dropzone
DW	keep	run-start-dialog.test.ts	run-start-dialog.test.ts	D296 — the spreadsheet method is the intake workspace's one door a dropped file is uploaded, and the handoff carries the workflow AND the new session
DW	keep	run-start-dialog.test.ts	run-start-dialog.test.ts	D296 — the spreadsheet method is the intake workspace's one door a REFUSED upload prints the server's own code and opens no session
DW	keep	run-start-dialog.test.ts	run-start-dialog.test.ts	D296 — the spreadsheet method is the intake workspace's one door a transport failure says the file never landed, and opens no session
DW	keep	run-start-dialog.test.ts	run-start-dialog.test.ts	D296 — the spreadsheet method is the intake workspace's one door the typed arm comes back with its box and its full path
DW	keep	run-start-dialog.test.ts	run-start-dialog.test.ts	an omittable step draws its own form when it is left out (D307) draws nothing while the step is included, and the step's declared fields once it is not
DW	keep	run-start-dialog.test.ts	run-start-dialog.test.ts	an omittable step draws its own form when it is left out (D307) says so when the omitted step asks for nothing at all
DW	keep	run-start-dialog.test.ts	run-start-dialog.test.ts	an omittable step draws its own form when it is left out (D307) draws an enum as a choice with NO pre-selected value
SP	keep	run-start-dialog.test.ts	run-start-dialog.test.ts	Confirm is not reachable while an omitted step's form does not parse (D307) holds the Steps stage, draws the declared refusal, and never asks the server
SP	keep	run-start-dialog.test.ts	run-start-dialog.test.ts	the request carries the operator's omissions (D307) sends one entry per omitted step, in timeline order, with the typed facts
SP	keep	run-start-dialog.test.ts	run-start-dialog.test.ts	the request carries the operator's omissions (D307) sends no omissions at all when the operator omitted nothing
DW	keep	run-start-dialog.test.ts	run-start-dialog.test.ts	a plan that omits a different set cannot be started (D307) refuses Start and says which set each side named
DW	keep	run-start-dialog.test.ts	run-start-dialog.test.ts	a plan that omits a different set cannot be started (D307) starts when the plan names exactly the set the dialog sent
DW	keep	run-start-dialog.test.ts	run-start-dialog.test.ts	typed facts describe ONE subject (D307 single-subject-only) does not offer an omission for a box that would create several runs
AS	keep	run-start-dialog.test.ts	run-start-dialog.test.ts	a forced step is unchecked and LOCKED while the choice that forces it stands (D307) names the forced step up front, drags it out, locks it, and puts it back
PD	keep	run-start-kit-render.test.ts	run-start-kit-render.test.ts	a locked value states its reason ON SCREEN (C48 / C81, D272 item 9) prints the reason as page text, not only as a tooltip
PD	keep	run-start-kit-render.test.ts	run-start-kit-render.test.ts	a locked value states its reason ON SCREEN (C48 / C81, D272 item 9) states the reason ONCE — the `<p>` replaced the tooltip, it did not join it
PD	keep	run-start-kit-render.test.ts	run-start-kit-render.test.ts	a locked value states its reason ON SCREEN (C48 / C81, D272 item 9) is the SAME component behind the sub-selection, so the two cannot drift
PD	keep	run-start-kit-render.test.ts	run-start-kit-render.test.ts	the plan is a card per proposed row (C57, D272 item 8) draws no table, and names every served identity on the card
PD	keep	run-start-kit-render.test.ts	run-start-kit-render.test.ts	the plan is a card per proposed row (C57, D272 item 8) invents none of the demo's unserved plan-row anatomy
VL	keep	run-start-kit-render.test.ts	run-start-kit-render.test.ts	the plan is a card per proposed row (C57, D272 item 8) puts the untruncatable identities on the provenance line, not in a clipped chip
PD	keep	run-start-kit-render.test.ts	run-start-kit-render.test.ts	the plan is a card per proposed row (C57, D272 item 8) prints the plan's expiry as a clock reading, never a raw ISO instant (C61)
PD	keep	run-start-kit-render.test.ts	run-start-kit-render.test.ts	the result banner's own words (C69 / C72, D272 items 8 and 9) says Close on a settled start and Dismiss on a refusal
PD	keep	run-start-kit-render.test.ts	run-start-kit-render.test.ts	the result banner's own words (C69 / C72, D272 items 8 and 9) gives the conflict arm the one exit it has
SP	keep	run-start-kit-render.test.ts	run-start-kit-render.test.ts	the result banner's own words (C69 / C72, D272 items 8 and 9) still draws a conflict when no reload handler is wired, rather than a bare banner claim
PD	keep	run-start-model.test.ts	run-start-model.test.ts	the descriptor version in the Run Modal footer (C96) prints the stored integer with no fabricated minor version
PD	keep	run-start-model.test.ts	run-start-model.test.ts	the declared active-run policy, as the modal states it (D251) covers the enum exactly — a new policy arm cannot land wordless, and no word outlives its arm
PD	keep	run-start-model.test.ts	run-start-model.test.ts	the declared active-run policy, as the modal states it (D251) has a sentence for every policy any registered workflow actually declares
PD	keep	run-start-model.test.ts	run-start-model.test.ts	the declared active-run policy, as the modal states it (D251) pins ref frontend-backend-integration §D251's claim that NO registered workflow declares supersede-active
PD	keep	run-start-model.test.ts	run-start-model.test.ts	the declared active-run policy, as the modal states it (D251) states WHY the policy is not a control, so a locked value never reads as a broken one
AS	keep	run-start-model.test.ts	run-start-model.test.ts	why this dialog cannot start a workflow (D251) names the modal's own precondition and does not speak for the server
PD	keep	run-start-model.test.ts	run-start-model.test.ts	why this dialog cannot start a workflow (D251) has exactly one arm, because exactly one precondition exists
PD	keep	run-start-model.test.ts	run-start-model.test.ts	the descriptor prose the modal draws (D251) finds a summary on every registered workflow, and treats absence as legal anyway
PD	keep	run-start-model.test.ts	run-start-model.test.ts	the descriptor prose the modal draws (D251) has exactly one start method kind, which is why no method tabs are drawn
SP	keep	run-start-model.test.ts	run-start-model.test.ts	a plan outlives nothing that shaped it (C109, D272 item 8) changes when ANY field of the start request changes
PD	keep	run-start-model.test.ts	run-start-model.test.ts	the run-control rail is numbered by what it draws (C83/C84, D272 item 9) draws no Safety group at all for a workflow that declares no dry run
PD	keep	run-start-model.test.ts	run-start-model.test.ts	the run-control rail is numbered by what it draws (C83/C84, D272 item 9) draws no Destination group
PD	keep	run-start-model.test.ts	run-start-model.test.ts	the run-control rail is numbered by what it draws (C83/C84, D272 item 9) leaves no gap in the reading path, in either shape
PD	keep	run-start-model.test.ts	run-start-model.test.ts	the run-control rail is numbered by what it draws (C83/C84, D272 item 9) gives every drawn group a title and a description
PD	keep	run-start-model.test.ts	run-start-model.test.ts	an omission form starts EMPTY (D307) seeds every typed kind with nothing and only a checkbox with an answer
PD	keep	run-start-model.test.ts	run-start-model.test.ts	an omission form starts EMPTY (D307) refuses every empty typed field by name rather than filling one in
SP	keep	run-start-model.test.ts	run-start-model.test.ts	a complete draft reads as the facts the declared schema produces (D307) reads each kind as its own shape, TRIMMED exactly as the schema trims it
SP	keep	run-start-model.test.ts	run-start-model.test.ts	every kind's refusal is the declared schema's own (D307) refuses an empty text field, at note
SP	keep	run-start-model.test.ts	run-start-model.test.ts	every kind's refusal is the declared schema's own (D307) refuses a date that is not MM/DD/YYYY, at lastDayWorked
SP	keep	run-start-model.test.ts	run-start-model.test.ts	every kind's refusal is the declared schema's own (D307) refuses a two-digit year, at lastDayWorked
SP	keep	run-start-model.test.ts	run-start-model.test.ts	every kind's refusal is the declared schema's own (D307) refuses an employee id of seven digits, at emplId
SP	keep	run-start-model.test.ts	run-start-model.test.ts	every kind's refusal is the declared schema's own (D307) refuses an employee id with a letter, at emplId
SP	keep	run-start-model.test.ts	run-start-model.test.ts	every kind's refusal is the declared schema's own (D307) refuses a number that is not whole, at hours
SP	keep	run-start-model.test.ts	run-start-model.test.ts	every kind's refusal is the declared schema's own (D307) refuses a number below the declared minimum, at hours
SP	keep	run-start-model.test.ts	run-start-model.test.ts	every kind's refusal is the declared schema's own (D307) refuses text where a number is asked for, at hours
SP	keep	run-start-model.test.ts	run-start-model.test.ts	every kind's refusal is the declared schema's own (D307) refuses a value outside the declared enum, at status
SP	keep	run-start-model.test.ts	run-start-model.test.ts	every kind's refusal is the declared schema's own (D307) refuses a string where a yes/no answer is asked for, at reviewed
SP	keep	run-start-model.test.ts	run-start-model.test.ts	every kind's refusal is the declared schema's own (D307) accepts an empty text-list, because the declared schema does
PD	keep	run-start-model.test.ts	run-start-model.test.ts	the cascade locks exactly what the planner would refuse (D307) names nobody while every step is included
PD	keep	run-start-model.test.ts	run-start-model.test.ts	the cascade locks exactly what the planner would refuse (D307) takes the forced step out with the forcing one, and locks it there
PD	keep	run-start-model.test.ts	run-start-model.test.ts	the cascade locks exactly what the planner would refuse (D307) puts the forced step back when the choice that held it out is undone
PD	keep	run-start-model.test.ts	run-start-model.test.ts	the cascade locks exactly what the planner would refuse (D307) never moves a required step
PD	keep	run-start-model.test.ts	run-start-model.test.ts	the cascade locks exactly what the planner would refuse (D307) keeps the result in timeline order however the presses arrive
PD	keep	run-start-model.test.ts	run-start-model.test.ts	the cascade locks exactly what the planner would refuse (D307) refuses a toggle for a step this workflow does not declare
PD	keep	run-start-model.test.ts	run-start-model.test.ts	the cascade locks exactly what the planner would refuse (D307) reads the omitted steps in timeline order, and only the omittable ones
PD	keep	run-start-timeline.test.ts	run-start-timeline.test.ts	run-start timeline keeps Options in the ordinary path
PD	keep	run-start-timeline.test.ts	run-start-timeline.test.ts	run-start timeline adds Steps after Options when customization is enabled
PD	keep	run-start-timeline.test.ts	run-start-timeline.test.ts	run-start timeline returns to Options when Steps disappears
SP	keep	seeded-bff.test.ts	seeded-bff.test.ts	seeded parity BFF (adapter #2 — real machinery) serves a strict bootstrap document
SP	keep	seeded-bff.test.ts	seeded-bff.test.ts	seeded parity BFF (adapter #2 — real machinery) projects one queue surface per seeded role with the expected status
SP	keep	seeded-bff.test.ts	seeded-bff.test.ts	seeded parity BFF (adapter #2 — real machinery) keeps counts on the one D81 path, excluding member surfaces
SP	keep	seeded-bff.test.ts	seeded-bff.test.ts	seeded parity BFF (adapter #2 — real machinery) serves the failed run's detail, failure section, and note-backed logs
SP	keep	seeded-bff.test.ts	seeded-bff.test.ts	seeded parity BFF (adapter #2 — real machinery) serves the parked run's section from a real fenced-and-parked write intent
SP	keep	seeded-bff.test.ts	seeded-bff.test.ts	seeded parity BFF (adapter #2 — real machinery) opens a resumable stream whose first envelope parses
PD	keep	served-clock.test.ts	served-clock.test.ts	the served clock (D256) is EXACTLY the served instant when no monotonic time has passed
PD	keep	served-clock.test.ts	served-clock.test.ts	the served clock (D256) advances by the monotonic time since that instant arrived, never by a browser wall clock
PD	keep	served-clock.test.ts	served-clock.test.ts	the served clock (D256) refuses a monotonic interval that ran backwards rather than reporting a plausible instant
PD	keep	served-clock.test.ts	served-clock.test.ts	the served clock (D256) refuses a served instant it cannot parse
PD	keep	served-clock.test.ts	served-clock.test.ts	the served clock (D256) makes a run that started AFTER page load report its real age instead of 0s
PD	keep	served-clock.test.ts	served-clock.test.ts	the served clock (D256) keeps a settled row's duration untouched as the clock ticks
PD	keep	served-clock.test.ts	served-clock.test.ts	a backwards elapsed is drawn, not clamped (D256) returns the SIGNED interval so 'the clock is behind' cannot read as 'just now'
PD	keep	served-clock.test.ts	served-clock.test.ts	a backwards elapsed is drawn, not clamped (D256) still renders a sub-second skew as 0s — this arm fires only on a real defect
PD	keep	served-clock.test.ts	served-clock.test.ts	a backwards elapsed is drawn, not clamped (D256) spells a genuinely negative interval with its sign, at every magnitude
SP	keep	session-panel-pool-press.test.ts	session-panel-pool-press.test.ts	a pool command carries the CAS basis the operator was reading spawns against the SERVED pool version, not a re-read one
SP	keep	session-panel-pool-press.test.ts	session-panel-pool-press.test.ts	a pool command carries the CAS basis the operator was reading plans against the SERVED pool version, and sends the count that was confirmed
DW	keep	session-panel-pool-press.test.ts	session-panel-pool-press.test.ts	the worker id is reachable without a mouse prints the unmet member's served id in the dialog's roster, and the card's behind its identity control
DW	keep	session-panel-pool-press.test.ts	session-panel-pool-press.test.ts	browser requirements are visible before acquisition shows every required system without reporting an unopened browser as open
DW	keep	session-panel-pool-press.test.ts	session-panel-pool-press.test.ts	nothing is dispatched until the confirmation is pressed sends nothing for opening the dialog or stepping the count
DW	keep	session-panel-pool-press.test.ts	session-panel-pool-press.test.ts	nothing is dispatched until the confirmation is pressed re-stepping the count before confirming sends only the LAST count, once
PD	keep	session-view.test.ts	session-view.test.ts	Session Panel authority joins joins a working card to its run's served session by exact run id
PD	keep	session-view.test.ts	session-view.test.ts	Session Panel authority joins keeps an absent session as the row's served reason, never a guessed id
PD	keep	session-view.test.ts	session-view.test.ts	Session Panel authority joins distinguishes a declared pool from authority worker facts and treats no row as no declaration
PD	keep	session-view.test.ts	session-view.test.ts	Session Panel authority joins does not turn an idle worker's absence of a current run into an absent session or browser verdict
PD	keep	session-view.test.ts	session-view.test.ts	Session Panel authority joins keeps descriptor browser order, upgrades observed sessions, and retains observed extras
PD	keep	session-view.test.ts	session-view.test.ts	Session Panel authority joins serves requirement authority failures explicitly without hiding observed browsers
PD	keep	session-view.test.ts	session-view.test.ts	Session Panel authority joins shows no browser slots on a retained terminal worker card
SP	keep	session-view.test.ts	session-view.test.ts	Session Panel authority joins folds one membership per served card, in wire order, for the strip to read by worker id
PD	keep	session-view.test.ts	session-view.test.ts	Session Panel authority joins plans a workflow with neither a card nor a pool row at basis 0 with an empty roster (D305)
SP	keep	settings-editor-client.test.ts	settings-editor-client.test.ts	Settings editor client asks the BFF for the server-listed editable inventory
SP	keep	settings-editor-surface.test.ts	settings-editor-surface.test.ts	editable Settings surface refuses a malformed server settings inventory instead of retyping, relocating, or contradicting its runtime identity
DW	keep	settings-editor-surface.test.ts	settings-editor-surface.test.ts	editable Settings surface keeps one keyboard-submittable atomic draft and locks an environment-owned leaf
DW	keep	settings-editor-surface.test.ts	settings-editor-surface.test.ts	editable Settings surface refuses a cleared zero-allowed OCR field instead of converting it to zero
AS	keep	settings-status-sections.test.ts	settings-status-sections.test.ts	System hosts (SE40) prints the configured production host and names the absence of a test one
DW	keep	settings-status-sections.test.ts	settings-status-sections.test.ts	System hosts (SE40) names a test host configured identical to production as refused, not as unprovisioned
DW	keep	settings-status-sections.test.ts	settings-status-sections.test.ts	System hosts (SE40) counts the systems that have a test host
DW	keep	settings-status-sections.test.ts	settings-status-sections.test.ts	System hosts (SE40) states that the instance is a per-run decision this page does not make
SP	keep	settings-status-sections.test.ts	settings-status-sections.test.ts	System hosts (SE40) names each system rather than printing its wire id
DW	keep	settings-status-sections.test.ts	settings-status-sections.test.ts	System hosts (SE40) carries the per-system sentence under each name
DW	keep	settings-status-sections.test.ts	settings-status-sections.test.ts	System hosts (SE40) subtitles the section with where the instance question is actually asked
DW	keep	settings-status-sections.test.ts	settings-status-sections.test.ts	System hosts (SE40) presents exactly the closed system enum, no more and no less
DW	keep	settings-status-sections.test.ts	settings-status-sections.test.ts	System hosts (SE40) carries the demo's own sentence for the systems the demo covers
DW	keep	settings-status-sections.test.ts	settings-status-sections.test.ts	Workflow capabilities (SE41/SE42) carries SE42's provenance banner
DW	keep	settings-status-sections.test.ts	settings-status-sections.test.ts	Workflow capabilities (SE41/SE42) draws all three cell shapes, each with its own word
DW	keep	settings-status-sections.test.ts	settings-status-sections.test.ts	Workflow capabilities (SE41/SE42) subtitles the section with the decision-or-gap distinction
DW	keep	settings-status-sections.test.ts	settings-status-sections.test.ts	Workflow capabilities (SE41/SE42) counts, per capability, how many workflows answer it
DW	keep	settings-status-sections.test.ts	settings-status-sections.test.ts	Workflow capabilities (SE41/SE42) gives the dry-run posture its own reading, including the refusal
DW	keep	settings-status-sections.test.ts	settings-status-sections.test.ts	Workflow capabilities (SE41/SE42) falls back to the workflow's own id, and says that is what it is
DW	keep	settings-status-sections.test.ts	settings-status-sections.test.ts	the F11b review fixes announces a refusal ONCE — the danger Banner is the only alert
VL	keep	settings-status-sections.test.ts	settings-status-sections.test.ts	the F11b review fixes keeps a capability detail out of a clipping chip
DW	keep	settings-status-sections.test.ts	settings-status-sections.test.ts	the F11b review fixes names an empty registry instead of drawing six header-only tables
DW	keep	settings-status-sections.test.ts	settings-status-sections.test.ts	the F11b review fixes refuses a document that serves zero system hosts
DW	keep	settings-status-sections.test.ts	settings-status-sections.test.ts	the async arms (D275 item 4) says it is reading, rather than drawing an empty table
DW	keep	settings-status-sections.test.ts	settings-status-sections.test.ts	the async arms (D275 item 4) names a refusal and says nothing below is missing
DW	keep	settings-status-sections.test.ts	settings-status-sections.test.ts	the async arms (D275 item 4) refuses in the capabilities section too, rather than an empty matrix
SP	keep	settings-storage-doctor.test.ts	settings-storage-doctor.test.ts	loaded Settings storage doctor renders every degraded span-authority diagnosis with exact counts and identifying facts
SP	keep	settings-storage-doctor.test.ts	settings-storage-doctor.test.ts	loaded Settings storage doctor renders reconciled span authority with exact live, stream, and archived accounting
SP	keep	settings-storage-doctor.test.ts	settings-storage-doctor.test.ts	loaded Settings storage doctor renders unavailable span authority as its exact cause rather than empty or reconciled evidence
PD	keep	settings-takeover.test.ts	settings-takeover.test.ts	the settings route (D272 item 1) carries an EMPTY value, because that is the page's first section
PD	keep	settings-takeover.test.ts	settings-takeover.test.ts	the settings route (D272 item 1) carries a named section both ways
PD	keep	settings-takeover.test.ts	settings-takeover.test.ts	the settings route (D272 item 1) is absent when the key is absent, and then owns nothing
PD	keep	settings-takeover.test.ts	settings-takeover.test.ts	the settings route (D272 item 1) OUTRANKS every other takeover key
PD	keep	settings-takeover.test.ts	settings-takeover.test.ts	the settings page's nav (D274 item 5) puts every served section under Status and always offers both Help entries
AS	keep	settings-takeover.test.ts	settings-takeover.test.ts	the settings page's nav (D274 item 5) draws no Status heading over an empty list, and Help still stands
PD	keep	settings-takeover.test.ts	settings-takeover.test.ts	the settings page's nav (D274 item 5) gives a served section this build cannot render its own glyph
PD	keep	settings-takeover.test.ts	settings-takeover.test.ts	which section a link opens (D274 item 5) opens the first entry on the empty value
PD	keep	settings-takeover.test.ts	settings-takeover.test.ts	which section a link opens (D274 item 5) opens the named entry — this is the Help → Keyboard destination
PD	keep	settings-takeover.test.ts	settings-takeover.test.ts	which section a link opens (D274 item 5) REFUSES to fall back to the first entry for a section it does not have
PD	keep	settings-takeover.test.ts	settings-takeover.test.ts	which section a link opens (D274 item 5) says so when there is nothing at all to open
PD	keep	settings-takeover.test.ts	settings-takeover.test.ts	focus on close (unit F4b finding 1) prefers the gear that opened the page
PD	keep	settings-takeover.test.ts	settings-takeover.test.ts	focus on close (unit F4b finding 1) falls back to the main region the takeover was covering, when the gear is gone
VL	keep	settings-takeover.test.ts	settings-takeover.test.ts	focus on close (unit F4b finding 1) the two targets are distinct ids — a collision would make this fold meaningless
PD	keep	settings-takeover.test.ts	settings-takeover.test.ts	history push on re-press (unit F4b finding 2) does NOT advance history when the next route serialises to the current search
PD	keep	settings-takeover.test.ts	settings-takeover.test.ts	history push on re-press (unit F4b finding 2) DOES advance history when the next route is a different place
PD	keep	settings-takeover.test.ts	settings-takeover.test.ts	history push on re-press (unit F4b finding 2) advances on the very first navigation, from an unrelated current search
PD	keep	settings-takeover.test.ts	settings-takeover.test.ts	the settings nav renders real navigation, not buttons (unit F4b finding 4) gives every nav entry a real, section-addressed href
AS	keep	settings-takeover.test.ts	settings-takeover.test.ts	the settings nav renders real navigation, not buttons (unit F4b finding 4) keeps aria-current on the open entry and off the others
PD	keep	settings-takeover.test.ts	settings-takeover.test.ts	the settings nav renders real navigation, not buttons (unit F4b finding 4) renders no plain <button> for a nav entry any more
SP	keep	settings-takeover.test.ts	settings-takeover.test.ts	curly quotes around a section name (unit F4b finding 3) quotes the requested-but-unknown section name with curly quotes, not &quot;
PD	keep	settings-takeover.test.ts	settings-takeover.test.ts	curly quotes around a section name (unit F4b finding 3) quotes an unrendered served section's id with curly quotes, not &quot;
PD	keep	settings-takeover.test.ts	settings-takeover.test.ts	the app version tag (D272 item 4, ledger row A126) prints the two components the tooltip beside it explains
PD	keep	settings-takeover.test.ts	settings-takeover.test.ts	the app version tag (D272 item 4, ledger row A126) THROWS on a shape it does not recognise rather than printing the raw string
PD	keep	settings-takeover.test.ts	settings-takeover.test.ts	the session bar's attention chip (D272 item 4, ledger row A122) keeps the noun and the verb agreeing at a count of ONE
PD	keep	settings-takeover.test.ts	settings-takeover.test.ts	the session bar's attention chip (D272 item 4, ledger row A122) reads the same way above one
PD	keep	settings-takeover.test.ts	settings-takeover.test.ts	the session bar's attention chip (D272 item 4, ledger row A122) draws no chip when nothing is failed — honest absence
PD	keep	settings-takeover.test.ts	settings-takeover.test.ts	the session bar's attention chip (D272 item 4, ledger row A122) prints the app version as MAJOR.MINOR beside the tooltip that explains two
VL	keep	shell-structural-fidelity.test.ts	shell-structural-fidelity.test.ts	DCF2 shell and queue structural fidelity A81 — gives the one-child workflow label no invented gap
VL	keep	shell-structural-fidelity.test.ts	shell-structural-fidelity.test.ts	DCF2 shell and queue structural fidelity A82 — lets the row gap, rather than a second left pad, separate label and count
VL	keep	shell-structural-fidelity.test.ts	shell-structural-fidelity.test.ts	DCF2 shell and queue structural fidelity A168/A169 — places the floor-bearing root outside both providers
VL	keep	shell-structural-fidelity.test.ts	shell-structural-fidelity.test.ts	DCF2 shell and queue structural fidelity A170 — restores the demo root's horizontal shrink and viewport clip without re-adding min-h
PD	keep	shell-view-selection.test.ts	shell-view-selection.test.ts	the Top Bar switcher's pressed segment presses nothing for every takeover the switcher does not name
PD	keep	shell-view-selection.test.ts	shell-view-selection.test.ts	the Top Bar switcher's pressed segment presses the segment that owns the main region for the three it does name
PD	keep	shell-view-selection.test.ts	shell-view-selection.test.ts	the Top Bar switcher's pressed segment presses Dashboard only when no takeover owns the main region
PD	keep	shell-view-selection.test.ts	shell-view-selection.test.ts	the Top Bar switcher's pressed segment follows the route's own precedence rather than a second copy of it
PD	keep	shell-view-selection.test.ts	shell-view-selection.test.ts	the Top Bar switcher's pressed segment presses the segment its arm names, for every takeover in the union
PD	keep	status-band-scope.test.ts	status-band-scope.test.ts	workflowStatusCounts — the band's scope selector reads the ACTIVE workflow's entry, not the day's fold
PD	keep	status-band-scope.test.ts	status-band-scope.test.ts	workflowStatusCounts — the band's scope selector answers an unserved workflow with an empty array, so every pill reads zero
PD	keep	status-band-scope.test.ts	status-band-scope.test.ts	totalCount — the `All` segment (R4-2) folds the SAME array the pills render, and matches the served row total
PD	keep	status-band-scope.test.ts	status-band-scope.test.ts	totalCount — the `All` segment (R4-2) stays closed under addition with the composites beside it
PD	keep	storage-banner.test.ts	storage-banner.test.ts	the app-wide storage band (D281 item 7) renders only when authority storage is unavailable
PD	keep	storage-banner.test.ts	storage-banner.test.ts	the app-wide storage band (D281 item 7) uses the bottom-edge-only, radius-free band arm
PD	keep	storage-banner.test.ts	storage-banner.test.ts	the app-wide storage band (D281 item 7) leaves every ordinary Banner on the bordered, rounded card shape
AS	keep	takeover-frame-focus.test.ts	takeover-frame-focus.test.ts	ds/TakeoverFrame — entering a takeover moves focus into it focuses its own labelled section on mount
DW	keep	takeover-frame-focus.test.ts	takeover-frame-focus.test.ts	ds/TakeoverFrame — entering a takeover moves focus into it leaves the door it was opened from — focus does not stay on the trigger
VL	keep	takeover-frame-focus.test.ts	takeover-frame-focus.test.ts	ds/TakeoverFrame — entering a takeover moves focus into it is a focus target, not a tab stop
VL	keep	takeover-frame-focus.test.ts	takeover-frame-focus.test.ts	ds/TakeoverFrame — entering a takeover moves focus into it paints no focus ring — the UA's included
DW	keep	takeover-frame-focus.test.ts	takeover-frame-focus.test.ts	ds/TakeoverFrame — entering a takeover moves focus into it does not steal focus from a descendant that took it in the same commit
DW	keep	takeover-frame-focus.test.ts	takeover-frame-focus.test.ts	the two remaining takeovers use the shared focus boundary (UF-FU-1) Spreadsheet intake receives frame focus, then Tab reaches Close first
DW	keep	takeover-frame-focus.test.ts	takeover-frame-focus.test.ts	the two remaining takeovers use the shared focus boundary (UF-FU-1) the UI catalog draws inside the Settings frame and owns no exit of its own
DW	keep	takeover-frame-focus.test.ts	takeover-frame-focus.test.ts	closing a route-backed takeover restores its toolbar door returns intake focus to Start a run after the route unmounts
DW	keep	takeover-frame-focus.test.ts	takeover-frame-focus.test.ts	closing a route-backed takeover restores its toolbar door uses the persistent main region when a deep link has no matching door
SP	keep	takeover-frame-focus.test.ts	takeover-frame-focus.test.ts	closing a route-backed takeover restores its toolbar door fails loud when neither the requested door nor the main fallback exists
DW	keep	takeover-frame-focus.test.ts	takeover-frame-focus.test.ts	Settings exits share the page-owned draft guard requires a discard before persistent TopBar navigation unmounts a dirty Settings draft
DW	keep	takeover-frame-focus.test.ts	takeover-frame-focus.test.ts	Settings exits share the page-owned draft guard allows persistent TopBar navigation immediately when the Settings draft is clean
DW	keep	takeover-frame-focus.test.ts	takeover-frame-focus.test.ts	Settings exits share the page-owned draft guard reconciles a dirty native popstate until the operator chooses an exit
DW	keep	takeover-frame-focus.test.ts	takeover-frame-focus.test.ts	Settings exits share the page-owned draft guard accepts a clean native popstate immediately
DW	keep	takeover-frame-focus.test.ts	takeover-frame-focus.test.ts	Settings exits share the page-owned draft guard does not mutate TopBar history until a dirty Settings exit is confirmed
DW	keep	takeover-frame-focus.test.ts	takeover-frame-focus.test.ts	Settings exits share the page-owned draft guard accepts clean TopBar history navigation immediately
VL	remove-duplicate	parity/top-bar-search-touch-target.spec.ts	top-bar-search-a11y.test.ts	the Top Bar search scope control keeps each 24px painted toggle inside an independent coarse-pointer 44px target
PD	keep	ui-catalog-model.test.ts	ui-catalog-model.test.ts	foldCatalogRail draws every served entry exactly once, nested under the screen it names
AS	keep	ui-catalog-model.test.ts	ui-catalog-model.test.ts	foldCatalogRail keeps a screen as the heading of its matching entries without counting it as a hit
PD	keep	ui-catalog-model.test.ts	ui-catalog-model.test.ts	foldCatalogRail narrows by every whitespace-split term, exactly as the shared matcher does
PD	keep	ui-catalog-model.test.ts	ui-catalog-model.test.ts	foldCatalogRail returns an empty rail, not a throw, for a term nothing matches
PD	keep	ui-catalog-model.test.ts	ui-catalog-model.test.ts	foldCatalogRail refuses an entry whose screen the catalog does not serve
SP	keep	ui-catalog-model.test.ts	ui-catalog-model.test.ts	the selection follows a drawn request, else a same-term request, else the first match, else nothing
PD	keep	ui-catalog-model.test.ts	ui-catalog-model.test.ts	the selection prints a nested id without its screen's prefix, and whole when it has none
PD	keep	ui-catalog-model.test.ts	ui-catalog-model.test.ts	the selection steps by one row and clamps at both ends
AS	keep	ui-catalog-model.test.ts	ui-catalog-model.test.ts	the selection names the other entries on the selected entry's screen, never itself and never the screen
SP	keep	ui-catalog-model.test.ts	ui-catalog-model.test.ts	the vocabulary names every entry kind the schema serves, with one mark each
PD	keep	ui-catalog-model.test.ts	ui-catalog-model.test.ts	the vocabulary makes a DOM id out of an entry id without dropping its identity
DW	keep	ui-catalog-surface.test.ts	ui-catalog-surface.test.ts	the UI catalog rail and record draws every match in the rail and opens the record on the first one
DW	keep	ui-catalog-surface.test.ts	ui-catalog-surface.test.ts	the UI catalog rail and record moves the record on click and on arrow keys, and keeps focus on the row it moved to
DW	keep	ui-catalog-surface.test.ts	ui-catalog-surface.test.ts	the UI catalog rail and record prints the selected entry's provenance whole: both evidence refs, every scenario, every task
DW	keep	ui-catalog-surface.test.ts	ui-catalog-surface.test.ts	the UI catalog rail and record offers the other entries on the same screen, and selecting one moves the record
DW	keep	ui-catalog-surface.test.ts	ui-catalog-surface.test.ts	the UI catalog rail and record shows the empty state, and no rail, when nothing matches
PD	keep	worker-card.test.ts	worker-card.test.ts	the card the projector composes from a lease (D248) accepts the descriptor browser systems the worker persisted at launch
PD	keep	worker-card.test.ts	worker-card.test.ts	the card the projector composes from a lease (D248) names launch-time requirements as unavailable for a historical lease
PD	keep	worker-card.test.ts	worker-card.test.ts	the card the projector composes from a lease (D248) reads identity, phase, directive and the CAS basis off the lease
PD	keep	worker-card.test.ts	worker-card.test.ts	the card the projector composes from a lease (D248) says WHICH run it holds when the spans for it have not been folded
PD	keep	worker-card.test.ts	worker-card.test.ts	the card the projector composes from a lease (D248) splits a settled lease by its recorded reason and drops every tile
PD	keep	worker-card.test.ts	worker-card.test.ts	the card the projector composes from a lease (D248) calls a lease that has taken its generation and reported nothing `starting`
PD	keep	worker-card.test.ts	worker-card.test.ts	the browser span path is read, never guessed (D248) reads the system and session id the emitter composed
PD	keep	worker-card.test.ts	worker-card.test.ts	the browser span path is read, never guessed (D248) refuses a path that names no session, rather than folding a guessed one
PD	keep	worker-card.test.ts	worker-card.test.ts	the browser span path is read, never guessed (D248) refuses a span whose declared system disagrees with its own path
PD	keep	worker-card.test.ts	worker-card.test.ts	the words the card carries (D249) states a standing directive beside the state word, never as it
PD	keep	worker-card.test.ts	worker-card.test.ts	the words the card carries (D249) offers Stop only where a directive can still land
PD	keep	worker-card.test.ts	worker-card.test.ts	the words the card carries (D249) counts a settled worker's uptime to its END, never to now
PD	keep	worker-card.test.ts	worker-card.test.ts	the words the card carries (D249) has a word for every state and every recorded stop reason
PD	keep	worker-pool-controls.test.ts	worker-pool-controls.test.ts	the panel's copy of the pool contract is pinned to the kernel's restates D271's cap as the kernel's own number
PD	keep	worker-pool-controls.test.ts	worker-pool-controls.test.ts	the panel's copy of the pool contract is pinned to the kernel's derives the same canonical identity the supervisor requires
PD	keep	worker-pool-controls.test.ts	worker-pool-controls.test.ts	the panel's copy of the pool contract is pinned to the kernel's refuses to mint an identity outside the pool's index range
PD	keep	worker-pool-controls.test.ts	worker-pool-controls.test.ts	the panel's copy of the pool contract is pinned to the kernel's reads an index back only from a canonical, unpadded identity
PD	keep	worker-pool-controls.test.ts	worker-pool-controls.test.ts	the pool roster is folded from served facts only gives a declared index with no served lease an unmet slot, and never a reason nobody served
PD	keep	worker-pool-controls.test.ts	worker-pool-controls.test.ts	the pool roster is folded from served facts only keeps a retained terminal card on its declared index as a visibly unmet member (D271)
PD	keep	worker-pool-controls.test.ts	worker-pool-controls.test.ts	the pool roster is folded from served facts only reads a workflow with no pool row as no declaration at basis 0, never as one worker
PD	keep	worker-pool-controls.test.ts	worker-pool-controls.test.ts	the pool roster is folded from served facts only keeps a worker id the pool contract cannot address out of the indexed roster
AS	keep	worker-pool-controls.test.ts	worker-pool-controls.test.ts	a plan names the exact members it will stop refuses a count outside D271's range without composing anything
AS	keep	worker-pool-controls.test.ts	worker-pool-controls.test.ts	a plan names the exact members it will stop refuses a plan that changes nothing
AS	keep	worker-pool-controls.test.ts	worker-pool-controls.test.ts	a plan names the exact members it will stop names indices N+1..MAX as the excess set, exactly as the kernel reconciles them
AS	keep	worker-pool-controls.test.ts	worker-pool-controls.test.ts	a plan names the exact members it will stop calls a first plan over a running CLI worker a scale-down, because it stops one
AS	keep	worker-pool-controls.test.ts	worker-pool-controls.test.ts	a plan names the exact members it will stop stops nothing when the count rises: there is no index above it
SP	keep	worker-pool-controls.test.ts	worker-pool-controls.test.ts	the controls post the arms the wire declares plans against the POOL version the view was drawn from
SP	keep	worker-pool-controls.test.ts	worker-pool-controls.test.ts	the controls post the arms the wire declares plans a first pool against basis 0 — the honest basis, not a guess
SP	keep	worker-pool-controls.test.ts	worker-pool-controls.test.ts	the controls post the arms the wire declares spawns the EXACT member the operator pressed, against the pool version
SP	keep	worker-pool-controls.test.ts	worker-pool-controls.test.ts	the controls post the arms the wire declares stops a worker against its LEASE version, which is a different basis
PD	keep	worker-pool-controls.test.ts	worker-pool-controls.test.ts	an unmet member states the ABSENCE, and never a cause nobody served says only that no lease is served for the index
SP	keep	worker-pool-controls.test.ts	worker-pool-controls.test.ts	an unmet member states the ABSENCE, and never a cause nobody served never names a cause the wire does not carry
VL	keep	worker-pool-controls.test.ts	worker-pool-controls.test.ts	an unmet member states the ABSENCE, and never a cause nobody served prints the worker id the spawn addresses, unclipped
PD	keep	worker-pool-controls.test.ts	worker-pool-controls.test.ts	an unmet member states the ABSENCE, and never a cause nobody served repeats a retained member's RECORDED reason beside its replacement spawn (D271)
SP	keep	worker-pool-controls.test.ts	worker-pool-controls.test.ts	both refusal arms are drawn, verbatim draws a CAS conflict with the live pool version and no retry
PD	keep	worker-pool-controls.test.ts	worker-pool-controls.test.ts	both refusal arms are drawn, verbatim draws a kernel rejection with its own code
SP	keep	worker-pool-controls.test.ts	worker-pool-controls.test.ts	both refusal arms are drawn, verbatim never claims a thrown post recorded nothing — the envelope was already on the wire
PD	keep	workflow-grouping.test.ts	workflow-grouping.test.ts	groupWorkflowsByCategory — the category half orders listed categories by the frontend's display order, whatever order they were served in
PD	keep	workflow-grouping.test.ts	workflow-grouping.test.ts	groupWorkflowsByCategory — the category half appends an unlisted category after the listed ones, headed by its raw id
AS	keep	workflow-grouping.test.ts	workflow-grouping.test.ts	groupWorkflowsByCategory — the category half drops a category nothing is registered under rather than heading an empty list
PD	keep	workflow-grouping.test.ts	workflow-grouping.test.ts	groupWorkflowsByCategory — the membership half (D219) nests a harness under its composition instead of listing it as a peer
PD	keep	workflow-grouping.test.ts	workflow-grouping.test.ts	groupWorkflowsByCategory — the membership half (D219) marks a nested harness with the composition's own served label
PD	keep	workflow-grouping.test.ts	workflow-grouping.test.ts	groupWorkflowsByCategory — the membership half (D219) gives a standalone and a composition entry no harness marking and no members
PD	keep	workflow-grouping.test.ts	workflow-grouping.test.ts	groupWorkflowsByCategory — the membership half (D219) nests one level only — a member never carries members of its own
PD	keep	workflow-grouping.test.ts	workflow-grouping.test.ts	groupWorkflowsByCategory — the membership half (D219) places all five real separations harnesses under Separations, including the cross-category Kronos step
PD	keep	workflow-grouping.test.ts	workflow-grouping.test.ts	groupWorkflowsByCategory — the orphan rule keeps a harness whose composition is not in the list at all — marked, named by its id
VL	keep	workflow-grouping.test.ts	workflow-grouping.test.ts	groupWorkflowsByCategory — the orphan rule takes the orphan arm when the named target is not a composition
PD	keep	workflow-grouping.test.ts	workflow-grouping.test.ts	groupWorkflowsByCategory — ordering stability leaves the top-level order untouched when a harness is lifted out of it
PD	keep	workflow-grouping.test.ts	workflow-grouping.test.ts	groupWorkflowsByCategory — ordering stability orders members by first-seen, independently of where they sat in the served list
PD	keep	workflow-grouping.test.ts	workflow-grouping.test.ts	groupWorkflowsByCategory — ordering stability is a pure function of its input — the same list twice is the same answer
```
