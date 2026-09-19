# Task 3.1.10 · Repair date navigation and the date picker
<!-- roadmap: dash-date-navigation -->

**Current assignment: 3.1.10.** Standalone prerequisite or individual task; follow its explicit dependencies.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13): focused task checks, full repository gates only at 3.1.19, no independent review.
Earlier labels and filenames are recorded in the [rename map](README.md#earlier-labels-and-filenames).

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

- [x] Make URL, selected date, timezone, loaded snapshot, controls, focus, races, DST, and browser
  history one tested state machine.

Current baseline and acceptance: [3.1.8 inventory](task-8-dashboard-inventory.md) and
[frozen matrix and ownership](task-8-acceptance-matrix.md). Remaining checklist items require
their mapped outcome/proof; historical subfeature credit does not complete this task.

## Approved execution brief — 2026-09-18

**Approval:** the operator approved the complete DN1–DN5 proposal with “approve” on 2026-09-18,
including the narrow backend/shared-file allocation and interaction rules below. The current
execution record below owns implementation and integration status. This is one standalone assignment, not a new parallel group. The frozen A19 outcome and
D01/D02 requirements remain unchanged; full acceptance is still 3.1.19.

### Allocation, prerequisite and checkout binding

One operator-opened **GPT-6 Astra / medium** supervisor implements this assignment locally. The
calendar query, route/history, subscription identity and picker are one coupled seam with consequential
cross-layer proof. There are **no implementation workers and no independent review** under the
[Phase 3.1 cadence](README.md#execution-cadence--operator-amendment-2026-09-13). Use `/ui`, Components
lead, inherited Operate design, local execution. Read the dashboard/server module instructions; inspect
the specimen before choosing primitives and follow the prescribed playwright-cli reference for manual
browser work. Keep the established desktop design and existing primitives.

| Binding | Approved assignment |
| --- | --- |
| Task and owner | 3.1.10, this section; no sibling or next-task dispatch |
| Product discovery base | `faa8b2165fcd2232028f6436471393d6b9d87747`, clean local `master` on 2026-09-18 |
| Accepted boundary prerequisite | 3.1.9 B integration `3d4d8c0c64cf2e96096b193966a66741861d6f1c`, with its A prerequisite in ancestry |
| Accepted shell prerequisite | `251d471b27dcdb0d32027fc5dd9acffffe3c6449` |
| Accepted surface release | 3.1.9.8 integration `801da4f3d1bfdf0a9ecc81c993289f70699aa140`; its exact delivery is `2109cab8fc6481e1aa2a4eceb9052953a76c6254` |
| Planning delivery | `codex/plan-3.1.10`; documentation-only, based on the product discovery base. The verified full plan SHA is supplied in the handoff, not invented here. |
| Implementation mode | Create a new branch/worktree from that exact approved plan commit, after verifying all prerequisite ancestry and committed contents. Do not implement in the planning checkout or `master`. |
| Implementation branch | `codex/3.1.10-date-navigation` |
| Implementation path | `/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-date-navigation` |
| Planning path | `/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-date-plan` |
| Integration target and owner | Local `master`, `/Users/julianhein/Projects/hr-automation-rebuild`; the operator chooses integration. The supervisor prepares the exact passing candidate and performs integration only after explicit instruction. |
| Merge condition | DN1–DN5 focused proof passes; candidate and evidence are committed; target/ownership is rechecked. Reuse identical-input evidence, rerun affected checks for changed integration inputs, and fix in-scope conflicts. |
| Evidence | `/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.10/<execution-date>/`, outside disposable worktrees |
| Completion | Accepted integration, required focused checks, retained proof and verified owned branch/worktree cleanup. Full Phase 3.1 acceptance remains open at 3.1.19. |

The named refs/paths were available at planning. Recheck availability, working state, ownership and
the four-auxiliary-worktree ceiling before creation; names are not reservations. A dependency symlink
to the installed root `node_modules` is permitted; Git index, bundle, fixtures and proof outputs remain
private. The committed planning ref is the direct delivery path and does not require a planning merge
into `master`. Retain it until its contents are integrated and no consumer needs it. No push is authorized.

### Feasibility and change ownership

Discovery inspected the actual source at the product base, not historical completion claims. Read-only
probes confirmed `parseRoute('?day=2026-02-30')` retains that impossible day and a served future calendar
cell is marked available. No implementation or runtime acceptance was executed during planning.

| Current mechanism and evidence | Required change and permitted owner | Acceptance proof |
| --- | --- | --- |
| `projectors/run-queue-projection.ts` builds `monthCounts` only for the selected month. `date-navigation.tsx` treats those counts as the full first/last day range. | DN1 adds a bounded canonical-summary calendar read and DN4 consumes its month/bounds. This explicitly supersedes the old frontend contract's blanket “no calendar route” statement, while preserving selected-day snapshot counts and D81 membership. | Real summary-backed history spanning months/years; adjacent days across gaps; empty months; equality with selected-day top-level counts at the same authority state. |
| `dashboard-app.tsx` computes Today from frozen bootstrap; its one `useServedNow` is inside `LoadedApp`. | DN2 places the single served calibration where both selected day and all existing elapsed consumers use it; derive local dates with the served zone. No browser wall-clock replacement or heartbeat recalibration channel. | Midnight and both Pacific DST boundaries; browser timezone differs; explicit historical selection remains pinned; visibility refresh. |
| `url-state.ts` only checks date shape. Its malformed-day drop can leave the URL and displayed day disagreeing. | DN2 makes invalid/future date state visible with a Today recovery action. Preserve the raw requested identity for refusal, without requesting an impossible/future partition or selecting another day silently. | Invalid date plus run/section, invalid leap day, future link, valid empty historical link, refresh and history. |
| App `dayWire` already excludes a snapshot naming another day. Subscription ignores callbacks after close, but does not check a snapshot's day against its subscription. Hook state is not explicitly bound to a request generation. | DN3 preserves the app guard and enforces request/day identity at client and hook boundaries, including A→B→A and late error callbacks. | Deliberately reordered responses, closed callbacks, wrong-day snapshot, reconnect and unmount; old counts/rows/errors never appear under the current day. |
| `moveCalendarFocus` moves by index, including disabled cells; month changes can leave a stale tab stop. Empty/absent dates are not chronological neighbors in `DateNav`. | DN4 owns pure date/focus logic and the existing picker/stepper component, with narrow top-bar props. | Keyboard, month/year transitions, empty history, selectable Today, disabled future days, dismissal and focus restoration. |
| Existing shell browser proof uses both fixture and seeded production-service adapters; common seeded data does not itself prove multi-month history. | DN5 owns dedicated calendar seeding/specs and narrowly scoped fixture/seeded wiring. Use real summary queries, projection and subscription for production-service claims. | Correlate selected URL, day wire, rows/counts and calendar authority; attach source-bound browser/a11y receipts and list remaining fakes. |

The bounded query can use existing published summary authority and its workflow/day index; no new
DDL, schema floor or migration is admitted. Read methods remain behind `AuthorityDatabase` and its
consistent authority-read snapshot. Preserve publication freshness/corruption failures, top-level
membership and existing archive/delete disposition. Return only bounded month cells and navigation
bounds, not a copied history of run records. Do not use `readRunSummaries()` or canonical run-list
materialization as a calendar shortcut. Prove that prohibition with a negative control and real valid
query fixtures. No actual deployment/migration/recovery target is involved; operator state, secrets,
fixed runtime ports and external HR services are outside this task's proof.

**Exclusive feature ownership:** `src/dashboard/surfaces/date-navigation-model.ts`,
`date-navigation.tsx`, new date-only state/model siblings; new `src/domain/dashboard/calendar.ts`,
`src/server/dashboard/queries/calendar.ts` and `src/dashboard/state/use-calendar.ts`; the five new
proof files listed under Gates and a dedicated `tests/parity/helpers/date-navigation-server.ts` when
needed. These new module names are the assigned destinations; routine internal API design remains
with the supervisor.

**Narrow shared-file grant:** date props/wiring only in `src/dashboard/surfaces/top-bar.tsx`,
`src/dashboard/app/dashboard-app.tsx`, `url-state.ts`, `route-history-model.ts` and existing shell
history/selection models; single-clock placement in `state/served-clock.ts`; day identity/loading
in `state/use-dashboard-day.ts` and `client/subscription.ts`; calendar transport in
`client/shell-queries.ts`/`client/index.ts`; calendar route/dependencies/composition in
`src/server/dashboard/routes/shell.ts`, `shell-types.ts`, `api-types.ts`, `api.ts`, `compose.ts` and
its date-only composition helper; read-only calendar support in `src/infra/sqlite/run-summaries.ts`
and `authority-database.ts`. The selected-day projector may receive only a narrowly required shared
calendar-membership helper extraction, preserving the existing wire and count semantics.

Corresponding regression tests, calendar-wire schema inventories and date fixture plumbing are owned,
including `tests/parity/helpers/fixture-shell-routes.ts`, `fixture-profile.ts`, `fixture-bff.ts`,
`seeded-services.ts` and `seeded-bff.ts`. Keep default fixture/reference behavior intact; task-specific
state belongs in the dedicated helper. Any new disposable file writer must be registered with exact
destinations in the existing `parity-reference-authority` guard. Guard inventory changes are required
only for an actual guard addition/retirement, with deciding evidence. Documentation ownership includes
this task, the allocation pointers, affected contract descriptions/decision pointers and roadmap source;
`docs/roadmap/index.html` remains generator-owned.

The [parent allocation amendment](task-9-establish-independent-dashboard-boundaries.md#date-navigation-ownership-amendment-2026-09-18)
releases only these date seams. No unfinished sibling dependency or competing owner is introduced.

### Ratified interaction rules

The normative rules live in [dashboard surfaces](../../../reference/dashboard-surfaces.md#date-navigation-amendment-2026-09-18)
and the bounded read/coherence amendment in [frontend/backend integration](../../../reference/frontend-backend-integration.md#calendar-navigation-read-amendment-2026-09-18).

- No `day` parameter means follow server Today. An explicit valid day stays pinned. Today removes
  the explicit selection and returns to following Today, including midnight and visibility refresh.
- Previous/next move chronologically through available days, with Today reachable even when empty.
  They do not jump from an unserved position to the oldest recorded day or pass served Today.
- Empty historical days remain disabled in the picker. Valid historical direct links render an
  honest empty queue; a disappeared partition never fabricates available rows.
- Invalid or future links show a recoverable date error and Today action. They do not silently
  display another day, launch an invalid day stream, or expose a run under the wrong date.
- Browsing a month changes only the calendar view until a day is selected. Keep month/year boundary
  movement reachable without inventing a new product control or new design system.
- Loading/failure are distinguishable from zero rows. Selected-day queue/status/count facts come from
  the matching day snapshot; calendar responses are separately bound to their requested month/day.
- Preserve dirty Settings navigation protection, no-op history behavior and exact run/day selection.
  An explicit date change clears incompatible run/section selection; same-place navigation adds no entry.

### Ordered execution and acceptance

| Step | Required outcome and implementation | Proof before leaving the step |
| --- | --- | --- |
| **DN1 — Calendar authority** | Strict bounded read over canonical summaries, database facade, dashboard query/route/composition and client. Serve requested-month availability/counts and chronological navigation bounds. Preserve existing day-snapshot semantics. | Cross-month/year history; empty history/month; top-level/member exclusion; archive/delete updates; invalid query; unavailable/corrupt summary; no writes or full-history materialization. Compare count membership with the production day projection on the same authority state. |
| **DN2 — Date state** | Coordinate selected day, URL, timezone, single live clock and native/toolbar history through the date model and app integration. Implement the ratified link/Today rules. | Leap years, month/year boundaries, Pacific spring-forward/fall-back and local midnight with browser UTC/another zone; pinned dates, missing-date live mode, invalid/future refusal, direct link, reload, Back/Forward and no duplicate history. |
| **DN3 — Loading and races** | Bind calendar responses and day resource/subscription callbacks to the current request identity; discard superseded callbacks, reject wrong-day payloads, retain honest current loading/error/connection state. | Delayed A→B→A successes and failures, wrong-day envelope, close/unmount, reconnect. Observe intermediate renders as well as final state; no old rows, counts, errors or run selection under a new date. |
| **DN4 — Picker interaction** | Repair chronological stepping, independent month browsing, disabled dates, focus/roving tab stop, selection and dismissal using existing primitives. | Arrows/Home/End, Enter/Space, month/year transitions, disabled/future/empty cases, Today from an empty month, Escape/outside click and focus return. Recheck selected day changes while picker is open. |
| **DN5 — Browser proof and delivery** | Dedicated production-service-backed browser proof over isolated SQLite plus controlled transport/clock fixtures for race negatives; finish focused gates, commit and freeze evidence/candidate. | Direct links, rapid navigation, refresh and native/toolbar history; both themes; D01/D02 desktop/reference checks, resize and actual 125%/200% zoom; screenshot and accessibility evidence; exact URL/day/rows/counts correlation. |

Use the smallest red-capable regression at each affected boundary. Required interacting cases include:
invalid date with a run/section (refuse before fetching/rendering that run under a substituted day),
late A success/error after B or after returning to A (reject the obsolete request), midnight while
following Today versus pinned history (only live selection advances), month browsing while the day
stream changes (retain viewed-month identity), and native date history through a dirty Settings exit
(preserve the draft/guard and then the accepted destination). A valid control must reach each tested
boundary so refusal cannot pass because the fixture was unrelatedly broken.

The retained 3.1.9.8 delivery assessment found missing disposable-writer registration and fixture
TypeScript narrowing only at combined checks. Run the assigned compiler/fixture/guard checks before
DN5 freeze. That assessment does not add an independent-review stage or broad gates here. Its
inherited broad-ratchet failures remain recorded at 3.1.19; they are not claimed green by this task.

### Gates, browser resources and evidence reuse

During DN1–DN4 use the relevant exact tests below and scoped lint; group logical fixes rather than
running full suites for each small edit. Before the candidate is frozen, run:

```sh
npm run test -- tests/unit/server/calendar-navigation.test.ts tests/unit/dashboard/date-navigation-model.test.ts tests/unit/dashboard/date-navigation-state.test.ts tests/unit/dashboard/date-navigation-control.test.ts tests/unit/run-summaries/queries.test.ts tests/unit/summary-surfaces/queue.test.ts tests/unit/dashboard/use-dashboard-day.test.ts tests/unit/dashboard/subscription.test.ts tests/unit/dashboard/served-clock.test.ts tests/unit/dashboard/shell-navigation.test.ts tests/unit/dashboard/shell-controls.test.ts tests/unit/dashboard/surface-fixture-boundaries.test.ts
npm run test -- tests/unit/architecture/clock-single-source.test.ts tests/unit/architecture/dashboard-wire-boundary.test.ts tests/unit/architecture/dashboard-memo-prop-stability.test.ts tests/unit/architecture/dashboard-refresh-boundary.test.ts tests/unit/architecture/parity-reference-authority.test.ts
npm run typecheck
npm run test:parity -- tests/parity/date-navigation.spec.ts tests/parity/shell-navigation.spec.ts tests/parity/shell-accessibility.spec.ts tests/parity/dashboard-reference.spec.ts tests/parity/cross-date-search.spec.ts --workers=4
npm run test -- tests/unit/architecture/roadmap-doc-binding.test.ts
npm run roadmap
npm run roadmap:check
git diff --check
```

The four date unit files and `tests/parity/date-navigation.spec.ts` are new assigned files, not claims
of existing coverage. Add or update the meaningful corresponding existing tests as behavior changes.
Stage exact owned new paths before deriving the lint selection; never omit an untracked test. With
`PLAN_COMMIT` set to the verified full handoff SHA, run from the implementation checkout:

```sh
node --input-type=module - "$PLAN_COMMIT" <<'JS'
import { execFileSync } from 'node:child_process';
const planCommit = process.argv[2];
if (!/^[0-9a-f]{40}$/.test(planCommit ?? '')) throw new Error('exact-plan-commit-required');
const files = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', '-z', planCommit, '--', 'src', 'tests', 'scripts'], { encoding: 'utf8' }).split('\0').filter(p => /\.tsx?$/.test(p));
if (files.length === 0) throw new Error('implementation-lint-selection-empty');
const args = ['eslint', ...files, '--max-warnings', '0'];
console.log(JSON.stringify(['npx', ...args]));
execFileSync('npx', args, { stdio: 'inherit' });
JS
```

The existing Vitest configuration caps file workers at four. The parity wrapper uses the authoritative
configuration, private bundle/global setup, fixed JSON output validation and `--workers=4`; retain
resolved worker/selection evidence and zero retries. Its global setup builds/stamps production assets,
so an unchanged-input extra `web:build` is unnecessary. Preserve all reference membership, assertions,
timeouts and comparison tolerances. No screenshot refreeze is approved. New screenshots/a11y outputs
are task evidence; changing an existing expectation requires a deliberate, separately authorized
reference decision, not a test-passing shortcut.

Use ephemeral loopback ports and disposable synthetic roots, never operator ports 3938/5174 or the
live runtime. The browser proof must exercise production calendar query/projection/subscription
machinery; a static fixture response alone cannot close A19. List fakes (manual clock, synthetic runs,
unrelated service fixtures) and scope each claim. Race-injection tests may delay/replace transport
messages but do not stand in for the separate real-service path. Retain API/wire correlation, browser
errors, screenshots, a11y and cleanup evidence.

D01 uses both themes at 1440×900 and 1280×720. D02 resizes 1024×768 → exact 1024×720 → 1024×768,
retaining selected queue/detail and picker reachability. Use actual browser 125% and 200% zoom with
readback, not CSS zoom or device-scale substitution. Reuse the accepted shell proof's retained
tab-scoped Chromium zoom-extension mechanism and playwright-cli procedure, updating it to the exact
candidate bundle/owned browser session. Keep the 1024×720 canvas, scroll access, focus return and
popover hit geometry; no mobile/coarse-pointer variants. The retained mechanism is documented in
[the shell task](task-9-1-finish-the-shell-navigation-and-accessibility-baseline.md#final-focused-checks-and-artifact-custody).

Serialize only shared mutable resources: the checkout's parity bundle/output/lock and roadmap
regeneration before freshness. Unit tests, scoped lint and compiler may overlap within verified host
capacity; never run more than four file workers. No coverage run is assigned here. Reuse evidence only
when its source/test/config/dependency/fixture/reference inputs are verified unchanged. Record the
exact command, expanded selection, exit, tested candidate/tree, output paths and reuse basis. Rerun
invalidated checks after fixes or integration changes; a documentation-only SHA change does not rerun
unchanged runtime gates. A failed check is not deferred as passed.

Documentation-only planning/recording uses roadmap binding, scoped generator/test ESLint, touched-link
checks, existing instruction-twin equality and the 32,768-byte chain cap, roadmap generation/freshness
and diff checks. Full coverage, repository-wide lint/architecture, broad parity and combined
production/performance/recovery/live proof remain **3.1.19**, along with complete A01–A42/D01–D05.
This task supplies its assigned targeted browser/zoom proof now.

### Fix, integration and stop boundaries

The supervisor resolves routine coding choices and tactical fixes within DN1–DN5. No nested fix
agents, recursive supervisors or extra implementation worktrees are admitted. No database migration,
schema floor, summary-publication redesign, worker/workflow change, external HR action, live-state
access, shared design-system redesign, heartbeat recalibration or unapproved reference refreeze.
Do not change accepted Settings, notification, session, Archive, Activity or Queue policy while wiring
dates. Stop dependent work for changed prerequisites/ownership, a required out-of-scope mechanism,
missing required proof, or a material contract decision; report the exact blocker and continue any
independent authorized verification. Do not re-ask approved interaction rules or routine implementation.

Keep one current state/evidence record in this task. Send Done / Now / Remaining once at supervisor
start or genuine resume, then only newly verified completions and compact evidence; compaction does
not restart the cadence. Commit by logical category and stage exact paths. Freeze the tested candidate
and retained proof, then request only the still-required explicit integration instruction with a
concrete reviewable result. No independent review step applies. After authorized local integration,
verify ancestry/tree and required reuse/reruns, preserve proof outside the worktree, remove owned
registered and physical worktree residue and branch, and close the task's checkbox/roadmap only then.
Stop after 3.1.10; no push or downstream dispatch.

### Current execution state — 2026-09-19

**3.1.10 complete: DN1–DN5 accepted, integrated locally and owned cleanup verified.**
The operator's “is it done? finish it” on 2026-09-19 authorized the previously requested integration
and cleanup. Frozen delivery `4235dbcaf3c48a9e24f435dde5069fd04e51903c` (implementation
`7b98ba23dc9f5876dba927ad6cf02498c51e2d8c`, approved plan
`92e4e86ccf20218a4c3af9bd6d4e813f3d6b9270`) is an ancestor of accepted local master integration
`517f7319fdcd771aee8356e664f1e8a885032ba0`. All four prerequisite SHAs in the allocation table were
verified before implementation and integration. No workers or independent reviewer were dispatched.
No push or downstream task dispatch occurred; full Phase 3.1 acceptance remains **3.1.19**.

Master had advanced to `f02eb7f837677eef210d305635f6a2d84f0516b4` with the approved 3.1.11 planning
documents. Both tasks' owning sources were retained. The sole conflict was generated
`docs/roadmap/index.html`, resolved by the existing generator over the combined sources. There was
no runtime or behavioral conflict. All 2,440 frozen source/test/config/dependency/reference inputs
match the integrated checkout, so the focused unit/architecture, compiler, implementation lint,
browser and zoom receipts below are reused for their identical inputs. Documentation binding,
scoped generator/test lint, generation/freshness, links/twins/chain cap and whitespace checks were
rerun for integration and completion recording.

Integration evidence is `/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.10/2026-09-19/`:
`integration-precommit.json` records the target drift, source equality and conflict disposition;
`closure-checks.json`, `closure-roadmap-binding.log`, `closure-lint.log`,
`closure-roadmap-generation.log` and `closure-roadmap-freshness.log` bind the recording checks.
`integration.json` records the final commit/tree, gate reuse and cleanup. The task checkbox and
only its three roadmap builds are now complete.

Retained proof is `/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.10/2026-09-18/`.
`candidate.json` binds the implementation/tree, commands, selections, source/config/dependency/reference
hashes and retained outputs; `gate-inputs.json` supports identical-input reuse. The freeze recording commit changed only this owner, the implemented contract descriptions, roadmap
journal and generated roadmap. Runtime gates remain reusable only while those inputs match.

| Step | Verified outcome and retained proof |
| --- | --- |
| DN1 | Strict `GET /api/v1/calendar?month=&day=` over a consistent canonical-summary snapshot. At most 31 month counters; indexed chronological seeks; no complete-history reader or authority writes. Real valid SQLite fixtures compare calendar membership to the production projector, including operation-member exclusion, archived/deleted rows, empty history and unavailable/corrupt publication. `focused-unit.log`, calendar authority attachment in `parity-output/results.json`. |
| DN2 | One existing live served clock drives Today. Missing day follows Today; explicit valid day stays pinned; Today removes the pin. Invalid/future links preserve the invalid URL and show recovery before day/run reads. Leap/DST/midnight/visibility, month/year, native/toolbar history, reload, same-place navigation and dirty Settings exits are covered. `focused-unit.log`, `parity.log`. |
| DN3 | Calendar and day-hook request identities hide stale state on intermediate renders; old success/error after A→B→A, reconnect and unmount cannot paint the new request. Wrong-day/month payloads refuse explicitly. Browser transport negatives cover delayed month success/failure, visible current failure and retry. `focused-unit.log`, `parity.log`. |
| DN4 | Independent month browsing, chronological stepping, gaps/future disabling, empty-month Today, usable roving focus, arrows/Home/End, Enter/Space and trigger focus after selection/Escape/outside click. Existing primitives and reference bytes are preserved. `focused-unit.log`, `parity.log`, screenshots and a11y. |
| DN5 | Production-service SQLite/query/projector/SSE browser proof in both themes; URL/day/row/count correlation; 1440×900/1280×720 and 1024×768 → 1024×720 → 1024×768. Four native zoom/theme combinations verify 125%/200% readback, 1024×720 canvas, side-by-side panels, picker hit geometry, selection/focus and scroll access. `parity-output/`, `zoom-receipts.json`, four `zoom-*.png` screenshot pairs (eight PNG files), `zoom-console.txt`. |

| Required gate | Final result |
| --- | --- |
| Exact 12-file unit command above | Exit 0; **74 tests**, four-file-worker cap; `focused-unit.log`. |
| Exact five architecture files plus affected `redaction-surface-scan.test.ts` | Exit 0; **62 tests** (31 assigned + 31 redaction inventory), six files; `architecture-final.log`. Calendar wire is classified in the existing inventory; no guard was added or retired. |
| `npm run typecheck` | Exit 0; `typecheck.log`. |
| Exact derived implementation ESLint command above | Exit 0; **31 owned TS/TSX paths**, zero warnings; expanded command in `lint.log`. |
| Exact five-spec parity command above | Exit 0; **42 passed**, zero skipped/flaky/unexpected, four workers, zero retries; required a11y digests validated. `parity.log`, `parity-output/results.json`. No reference refreeze. |
| Native browser zoom via owned playwright-cli extension session | Exit 0; Chromium 149.0.7827.55, both themes at 1.25 and 2.0 with `chrome.tabs.getZoom` readback; visible screenshots inspected. `zoom-receipts.json`; console has zero errors/warnings. |
| Recording checks | Roadmap binding, scoped generator/test lint, touched local links, existing instruction twins/chain cap, roadmap generation/freshness and whitespace checks are recorded in `recording-checks.json` and companion logs. |

The manual zoom proof serves the same production bundle as the final parity run: input digest
`6827b0a4728b32d7cb9286805e33a08c8d19ea87b50f23fe95db59ff0081bd75`, output digest
`629ed071d80a2243557b66526d3d9f94b343ec8280ab1c3b4977bd84789e84d0`. Its source is `serve.mts` and
`zoom-proof.js`; copied extension source and configuration retain the actual zoom mechanism. Fakes
are synthetic run authorities, fixed server/monotonic clocks, seeded static/unrelated services and
unwired HR services. Calendar queries, day projection and subscription transport are production
implementations. This proves the assigned date seam, not external HR execution or broad acceptance.
No operator state, credentials, legacy runtime, fixed ports 3938/5174, migrations or writes are involved.

Owned proof servers and playwright-cli sessions are stopped. Temporary zoom profile/loaded extension
were removed while source/receipts were retained. Cleanup archived and hash-verified all 103 ignored
generated files (bundle, parity output, browser logs and empty proof lock) in
`2026-09-19/owned-generated-residue.tar.gz`, then removed the owned dependency symlink, ordinary Git
worktree registration and physical directory
`/Users/julianhein/Projects/hr-automation-rebuild-worktrees/hr-worktree-date-navigation`.
`codex/3.1.10-date-navigation` and `codex/plan-3.1.10` were deleted with normal ancestry-checked
branch deletion. The former planning directory is also absent. The shared worktree parent and
active `hr-worktree-sessions` checkout were preserved. This is the calling task, so no sidebar task
was archived. No owned cleanup remains.

**Delivery assessment.** No planning-driven amendment, new operator scope or changed prerequisite was
needed. Repairs were implementation/proof defects within the approved plan: strict summary-row parsing,
canonical fixture validity and projector initialization, browser response synchronization/a11y digest
registration, race-fixture TypeScript narrowing, outside-dismissal focus and capture-before-transition.
The existing delayed-day fixture used a future date; it now uses the preceding historical date so its
original stale-row assertions still reach the intended boundary under the new refusal rule. Retained
iteration logs (`dn1-test.log`, `focused-early.log`, `parity-date.log`, `final-repair.log`) and the final
receipts show repair rechecks; overwritten intermediate logs prevent a reliable total round count or
elapsed-cost claim. Context was compacted during this coupled assignment without resizing/delegation.
Earlier fixture startup/compiler checks and explicit visible-state screenshot waits would have avoided
some proof rework. Integration required only generated-roadmap conflict resolution; no additional
implementation repair or assignment amendment was needed. No assertion, timeout, reference tolerance
or gate membership was weakened. Broad
coverage, repository lint/architecture and complete A01–A42/D01–D05 remain assigned to 3.1.19.

### Planning verification — 2026-09-18

Planning evidence is retained at
`/Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.10/2026-09-18-plan/`.
The final plan SHA is the commit containing this verified section and is supplied in the launch prompt.
This planning candidate changes only the owning task, allocation pointers, date/transport contract
amendments and decision pointers, roadmap journal and generated roadmap. Product implementation,
existing completion checkboxes, runtime code/tests/config/dependencies/instructions and reference bytes
remain unchanged. Runtime gates are neither executed nor claimed reused for this documentation change.

| Planning check | Verified result |
| --- | --- |
| `npm run test -- tests/unit/architecture/roadmap-doc-binding.test.ts` | Exit 0; 24/24 tests, `roadmap-binding.log`. Rechecked after the final recording change. |
| `npx eslint tests/unit/architecture/roadmap-doc-binding.test.ts scripts/generate-roadmap.ts scripts/roadmap/parse-plan.ts scripts/roadmap/scan-docs.ts scripts/roadmap/schema.ts --max-warnings 0` | Exit 0; `lint.log`. These inputs are unchanged by the recording update; lint evidence is reused for that update only. |
| `npm run roadmap` then `npm run roadmap:check` | Both exit 0; `roadmap-generation.log`, `roadmap-freshness.log`. Regenerated/rechecked after recording. |
| `python3 /Users/julianhein/Projects/hr-automation-rebuild-evidence/3.1.10/2026-09-18-plan/check-plan.py` | Exit 0; eight-document scope, 18 touched local links/fragments, nine existing instruction pairs equal, maximum project instruction chain 19,308 UTF-8 bytes, 53 approval controls and four required ancestors. Completion checkboxes and runtime inputs unchanged. `document-checks.json` binds document hashes; repeated before commit. |
| `git diff --check` and staged whitespace check | Exit 0 before exact-path commit. |
| Runtime implementation/acceptance | Not run or claimed; DN1–DN5 and all product completion remain open. |

The planner verifies committed document bytes with `git show`, named-ref reachability, prerequisite
ancestry, integration-base state and execution ref/path availability before returning READY. The
planning ref supplies the exact launch base; a documentation merge is not required. Remove only the
clean owned planning worktree and its verified dependency symlink, retaining the committed ref and
external evidence. The final handoff reports the actual SHA and cleanup result.
