# Task 3.1.9.2 · Finish Settings over the canonical settings authority
<!-- roadmap: dash-settings -->

**Current delivery: complete — 2026-09-17.** Accepted candidate
`368496e0d55a259e8dd098c81a37bbcc9a966763` is incorporated into local master through
`c634e900f9858cf63e6ffb093581141a92dd1ecd`. Required focused child/group gates, integration
and owned cleanup are complete; see the [finalizer closure](task-9-8-finalization-dashboard-surfaces.md#accepted-integration-and-group-closure--2026-09-17).
Full acceptance remains 3.1.19. Earlier dated plan/freeze receipts below retain their historical state.

**Current assignment: 3.1.9.2.** Independent parallel task; launch only after the parent prerequisite is accepted and merged.
Read [the current identity map](README.md#current-task-identities) for naming and operator-controlled integration.
Follow the [execution cadence](README.md#execution-cadence--operator-amendment-2026-09-13): focused task checks, full repository gates only at 3.1.19, no independent review.
Earlier labels and filenames are recorded in the [rename map](README.md#earlier-labels-and-filenames).

**D341 (approved 2026-09-07).** Consume the detour’s application-only 86-row catalog. Test subjects,
canaries, fixture paths and shared test data are not Settings/Setup leaves or protected-setting
operations/readback. Do not add controls for them or reintroduce a source. The shared test-data
interface supplies this task’s fixtures; operational credentials retain D336’s independent authority.

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

Consume the [3.1.9 B ownership and working-interface record](task-9-establish-independent-dashboard-boundaries.md#b-implementation-and-child-release-contract--2026-09-13) at its accepted integration. The approved execution brief below and the [Settings ownership amendment](task-9-establish-independent-dashboard-boundaries.md#settings-child-ownership-amendment--2026-09-13) add the missing Settings projection and local wiring to this child. Other shared registration and generated outputs remain reserved.

> **D336 (2026-09-06):** ordinary settings are SQLite-owned; credentials are independently stored.
> Consume the existing catalog/revision/set-clear behavior and current settings activation through the service and protected
> write-only input through its independent operation. The file-target wording below is superseded.

- [x] Render every catalog leaf and implement revisioned edit/conflict/draft-reset/persisted-clear flows; protected
  values remain write-only and prove persisted readback by presence/revision.

> 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes `ref clock-config-secrets` §D331.10, the Settings/Setup edit
> contract: the surface renders the served catalog projection and nothing else. Edits go through
> §D331.5's two closed arms — `apply-settings` and `apply-protected-settings` — each CASing its own
> document's `expectedRevision`, with that section's closed refusal set (including
> `revision-conflict { currentRevision }`, which keeps the draft) mapped to fixed sentences that name a
> key or a document, never a value. Protected readback is exactly §D331.6's
> `{ present, valueId?, updatedAt? }` tuple plus the store revision. The `derived-host` row shows the
> observed primary display beside the active `display` override. P40/A8's deliberate re-freeze of the
> eleven `settings.json: not set` parity references happens HERE. No redesign.

The accepted 2.6 Settings activation amendment supersedes a blanket restart requirement: new runs
select the new committed settings snapshot; existing runs keep theirs. A stale unaccepted plan must
be reviewed again; exact accepted replay retains its original identity. Preserve process lifecycle
controls and process-owned configuration where they still apply. The current editor serves eight
leaves, and Reset only discards that leaf's draft. Complete the full served catalog and explicit
persisted-clear operation, independent protected settings and observed-host versus saved-display
readback. Preserve the accepted `Saved` badge; P40/A8 expansion and deliberate attributed refreeze
remain this task's work, using the current scene list rather than assuming eleven old copies survive.

Current baseline and acceptance: [3.1.8 inventory](task-8-dashboard-inventory.md) and
[frozen matrix and ownership](task-8-acceptance-matrix.md). Remaining checklist items require
their mapped outcome/proof; historical subfeature credit does not complete this task.

## Approved execution brief — 2026-09-13

The operator selected **A**: include the missing full-catalog and protected-presence read wiring
inside 3.1.9.2 through a bounded Settings ownership exception. The operator then approved the
complete S1–S4 proposal with `approve.`. This authorizes planning persistence and the following
fresh supervisor assignment. It does not launch implementation, accept a candidate, merge into
master, complete the roadmap task, or authorize a push.

### Current state, prerequisites and allocation

Planning inspected clean local `master` at `07221394ece638d5de9f38407654ad2b305f1f9f`.
The accepted 3.1.9 A integration `c990662e91604cfd38baa53e12bfb6e7c60610eb`, B integration
`3d4d8c0c64cf2e96096b193966a66741861d6f1c`, and accepted 3.1.8 baseline
`e182022edfa0cd05a46a74358cd3296bcade6e79` are ancestors. The current base also includes the
accepted shell child; that existing ancestry does not add a sibling prerequisite. Roadmap needs
remain `dash-truth-reset` and `dash-boundary-foundation`.

One **GPT-6 Astra medium supervisor**, zero implementation workers, zero independent reviewers.
The projection, typed drafts, privacy/readback, recovery and browser proof form one coupled Settings
delivery. Medium effort fits its cross-layer judgment; splitting producer and consumer across
parallel workers would create a dependency rather than independently acceptable work. Phase 3.1's
approved focused cadence omits independent review, including refreeze acceptance. The supervisor
inspects reference diffs and supplies attributed proof. No agent or sibling dispatch is assigned.

| Assignment | Branch and absolute checkout | Base and availability | Release and merge condition |
| --- | --- | --- | --- |
| Planning persistence | `codex/3.1.9.2-settings-plan`; `/Users/julianhein/Projects/hr-worktree-settings-plan` | Created from `07221394ece638d5de9f38407654ad2b305f1f9f` after approval | Commit and verify this complete brief and the parent amendment. Remove the owned planning worktree after verifying artifact custody, retaining the named plan ref. No master merge is assigned to the planner. |
| S1–S4 implementation | `codex/3.1.9.2-settings`; `/Users/julianhein/Projects/hr-worktree-settings` | Create from the final verified planning commit delivered by the planner; it contains the integrated prerequisites and approved ownership amendment | Freeze the passing focused candidate for operator-controlled 3.1.9.8 intake. Ultimate target is local `master` at `/Users/julianhein/Projects/hr-automation-rebuild`, only under an operator integration instruction. |

At discovery, only the primary worktree existed and both proposed paths/refs were available.
Recheck ref/path ownership, ancestry, committed plan content and the four-auxiliary-worktree
ceiling before implementation. Do not reset a colliding ref, switch the primary checkout, copy
operator state, or overwrite another session's work. A missing planned implementation branch is
expected: its creation from the delivered plan commit is assigned to the supervisor.

The retained planning ref is the documentation delivery path. Implementation creates its branch
from that verified commit and inherits the approved amendment; documentation integration into
master is not a separate prerequisite. Keep the plan ref until integrated and no consumer needs it.

### Requirements, feasibility and proof ownership

The [frozen A03/A04 requirements](task-8-acceptance-matrix.md#a03),
[Settings edit contract](../../../reference/clock-config-secrets.md#d33110--the-settingssetup-interface-edit-contract-31-consumes),
[independent credentials](../../../reference/clock-config-secrets.md#d336--sqlite-settings-and-an-independent-credential-store-operator-decision-2026-09-06),
and [current activation amendment](../../../reference/clock-config-secrets.md#c0-settings-activation-and-recovery--2026-09-09)
own behavior. D341/D343 exclude test inputs and retain provider keys in `.env.providers`.
The [Settings surface contract](../../../reference/dashboard-surfaces.md#98-settings-and-the-storage-doctor),
[frontend state ownership](../../../reference/frontend-backend-integration.md#4-state-ownership),
and [P40/A8](../../../reference/guards-and-tests.md#a8--the-settingsjson-not-set-parity-references)
remain applicable subject to their later amendments. Do not revive historical file authority,
ordinary environment precedence, blanket restart, mobile/coarse-pointer or historical pseudonym
consumer behavior from superseded prose.

| Requirement / current mechanism | Needed change and permitted owner | Acceptance proof and forbidden result |
| --- | --- | --- |
| `src/domain/config/catalog.ts` has 86 rows: 59 ordinary, 5 protected, 5 provider, 16 runtime-isolation, 1 derived-host. `src/domain/dashboard/settings-editor.ts` and `src/server/dashboard/queries/settings-editor.ts` still close the editor over eight paths. | S1 expands the dedicated Settings wire/query from the existing catalog and executable schemas; no second allowlist. Settings-local composition supplies authoritative values and value-free auxiliary reads. | Compare canonical catalog identities in both directions, including wildcard templates; reject unknown, duplicate, missing, wrongly classified and wrongly typed rows. Expanded fiscal-year instances do not redefine the catalog's 86-row count. |
| The existing resolver and `SettingsPatchSchema` already admit booleans, route objects, complete provider budgets, ordered model chains and `annualDates.FYyyyy.<leaf>`. Display overrides require both dimensions; each fiscal year requires all three dates. | S1 serves typed descriptors/validated fiscal-year templates. S2 supplies suitable structured controls and complete atomic operations for coupled records. | Prove every value category, optional/unset rows, valid new-year creation, invalid year/date/number/object/list and partial display/year rejection. No invented defaults, automatic previous-year fallback or client-invented writable key. |
| `patchFromDraft` currently turns an edit equal to a default into Clear; its Reset only discards an edit. | S2 retains explicit draft operations, including saved values equal to defaults, and distinguishes per-leaf Reset, Discard all and persisted Clear. | Set-to-default stays a saved override. Clear removes it. Display Clear restores the observed host-derived default through the existing pair constraint. An invalid mixed patch changes no authority. |
| The ordinary executor atomically saves/configures/journals; current settings readers and stale-plan tests already enforce new-run activation. | S1 serves a coherent ordinary snapshot; S2 consumes the existing command and checks matching readback before clearing confirmed drafts. Retain active identity fields needed by preflight. | Prove save/readback/reopen and concurrent-read coherence; current/new-run and stale-plan regressions stay green. No blanket restart or retroactive change to existing runs. Readback failure or later intervening save cannot masquerade as confirmation of every draft row. |
| `createProtectedSettingsRuntimeReader` and the independent credential store exist; dashboard Settings lacks its own complete presence read wiring. Storage doctor is not the editor's authority. | S1 wires the existing reader through Settings-local composition/query. S3 supplies an independent credential draft, revision and command, with presence-only readback. Provider availability uses the existing sole secret-family accessor; derived display uses established host facts. | Prove missing, present and unavailable states, independent revision/conflict, exact set/clear readback identity and redaction. Unknown is not missing. No value, digest, length or partial-value echo; no provider input. |
| `useEditableSettings` reload discards drafts, surfaces raw messages and labels all transport failures refused. Shared command parsing admits broader command/history shapes. | S2/S3 retain drafts while rereading conflict authority, require deliberate resubmission, map typed failures to fixed safe copy, bind result to submitted command/target and validate current protected readback through the five-name schema. | Conflict never auto-merges/resubmits. Foreign/stale/wrong-family results and legacy seven-name Settings readback do not become success. Exact retry preserves command/write identity; divergent input is not retried as the same attempt. |
| The existing protected executor can commit independently before a later audit failure; its tests cover uncertain/replayed outcomes. | S3 represents an unconfirmed response truthfully and retains the exact in-memory attempt for explicit retry. Never store secret drafts in browser persistence or mint a new identity merely because a response was lost. | Exercise pre-effect refusal, lost response after apply, failed readback, exact retry and intervening update. Reopening the page only shows current authority, not a claim that the abandoned attempt succeeded. Do not infer rollback from an error or success from presence alone. |
| Settings owns its draft lifetime and informs the accepted shell exit guard; Storage/preflight/Catalog consume existing props. | S2/S3 extend dirty protection to both drafts without changing sibling component contracts. S4 tests Settings exit/navigation and fixture composition. | Drafts survive section changes and cancelled exits; confirmed discard removes them. No sibling body/API, root registration, fixture-order or route-history regression. |
| Existing reference families contain 18 sets/54 files: `settings` 8, `settings-activation-saved` 2, `settings-activation-reset` 2, `storage-settings` 6. The activation spec uses CSS zoom. | S4 deliberately attributes owned reference changes, adds Settings states and proves actual browser zoom using the accepted tab-scoped browser mechanism. | No assumption that eleven historical copies remain. No CSS zoom claim as browser zoom, omitted titles, unrelated refreeze or weakened parity allowance. |

These are source/ancestry findings, not new execution PASS claims. The accepted backend tests are
mechanism evidence and regression inputs, not proof that the future full editor already works.
No actual operator migration, deployment or recovery is assigned. Real-composition proof uses new
private synthetic authorities and synthetic credentials; no operator-state inspection/copy or
external HR transaction is required.

### Exact change ownership and exclusions

All source paths below are repository-relative. New cohesive Settings-only helper modules are
permitted alongside the named owners; preserve component-only TSX exports and pure model boundaries.

| Scope | Permitted paths and limits |
| --- | --- |
| Settings UI and client | `src/dashboard/surfaces/settings.tsx`, `settings-model.ts`, `settings-editor.tsx`, `settings-editor-model.ts`, `settings-facts.tsx`, `settings-facts-model.ts`, `settings-hosts.tsx`, `settings-hosts-model.ts`, `settings-capabilities.tsx`, `settings-capabilities-model.ts`, `settings-keyboard.tsx`; `src/dashboard/client/settings-queries.ts`, `settings-commands.ts`; `src/dashboard/state/settings-client.ts`. Preserve provider object stability and the published Storage/preflight/Catalog/shell interfaces. |
| Approved backend projection exception | `src/domain/dashboard/settings-editor.ts`, `src/domain/dashboard/settings.ts`; `src/server/dashboard/queries/settings-editor.ts`, `queries/settings.ts`; `src/server/dashboard/routes/settings.ts`, `routes/settings-types.ts`; `src/server/dashboard/compose/settings.ts`. Add the needed catalog/protected/provider/host projection and Settings-local dependency wiring through the existing root registration. |
| Settings fixtures and tests | `tests/parity/helpers/fixture-settings.ts`, `fixture-settings-routes.ts`, `fixture-settings-activation.ts`, `reference-settings-scenes.ts`; `tests/parity/reference-settings.spec.ts`, `settings-activation.spec.ts`, new `settings-catalog.spec.ts`; existing Settings unit suites and new `tests/unit/server/settings-catalog-projection.test.ts`, `tests/unit/dashboard/settings-catalog-surface.test.ts`, `tests/unit/dashboard/settings-protected-surface.test.ts`. New synthetic Settings test helpers may live beside these owners. |
| Bounded test-construction and audit exceptions | Settings dependency construction in `tests/parity/helpers/seeded-services.ts` and `tests/unit/server/bff-flow.test.ts`; Settings-specific assertions/fixtures in `tests/unit/server/settings-runtime-reader.test.ts`, `tests/unit/dashboard/takeover-frame-focus.test.ts`, `surface-fixture-boundaries.test.ts`, `tests/unit/architecture/strict-boundary-schemas.test.ts`, `redaction-surface-scan.test.ts`, and Settings-only entries in `tests/unit/architecture/helpers/redaction-surface-audit.ts`. Preserve unrelated builders, custody, assertions and membership. |
| References | Existing `settings--*`, `settings-activation-saved--*`, `settings-activation-reset--*` PNG/a11y/metadata and new Settings-owned states. `storage-settings--*` may change only for shared Settings navigation, with exact attribution; Storage body semantics and facts remain its owner's. `reference-storage.spec.ts` is a verification input, not permission to redesign its cases. |
| Execution/evidence documentation | This task owner; the parent allocation amendment during planning. Implementation records actual changed paths, commands, accepted proof, reference attribution and pending integration/cleanup here. Requested lessons belong in the linked module ledger, not instruction-file churn. |

Do not modify catalog membership, ordinary/protected value schemas, credential storage/executors,
`src/server/settings-runtime.ts`, database schema/migrations, shared command unions, root BFF or
dashboard registration, aggregate query/command/provider/transport code, sibling production modules,
DS/specimen primitives, runtime-isolation configuration, operator state or test-data authorities.
The projection must compose existing authority readers rather than change their guarantees.
Settings source facts must describe current SQLite/credential/provider/host/deployment ownership,
not repeat obsolete `currentSource` environment/file migration metadata as current provenance.

No credential reveal, masked saved-value echo, comparator, copy/export or diagnostic settings dump.
No new cross-store atomicity claim, provider-key editor, canary/test-subject/fixture-path control,
advanced storage recovery, workflow-specific feature, external HR action, automatic merge or push.
Retain the historical-only purpose of `activityPersonPseudonym`; rendering its catalogued operation
does not restore retired Activity consumers. No guard addition/retirement is expected; if one becomes
necessary, apply the guard-inventory contract with deciding evidence rather than silently changing it.

### Ordered implementation steps

| Step | Outcome and required work |
| --- | --- |
| **S1 — Complete the served catalog** | Before edits, verify plan/base/ref/path/capacity and current scoped ownership; create the assigned worktree and private evidence namespace. Read module instructions, use `/ui` with Components lead, local execution and Operate mode, inspect the specimen through `playwright-cli`, and record baseline behavior/reference inventory. Implement the full strict catalog projection and Settings-local wiring from existing authorities. Keep ordinary values/revisions coherent and protected/provider unknown states explicit. Establish catalog/schema/source/redaction and structured-type negative controls. |
| **S2 — Complete ordinary editing** | Render every applicable ordinary row with source, validity, editability, sensitivity, current activation scope and persisted/active/default distinctions. Use typed scalar/structured controls; support server-served fiscal-year templates and coupled display/year records. Keep one atomic ordinary Save across sections, explicit Reset/Discard/Clear operations, input errors and Saved/Default badges. On conflict refresh current authority beside the unchanged draft and require deliberate resubmission. Clear only readback-confirmed drafts. Preserve preflight identity and new-run activation. |
| **S3 — Complete protected editing and recovery** | Add separate credential draft/revision/Save over the existing protected command. Inputs start empty, remain masked and never refill from readback; no reveal. Clear submits its explicit operation. Show only presence/write identity/time and revision, with next-use copy. Show provider availability/count without keys, deployment facts read-only and observed host beside saved display. Fixed refusal copy uses typed codes and served names, never raw messages. Bind command/readback identity, represent transport/audit uncertainty honestly, retain exact pending attempts for explicit retry, and extend existing dirty exits to both drafts. |
| **S4 — Prove and deliver** | Run complete focused proof, production build, scoped lint and affected browser/parity checks on final inputs. Use real isolated composition for ordinary/protected saves, conflicts, clear, interruption/readback and redaction. Inspect actual 125%/200% browser zoom in both themes. Deliberately refreeze only attributed permitted references, inspect diffs, then assert. Record final candidate/source/bundle/fixture/reference/evidence hashes, commands/exits and every deferred gate. Commit exact paths by logical category, close owned processes, preserve candidate/evidence for operator-controlled 3.1.9.8 intake and report remaining integration/cleanup. |

### Focused proof matrix

| Proof | Earliest stable step / required cases |
| --- | --- |
| **P1 — Complete and truthful catalog** | S1: two-way 86-row/template membership; all five source classes; correct source/editability/sensitivity/activation; no test inputs; corrupt/missing/duplicate/wrong-type/wrong-section payloads; provider missing/present/unknown without values. Ordinary snapshot identity must agree with its values. |
| **P2 — Types and atomic omission** | S1/S2: text, positive/nonnegative integers, empty/invalid numeric text, booleans, dates, paths/URLs, route objects, full budgets and ordered model chains; new fiscal year and all three required dates; partial display/year and mixed valid/invalid patches; saved-to-default versus omitted values; Reset/Discard versus explicit persisted Clear; readback/reopen and host observation. Failed validation changes no authority. |
| **P3 — Conflict and confirmation** | S2: competing save while draft is open, fresh revision/current values beside retained edits, explicit retry after review, no automatic merge; matched command/result/readback, failed or stale readback after apply, another writer between apply and readback, foreign/wrong-family result. Preserve unconfirmed edits and truthful state. |
| **P4 — Independent protected operations** | S3: missing/present/clear, valid and invalid per-name values (including the structured historical entry), independent ordinary/protected revisions and outcomes, protected conflict, successful readback identity, unavailable store, and rejection of legacy seven-name readback on this live surface. No ordinary mutation from credential Save or vice versa. |
| **P5 — Interruption, exact retry and privacy** | S3: request refusal before effect versus lost response after effect; retained exact command/write identity, exact replay, divergent retry, intervening update, and failed readback/audit without a false rollback/success claim. Synthetic sentinels must be absent from GET/readback, errors/diagnostics, console/logs, accessible output, saved DOM content, snapshots and journal evidence; the masked write-only input is the transient user-entry boundary. Reuse existing credential-store/history regression coverage for unchanged internal semantics. |
| **P6 — Integration and desktop** | S4: Settings navigation, section persistence, ordinary/protected cancelled/confirmed exit, keyboard save/error focus, both themes, minimum 1024×720 canvas and desktop resize; actual 125%/200% browser zoom, reachable scrolling/footer/controls and focus restoration. Preserve Storage/preflight/Catalog contracts and forward/reverse fixture registration. Current/new-run, stale-plan and historical protected regressions remain required. |

The supervisor can repair tactical implementation/test setup failures inside these outcomes.
For a definitive `write-id-reused` refusal, follow the contract's explicit recovery with a fresh
write identity without demanding re-entry; this is distinct from retrying an uncertain attempt,
which must keep its original identity. Do not weaken ordering or identity checks to make a case pass.

### Gate commands, resources and reference policy

Run from the assigned implementation worktree. The following are exact focused inputs; S1/S3 create
the three new unit files and S4 creates the new catalog browser spec before final candidate gates.

```sh
npm run test -- tests/unit/dashboard/settings-editor-surface.test.ts tests/unit/dashboard/settings-editor-client.test.ts tests/unit/dashboard/settings-takeover.test.ts tests/unit/dashboard/surface-fixture-boundaries.test.ts tests/unit/server/settings-runtime-reader.test.ts tests/unit/settings-activation/save-create.test.ts tests/unit/settings-activation/stale-plan.test.ts tests/unit/server/settings-catalog-projection.test.ts tests/unit/dashboard/settings-catalog-surface.test.ts tests/unit/dashboard/settings-protected-surface.test.ts
npm run test -- tests/unit/architecture/settings-catalog.test.ts tests/unit/architecture/strict-boundary-schemas.test.ts tests/unit/architecture/redaction-surface-scan.test.ts
npm run test -- tests/unit/config/credential-store.test.ts tests/unit/protected-settings-history.test.ts tests/unit/dashboard/takeover-frame-focus.test.ts tests/unit/server/bff-flow.test.ts
npm run web:build
npm run test:parity -- reference-settings.spec.ts settings-activation.spec.ts reference-storage.spec.ts shell-navigation.spec.ts settings-catalog.spec.ts --workers=4
git diff --check
```

Lint every changed authored code/test file, including untracked additions, with zero warnings.
This reproducible selector records the exact argv and avoids ignored build artifacts:

```sh
python3 - <<'LINT'
import subprocess
base = '07221394ece638d5de9f38407654ad2b305f1f9f'
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

During iteration, run discriminating focused tests and scoped lint. Before each logical implementation
commit and S4 freeze, establish the applicable focused checks on final inputs; run the combined
focused selection at candidate completion. Repeat invalidated checks after repairs, not unchanged
broad suites after each small cycle. Preserve assertions, discovered membership, isolation, deadlines
and floors. Use at most four file workers; parity's explicit `--workers=4` overrides its five-worker
default. Confirm effective concurrency through resolved config/output. No independent review step.

Actual-browser proof uses `playwright-cli` and the platform playbook, with snapshot-before-locator
selection. Inspect the existing specimen before selecting primitives. For actual zoom, reuse the
accepted shell delivery's reproducible tab-scoped `chrome.tabs.setZoom/getZoom` mechanism under an
owned Chromium profile/extension, verifying 1.25 and 2 and recording viewport/geometry/focus receipts
on the current Settings bundle in both themes. The shell task's committed delivery record names
the retained mechanism and artifacts; recreate owned files and close the session. Do not claim
`document.documentElement.style.zoom` or deviceScaleFactor as browser zoom. Existing CSS-zoom
references may retain their actual attribution while the separate actual-zoom proof supplies D04.

Add Settings-owned catalog/protected/structured-value/conflict/read-only scene coverage through
`settings-catalog.spec.ts` and surface-specific helpers. Preserve all existing scene identities and
titles. Before refreeze, record a complete discovered title/reference census and the expected visible
change. Use:

```sh
npm run test:parity:update -- reference-settings.spec.ts settings-activation.spec.ts reference-storage.spec.ts settings-catalog.spec.ts --workers=4
```

That command is not permission to update every file it encounters. The approved allowlist is the
three Settings families and new Settings-owned states; the six existing `storage-settings` sets
may change solely because of shared Settings navigation. Attribute exact filenames and before/after
hashes with the requirement causing each changed PNG/a11y/metadata item. Inspect the visual and
accessibility diff, preserve unchanged metadata, and rerun the assert command above. Unexpected
Storage-body, non-Settings or other-family drift stops dependent refreeze work. Do not lower pixel
tolerance, discard titles or change unrelated fixture facts. The baseline has 18 sets/54 files;
new states are additions, not permission to remove those cases.

The Git index, compiler evidence, `dist/dashboard`, `tests/parity/.output`, screenshot/profile state,
fixture roots and evidence namespace must be private. Installed `node_modules` may be a read-only
link; do not install into or mutate that shared directory. Use the runner's private
`/tmp/hrt-<uid>/run-*` roots and ephemeral HTTP/SSE ports, never 3938/5174 or operator state.
Do not overlap build/parity writers in one checkout. Keep test/provider/credential values synthetic;
no external HR action or operator credential change is assigned. Retain implementation evidence at
`/Users/julianhein/Projects/hr-automation-rebuild-evidence/hr-settings-evidence-20260913/`, creating it only if absent or verifying
this assignment owns it. Record commands, effective workers, tested inputs, exit status and artifact
hashes; preserve required evidence before releasing scratch/worktrees.

The Settings-only shared-test edits do not assign sibling behavior or root interfaces. 3.1.9.8
combines exact candidates, resolves shared/generated output and any independently changed reference
hunks, proves the assigned either-order combination, runs typecheck and focused integration/lint/
affected build checks, then completes operator-authorized integration/cleanup. No future merge result
is claimed by planning. Full coverage, whole-repository lint/architecture, broad parity, production,
performance, recovery, live acceptance and complete A01–A42/D01–D05 remain **3.1.19**. No unrun proof
becomes green. Any affected generated artifact must be regenerated through its owner, never by hand;
an unexpected need to alter reserved generated/runtime inputs returns for allocation.

### Stop conditions, progress and delivery

Stop dependent work for changed prerequisites/ref ownership, missing required proof, necessary
changes outside the bounded Settings projection/test/reference exception, unexpected reference
drift, or a new material product/contract choice. Routine coding choices and tactical corrections
within S1–S4 remain with the supervisor; do not re-ask the approved ownership choice. No fallback
through a second authority, guessed values, swallowed errors or weaker checks.

At start/resume and after each verified step, send **Done / Now / Remaining** before the next tool
call. Maintain this task's current state with branch/base/head, scoped changes, accepted proof,
next action and all pending finalizer/integration/cleanup work. No workers or independent review
are pending. Use `/handoff` for interrupted unique state, not a second standing plan.

Commit/freeze the focused candidate and preserve its branch/evidence for 3.1.9.8. Close owned browser,
server and extension/profile resources. Release a clean stopped worker worktree only from a separate
safe checkout after preserving artifacts, retaining its candidate ref; otherwise report it for
finalizer cleanup. Do not remove an active supervisor checkout or delete an unintegrated candidate.
Development completion is distinct from assigned integration/cleanup and roadmap completion. Do not
mark this task implemented during planning or claim group release before 3.1.9.8. Never push.

### Planning validation and delivery

Planning evidence is retained at `/Users/julianhein/Projects/hr-automation-rebuild-evidence/hr-settings-plan-evidence-20260913/`.
The planner validates doc binding, scoped lint for any executed documentation test, generated roadmap
freshness, local links, existing instruction twins/chains, exact changed-path scope, complete approved
controls and Git ancestry. Read back this entire section from the final plan commit, verify named-ref
reachability and creation from the plan SHA, then remove only the owned planning worktree while
retaining the branch and evidence. Product code/tests/references remain unchanged during planning.
Record the scoped results here before handoff; no product gate reuse or new runtime PASS is claimed.

| Planning check | Result and evidence |
| --- | --- |
| `npm run test -- tests/unit/architecture/roadmap-doc-binding.test.ts` | PASS: 24 tests, exit 0; `roadmap-binding.log` and its command JSON. The runner removed successful private scratch. |
| `npx --no-install eslint tests/unit/architecture/roadmap-doc-binding.test.ts scripts/generate-roadmap.ts scripts/roadmap --max-warnings 0` | PASS, zero warnings, exit 0; `scoped-lint.log` and command JSON. |
| `npm run roadmap`; `npm run roadmap:check` | PASS, exit 0. Generation produces the same `docs/roadmap/index.html` bytes as the planning base; `roadmap-check.log` records freshness. |
| `python3 /Users/julianhein/Projects/hr-automation-rebuild-evidence/hr-settings-plan-evidence-20260913/audit.py /Users/julianhein/Projects/hr-worktree-settings-plan` | PASS: exactly two approved documentation paths, 17 links/fragments, 19 existing/planned test paths, nine byte-identical instruction pairs, maximum chain 18,376 bytes below 32,768, all execution-control sections and prerequisite ancestries. `document-audit.json` records inputs/hashes. The first audit run's literal label check was corrected from `Settings-only dependency construction` to the actual `Settings dependency construction`; no plan scope was changed to satisfy it. |
| Source and whitespace boundary | PASS: `git diff --check`; no product/test/config/dependency/instruction/reference or generated-roadmap changes from `07221394ece638d5de9f38407654ad2b305f1f9f`. No implementation or broad acceptance gates were run or claimed. |

The recording table changes no source, test, tool/configuration input, links, requirement, task
identity, acceptance status or ownership. Scoped lint is reused against its unchanged input bytes;
binding/freshness/audit and whitespace are checked again after this table and before commit.
The planner's external `commit-verification.json` records the final full plan SHA, committed-document
hashes, named-ref reachability, prerequisite ancestry and worktree/ref availability after readback.
Planning-worktree cleanup retains the named branch and durable evidence. The outgoing prompt uses
that verified plan commit as the implementation creation base; no master merge or implementation
dispatch is assigned to this planning stage.

### Implementation execution record — 2026-09-13

The supervisor created `codex/3.1.9.2-settings` at
`/Users/julianhein/Projects/hr-worktree-settings` from the exact approved plan commit
`e89a8fb7fb0105d0765e08120d6f64064ff01ab2`, after checking ref/path ownership,
capacity and all three prerequisite ancestries. The retained plan ref still names that commit.
One supervisor executes locally; zero workers and no independent review under the Phase 3.1 cadence.

At the first S4 checkpoint, S1–S3 were implemented in the allocated Settings projection,
ordinary/protected editor and tests. The passing candidate record below supersedes that checkpoint. Evidence lives at `/Users/julianhein/Projects/hr-automation-rebuild-evidence/hr-settings-evidence-20260913/`.
The exact ten-file unit gate passed 91 tests. The first real HTTP browser proof passed in both
themes, including independent saves, conflicts, explicit clear, response loss after effect, failed
readback, exact retry, privacy, cancelled/confirmed dirty exits and focus restoration. Actual
Chromium tab zoom read back 1.25 and 2 in both themes, with CSS zoom 1, reachable ordinary and
protected footers, retained drafts, keyboard error focus and confirmed exit restoration.
Final gate and reference results will supersede these iteration results below.

**Reference allocation clarification.** The six `storage-settings` cases retain their existing
blank Settings route, which renders General rather than the Storage body. The supervisor showed
the proposed General body and requested an amendment; the operator replied “keep going”, and
the supervisor explicitly stated that this authorized attribution of those General changes.
These six sets may therefore include the completed General catalog/editor and shared navigation.
The Storage warning band, source facts, body code and test assertions remain unchanged.
The before/after proposal is retained as `storage-settings-proposed.png` and `.yml`.

The first complete parity assertion also found four `storage-doctor-degraded` sets whose shared
Settings navigation changes and seven inherited `storage-queue` stale empty-state references.
The latter reproduce identically on an untouched private export of the exact plan commit;
`base-reproduction.json` and `base-storage-queue.log` record that proof. The operator explicitly approved “Approve 11 reference-only fixes”. The four Storage-doctor
sets may change only for shared Settings navigation; the seven queue sets may replace only the
proven stale empty-state copy. All code, facts, case identities and assertions remain unchanged.
Exact before/after hashes and semantic/pixel attribution are required for each changed item.

That checkpoint retained an uncommitted candidate while focused gates and reference attribution
finished. Final candidate/evidence commits and owned-resource cleanup are recorded below. 3.1.9.8 intake, operator-controlled integration and eventual
worktree cleanup remain separate; all 3.1.19 broad gates remain deferred. No merge or push is assigned.

### Passing implementation candidate — 2026-09-13

S1–S4 and P1–P6 are complete for this child's development scope. The catalog projection contains
all 86 entries: 56 concrete ordinary rows plus three served fiscal-year templates, five independent
protected operations, five provider availability families, sixteen deployment facts and one host
observation. Ordinary records retain atomic coupled fields and explicit set/clear semantics;
per-leaf Reset preserves other deliberate edits. Both authority drafts survive conflicts, require
explicit resubmission, retain exact uncertain attempts and clear only after matched result/readback.
Credential values remain transient masked input; readback exposes only presence and write metadata.

| Focused proof on candidate inputs | Result / retained evidence |
| --- | --- |
| Exact ten-file unit command above | PASS: 91 tests / 10 files; `unit-final.log`, command JSON. |
| Exact catalog / strict-boundary / redaction command above | PASS: 42 tests / 3 files; `architecture-final.log`, command JSON. |
| Exact credential / history / focus / BFF command above | PASS: 202 tests / 4 files; `regression-final-fixed.log`. The first run exposed the BFF fixture's old invented Settings fingerprint; only its Settings construction and complete section expectation changed. |
| Scoped lint, exact selector above | PASS: zero warnings; `lint-final-argv.json` and `lint-final.command.json` contain the exact argv and input hashes. |
| Additional scoped compiler | PASS: `compiler-candidate.log`; external `tsconfig.focused.json` includes every changed authored file and its import closure. This does not claim the finalizer's full typecheck. |
| `npm run web:build` | PASS: `build-final.log`; bundle input digest `c190e455b50214544179677b395659268706e1a4c883e197d14ab8b4f5a75395`, output digest `070487ee69fa54ccbabb55735934947ba2bdc6ce5c1e5d65e3fe0b95452c4864`. The existing bundle-size advisory remains non-fatal. |
| Exact deliberate refreeze command above | PASS: 39 browser cases, maximum four workers; `refreeze-final.log`. |
| Exact five-spec parity assertion above | PASS: 45 browser cases, four workers; `parity-final.log` and retained `parity-final-output/results.json`, including required body-backed a11y attachments. |
| Reference attribution / complete discovery | PASS: all 288 previous discovered titles remain; 12 new titles bring discovery to 300. All 693 baseline files remain; 30 new files make 723. The 88 changed/added items are 58 existing PNG/a11y files and 30 new Settings scene files. No existing metadata changed. `reference-attribution.json` gives every path, before/after SHA-256, requirement and pixel bounds; `reference-a11y.diff` preserves semantic diffs. |
| Actual Chromium zoom via `playwright-cli` | PASS: 1.25 and 2 read back through tab-scoped `chrome.tabs.getZoom`, both themes, CSS zoom 1. Canvas stays 1024×720; effective viewports are 1024×576 and 720×450. Ordinary/protected controls and footers remain reachable; section drafts, keyboard error focus and cancelled/confirmed exits are verified. `zoom-proof.js`, `zoom-provenance.json`, `zoom-receipts.json` and screenshots retain the mechanism and geometry. |
| Source and whitespace boundary | PASS: `git diff --check`; all authored Settings/test paths are bound by `candidate-authored-inputs.json`. Runtime authorities, root wiring, catalog membership, schemas, dependencies, DS primitives, Storage/queue code, guard inventory and instruction twins are unchanged. |

The original 18 Settings-related reference sets remain. The eleven additional existing sets are
only the operator-approved exceptions above. Pixel bounds prove that Storage-doctor and existing
System-host/capability body pixels are unchanged; their differences stay within the 220-pixel
Settings navigation. Every queue a11y diff contains exactly the one inherited empty-state line.
New synthetic scenes use revision two for saved values; revision one correctly rejects nonempty
settings. Captures preserve real CSS-zoom attribution separately from actual browser zoom.

`candidate-nondoc-inputs.json` binds source/test/reference bytes; `final-reference-hashes.json`
binds the complete corpus. `gate-reuse.json` records the sole late BFF test-fixture correction and
which independent gates stayed valid. `final-bundle/` retains the tested build. The final Git
candidate and evidence hashes are recorded in the external delivery receipt after commit, avoiding
a self-referential commit hash in this document. No independent review is pending or claimed.

Documentation binding, roadmap freshness, scoped documentation lint, local links, existing twin
identity/chains and cleanup are checked during final delivery. Finalizer-owned work remains:
3.1.9.8 intake and combined gates, explicit operator integration into local master, then candidate
worktree/branch cleanup. The stopped implementation checkout and candidate ref remain in custody
until that integration decision. Full coverage, repository-wide gates and broad acceptance remain
3.1.19. This development record does not mark the roadmap task integrated or release downstream work.

Final documentation checks pass: 24 roadmap-binding tests, zero-warning documentation lint,
generated-roadmap freshness, fifteen local links/fragments, nineteen required test paths,
nine byte-identical instruction pairs and a maximum instruction chain of 18,376 bytes
(under 32,768). The ownership audit accepts exactly 118 allocated source/test/reference/document
paths, including the operator-approved reference-only exceptions. No guard was added or retired.

Owned fixture servers and all owned Chromium sessions are stopped. Temporary extension/profile
files are removed after retaining their source, scripts and receipts. The baseline diagnostic
export was removed after preserving its report and bundle hashes. `cleanup.json` records custody.
The worker checkout remains in place, stopped, for 3.1.9.8; removing an active supervisor checkout
or an unintegrated candidate is not assigned. No operator state, primary checkout edits or pushes
were made.

For the 200% screenshots, Chromium's default screenshot clip interpreted the scrolled viewport
in unzoomed capture coordinates. `zoom-capture.js` uses the measured zoom/DPR to express the
clip in capture coordinates, through CDP inside `playwright-cli`; it does not alter page zoom.
`zoom-confirmed-dark-2.png`, `zoom-confirmed-light-2.png` and `zoom-confirmed-receipts.json`
are the inspected viewport captures. Earlier capture attempts remain diagnostic artifacts.
The Save control is visible with focus at the viewport bottom; the independent hit-test receipt
also confirms it is reachable after document scrolling.
