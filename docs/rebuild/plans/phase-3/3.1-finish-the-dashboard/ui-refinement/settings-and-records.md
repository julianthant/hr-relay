# UI-A: Settings and records

Status: **execution authorized; candidate not accepted**. Task **3.1.23.1** (UI-A).
The operator waived the 3.1.23 release prerequisite for this execution on 2026-09-23 and approved
[bounded execution assignments](#execution-allocation). Astra high owns design decisions and
acceptance; Luna xhigh assignments own implementation and focused repairs.
Read the [shared brief](README.md), particularly the frozen base, design rules, file allowlists,
gate cadence and finalization conditions. This plan never waits for UI-B's implementation.

## Approved Settings design-system implementation — 2026-09-26

The operator approved the revision-3 Settings designs in this session and explicitly authorized
implementation, with one final correction: the Add key button needs normal horizontal padding.
This amendment supersedes the earlier Settings-only freezes on shared primitives, settings section
membership, provider editing, and runtime-path editing for this assigned change. It does not reopen
Archive, Activity, Sessions, Calendar, or unrelated workflow behavior. Settings begins the common UI
update; future pages will reuse the same primitives.

- Candidate checkout: `/Users/julianhein/.codex/worktrees/9d88/hr-automation-rebuild`.
- Dedicated branch: `codex/settings-design-system`; accepted input: `8cdf38b2a` (master including
  System hosts retirement). This chat owns the checkout; sequential category workers reuse it.
- Visual authority and implementation brief:
  `/Users/julianhein/Projects/hr-automation-rebuild-evidence/settings-global-design-2026-09-26/prototypes/tabs/`.
  Read `ui-kit-replacement-brief.md`, `revision-2-brief.md`, current HTML, and current screenshots.
  The latest user direction and this amendment override superseded prototype caveats.
- Body density is 90% of revision 2: 828px maximum width, 27px title, 13.5px labels, approximately
  32.4px controls and 62.5px two-line rows. Sidebar stays 288px and keeps its approved typography.
  No CSS zoom/transform. Both themes and 1024px desktop/zoom access remain required.
- Consolidate to 11 tabs: General (Display and single Job end date included), Performance, Paths
  (editable runtime locations included), Routes, Provider budgets & models, Credentials (provider
  keys included), Storage checks, Preflight, Workflow capabilities, Keyboard, UI catalog. Remove
  Observed host; preserve retired System hosts. Remove annual-year management and Kronos-period UI,
  not historical stored data. Navigation durations use fixed seconds with correct stored-unit mapping.
- Replace old DS primitives/specimens through the existing `ds/ui.tsx` barrel and real `kit-page.tsx`;
  do not fork a Settings-only kit. Shared forms, rows, grouped surfaces, search, disclosures, secret
  fields, ranked lists and confirmations use existing HeroUI/shadcn foundations. Retire superseded
  local styles after their consumers migrate. Keep unrelated page layouts stable during this phase.
- Credentials/provider keys are masked by default with individual eye and trash controls. Provider
  groups follow selected concept B from referenced chat `01a0db65-9bcc-7f13-98fb-0fef9bb34de3`:
  editable keys, autosave, Add key, and centered icon-free removal confirmation. Preserve false/unknown
  save states and saved-versus-active restart semantics. Use supported authenticated BFF contracts;
  never edit real credentials or move live state during verification.
- Paths editing must preserve runtime isolation and coupled settings/database authority. Resolve
  persistence/activation against current boot authority before implementation; an unsafe direct path
  rewrite is not an acceptable shortcut. Record consequential contract changes at their owner and
  decision index in the same logical commit.

### Current Settings amendments — 2026-09-26

- All editable Settings fields autosave. The Routes explicit Save control is obsolete; the next
  Settings consumer task owns its removal and the matching dirty-exit behavior. This shared-kit
  repair does not change Settings consumers.
- The current General and Paths Category 2 renderings are partial and rejected visually. Their
  existing implementation and captures are evidence of the partial candidate, not acceptance.
- The operator waived all zoom tests for this Settings design-system work. Verify normal 100%
  desktop viewports, including 1024×720, in both themes. Do not claim waived zoom proof passed.
- The shared-kit repair owns body-scale primitives and the real kit specimen only. General,
  Paths and Routes consumer layout repair, plus DateInput, remain with the following task.

### Shared kit implementation and correction record — 2026-09-26

The first shared-kit commit, `7409de3ca`, added the compact body fields, control widths,
section/disclosure composition and Switch fix. Focused body and architecture tests passed
17/17, body interaction tests passed 4/4, and typecheck, scoped ESLint, `web:build` and
`git diff --check` passed. The 100% dark/light kit captures at 1440×900 and 1024×720,
including checked/off/disabled Switch states and the open disclosure, are under
`/Users/julianhein/Projects/hr-automation-rebuild-evidence/settings-global-design-2026-09-26/category-1-logs/shared-kit-final/`.

The lower kit correction accompanying this record sets ResultRow values and evidence,
RankedList items, Checkbox and RadioGroup copy and controls, and recorded values to the
shared body scale. Radio options now place the control beside its copy; the two specimen
cards use natural heights. `PanelToolbar` has a reusable body variant. Focused tests pass
26/26 across body primitives/interactions, checkbox naming and specimen closure; typecheck,
scoped ESLint and `web:build` pass. Dark/light 100% captures at 1440×900 and 1024×720
are under
`/Users/julianhein/Projects/hr-automation-rebuild-evidence/settings-global-design-2026-09-26/category-1-logs/lower-kit-correction/`.
The dev kit reports 403 responses for IBM Plex Mono files outside Vite's allowed file
root; the production build passes. No Settings consumer layout or DateInput work is claimed.

### Category 2 Settings shell and ordinary forms — 2026-09-26

The operator approved Category 2 implementation in the existing candidate checkout after the shared
design-system commits `cf90206a9` and `ac6bb8ec7`. These commits own the accepted DS APIs, the 90%-scale
body tokens and contrast corrections; Category 2 consumes them through `ds/ui.tsx`. All eleven tabs
use the same 828px maximum body scope. General folds in Display and shows only the server Clock's
current-fiscal-year `jobEndDate`; Performance shows fixed seconds while preserving millisecond values;
Paths groups ordinary editable paths with runtime-path facts in their existing truthful
read-only state; Routes still has its now-obsolete explicit Save in that Category 2 commit; Credentials temporarily combines the existing
credential authority with read-only provider-key facts. Provider-key persistence, budget/model
internals and diagnostics remain with later categories. Existing 700ms ordinary autosave, separate
protected editing, revision/conflict/refusal/readback behavior and dirty-exit protection remain.

D350 records the authorized date/schema compatibility boundary: optional live Kronos dates, required
job end date, no authority-version bump or historical record rewrite, and strict pinned v2 backup
compatibility for the pre-change hash. It does not authorize editing or relocating state/artifact
roots in Category 2; their separately approved offline relocation remains with later runtime-path
work. Category 2 owns the D350 amendment here and in `clock-config-secrets.md` plus
`reference/decisions.md` in the same logical change.

The Category 2 execution worker owns its shell/general/display/job-date/performance/routes proof,
focused tests, scoped lint and affected static checks. It does not run full parity or full-repository
gates under the Phase 3.1 cadence. Root owns candidate acceptance and combined verification.

### Category 2 execution record — 2026-09-26

The candidate commit is `5d2f606ab0a6f325332c5577616e344dbea51af7`, based on `ac6bb8ec7` on
`codex/settings-design-system` in
`/Users/julianhein/.codex/worktrees/9d88/hr-automation-rebuild`. The shell now has the eleven
canonical tabs and legacy aliases, with all page bodies using the shared 828px scope. The retained
render captures are `settings/general-dark-1440x900.png`, `settings/general-light-1024x768.png`,
`settings/performance-dark-1440x900.png`, `settings/paths-light-1024x768.png`, and
`settings/routes-dark-1440x900.png` under
`/Users/julianhein/Projects/hr-automation-rebuild-evidence/settings-global-design-2026-09-26/category-2/`.
Observed geometry: body scope is 828px at 1440px and fills 688px at 1024px after the 288px sidebar
and page gutters; horizontal form rows are 62.5px. The fixture build and visual check showed one
required Job End Date control and no other-fiscal-year or Kronos-date controls. Routes labels remain
connected to their generated input IDs. Dirty-exit keyboard/focus behavior is covered by the 17-test
takeover-focus run. The headless playwright-cli session did not provide browser-level zoom, so actual
desktop zoom remains unverified; the 1024px desktop viewport and keyboard behavior were checked.

Focused tests used the approved two-worker Vitest adapter and `npm run test -- --config <adapter>`.
`vitest-unit-11-final.log` passed 11 files / 201 tests; `settings-file-service-final.log` passed
50 tests; `bff-flow-final.log` passed 152. Additional regression runs passed 3 files / 44 tests
(`settings-existing-consumers-final.log`), 3 files / 47 tests
(`settings-nav-editor-backup-final.log`), 4 architecture files / 68 tests
(`architecture-focused-final.log`), and 17 focus tests (`takeover-focus-final.log`). These later
runs overlap earlier membership and are not additive counts. The earlier combined run with timeouts
is retained as failed diagnostic evidence; the 17-test focus file reproduced a worker exit at 10/17
before the focus restoration fix and passed after it. Scoped ESLint and `git diff --check` passed.
`web-build-final-2.log` passed with the existing >500 kB chunk warning. Typecheck still reports only
the shared-kit Category 1 errors in `src/dashboard/kit/kit-page.tsx` and
`tests/unit/dashboard/ds-body-primitives.test.ts`; those files are outside this category and remain
assigned to root. Exact logs and renders are retained in the evidence directory above. Full parity,
repository-wide gates and real desktop browser zoom were not run.

### General, Paths, and Routes fidelity checkpoint — 2026-09-26

Commit `0794a443ec5ceb0c4e0d6377dac0a6fb1ec48a54` replaces the rejected partial General and
Paths layouts with the approved revision-3 groups and copy. General shows the current fiscal year's
required job end date, operator name, three browser switches, and one coupled width/height viewport
row. Paths shows five served deployment locations as read-only facts, followed by four editable file
paths. Both pages use the shared body primitives, including a canonical calendar with retained raw
M/D/YYYY drafts. Routes uses the shared disclosure and the existing 700 ms valid-draft autosave;
the explicit Save button is gone. The exact retry, conflict, readback, and dirty-exit models remain
in use. The shared Switch thumb now stays inside its track in both themes. Performance is unchanged
in this checkpoint and still needs its approved revision-3 presentation alignment.

Real application captures at 100% for General, Paths, Routes, and diagnostic Performance in dark
and light themes at 1440×900 and 1024×720 are retained under
`/Users/julianhein/Projects/hr-automation-rebuild-evidence/settings-global-design-2026-09-26/category-2/fidelity/`.
The `interactions.mjs` fixture probe retained an invalid `6/` date draft after autosave delay, then
tabbed from the single named date textbox to its calendar and selected a date. The subsequent
`date-focus.mjs` probe confirmed its wrapper has a visible 2 px solid focus ring while the textbox
is focused, and Tab reaches the named calendar trigger. The Routes probe retained invalid `https://`
and operated the disclosure by keyboard; the focused unit test confirms that invalid draft causes
no save request. Runtime locations remain read-only
pending the separately owned verified relocation work. All zoom tests were waived by the operator.

Retained gate logs, all passing: [84 focused dashboard tests](/Users/julianhein/Projects/hr-automation-rebuild-evidence/settings-global-design-2026-09-26/category-2/fidelity/logs/vitest-focused.log),
[17 architecture tests](/Users/julianhein/Projects/hr-automation-rebuild-evidence/settings-global-design-2026-09-26/category-2/fidelity/logs/architecture-focused.log),
[2 theme Switch geometry parity tests](/Users/julianhein/Projects/hr-automation-rebuild-evidence/settings-global-design-2026-09-26/category-2/fidelity/logs/switch-parity.log),
[scoped ESLint](/Users/julianhein/Projects/hr-automation-rebuild-evidence/settings-global-design-2026-09-26/category-2/fidelity/logs/eslint-scoped.log),
[typecheck](/Users/julianhein/Projects/hr-automation-rebuild-evidence/settings-global-design-2026-09-26/category-2/fidelity/logs/typecheck.log),
[web build](/Users/julianhein/Projects/hr-automation-rebuild-evidence/settings-global-design-2026-09-26/category-2/fidelity/logs/web-build.log), and
[date keyboard focus](/Users/julianhein/Projects/hr-automation-rebuild-evidence/settings-global-design-2026-09-26/category-2/fidelity/logs/date-focus.log).
The build retains its existing >500 kB chunk warning. `git diff --check` passed; full repository
gates and broad parity remain deferred under the Phase 3.1 cadence.

### Performance fidelity checkpoint — 2026-09-26

Commit `0b598bbb21a359e75bd1de4c50e09f9c28221c91` replaces Performance's generic open
groups with the approved Navigation, Work, and Sign-in & Duo body sections, followed by one
Additional limits surface containing four initially collapsed shared disclosures: Worker scheduling,
Retry & termination, OCR processing, and Browser recovery. The current served projection has 28
leaves, all represented once. Eight additional millisecond durations now display fixed seconds and
convert exactly back to stored integers; malformed and sub-millisecond drafts remain invalid. Saved
custom values keep Restore standard and Undo edit inside the same row. Retained draft errors reopen
their additional disclosure on remount. The shared body disclosure places its chevron at the right;
the settled open state rotates it downward.

The operator's later amendment removed setting-count labels from all Performance section headings
and disclosure headers. No count API was added to `BodySection`; Routes and other existing counts
are unchanged. General, Paths, Routes, providers, Credentials, runtime authority, and the sidebar
were not changed by this Performance composition except for the shared disclosure chevron rule.

Final [dark/light captures at 1440×900 and 1024×720, including closed and open Additional limits](/Users/julianhein/Projects/hr-automation-rebuild-evidence/settings-global-design-2026-09-26/category-2/performance-fidelity/)
use the fixture application at 100%. Browser interaction evidence in that directory confirms a
62.5 px row and 147.6 px unit field for both default and saved-custom values; a keyboard-opened
disclosure; `900` and `120` second conversions; retained invalid `0.0001` with no command POST;
Undo edit; and an accessible saved-custom Restore standard action. The browser's settled chevron
probe reported CSS order 3 and 90-degree rotation when open. Synthetic Settings controller tests
verify Restore standard then Undo edit without a write. A discarded probe clicked Restore standard
against the read-only fixture BFF, whose missing command POST returned an unconfirmed state; it
made no real settings write. The earlier date-focus console count was a fixture favicon 404; older
5190 event-stream errors in that long-lived browser session came from a stopped prior fixture.

Retained focused gates: [49 dashboard tests](/Users/julianhein/Projects/hr-automation-rebuild-evidence/settings-global-design-2026-09-26/category-2/performance-fidelity/vitest-focused.log),
[17 architecture tests](/Users/julianhein/Projects/hr-automation-rebuild-evidence/settings-global-design-2026-09-26/category-2/performance-fidelity/architecture-focused.log),
[scoped ESLint](/Users/julianhein/Projects/hr-automation-rebuild-evidence/settings-global-design-2026-09-26/category-2/performance-fidelity/eslint-scoped.log),
[typecheck](/Users/julianhein/Projects/hr-automation-rebuild-evidence/settings-global-design-2026-09-26/category-2/performance-fidelity/typecheck.log),
[web build](/Users/julianhein/Projects/hr-automation-rebuild-evidence/settings-global-design-2026-09-26/category-2/performance-fidelity/web-build.log), and
[diff check](/Users/julianhein/Projects/hr-automation-rebuild-evidence/settings-global-design-2026-09-26/category-2/performance-fidelity/diff-check.log) all passed. The build retains the
existing >500 kB chunk warning. Broad parity, repository-wide gates, and zoom tests were not run
under the Phase 3.1 cadence and operator zoom waiver.

### Category assignments and gates

Root owns design, behavior decisions, acceptance, and combined verification. Native Sol medium
workers own longer iterative implementation with retained feedback context; fresh Luna max workers
handle bounded short tasks. No nested dispatch or independent review in Phase 3.1.
Writers run sequentially in this owned checkout; read-only investigation may overlap a disjoint writer.

1. Shared DS primitives and real UI kit, including the Add key padding correction.
2. Settings shell, General/Paths/Routes/Performance and section consolidation.
3. Credential/provider persistence and UI, including activation and deletion behavior.
4. Provider budgets/model ranking.
5. Diagnostics/reference tabs, cohesive cleanup and final focused render/interaction proof.

Each category stops with focused tests, scoped ESLint, diff checks, a logical commit, and retained
before/after evidence. Root inspects actual diffs and results before releasing dependent work.
Match tests to behavior, preserve assertions/membership/timeouts, and deliberately attribute changed
visual references. Run affected architecture/static checks and combined typecheck as appropriate.
Full repository coverage/lint/broad parity remain at 3.1.19 under the phase cadence; no claim they
passed is permitted here. Shared-primitives changes require representative consumer inspection and
focused kit proof now, with broad obligations recorded. Use playwright-cli for browser operation.

Integration owner is the user. Completion here produces an accepted local candidate; no merge,
push, new worktree, automatic next-task launch, or cleanup of peers is authorized.

### Category 3 provider-key persistence — 2026-09-26

D351 owns the private `.env.providers` writer and recovery protocol for the approved editable
Credentials provider keys. The first Category 3 outcome is the bounded private file store and
synthetic-file proof in `src/infra/config/provider-key-store.ts` and
`tests/unit/config/provider-key-store.test.ts`. The second bounded outcome wires the admitted
`settings/apply-provider-keys` command, marked journal/audit verifier, exact pending retry,
same-descriptor boot provenance, and saved/active/recovery GET. The third bounded outcome adds
the Credentials editor with masked protected and provider rows, stable sparse provider slots,
source-aware removal, valid-only autosave, exact retry, and a dirty-exit guard. It also adds the
reusable 288px medium control column and an outlined destructive icon control to the design
system and kit. Provider tests use synthetic temporary files only; browser captures use a
synthetic fixture.

The Credentials UI outcome passed 55 focused dashboard tests and 13 affected architecture
tests, scoped ESLint, typecheck, web build, and roadmap freshness. Playwright-cli captures
cover dark and light themes at 1440×900 and 1024×720: top, expanded provider rows, and
centered removal dialog. All four sizes had no horizontal overflow; Escape closed the dialog.
Evidence is retained under
`/Users/julianhein/Projects/hr-automation-rebuild-evidence/settings-global-design-2026-09-26/category-3/credentials-ui/`.

The operator authorized parallel implementation in owned worktrees from accepted backend
revision `897158ece`: this branch owns Credentials and shared control details, the models lane
owns provider budgets/model controls, and the diagnostics lane owns Storage, Preflight,
capabilities, Keyboard and UI catalog. Those categories have disjoint writes and evidence;
the root accepts and assembles their commits into this task branch after each writer stops.
Primary-checkout integration and push remain outside this assignment.

The Models lane was accepted at `1ffe0ba` with the `e8b04f7` rename correction;
Diagnostics was accepted at `166b926` and assembled as `9d7542fae`. Both are present in
the Settings candidate at `f63624c67`. The combined outcome adds an editable RankedList
kit specimen beside the existing ranked example and scopes the Credentials Add key footer
CSS to its page so the Models Add model control keeps its normal button layout. The
assembled provider, ranked-model, editor, catalog, protected, and shared body tests pass
(78 tests across seven files), as do ten affected architecture tests, scoped ESLint,
typecheck, web build, and roadmap freshness. Synthetic
Playwright-cli captures cover the kit and assembled Models in dark/light at 1440×900 and
1024×720; the Add key control was rechecked after the CSS scope change. Evidence is under
`/Users/julianhein/Projects/hr-automation-rebuild-evidence/settings-global-design-2026-09-26/category-assembly/kit-combined/`.
The setup/preflight parity inputs were unchanged by this kit and scoped CSS outcome; the
accepted Diagnostics lane retains its separate 25-case parity proof. Runtime relocation
remains pending; its separate lane is working on a control-locator and lease foundation.
The three reference tabs are recorded separately below.

### Reference tabs and runtime-path allocation — 2026-09-26

The reference-tab category uses the shared body primitives for Workflow capabilities, Keyboard,
and UI catalog. Capabilities preserves all six served facts and each workflow's dry-run boundary;
Keyboard derives its three groups from the existing shortcut registry. The catalog preserves
route-owned search/view, screen nesting, stable selection, and the complete selected record.
The approved label-led rail amendment is recorded together in D303, operator-trust §5.8, and
dashboard-surfaces §9.5.3. Catalog refusal states remain fail-loud.

The initial candidate `a2eac3438` passed 63 focused unit tests, 17 affected architecture tests,
typecheck, scoped lint, build, one capabilities parity assertion, one catalog interaction case,
and two stale/malformed catalog refusal cases. Only the capabilities reference triple changed.
Root inspection found that inter-row spacing applied only to the last screen group. The accepted
correction `ef9394b0e` gives every screen wrapper a shared gap, verified at 5.39px in dark 1440×900
and light 1024×720 selected/hover captures. Its focused interaction assertion and build pass;
`5997b7be7` removes an unnecessary test assertion, after which scoped lint passes. These source
commits and this contract amendment are assembled into the Settings task
branch together. Ten of eleven Settings tabs are complete; Paths still requires its backend work.
No zoom tests ran. Evidence is retained under
`/Users/julianhein/Projects/hr-automation-rebuild-evidence/settings-global-design-2026-09-26/category-5/reference-tabs/`.

Runtime-path work is split into independent outcomes. The ordinary-path category owns editable
browser-profile, Duo credential, and Duo extension locations with the existing Settings CAS,
readback, and new-run activation. These paths remain independent: changing the profile does not
implicitly rebase the Duo credential. Changed paths require validation before activation; a fresh
profile is not populated by copying the old profile. Existing runs retain their immutable snapshots.
State/database and artifact locations remain with the verified offline relocation category.
Neither category may move real data or modify real credentials during verification.

The ordinary-path outcome `e27fba469` is accepted: the three runtime fields use the shared compact
editors and ordinary autosave, with changed-target validation before activation and immutable old
run snapshots. D353 owns the authority amendment. Focused tests pass 164/164 including catalog
architecture; the final v55 backup suite passes 41/41 with the prior schema hash, unchanged
command fingerprint, and `restartRequired: false`. No historical backup reader was changed.
Scoped lint, typecheck, build, manifest, stores, and roadmap freshness pass. Dark/light 1440×900
and 1024×720 captures show three editable fields without horizontal overflow; state/artifact
fields remain read-only pending D352. Evidence is under `category-6/ordinary-paths/` in the
existing Settings evidence directory. No zoom tests ran.

### Runtime relocation foundation and intent — 2026-09-26

The uncalled installation-control foundation (`9ab7f8a95` through `b6f6c8827`) and deferred
PLAN/CANCEL producer (`605c10236`) are accepted as bounded backend outcomes. The foundation has
12 passing focused tests covering private control files, competing processes, crash refusal,
retained-source witnesses, and immutable locator snapshots. The producer has seven passing
focused tests covering revision CAS, exact retry/cancel, unsafe overlap, divergent identities,
and missing/multiple/mismatched audit history. Command-path architecture passes 9/9 and wire
connectivity passes 51/51; typecheck, lint, manifest freshness, and store catalog freshness pass.
The strict-boundary guard retains four verified unchanged baseline source findings; it did not
pass and no new relocation boundary finding was introduced. Evidence and exact process exits are
under `category-6/runtime-relocation/producer/` in the existing Settings evidence directory.

D352 records the single locator authority and v55 intent/v56 activation boundary. The next
outcome must hold admission across the complete CLI lifetime before secrets or storage opens,
including previously detached asynchronous composition branches. Actual relocation, verified
backup and destination checks, source tombstones, receipt-aware historical projection, and the
editable desired-root UI remain pending. No production runtime uses the foundation yet, and no
real paths, state, artifacts, or credentials were changed by these checks.

## Outcome and scope
<!-- roadmap: dash-ui-settings-records -->

Settings feels like an organized control panel, with clear labels and consistent value editors.
Archive and Activity read as professional records views. Help remains available when requested.
Dialog layouts, buttons and feedback within these surfaces follow the same quiet visual language.

**Operator amendment, 2026-09-19:** also improve the expanded Session panel and its worker/browser
rows, grouping, pool controls and dialogs, plus the Calendar picker. Preserve the collapsed session
bar, date toolbar control, queue panel and default dashboard design. These panels are implementation
scope, not finalizer-only inspections.

Own all Settings subsections: General, Display, Performance, Paths, Test routes, Annual dates,
Provider budgets/models, Credentials, Provider availability, Observed host, Deployment, Storage
health, System hosts, Workflow capabilities, Keyboard and UI catalog. Include any applicable
served section added by accepted Setup work. Preserve server-driven membership and unavailable
states. Include Archive saved reports, filters, version changes, deletion, attachments/lightboxes,
and Activity search/export presentation. The shortcut legend and its presentation model belong
here because Settings imports them; shortcut bindings and keyboard behavior remain unchanged.

Own `preflight-popover.tsx` with Settings preflight presentation; keep its closed trigger frozen.
The shared `preflight-popover-model.ts`, `archive-model.ts` and `row-catalog-model.ts` stay frozen.
No notification, Explorer, Run/Rerun or Intake edits. Their workers' dialogs do not belong here.
No shared tokens/primitives, transport, authority, route or validation-schema changes. Do not add
settings, convert stored units, restore retired Archive behavior or expose protected values.

## Start and ownership

- Accepted feature input: `beb2a79b6bd699afb3701ee8aeb3ec3bfe011a1a`; initial branch/plan
  commit: `fac236fbc2c27192c31fdfbca3e2a5512d870800`, with unchanged product code between them.
  The 3.1.23 release is waived for UI-A, not completed. Retain its unperformed shared repairs and
  proof as explicit obligations; this exception does not release UI-B or change finalizer gates.
- Existing branch: `codex/3.1-ui-settings-records`.
- Owned checkout: `/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-ui-settings`.
- Exact source/test/reference ownership: the closed UI-A paths in [ownership.json](ownership.json). New helpers/tests use
  `ui-settings-records-` prefixes. This file alone receives UI-A progress and candidate evidence.
- Target: operator-controlled finalization branch, then `master`; either worker merge order works.
- Lead: `/ui` Design, refinement within the existing system; Content support.
- Execution: `/sol-orchestrator` with `/luna-worker`; Astra high is the explicit root-model override
  for this task. New native workers use `luna_worker_xhigh`, standard speed, with no nested dispatch.
  The root accepts completed outcomes and the combined candidate. Phase 3.1 requires no independent reviewer.

## Execution allocation

UI-A permits multiple bounded assignments; the whole manifest is not one automatic worker brief.
Preserve current edits, receipts and settled decisions. Verify the existing writer before resuming it;
checkpoint and stop it before transferring its paths. Reuse a session while its context remains useful.

| Outcome | Included work | Acceptance emphasis |
| --- | --- | --- |
| Settings | A2–A3, all subsections and their help/catalog/dialogs | Control hierarchy; draft/save/clear/conflict behavior and rendered comparison. |
| Records | A4 Archive and Activity, including confirmations/viewers | Scannable records; selection/export/delete consequences and rendered comparison. |
| Sessions and Calendar | A4b–A4c | Expanded/open hierarchy; keyboard/focus, unavailable states, real zoom and unchanged collapsed controls. |

Apply A1 inventory and A5 consistency checks to each outcome; retain all manifest entries and proof.
Adapt order to verified progress. Reuse attributable baseline evidence when inputs are unchanged;
capture missing required states before editing that surface, then implement. Do not restart the whole
inventory or expand baseline work beyond assigned proof.

Before dispatch, the root settles consequential layout, grouping and copy direction using existing
tokens and inspected examples. Give the worker that concise direction, owned paths and deciding checks.
The worker handles discovery, implementation, focused tests/lint and routine repairs for its outcome.
The root inspects completed patches, critical behavior and before/after renders, then batches corrections.
Intervene earlier for material scope, contract or verification violations; report only new evidence,
accepted outcomes, blockers and decisions. Do not direct every small edit or repeat unchanged status.

Sequence coupled writes. Parallel assignments require stable inputs, disjoint source/test/evidence
ownership, independent acceptance, isolated worktrees/resources and available capacity. Record exact
bindings and an authorized integration/cleanup owner before dispatch; this allocation grants no new
merge permission. Read-only parallel work must answer a concrete independent question. Complete the
combined focused acceptance before finalizer intake; additional agents and independent review are not gates.

## Implementation sequence

| Unit | Necessary change | Observable result and proof |
| --- | --- | --- |
| A1: Inventory and layout | Capture each reachable section's resting, edited and exceptional states. Trace current mounts, especially `SavedArchiveWorkspace` in `archive-report.tsx`. List every embedded confirmation/viewer. | Before captures tied to the common base, source paths and an exhaustive section/dialog checklist. Do not spend the pass polishing unused legacy Archive markup. |
| A2: Settings controls | Compose existing fields into consistent groups with aligned label/control/unit placement. Give structured provider/route fields readable presentation labels in an owned pure helper while preserving served key identity and units. Keep model chains, coupled display dimensions and fiscal-year groups intact. | Boolean/scalar/object/list/date/credential cases work. Default/saved/dirty/invalid/read-only states are distinguishable without repetitive classification prose. |
| A3: Settings detail and feedback | Remove implementation subtitles and generic teaching. Consolidate identical value readbacks; expose full provenance through accessible details. Keep active-versus-saved differences and activation consequences visible. Align Save/Discard and per-field Reset/Clear; give dirty-exit confirmation the common dialog anatomy. Apply the same hierarchy to storage, preflight and read-only sections. | Controls remain reachable at 1024×720 and real zoom. Errors, conflicts, retained drafts, failed/unconfirmed saves and required recovery remain visible. No false “saved” state or blanket restart instruction. |
| A4: Records views | Recompose Archive filters, list/detail selection, report header, facts, logs, evidence and version-change review using existing panels, table and typography primitives. Give Activity the same toolbar/filter/result hierarchy. Separate destructive actions from reading/exporting. | Reports are scannable without raw metadata dominating. Long IDs and missing/corrupt attachments remain usable. Delete consequences remain explicit before confirmation; export and exact report selection are preserved. |
| A4b: Expanded Sessions | Improve worker/browser row hierarchy, grouping, concise state/reason presentation, control alignment and pool dialogs using existing primitives. Keep current command admission, errors and lifecycle semantics. | Busy/idle/unavailable/failed workers and unmet pool members remain distinguishable. Controls and confirmations are reachable by keyboard and at zoom. The collapsed bar and queue render unchanged. |
| A4c: Calendar | Refine the open picker header, month controls, day grid, date/count hierarchy and selected/today/disabled states. Keep the existing trigger and shared date model/state unchanged. | Month/year boundaries, keyboard movement, today/selected distinction, server availability, loading/refusal and Escape/focus return remain correct. The picker fits narrow desktop and zoom without covering its own controls. |
| A5: Complete the family | Apply consistent button variants, gaps, footer placement and short labels across every owned subsection/dialog, including help/catalog. Compare both themes and fix remaining defects. | Completed checklist with before/after proof; each item implemented, explicitly inspected with no change, or blocked with a named owner. No unexplained deferrals. |

Keep domain meaning intact. An unchanged backend does not by itself prove unchanged interaction:
exercise dirty exit, exact retry, conflict and destructive cancellation after any layout change.
Settings diagnostics must never display a credential value or its digest. A details disclosure must
not become a way to conceal an unavailable/unsafe authority state.

## Focused acceptance

Expanded Sessions has its own before/after evidence in both themes. Exercise expand/collapse,
pool selection, the existing add/stop/restart/close controls actually served by the accepted base,
busy/refused/unknown results and focus return. No lifecycle behavior or command availability is
invented. Capture the owned panel region; combined screenshots belong to finalization.
Calendar also needs both-theme before/after evidence, unchanged closed-toolbar geometry, long
month labels, counts, unavailable dates and keyboard navigation. Existing `session-panel-model.ts`
and `date-navigation-model.ts` remain frozen; `settings-model.ts` is also shared with Run launch
and stays frozen, together with the shared Settings state models listed in the overview.
Use only owned presentation helpers as needed.

1. Every applicable Settings section and value type is accounted for. No blanket generic JSON
   editor replaces structured controls. Friendly labels agree with accessible names.
2. Persisted Clear, draft Reset and Discard stay distinct. Clearing coupled values, entering an
   invalid/empty number, saving a value equal to its default and rejecting a partial record retain
   current behavior. Conflicts retain draft and identify current state.
3. Current state leads; generic explanations are removed or available on demand. Critical source,
   activation and saved/active differences are readable without a hidden dependency on help.
4. Archive uses its frozen report and exact attachment authority. Missing, corrupt, unavailable,
   empty and deleted records are different states. No regeneration from a current descriptor.
5. Delete confirmation names the object, retained-file/evidence loss and any applicable duplicate-
   write consequence. Cancel changes nothing. Success appears only after verified settlement.
6. Filters, tables, actions and overlays have consistent hierarchy. The active selection is clear;
   overflow does not cover Save, Discard, Close or destructive confirmation controls.
7. Existing keyboard/dirty-navigation, protected-store privacy and focus behavior pass. All owned
   states work in both themes and the desktop/zoom matrix in the overview.

## Focused checks

These commands exist at the current inspection base; they are **planned**, not executed by planning.
The manifest also assigns `tests/unit/dashboard/setup-preflight.test.ts`, `preflight-client.test.ts`,
`session-controls.test.ts` and browser `setup-preflight.spec.ts`, `session-controls.spec.ts`.
Add these to the focused commands below. Run `setup-boundary.test.ts` read-only as the authority
regression. Session/runtime and preflight server fixtures stay frozen. Setup/doctor reference
triples belong to UI-A; the closed preflight trigger is preserved in both workers' scenes.

Additional Session proof: `npm run test -- tests/unit/dashboard/session-panel-pool-press.test.ts tests/unit/dashboard/worker-pool-controls.test.ts`
and `npm run test:parity -- pool-control-desktop-target.spec.ts --workers=2`. These paths are
assigned to UI-A in the manifest. Extend the owned interaction proof for the new layout and
preserve all existing assertions; scoped lint also covers the added Session source/test paths.
Calendar proof adds `npm run test -- tests/unit/dashboard/date-navigation-control.test.ts` and
`npm run test:parity -- date-navigation.spec.ts --workers=2`; retain model/state tests as read-only
regressions when useful. `date-navigation-server.ts` stays shared and frozen.
Use the shared brief’s verified two-worker Vitest adapter: add `--config <absolute-owned-adapter>`
after `--` in unit commands below. At launch, verify the current manifest and retain all assigned Setup and Session checks.

```sh
npm run test -- tests/unit/dashboard/settings-editor-surface.test.ts tests/unit/dashboard/settings-catalog-surface.test.ts tests/unit/dashboard/settings-protected-surface.test.ts tests/unit/dashboard/settings-takeover.test.ts tests/unit/dashboard/settings-status-sections.test.ts tests/unit/dashboard/settings-storage-doctor.test.ts tests/unit/dashboard/activity-render.test.ts tests/unit/dashboard/archive-delete-door.test.ts
npm run test:parity -- reference-settings.spec.ts settings-catalog.spec.ts settings-activation.spec.ts reference-storage.spec.ts storage-recovery.spec.ts archive-report.spec.ts archive-authority.spec.ts archive-accessibility.spec.ts archive-evidence.spec.ts reference-archive.spec.ts reference-activity.spec.ts --workers=2
```

`archive-render.test.ts` and `archive-detail-render.test.ts` exercise the frozen older Archive;
they are not acceptance for the mounted saved-report workspace. Add an owned
`tests/unit/dashboard/ui-settings-records-archive.test.ts` for changed saved-report layout,
attachment failures and delete/cancel reachability, alongside the listed current browser proof.

Add meaningful interaction assertions for the changed grouping/disclosure/scrolling behavior in
the owned test files; do not test incidental prose verbatim. Run scoped ESLint with
`--max-warnings 0` over the exact changed source and test paths. Resolve the list from the owned
diff, not a whole-directory lint that includes the other assignment. Run `git diff --check`.

Attribute deliberate owned reference changes, update only the UI-A scene prefixes, inspect
screenshot/a11y pairs and rerun the listed assert-mode tests. No global `test:parity:update`.
Shared fixture, registry or primitive needs stop the affected unit for prerequisite reassignment;
the independent parts can continue. Browser operation follows playwright-cli and the repository
parity lane; no new dependencies or alternative browser tooling.

Full coverage, whole-repository lint/architecture and broad parity remain at 3.1.19. The group
finalizer runs typecheck and focused combined checks. No independent review is required by the
Phase 3.1 exception. This does not waive any assigned focused failure.

## Release record to fill during implementation

Record: approved plan commit; accepted base; exact branch/worktree; source and test diff; completed
surface/dialog checklist; before/after paths; candidate commits; exact gate commands/results;
deliberate reference attribution; privacy/keyboard/zoom evidence; deferred broad proof and any
blocker. End with a committed candidate ready for finalizer intake. Do not update the shared phase,
roadmap, generated index or UI-B record, integrate, push or launch another task.

### UI-A Settings checkpoint — 2026-09-23

Status: **Settings implementation and focused proof complete; checkpoint committed for root
acceptance.** UI-A Records and Sessions/Calendar work remains assigned separately. The exact
checkpoint revision is reported in the returning task message.

- Plan / input: approved planning commit `fac236fbc2c27192c31fdfbca3e2a5512d870800`; accepted
  product input `beb2a79b6bd699afb3701ee8aeb3ec3bfe011a1a`.
- Base / worktree: `4eb263c16909d7d866792cdde8ffd02361d6bcf3`; branch
  `codex/3.1-ui-settings-records`; `/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-ui-settings`.
- Scope: Settings authority, field, editor, host, keyboard, capability and storage presentation;
  `ui-settings-records-labels.ts`; the Settings unit/parity proof and Settings-owned references.
  The UI-A-only approval to skip 3.1.23 remains in force; its skipped shared repairs and proof are
  **not passed** and are not represented by this checkpoint.
- Explicit fixture authorization: the user authorized the narrow helper repairs in
  `tests/parity/helpers/fixture-settings-activation.ts` and `tests/parity/helpers/session-runtime.ts`.
  This checkpoint includes only the Settings-owned activation helper; `session-runtime.ts` stays
  with the Sessions/Calendar assignment. The changed Archive report file also stays with Records.
- Render checklist: both themes, at 1440×900, inspected for General, Display, Performance, Paths,
  Test routes, Annual dates, Provider budgets & models, Credentials, Provider availability,
  Observed host, Deployment, Storage health, System hosts, Workflow capabilities, Keyboard and UI
  catalog. Paths, Annual dates, Provider budgets & models, Credentials, Deployment and Storage
  health also have both-theme captures at 1280×720, 1024×768 and 1024×720. Actual browser zoom was
  verified at 125% from 1280×720 (CSS 1024×576) and 200% from 1440×900 (CSS 720×450), in both
  themes.
- Interaction checklist: grouped fields and accessible identity details; saved/active/default and
  absent-source facts; coupled Display width→height Tab order; dirty, reset, clear, discard, save,
  refusal, conflict and unknown outcomes; dirty-exit confirmation; masked credentials and presence
  details; storage doctor/recovery; preflight states. Settings preflight trigger and
  `Keep editing` / `Discard changes` remain unchanged. The desktop and real-zoom proof confirms
  the expanded identity disclosure and final input each scroll fully above the fixed Save/Discard
  footer.
- Focused gates: 13 unit files / 133 tests pass via the verified two-worker adapter; the assigned
  73-case parity assertion passes with `--workers=2`; scoped ESLint passes with `--max-warnings=0`;
  `git diff --check` passes. The parity gate includes both-theme inventory, source-value and
  activation interactions, Setup/preflight, storage doctor/recovery and the exact `catalog-search`
  scene. No broad repository gate or independent review was required here.
- Reference attribution: deliberate refreshes are limited to owned `settings`, `settings-activation`,
  `settings-catalog`, `storage-settings`, `storage-doctor-degraded`, `setup-preflight`, and exact
  `catalog-search` triples. The last one changes only because the existing catalog-search scene now
  captures the served preflight toolbar trigger; other Explorer scenes remain frozen. Final
  assertion evidence is in
  `/Users/julianhein/Projects/hr-automation-rebuild-evidence/ui-settings-records-2026-09-23/receipts/settings-parity-focused-final-2workers.log`.
- Before images: `.../screenshots/before/settings-inventory/`. Final images, attached accessibility
  trees and real-zoom proof (218 files) are in
  `/Users/julianhein/Projects/hr-automation-rebuild-evidence/ui-settings-records-2026-09-23/screenshots/after/settings-probe-output-checkpoint/`.
  Changed copy with stable review IDs is recorded in
  `/Users/julianhein/Projects/hr-automation-rebuild-evidence/ui-settings-records-2026-09-23/settings-copy-changes.md`.
- Retained check receipts: `settings-focused-unit-final.log`, `settings-eslint-final.log`, and
  `settings-parity-focused-final-2workers.log` under the evidence `receipts/` directory above.

### UI-A Records checkpoint — 2026-09-23

Status: **Records implementation and focused proof complete; candidate ready for root acceptance.**

- Plan / input: approved planning commit `fac236fbc2c27192c31fdfbca3e2a5512d870800`; accepted product input `beb2a79b6bd699afb3701ee8aeb3ec3bfe011a1a`.
- Base / source candidate: `e08007ebbddef47550c95c20a10493c4113d6e71` → `d745f6066356b091e1e3a2c4e00641403141b9b7`; branch `codex/3.1-ui-settings-records`; worktree `/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-ui-settings`. The candidate commit contains only Records source, tests and owned references. The task checkpoint is a separate docs-only commit.
- Scope: Activity report range and existing CSV/XLSX exports; Archive saved-report list/detail, filters, attachments, saved version form/history, and delete dialog. Frozen `archive.tsx`, `archive-model.ts`, APIs, authority rules, shell, toolbar and tokens remain unchanged. Activity search was not added.
- Behavior checklist: visible selected-report state and clear filters; active date-range summary; structured saved facts, neutral exact saved outcome labels and collapsed report identity; exact attachment selection with missing/unavailable/corrupt/read failures retained as distinct states; cancel/Escape/focus return and visible refusal/unknown deletion response inside the named dialog; no automatic retry or premature success; late deletion response does not replace the current selection; major/minor consequence copy, version state, target/scope, reviewed membership, blockers, archived runs and progress remain visible.
- Render checklist: both themes at 1440×900, 1280×720, 1024×768 and 1024×720 for Archive/Activity; delete dialog at 1024×720; Versions form and planned-change view at 1440×900. Real browser zoom used `chrome.tabs.setZoom`: 125% from 1280×720 (CSS 1024×576) and 200% from 1440×900 (CSS 720×450), both themes. At 200%, the 1024 CSS px desktop floor remains and tested content/actions are reachable by horizontal/vertical scroll.
- Focused gates: four assigned unit files pass, 40 tests; owned Archive/Activity parity passes, 57 tests with two workers; exact owned reference refresh assertion passes, 49 tests; final UI-A Records matrix and real-zoom capture pass, four tests across two themes; scoped ESLint with `--max-warnings 0` and `git diff --check` pass. Receipt files are under `/Users/julianhein/Projects/hr-automation-rebuild-evidence/ui-settings-records-2026-09-23/records/logs/`: `records-unit-final-pass-2.log`, `records-owned-parity-final-pass-2.log`, `records-parity-refresh-with-proof.log`, `records-final-capture-with-actions.log`, `records-eslint-final-after-actions.log`, and `records-final-diff-check.log`.
- Reference attribution: changed only owned triples in `activity-report`, `activity-report-unavailable`, `archive-evidence`, `archive-ledger`, `archive-report-saved`, `archive-report-zoom`, `archive-run`, and `archive-version-bump`. The exact Records refresh reflects current descriptor (`71b1674` → `67c72b`) and served preflight-trigger metadata drift in those owned triples; no frozen source was changed and no global refresh ran.
- Final screenshot/a11y captures: `/Users/julianhein/Projects/hr-automation-rebuild-evidence/ui-settings-records-2026-09-23/records/final/records-matrix-final/` and `records-zoom-final/`; capture attribution and source/artifact SHA-256 manifests are alongside them. Exact old/new copy with stable review IDs: `records/records-copy-changes.md`. Limits: `records/scope-limits.md`.
- The approved UI-A-only exception skips release UI-A 3.1.23. Its skipped repairs and proof are **not passed**; broader repository gates remain for the phase finalizer. Sessions/Calendar remains outside this checkpoint.

## Resume prompt

Resume the existing execution under its UI-A-only prerequisite exception. Verify actual current HEAD
and dirty state; do not reset the branch to its initial planning commit.

```text
Continue UI-A with Astra high as orchestrator and /luna-worker plus /ui.
Read this amended task owner and verify the existing branch, worker, edits and evidence.
Preserve my approval to skip the 3.1.23 release for UI-A; do not claim skipped checks passed.
Do not restart discovery or create a new root session.

Own consequential design choices and acceptance. Delegate bounded outcomes with tests and repairs:
Settings, records, then Sessions/Calendar, adapting order to verified progress. Multiple Luna xhigh
assignments are permitted. Reuse useful context; stop the previous writer before transferring paths.
Parallelize only proven independent ownership and proof within existing capacity and integration rules.

Inspect completed renders and critical behavior, batch corrections and report meaningful changes.
Preserve the closed manifest, frozen surfaces/APIs, tests and required focused unit/parity, lint,
both-theme and real-zoom proof. Reuse valid baseline evidence. No independent review under Phase 3.1.
Do not silently absorb shared prerequisite repairs or weaken checks.

Commit exact owned paths and this worker record. Return candidate/base/plan SHAs, checks, screenshot
attribution and deferred proof to finalizer 3.1.23.3. No merge, push, shared roadmap/manifest edits,
new roadmap task or nested worker dispatch.
```


### Paths relocation plan controls — 2026-09-26

Commit `1a267574c` adds the compact coupled state/artifact plan editor, strict read and command
adapters, 700 ms autosave, exact uncertain retry, cancellation, stale-read refusal, and dirty-exit
handling. The query returns an explicit unavailable response until the runtime reader is composed;
this commit does not enable the command kernel or perform relocation. The Paths form preserves the
approved body density and distinguishes active locations from a pending desired pair.

Focused checks passed 43/43, followed by current affected reruns of 10 relocation tests and 5
route/client tests. Scoped lint, typecheck, and web build passed. The earlier failed narrow run is
retained; the repaired rerun passed without changing its timeout. Dark/light captures at 1024 and
1440 pixels, including pending plans, are retained under `category-6/relocation-ui/` in the existing
evidence directory. Root inspected the model, actual logs, and rendered captures. A subsequent
bounded correction must also refuse a global plan revision rewind across a newer locator generation.

D352 now specifies preservation of the fixed `.tracker/locks` authority during default-state
relocation: retain managed entries separately, leave the lock shell, and tombstone the old database
under continuous restore and installation-exclusive admission. Locator v2 preserves separate root
marker epochs. Runtime admission and control/recovery remain separate parallel worker outcomes;
actual verified copying, v56 activation, receipt-aware history, and real composition remain pending.


### Relocation control and admitted-config prerequisites — 2026-09-26

The Paths correction `686bcccba` refuses a global plan revision rewind even when the locator
generation advances. Its focused suite passed 11/11 and scoped lint passed; the exact retry and
dirty-exit behavior are unchanged.

The pure resolver prerequisite `07c337e29` accepts an explicit canonical storage pair without
changing the ordinary settings document, revision, or earlier resolved snapshots. It recomputes
the active config fingerprint and retains complete provenance. Its 52 focused tests and scoped
lint passed; receipts are under `category-6/runtime-relocation/admitted-config/`. Real caller and
activation wiring remain pending.

The bounded control candidate `26e2f90d7` implements locator v2 marker epochs, exact plan/operation
binding, verified-stage evidence, fixed restore admission, retained source shells, tombstones,
and durable activation receipts. The first PLAN uses expected revision zero and applied revision
one; receipt bindings preserve both. Recovery covers partial entry moves, partial shell witnesses,
locator publication, receipt publication, and independent root moves, including later moves that
must preserve earlier receipt witnesses. Root inspected the implementation and deciding logs.
Its 25 synthetic protocol tests and scoped lint passed. Its separate branch typecheck failed on
396 consumers awaiting the concurrent admission migration, with no diagnostics in the two owned
files; integration must discharge that obligation. Evidence is under `category-6/relocation-control/`.
The typed stage verifier is an engine boundary, not proof that real copy, backup, config activation,
or CLI composition has been implemented.


### Runtime admission integration and receipt history — 2026-09-26

Runtime candidate `d33a970f3` was integrated into the owned Settings branch as `2b7301e1a`;
control protocol `26e2f90d7` was applied as `ae4491869`. Admission is mandatory at physical SQLite
openers and long-lived artifact/credential/provider boundaries, with awaited bootstrap/CLI
lifetimes and separate stopped, adoption-inspection, and verified-copy scopes. The deciding
category receipts are under `category-6/runtime-relocation/admission/`. Typecheck and scoped
lint passed. Focused backup/restore checks passed 81/81; credential/provider checks passed 44/44.
The old conversion-to-dashboard M25 case and five storage-status cases fail identically against
clean `f63624c67` and remain explicit baseline obligations, not passing gates.

The combined repair `05cf59d30` corrected test API shapes and a real fixture import-cycle regression.
The catalog passed 23/23 on pre-admission `56949dbeb`, failed after the broad helper import, and
passed after the harness used directly admitted leaf factories and accidental helper self-exports
were removed. Combined typecheck and lint passed, as did 93 focused tests across six suites and
52 config tests. Exact logs/exits are under `category-6/runtime-relocation/integration/`.

Receipt-aware history `de466ef06` was applied as `77c51b8c7`, and locator reread correction
`34a9cd39a` as `51a4284ed`. The reader now binds a genuine live admission, validates each command
against its original source epoch, consumes only an exact completed pending plan, and preserves
the global revision across later plans and cancels. Missing, corrupt, or changed locator state
refuses even after reader creation. Focused producer/control tests passed 38/38 and scoped lint
passed; receipts are under `category-6/receipt-plan-bridge/` and `category-6/locator-readback/`.
Their combined typecheck is still an integration obligation. Actual copy/backup verification,
explicit v56 activation, real command composition, and final Paths behavior remain pending.

### Relocation operation capabilities — 2026-09-26

Control candidate `d2dbfb908` was applied as `5656b272f`. Issued installation leases are frozen
and recheck their captured mode. Destination access and retained-source verification now derive
from the exact live operation journal, parent admission, and held restore admission; recovery
requires the explicit installation, generation, and operation binding. Retained-source access is
read-only and available only after complete retention. Root inspected the patch and deciding
logs: 28 focused control tests, scoped lint, and typecheck passed under
`category-6/relocation-control/capability-*`. This establishes the engine's access boundaries;
actual copying and recovery orchestration remain pending.

Real intent/config wiring `82446e01e` composes the same genuine reader for the dashboard query and
command kernel. Runtime callers resolve the admitted physical pair while preserving ordinary
settings revisions. Root inspected the patch and real temporary-installation BFF test: PLAN,
readback, exact retry after ingress restamping, stale revision conflict, CANCEL, and retry passed.
The settings reader passed 14/14 and command architecture 9/9; scoped lint passed. Receipts are in
`category-6/runtime-relocation/intent-wiring/`. Combined typecheck remains due after the concurrent
fresh-adoption and v56 work is assembled.

Fresh-adoption control `8d56de21e` was applied as `9a1cce189`, followed by the production bootstrap
callback `c552679be`. Initialization is synchronous, database-only, and expires before read-only
verification and locator publication. The fixed process-lock root check binds the issued lease's
actual workspace. Control/admission/artifact tests passed 75/75; the real BFF tests passed 2/2,
including fresh startup and refusal after an established database is removed. Scoped lint and the
combined root typecheck passed, discharging the preceding control/intent static-check obligation.
Receipts are `category-6/relocation-control/fresh-adoption-*` and
`category-6/runtime-relocation/intent-wiring/fresh-*`. v56 and the offline engine remain separate
pending outcomes.

The explicit v56 candidate `044ccab14` was applied as `01cb0f52b`. Existing v55 opens without
automatic migration; fresh databases use v56, and the separate stopped upgrade requires a verified
current backup and actual installation-bound restore admission. Source upgrade preserves command,
audit, and ordinary-settings bytes. v55 DB-only and paired backups still restore at v55. Root
inspected the implementation, focused logs, and frozen-opener proof script. The final focused set
passed 14/14, compatibility tests passed 85/85, backup tests passed 41/41, and typecheck/scoped lint
passed. Frozen pre-location `8cdf38b2a` refused an actual upgraded v56 database without changing
database bytes or state entries. Evidence is under `category-6/runtime-relocation/v56/`, including
the durable proof script and provenance. M25 remains the documented baseline failure (71/72
storage-upgrade tests passed); the five status baseline failures were not rerun. This accepts the
upgrade primitive, not the pending copy engine or its end-to-end activation.
