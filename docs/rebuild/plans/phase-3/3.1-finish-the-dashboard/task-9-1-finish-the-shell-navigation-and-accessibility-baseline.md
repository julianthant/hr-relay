# Task 3.1.9.1 · Finish the shell, navigation, and accessibility baseline
<!-- roadmap: dash-shell -->

**Current assignment: 3.1.9.1.** Independent parallel task; launch only after the parent prerequisite is accepted and merged.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13): focused task checks, full repository gates only at 3.1.19, no independent review.
Earlier labels and filenames are recorded in the [rename map](README.md#earlier-labels-and-filenames).

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

Consume the [3.1.9 B ownership and working-interface record](task-9-establish-independent-dashboard-boundaries.md#b-implementation-and-child-release-contract--2026-09-13) at its accepted integration. The approved brief below and the [shell ownership amendment](task-9-establish-independent-dashboard-boundaries.md#shell-child-ownership-amendment--2026-09-13) own this child. Other shared registration and generated outputs remain reserved.

- [ ] Finish shell/navigation and responsive containment within Task 8's supported desktop matrix,
  including smaller laptop windows and zoom; preserve keyboard, focus, reduced-motion, theme,
  accessibility, component, and production-browser proof. Mobile/touch-specific support is not owed.
- [ ] D340: consume the desktop-only control/layout baseline. Keep responsive CSS useful for
  desktop resizing and zoom; do not reintroduce mobile-only variants or schedule another cleanup.

Current baseline and acceptance: [3.1.8 inventory](task-8-dashboard-inventory.md) and
[frozen matrix and ownership](task-8-acceptance-matrix.md). Remaining checklist items require
their mapped outcome/proof; historical subfeature credit does not complete this task.

## Approved execution brief — 2026-09-13

**Approval:** the operator first chose A to permit the narrowly required shell changes in
`dashboard-app.tsx` and `dashboard-takeovers.tsx`, then approved the full S1–S5 proposal with
`approve`. This authorizes planning persistence. It is not implementation, candidate acceptance,
permission to merge, or a completed A01/A02 claim. Implement in a fresh `/supervise 3.1.9.1` session.

### Current state and allocation

Planning starts from clean local `master` at `f37a4f4be20a6ff6e806ce95070ce55f6e4ccd1f`.
Accepted 3.1.9 A integration `c990662e91604cfd38baa53e12bfb6e7c60610eb` and B integration
`3d4d8c0c64cf2e96096b193966a66741861d6f1c` are verified ancestors. The parent records accepted
prerequisites and completed owned cleanup. Its focused results are historical prerequisite evidence,
not tests of this unimplemented child. Preserve [A01/A02 and applicable D01–D05](task-8-acceptance-matrix.md),
including the [inventory's historical obligation mappings](task-8-dashboard-inventory.md).

One **GPT-6 Astra medium supervisor** implements the coupled route, selection, focus and proof seam
locally. **Zero workers and zero independent reviewers.** Medium fits the native-history interleavings,
draft lifetime, route/resource identity and rendered accessibility judgment. The [Phase 3.1 cadence](README.md#execution-cadence--operator-amendment-2026-09-13)
supersedes personal independent-review and full-per-candidate gate defaults. No sibling or next-task
dispatch. Use `/ui`, Components lead, local execution, preserving the established Operate design.
Read dashboard instructions, DESIGN/PARITY and relevant lessons; inspect the specimen through an
owned isolated server before choosing primitives. Read craft guidance before actual UI edits.

| Assignment | Branch and absolute checkout | Base and prerequisite | Release and integration condition |
| --- | --- | --- | --- |
| Planning persistence | `codex/3.1.9.1-shell-plan`; `/Users/julianhein/Projects/hr-worktree-shell-plan` | `f37a4f4be20a6ff6e806ce95070ce55f6e4ccd1f` | Commit and verify the full plan and matching ownership amendment. Remove the owned planning worktree, retaining the named ref for launch. No master merge is assigned to the planner. |
| S1–S5 implementation | `codex/3.1.9.1-shell-baseline`; `/Users/julianhein/Projects/hr-worktree-shell-baseline` | Create from the final verified planning commit delivered by the planner, containing both accepted 3.1.9 integrations. Verify exact plan content and ancestry before editing. | Freeze the candidate after focused gates. Operator-controlled 3.1.9.8 finalization consumes it with the six siblings. Ultimate target: local `master` at `/Users/julianhein/Projects/hr-automation-rebuild`, only under the operator's integration instruction. |

Discovery found only the primary worktree; both proposed implementation/planning refs and paths
were absent. The planning worktree was then created from the stated base. Implementation names
remain proposals, not reservations. Recheck Git status, refs, worktree ownership, path availability
and the four-auxiliary-worktree ceiling before creation. Do not repurpose a colliding branch/path,
switch the primary integration checkout, or overwrite another session's changes.

### Ownership and exclusions

The [parent's shell row and exact module census](task-9-establish-independent-dashboard-boundaries.md#working-ports-and-sibling-ownership)
remain the source for existing shell ownership. Beneath `src/dashboard/`, this includes
`app/url-state.ts`, `app/nav-history.ts`, `app/navigation-model.ts`, `app/route-history-model.ts`,
`app/takeover-focus-model.ts`, `app/dashboard-app-model.ts`, `app/global-keys.ts`, shell-scoped
`app/index.css`, `client/shell-queries.ts`, `surfaces/shell.tsx`, `surfaces/shell-model.ts`,
`surfaces/top-bar.tsx`, `surfaces/top-bar-model.ts`, `surfaces/top-bar-layout-model.ts` and
`surfaces/navigation-controls.tsx`. New shell-only
sibling modules may factor the approved behavior without changing published sibling APIs or product scope.

The approved amendment permits shell-only edits in `src/dashboard/app/dashboard-app.tsx` and
`src/dashboard/app/dashboard-takeovers.tsx`: route/tab/run selection, navigation callbacks, focus,
shell containment, and shell empty/error rendering. Preserve existing surface registration, sibling
component contracts, Settings editor and draft authority, backend wiring, provider nesting and
command-dispatch responsibilities. This does not grant ownership of Settings, storage, notification,
date, session, start, intake, Archive, Activity, queue or run-detail bodies. Consumer identity checks
may prevent painting stale detail; shared async hooks and detail implementation stay outside this
child. Defects requiring those owners return for amendment.

Proof ownership includes new `tests/unit/dashboard/shell-navigation.test.ts` and
`tests/unit/dashboard/shell-controls.test.ts`, new `tests/parity/shell-navigation.spec.ts` and
`tests/parity/shell-accessibility.spec.ts`, and separately named shell-only helpers/profiles. Existing
component suites are regression inputs, not permission to take sibling test files. Existing
shell/toolbar/search-target/kit parity specs and shell fixture/scene modules retain the parent's
allocation. New cases may use `FixtureDashboardProfile` and existing server APIs; do not edit the
default shared profile, common builder, seeded-service composition or shared harness.

Preserve established geometry and the reference corpus. Deliberate `queue-day` PNG/a11y/provenance
updates may cover corrected shell empty-state copy, with exact reference diffs and reasons recorded
together. This is not blanket reference approval: kit and other owners' references, and default
fixture facts, stay unchanged. Unexpected or cross-owner reference changes require amendment;
never refreeze merely to pass. New states can retain screenshot/a11y artifacts without adding
shared scene membership or inventing a baseline family.

Excluded: redesign; mobile/coarse-pointer variants; new URL/product features; Settings editor,
workflow/start/session/detail feature work; DS/specimen sources; shared transport/command unions;
BFF/schema/authority changes; root configuration and generated manifest/catalog/membership edits;
operator-state copies; external HR actions; deployment; cutover; push.

### Ordered steps

| Step | Required outcome and earliest proof |
| --- | --- |
| **S1 · Verify allocation** | Verify committed approval, exact plan/base ancestry, ownership, branch/path and capacity. Create the implementation worktree from the delivered planning commit. Establish private build/test/evidence resources and confirm existing shell and fixture/seeded interfaces. Capture the before state and inspect the specimen. No product edits precede these checks. |
| **S2 · Finish navigation** | Make every reachable door, deep link, reload, browser history and toolbar history agree on one visible surface and intended run/workflow/tab. Preserve Settings drafts and Keep/Discard behavior across section/catalog changes. Repair shell navigation/consumer seams with mounted regressions before or alongside the repair; retain failing evidence. Cover repeated doors, competing takeover keys, rapid/interleaved navigation, delayed responses and return focus. |
| **S3 · Finish shell states and controls** | Distinguish loading, failed, unavailable, unknown-section and genuinely empty states. Never present an old run as the new selection, call an error empty, or permit hidden queue shortcuts behind another surface. Verify floating/sidebar/minimized workflow modes, status controls and truthful names/counts, Help through Settings, theme destination labels, focus entry/return, and keyboard/pointer ownership. Preserve existing command effects. |
| **S4 · Prove desktop behavior** | Run the production bundle through shell fixture and isolated seeded-service paths. Prove both themes, floor scrolling, resize with selected queue/detail, actual browser zoom, reduced motion, focus, hit ownership, names, contrast and toast/footer clearance. Repair scoped failures and rerun invalidated proof. Screenshots do not establish behavior, and fixture rendering does not establish authority. |
| **S5 · Deliver candidate** | Establish combined focused gates, inspect the final diff/reference attribution, commit exact paths by logical category, and record candidate/source/bundle/fixture/evidence hashes with commands and exit results. Close owned browser/server processes. Preserve the candidate branch and durable evidence for operator-controlled 3.1.9.8 intake. Development may finish while integration/cleanup and roadmap completion remain open. |

### Interaction proof and feasibility

| Boundary and interacting conditions | Required result; forbidden result | Proof |
| --- | --- | --- |
| Clean route; deep link/reload/native Back/Forward/toolbar history; known or unknown section | URL, visible surface and selected tab agree; unknown/unavailable targets state absence. No stale local-tab override or duplicate history entry from an unchanged door. | `shell-navigation.test.ts`, `shell-navigation.spec.ts` |
| Dirty Settings; shell exit/native history; Keep/Discard; section/catalog changes | Keep retains the same draft and original destination; Discard completes the chosen exit once. Section changes retain the mounted editor. No abandoned replay, lost draft or extra history entry. | New shell navigation tests plus existing takeover-frame regressions |
| Rapid navigation while history restoration, confirmation or fetch settlement is pending | Final route/run/tab belongs to the accepted navigation intent. No stale callback replaces it, hidden takeover wins, or skipped/duplicate history action is presented as the chosen destination. | Controlled mounted settlement cases and real browser history |
| Workflow/day/run/tab changes with delayed/missing day/detail or empty/unavailable/error results | Join route and served identity at the consumer; old selection cannot appear as a newly selected run. Preserve valid same-run refresh. Distinguish missing/loading/failed states without invented workflow, partition, default status or successful empty response. | Mounted shell profiles and seeded-service browser cases |
| Typing/native selector, handled key, modal/popover or takeover combined with queue shortcuts | Native/active interaction owns the key; hidden queue actions do not fire. Reachable queue shortcuts keep their advertised scope; keyboard/pointer perform the same existing action and restore focus to a mounted target. | `shell-controls.test.ts`, `shell-accessibility.spec.ts` |

Discovery inspected sources and existing tests; it ran no product gates. `dashboard-app.tsx`
computes `effectiveTab` with local `tab` ahead of URL selection and defaults unsupported sections.
It also owns detail/empty rendering and navigation callbacks. These concrete acceptance/ownership
conflicts are resolved by the approved shell amendment. `route-history-model.ts` has one pending
restore/replay slot; existing tests cover single transitions, not the rapid-interleaving matrix.
`state/use-run-detail.ts` revokes old settlement callbacks and preserves same-run refresh; consume
it without claiming it proves route/workflow/tab alignment. The parent repaired Settings close
focus after discard-dialog unmount; preserve that regression and post-commit coordinator.

The prior B delivery assessment identifies focus timing and broad import rewrites as actual risks.
Keep behavior in assigned shell modules and preserve the specimen closure. The inventory's
historical rows 3, 6, 20, 31, 32, 36, 49 and 50 retain specimen/primitive proof, reachable Help,
theme/provider and toast geometry, shared presentation, containment, search Escape, empty-workflow
and applicable zero-system explanations. Other portions of cross-owner rows remain their owners'.
This plan does not redefine parser, command or authority contracts.

The fixture server serves strict profile data. The seeded server uses real isolated SQLite,
projection, query, HTTP/SSE and command services; its declared gaps and simulated/unwired dependencies
include synthetic clock/config/descriptor input and fixture preflight, archive, explorer and intake
inputs. Each proof receipt names which were used. Do not label every seeded dependency live
production authority. No external HR system, operator credentials or actual-target deployment/
migration preflight is needed for the shell journey.

### Browser proof and focused gates

S4 supplies the shell's parts of the [frozen desktop matrix](task-8-acceptance-matrix.md):

- At actual 100% zoom, 1280×720 and 1440×900 in Graphite Warm and Paper Ink; preserve existing
  desktop references and the specimen's named assertions.
- At 1024×768, resize to exactly 1024×720 and back with a run/detail selected. Queue and detail
  stay side by side; date, search, status, notification and session doors remain reachable.
- At 900×600 CSS pixels, document scrolling exposes the same 1024×720 canvas, including toast,
  status and footer. Tab to an offscreen control and return to 1440×900; exercise both themes.
- At 1280×720 with actual 125% browser zoom and 1440×900 with actual 200% browser zoom, record
  effective CSS viewport, browser version, zoom mechanism/readback, focus and scrolling. This
  proves shell containment; sibling form-specific D04 cases remain with those owners.
- At narrow desktop, keyboard-only and reduced motion in both themes: names, focus order/return,
  hit ownership, resting motion and text/status contrast.

Use the prescribed playwright-cli playbook for interactive browser work and the repository parity
lane for committed tests. Real zoom uses an owned persistent context in Playwright's bundled
Chromium and a disposable Manifest V3 extension calling tab-scoped `chrome.tabs.setZoom` / `getZoom`.
Installed CLI 0.1.19 accepts a dedicated JSON config with `browser.userDataDir`, `launchOptions`
and `contextOptions`; no shared config edit is required. Recreate the extension/profile under
owned scratch; use bundled Chromium with `--disable-extensions-except` and `--load-extension`,
bind the exact owned tab, apply 1.25 or 2.0 and read it back, then record viewport/DPR and browser
version before assertions. Drive it through an owned playwright-cli session and close/remove only
its resources. Verify the mechanism locally before claiming zoom proof. CSS zoom, device scale
factor, pinch scaling or viewport resizing alone cannot substitute. Official [Chrome tabs docs](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-setZoom)
and [Playwright extension docs](https://playwright.dev/docs/chrome-extensions) establish the API and
persistent bundled-Chromium route; they do not establish that this project's cases pass.

After S2/S3 create the named test deliverables, run from the implementation checkout:

```sh
npm run test -- tests/unit/dashboard/shell-navigation.test.ts tests/unit/dashboard/shell-controls.test.ts tests/unit/dashboard/takeover-frame-focus.test.ts tests/unit/dashboard/settings-takeover.test.ts tests/unit/dashboard/shell-view-selection.test.ts tests/unit/dashboard/shell-structural-fidelity.test.ts tests/unit/dashboard/global-keys.test.ts
npm run test -- tests/unit/architecture/dashboard-refresh-boundary.test.ts tests/unit/architecture/dashboard-memo-prop-stability.test.ts tests/unit/architecture/dashboard-wire-boundary.test.ts tests/unit/architecture/parity-reference-authority.test.ts
npm run test:parity -- tests/parity/dashboard-reference.spec.ts tests/parity/shell-navigation.spec.ts tests/parity/shell-accessibility.spec.ts tests/parity/shell-toast-floor.spec.ts tests/parity/toolbar-desktop-target.spec.ts tests/parity/top-bar-search-desktop-target.spec.ts tests/parity/kit-reference.spec.ts --workers=4
git diff --check
```

Parity global setup builds or proves the current production bundle through `ensureParityBundle`;
do not add a competing build. New shell specs consume existing fixture/seeded APIs. Preserve
required a11y evidence, reference/provenance assertions, membership, timeouts and wrapper verification.
The selected four-worker override is the only scheduling change.

Scoped ESLint includes every changed TypeScript/JavaScript source and test, including new helpers.
Resolve and retain its exact argv from the assignment's diff plus untracked authored files; the
following recipe includes new files without scanning ignored build/output artifacts:

```sh
python3 - <<'LINT'
import subprocess
base = 'f37a4f4be20a6ff6e806ce95070ce55f6e4ccd1f'
tracked = subprocess.check_output(['git', 'diff', '--name-only', '--diff-filter=ACMR', base, '--'], text=True).splitlines()
new = subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard'], text=True).splitlines()
paths = sorted({p for p in tracked + new if p.endswith(('.ts', '.tsx', '.js', '.mjs', '.cjs'))})
if not paths:
    raise SystemExit('No changed authored source/test paths found for implementation lint')
argv = ['npx', '--no-install', 'eslint', *paths, '--max-warnings', '0']
print(repr(argv), flush=True)
subprocess.run(argv, check=True)
LINT
```

During iteration run discriminating affected tests and scoped lint. Before each logical
implementation commit and S5 freeze, establish combined focused gates on final inputs. Rerun
invalidated checks after repairs, not unchanged full suites after every green micro-step. Run
filtered parity after final UI changes and before the last implementation commit. An authorized
`queue-day` refreeze uses `npm run test:parity:update -- tests/parity/dashboard-reference.spec.ts --workers=4`,
then inspect exact allowed reference changes and rerun the assert lane. No other reference family
may change merely because that command encountered it.

Git index, `dist/dashboard`, `tests/parity/.output`, bundle stamp, screenshot/profile state and
compiler/test evidence are private. Installed `node_modules` may be a read-only symlink; never
mutate shared dependencies. Tests use the runner's private `/tmp/hrt-<uid>/run-*` roots and ephemeral
HTTP/SSE ports, never 3938/5174 or operator state. Do not overlap bundle/parity writers in one
checkout. Use at most four file workers and record effective concurrency. Repair owned failures
without terminating another session's processes. Retain durable implementation evidence under
`/Users/julianhein/Projects/hr-shell-baseline-evidence-20260913/`; create it only if absent or verify
this assignment owns it. Copy/hash required artifacts before releasing their worktree or scratch.

3.1.9.8 combines seven exact candidates in either permitted order, resolves shared/generated outputs,
runs typecheck plus focused integration/regression/lint/build checks, and performs authorized
integration/cleanup. The two shell app-file exceptions change neither sibling APIs nor their write
sets, so no sibling dependency or merge-order constraint is added. Actual combination proof belongs
to the finalizer; no future-candidate combination is claimed here. Full coverage, whole-repository
lint/architecture, broad parity, production/performance/recovery/live proof and complete A01–A42/
D01–D05 acceptance remain **3.1.19**. No independent review is required at either boundary.

Recording-only changes use applicable documentation/link/twin/generated checks and `git diff --check`.
Reuse a gate only with its tested candidate/input hashes and inspected unchanged inputs. Changed
inputs, failures or missing evidence require rerun. An unrun broad gate never becomes PASS.

### Stop conditions, execution record and handoff

Routine implementation choices and repairs within S1–S5 stay with the supervisor. Stop dependent
work for changed prerequisite/ownership/base, unavailable required proof, shared/sibling/API/DS
changes, unexpected reference drift or a new material product/contract choice. No workaround through
DOM guesses, invented defaults, weaker assertions or another authority. Preserve the accepted
shell-only amendment without re-asking it.

At start/resume and after each verified S1–S5 step, send **Done / Now / Remaining** before the next
tool call. Maintain this owner's current-state record with checkout/base/head, scoped paths,
accepted proof, next action and every pending finalizer/integration/cleanup obligation. No worker
or independent review is pending. Use `/handoff` only for interrupted unique state; routine transfer
uses this committed owner.

At S5, commit/freeze the candidate and retain its ref and durable evidence for 3.1.9.8. Close owned
browser/server processes. A clean stopped worker worktree may be released from a separate safe
checkout after artifact custody is verified, retaining the candidate branch; otherwise report it
for finalizer cleanup. Do not remove an active supervisor checkout, delete an unintegrated candidate,
merge automatically, complete roadmap status before assigned integration/cleanup, or push.
The planner stops after verified prompt delivery and does not launch S1.

### Planning validation and delivery

Planning evidence: `/Users/julianhein/Projects/hr-shell-plan-evidence-20260913/`.
The planner records scoped documentation results here, verifies committed owner bytes against
S1–S5, confirms named-ref reachability and accepted prerequisite ancestry, then delivers the resolved
supervisor prompt. Product code, tests and reference images remain unchanged during planning.


| Planning check | Result and evidence |
| --- | --- |
| `npm run test -- tests/unit/architecture/roadmap-doc-binding.test.ts` | PASS: 24 tests, exit 0; `roadmap-binding.log`. The private runner scratch was removed after success. |
| `npx --no-install eslint tests/unit/architecture/roadmap-doc-binding.test.ts scripts/generate-roadmap.ts scripts/roadmap --max-warnings 0` | PASS, exit 0; `lint.log`. |
| `npm run roadmap` and `npm run roadmap:check` | PASS, exit 0; the generator output is unchanged from the planning base, and `roadmap-check.log` records freshness. |
| `python3 /Users/julianhein/Projects/hr-shell-plan-evidence-20260913/audit.py` | PASS: exactly three approved documentation paths, 12 owner/introduced links and fragments, nine byte-identical instruction pairs, maximum chain 18,376 bytes below 32,768, required control/test-path checks and both prerequisite ancestries. `document-audit.json` records inputs and results. |
| `git diff --check` | PASS. |

Only this task, the parent's bounded ownership amendment and the acceptance matrix's matching
pointer changed. A01–A42/D01–D05 outcomes, roadmap identities/statuses/dependencies, product code,
tests, scripts, configuration, dependencies and reference bytes are unchanged from
`f37a4f4be20a6ff6e806ce95070ce55f6e4ccd1f`. No full product gate is presented as new acceptance or
reused to claim this unimplemented behavior. Recording this table and spelling out existing owned
paths changes no checked heading, roadmap binding, link target, status or gate-script input;
the binding/lint results are reused on that basis. Final document audit, roadmap freshness and
whitespace checks are rerun before commit. Committed owner bytes, exact approved control coverage,
plan-ref reachability and prerequisite availability are verified again before prompt delivery.

The planning branch is the named delivery ref; documentation integration into master is not a
launch prerequisite under the approved allocation. A fresh supervisor creates its implementation
branch from the verified planning SHA and inherits the committed amendment. The plan ref remains
until its commit is integrated and no consumer needs it. Planning-worktree cleanup retains the
ref and external evidence; the final delivery receipt records the resolved SHA and cleanup facts.
