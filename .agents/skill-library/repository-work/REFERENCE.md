# Repository operating reference

Detailed guidance moved from the root instruction pair on 2026-09-04. Read only the
sections relevant to the task, as routed by the root `AGENTS.md`. This is an operating
reference, not a second plan or contract: the roadmap, admitted phase doc, and owning
`docs/rebuild/reference/` contract win on disagreement. The as-built descriptions below
are the pre-1.6 baseline unless they explicitly name a landed 1.6 seam; verify current
status against the owning phase before implementation.

## Current code paths — 2026-10-01

The current source and dependency map is `docs/rebuild/reference/codebase-structure.md`. Use it
when an older section names a moved module; dated path narratives preserve their original revision
evidence. Active checked-in migration/provenance inputs live under
`docs/rebuild/migrations/legacy/`; canonical field inventory and pending implementation bindings
now live under `src/models/fields/` and `src/backend/app/registries/`.

The operator retired the `tests/scenario/` and `tests/parity/` suites on 2026-10-02. Their commands,
layouts and acceptance descriptions below are historical. Do not restore those suites; any future
scenario or visual-test design requires a separate operator-led task. Workflow scenario IDs remain
declaration data, not test evidence. The current suite map is
`docs/rebuild/reference/codebase-structure.md`.

## Before you start

Read the assigned brief and the relevant owning reference contract before implementation.

- `docs/rebuild/reference/` — the contracts, each doc owning its own; in prose **`ref <slug>`**:
  `task-contract` (tasks, stores, drivers) ·
  `workflow-model` (the builder, descriptors, the run state machine) · `dashboard-surfaces` (spans,
  the ONE projection, every surface) · `execution-and-sessions` (workers, queues, browser sessions) ·
  `data-intake-and-edit-data` (extraction, OCR, intake, Edit Data) · `write-safety` (the write
  sequencer, intents, the ALWAYS-GATE) · `guards-and-tests` (the guard/test architecture) ·
  `clock-config-secrets` (clock, config resolver, secrets) · `operator-trust` (failures, receipts,
  knowledge, the explorer) · `frontend-backend-integration` (the BFF and wire) ·
  `stores` (the DERIVED store
  catalog — read it before authoring a task, and remember the code wins over it).
- Read the owning reference and nearest module `AGENTS.md` before kernel, driver, dashboard, or write-safety changes.
- `docs/rebuild/guard-inventory.json` — the reviewed guard manifest. `tests/architecture/`
  must match it exactly, both directions.

**A decision is not ratified until it lands in its owning doc, in the same commit that records it.**
The owner gets the normative text.

## Commands

```bash
npm run typecheck          # tsc --noEmit over src/, tests/, scripts/ — one program, no exclusions
npm run lint               # eslint src tests scripts --max-warnings 0 — zero-debt, no manifest
npm run test               # registered unit + integration + architecture projects
npm run test:unit          # deterministic units only; positional file filters allowed
npm run test:integration   # real-resource and composed workflow proofs; run deliberately
npm run test:architecture  # the guard suite alone
npm run test:coverage      # 60/80 lines/statements/functions floors + the suite-size report
npm run test:watch
npm run test:reap          # reclaim only validated inactive owned test-run roots; retain live/unknown runs

npm run cli               # the runtime CLI (help | phase | dashboard | worker | dry-run-scenario | explain | storage | ocr)
npm run cli -- dry-run-scenario <workflow> --subject <label> # missing rehearsal manifest reports unavailable before execution
npm run cli -- storage backup  # the ONLY writer of a verified SQLite backup (D322); `storage doctor` / `storage restore --from` beside it
npm run dashboard         # the dev dashboard in ONE terminal: BFF (3938) + vite (5174); Ctrl+C stops both
npm run cli -- dashboard  # the BFF alone; `dashboard:prod` passes --prod and serves dist/dashboard from it (run web:build first)
npm run web               # the vite dev server alone, proxying /api to a BFF you started yourself
npm run web:build         # production bundle into dist/dashboard

npm run build:manifest     # regenerate src/workflow-kit/validation/generated-build-manifest.ts
npm run build:manifest:check # fail if the committed manifest is stale
npm run stores:catalog     # regenerate the generated §2 task catalog in docs/rebuild/reference/stores.md
npm run stores:catalog:check # fail if the committed catalog is stale
```

`build:manifest` recomputes every descriptor's `contractFingerprint` from its source closure. Run it
after ANY edit under a descriptor's import closure (including `src/models/**`, `src/rules/**` and
`src/workflow-kit/**`) — `descriptor-coverage` regenerates and fails on a diff, so a stale manifest is a
red gate, not a silent drift.

Vitest schedules at most four isolated file forks (or the available CPU count when lower).
The 2026-09-02 full coverage gate repeatedly timed out its 30-second fixture/guard checks at the
CPU-derived ten-fork default on an 18 GiB host; the same 388 files / 4,795 tests passed with four.
Keep per-file isolation, in-test concurrency, test membership, coverage floors and the 30-second
limits intact. Run full coverage without a concurrent compiler/linter gate; reduce contention
before treating a full-suite timeout as permission to weaken a check.

Phase 3.2 onward uses [verification checklist](../../../docs/rebuild/reference/guards-and-tests.md):
focused tests/lint/affected checks for all within-phase work, full gates and repairs at phase exit.
This overrides the older default/group schedule below; Phase 3.1 retains its own exception.

D191 in `docs/rebuild/reference/guards-and-tests.md`  owns documentation-only checks,
unchanged-input evidence reuse and concurrent gate scheduling. Its 2026-09-09 amendment assigns
focused tests/scoped lint/quick checks to Phase 3 and future parallel workers, and full gates plus
fixes to the named finalizer. Other in-flight assignments keep their explicit cadence until revised.

The gate family is deliberately plain (`typecheck`/`lint`/`test:coverage`, D191 — `test:coverage` is
a strict superset of the earlier `test`+`test:architecture` pair and measured faster); the old
`*:rebuild` names retired with D93 and the `rebuild:` runtime prefix with D247 (2026-08-20) — this is
its own repository, so its commands are plain `cli` / `dashboard` / `web`. See "Operational
isolation" below for what still MUST differ from the legacy checkout.

## Cross-repo rules (D93/D94)

**The legacy repo is a frozen production reference, not a dependency.**

- **Never import, invoke, proxy, or read the legacy repo's live state from `src/`.** Two
  repositories share no module graph — this is now structural, not merely banned. Finished lint,
  type, test, architecture, performance, smoke, Duo, and generated gates are self-contained
  too: read-only porting work may consult legacy, but a committed gate may not resolve its checkout.
- **Porting = copy with provenance.** When you bring verified knowledge across (a selector, a
  parsing rule, a page-state fact), copy it and record **the legacy commit hash and source path** in
  the ported code. Never link it at runtime — which is impossible anyway.
- Record copied source commit and path in the assigned brief's evidence folder. Root `AGENTS.md` owns live re-verification and production isolation; the codebase map names current selector fixtures and readers.
- **Nothing in the legacy repo may be deleted** during the rebuild or the initial cutover. The whole
  repository is the D89 rollback asset.
- Never restore a `../hr-automation` or `HRAUTO_LEGACY_REPO` execution dependency to a finished gate.
- Inventories that span both repos (`src/models/runtime/runtime-environment.ts`) mark legacy paths with an
  explicit **`legacy:` scheme**. Both repos have a `src/` — `src/cli.ts` exists in both — so a bare
  path is ambiguous. Unprefixed always means this repo.

## Operational isolation

A repository boundary does not separate two runtimes on **one machine**. `config/runtime-isolation.json`
pins what must differ, and `operational-isolation.test.ts` proves it:

|                           | legacy                                           | rebuild                                                      |
| ------------------------- | ------------------------------------------------ | ------------------------------------------------------------ |
| state root                | `.tracker`                                       | `.tracker`                                           |
| artifact root             | `.tracker`                                       | `.tracker/artifacts`                                 |
| backend / frontend port   | 3838 / 5173                                      | 3938 / 5174                                                  |
| process locks             | `.tracker/daemons`                               | `.tracker/locks`                                     |
| browser profile / session | `.auth` / `hrauto-legacy`                        | `.auth` / `hrauto-rebuild` (D216 — roots are repo-relative and never collide; the SESSION namespace is the distinct half) |
| launch commands           | `dashboard`, `dashboard:prod`, `dashboard:watch` | `dashboard`, `dashboard:prod`, `cli` (D247 — names may coincide; each must be byte-exactly its declared script) |

Command NAMES are not an isolation resource (D247): a muscle-memory `npm run dashboard` in the wrong
checkout starts that checkout's dashboard on its own port under its own roots and locks, which the
rows above make legible and harmless. The state root NAME is not one either (D321, 2026-09-03): both
repos use `.tracker`, a repo-relative root that never collides across checkouts, exactly as D216
argued for `.auth`; the artifact root, lock root, ports and session namespace still differ. The
as-built settings authority (`settings.json` + its `.authority.json` / `.prepare.json` / `.rollback.json` /
lock siblings) lives INSIDE the state root since D321, beside the database whose command journal
proves it, so deleting `.tracker` removes both halves together and the next `npm run dashboard`
regenerates the root, a fresh migrated database and the never-applied revision-1 settings baseline.
A settings file that outlives its database refuses by name ("no durable command journal") — that is
the fail-loud rule working; never reset it by discarding one half silently. The state root holds only
what the runtime writes on demand; an authority backup exists only after `npm run cli -- storage
backup` (D322 — no start/interval/drain cadence, no stale-backup alert). Isolation values reach the runtime through one
exported direct-`const` `defineRuntimeIsolation` call that `src/cli.ts` consumes in the declared
exported `runCli` runner. The secure environment bootstrap is that runner's sole production invoker;
an identifier mention, another function, or direct module execution is not proof.

D327 plans the replacement without claiming it built, and 0.3 designed it (closed 2026-09-04) as three
contracts 1.6 implements EXACTLY, without redesign: **D330** the run-record lifecycle service (ref
dashboard-surfaces : identity tuple, three-way existence, the seven-state machine,
`version` CAS + `claimGeneration` fence, one total queue order, D308 delete behind the tombstone, the
adapter boundary and its guard), **D331** the settings catalog and protected `.tracker/settings/` root
(ref clock-config-secrets : the closed 88-row catalog, five source classes, two CAS
arms, write-only protected values, `settings > default` with the environment gone as a resolver input),
and **D332** the one stopped-system `cli storage upgrade` with its preflight, journal, rollback, boot
matrix and adapter roster A0–A8 (ref dashboard-surfaces  D332, its settings half in
clock-config-secrets, the deletion tests in ref guards-and-tests). Until 1.6 lands, the
as-built authorities described above stay in force. Doc 01 §1.6 binds each 1.6 task to one seam, gate,
integration order and deletion test; 2.6 revalidates downstream consumers, and 3.1 finishes the
dashboard. Provider API keys remain the sole `.env.providers` class; credentials and local canary inputs move
under the protected settings root; D324's host display stays a derived default. The D321
state-root/journal coupling, D308 terminal-only delete/tombstone semantics, and D322 explicit-only
backup rule remain binding.

## Live verification — standing pre-authorization (always available, never ask)

**The live environment is always available, and reaching it for verification is pre-authorized.
Never ask whether live access is up, whether to spend the live session, or to confirm a Duo prompt —
assume yes and proceed.** This covers the whole range: a read-only selector `snapshot`, a login smoke
check, a live collector, and a full live workflow dry-run against real UCPath / CRM / Kuali /
ServiceNow / I-9. Duo is cleared hands-off by Duo Autopilot on every verification path, so there is
no phone-approval step and nothing to sign off. The safety boundary for a live _workflow_ run is
`dryRun=true` (no UCPath transaction, no Kuali finalization) — that, not gated access, is what keeps
a live run safe. If one system is genuinely down, skip it and proceed with the rest.

Mapping or verifying a selector is **pre-approved** — do it whenever a fix or debugging needs it, and
never pause to ask. A `snapshot` is a read-only view of a page; treat it like running a test.

`playwright-cli` runs **headless by default**. The loop is: open headless → `snapshot` → read the ref
ids → confirm or repair the locator.

```bash
playwright-cli -s=sel open "<url>"          # headless — just omit --headed
playwright-cli -s=sel snapshot              # accessibility tree + ref ids
playwright-cli --raw snapshot > /tmp/s.yml  # grep-friendly dump for big pages
playwright-cli -s=sel close
```

**Auth-gated pages (UCPath/PeopleSoft, CRM, Kuali, ServiceNow, I-9) — use Duo Autopilot.** The
`duo-autopilot/` extension answers the Duo MFA WebAuthn ceremony itself, so an auth-gated login runs
unattended. You still fill the SSO username/password from `.env`
(`UCPATH_USER_ID` / `UCPATH_PASSWORD`). It needs Playwright's **full** bundled Chromium
(`channel: chromium`) — the lightweight headless shell cannot load extensions. See
`duo-autopilot/README.md`. The one thing it cannot do unattended is a brand-new credential
enrollment.

**Always** `close` the session when done and sweep orphans (`playwright-cli list` →
`playwright-cli close-all`) — these are real Chromium processes.

Use this repository's store drivers and selector registry for live verification. Read legacy only
for porting provenance; never restore a live legacy dependency (D93/D150).

## Environment

`.env.providers` is gitignored and NOT part of the repo. Create it safely with `umask 077` and
`install -m 600 .env.example .env.providers`, then fill only supported provider pool cells.
Keep an existing `.env` intact as operator reference; normal startup never opens it or falls back to it
(D343). Never overwrite an existing runtime file as setup. CLI and D300 document-number smoke startup
go through `scripts/dev/secure-env-bootstrap.ts`: normal runtime startup refuses migrated environment
names, opens the fixed provider-only path without following symlinks, validates that descriptor,
and admits its exact bytes before importing the allowlisted entrypoint. Storage commands bypass
runtime environment admission so stopped upgrade can inspect historical sources without changing
them. Ordinary settings come only from SQLite; `src/backend/app/config/resolve.ts` combines those
values with defaults. Protected settings come from the independent credential store through the
registered secret reader. Provider credentials remain environment-owned. The `display` default is the host's
primary display (D324): `src/backend/app/host/primary-display.ts` probes it once per process tree,
`hostAwareResolutionEnvironment` in `src/models/config/secrets.ts` publishes it as
`HRAUTO_HOST_PRIMARY_DISPLAY` for every child process, and 2560×1440 remains only the headless
fallback — never re-probe in a child, never guess on an unrecognized OS answer;
`src/models/config/secrets.ts` is the **only** module permitted to read a credential from `process.env`
(`secrets-single-source.test.ts` enforces it). A credential must never be interpolated into a
message — `no-secret-values-in-logs.test.ts` enforces that half. D361 permits complete
classified local values already supplied to an authorized capture or presentation boundary;
credential discovery/access and D346 provider/OS egress remain separately closed.

Dry-run subjects resolve by label through the typed registry; workflow/kind must match the manifest.
Unavailable/consumed/unknown subjects and declared-pending leaves block before private reads or a
browser; malformed available subjects fail by label/date. Subjects and shared data live in
`config/test-data.json`; private identifiers/paths live only in ignored `config/test-data.local.json`,
read through `src/backend/app/registries/test-data.ts` and the private reader
`src/backend/storage/configuration/test-data-local.ts` (D341). `npm run cli -- test-data check
--json` reports names/states only. Read `ref guards-and-tests`  and `ref clock-config-secrets`
 for the detour's acceptance evidence. Never source a
canary from `.env`, expose its value, silently substitute another target, or infer current availability.

## Coding conventions

- `src/workflows/` uses role-derived source paths: an operator entry is
  `src/workflows/<id>/workflow.ts`; a retained chunk-harness proof is
  `src/workflows/<composition>/steps/<step>/step.ts`. The backend composes harnesses separately;
  they are not operator-startable or picker entries. The composition owns step identities and each
  harness imports them. An operator workflow folder may also contain its backend-loaded
  `task-registry.ts` and `tasks/`, but no arbitrary descriptor/module/node files beside the entry.
  A step folder exists only when it carries a harness (`job-summary` has none). There is no
  `src/workflows/proving/`.
- Workflow scenario suites and their T1 proof convention were retired on 2026-10-02. Do not rely on
  old structural-scenario or parity files as current evidence. Future scenario tests must be designed
  with the operator; a declared workflow scenario ID alone proves no execution.
- No default exports.
- A `src/dashboard/surfaces/*.tsx` or `src/dashboard/app/*.tsx` module exports **components only**;
  its hooks, folds, vocabularies and object constants live in a sibling `<surface>-model.ts`
  (`dashboard-refresh-boundary`, ref frontend-backend-integration , `src/dashboard/AGENTS.md`).
- Archive subviews are dashboard route state (`archiveView`), not `ArchiveWorkspace` local state; a
  cross-takeover door must name the real Archive view in that state rather than open the ledger and
  require a second click.
- Kebab-case filenames; `.tsx` only under `src/dashboard/`.
- `verbatimModuleSyntax` + `.js` extensions on relative imports.
- Every durable / wire / config boundary is a recursively strict zod schema; no open records at a
  boundary, no `any`, no unchecked assertion (`strict-boundary-schemas.test.ts`).
- Browser tasks bind the store's exact invariant `DriverDeclaration<ConcreteDriver>` through
  `defineTask(driver, contract, impl)`; never project a semantic driver down to `{system}` or mint a
  second declaration for tasks registered in the same store. Service/workflow tasks remain
  `defineTask(contract, impl)` and receive no driver.
- All time reads go through `src/rules/time/clock.ts` (`clock-single-source.test.ts`); `manualClock`
  is test-only (`manual-clock-test-only.test.ts`).
- Registry exports are recursively frozen at module load (`src/rules/validation/immutability.ts`).
- Structured errors, never `console.*` in `src/`.
- Workflow definitions remain browser-safe: value imports are restricted to zod, `src/models/**`,
  `src/rules/**` and audited `src/workflow-kit/**` builders. The current dependency map is
  `docs/rebuild/reference/codebase-structure.md`. D311/D317 supersede the old D106 per-workflow
  `module.ts` attachment instruction: author one `workflow.ts`; `compileWorkflow` derives its module requirements.
  Branch cases and parallel branches name nodes downstream of their controller (D104).

- A contract a descriptor uses but no store implements yet must be listed in
  `src/backend/app/registries/pending-impl-bindings.json`; the guard fails in both directions (D107).

## Authorized orchestration

The operator launches tasks and chooses integration. Preserve in-flight ownership and follow the
assigned brief for prerequisites, gates and review. Planning and execution remain separate intent.

Use the current global workflow instructions for route, worker and model selection. Workers own
assigned implementation, checks and fixes; the root retains consequential decisions, acceptance
and authorized integration. Honor user-named providers, models and fallbacks. Existing admitted
sessions keep their assignments. Use standard variants only; no paid overages. The user handles
root exhaustion.

When required, independent review runs against a stable candidate without implementation conversation.
Fix findings, obtain required renewed review and complete assigned checks, authorized integration and
cleanup before marking completion. No historical lesson entries or routine delivery retrospectives.

Sequential implementation uses a dedicated non-`master` branch in an exclusively available checkout;
shared, dirty, uncertain or integration-only checkouts require an owned worktree instead. Preserve
stricter phase isolation. Verify branch/path/base before edits and record a merge condition for both
sequential and parallel work. Never switch another session's checkout or stash/reset its changes.

Each parallel writer has an isolated worktree/branch and non-overlapping scope/artifacts. Record
its exact returned id, base, branch, absolute worktree, gate and integration order. Verify its diff,
ancestry and gate evidence before integrating under the repository's merge policy. After required
integration gates pass, remove only its owned worktree and integrated local branch and verify both
registration and physical cleanup. Nested agents have no sidebar task; any separately assigned task
is associated by exact recorded id, never title or recency. Preserve unrelated sessions and record
cleanup failures as residue. No coordinator runtime, UUID or board is required. Planning and
supervision send Done / Now / Remaining once at start or genuine resume. Later updates report only
newly verified completions with concise evidence. Track review, integration and cleanup internally;
surface new blockers or decisions promptly, without repeating the plan or remaining list.

## Fail loud — no unverified silent fallbacks

**The system this replaces submits REAL HR transactions. Correctness beats graceful degradation
every time.** A fallback that silently substitutes a plausible-but-wrong value when something fails
is the single most dangerous pattern here — it hides the failure and can push wrong data (wrong pay
rate, wrong person, wrong department, a blank or duplicate document, a false "submitted") into a
live UCPath / Kuali / Kronos / OnBase / I-9 transaction, or mislead the operator into acting on a
lie. When it fails silently we never find out; when it fails loud we fix it.

**The rule:** when an operation fails or an expected value is missing, do **NOT** substitute a
default, an alternative selector or element, a cached-or-"latest" value, a fabricated constant, a
"safe" guess, or a swallowed-error return, and then continue as if nothing happened. **Throw with a
legible message naming the offending value / EID / field**, so the error surfaces and gets corrected
at the source.

**A fallback is acceptable only when BOTH hold:**

1. The fallback path is itself **verified correct** for the exact case it handles (live-verified for
   selectors and page state; test-pinned for pure logic) — and its verification is recorded (a test or retained verification receipt), AND
2. Absence, or the fallback case, is a **genuinely valid expected state** (e.g. "no search results"
   is a real outcome; a documented default that is provably right).

If you cannot satisfy both, **fail loud**. When in doubt, throw.

**Not a fallback (these are fine):** retrying the _same_ operation on a transient error — that
re-runs the operation, it does not substitute data. Swallowing an error is fine only when the
_action itself_ is genuinely optional AND the caller does not treat the result as load-bearing.

**When you catch, don't swallow:** a `catch` that returns a default / empty / `{}` / `null` / `0` /
`true` and lets execution continue must instead re-throw (or at minimum log AND propagate a
distinguishable "unknown" the caller checks). Never let "the check failed" become indistinguishable
from "the check passed / found nothing." `catch { won = true }`, `catch { return [] }`,
`JSON.parse(...) catch { return {} }`, `.catch(() => ({ match: true }))`, and `?? "queued"` on
corrupted input are bugs, not resilience.

This tree is zero-debt from its first file: `npm run lint` carries `--max-warnings 0` and there is
no debt manifest. The mechanical arms live in `tests/architecture/tooling/helpers/ratchet-arms.ts`
(fail-loud-catch-default, nullish-literal-data-fallback, wait-for-timeout, inline selectors,
evaluate-named-fn, import cycles, layer matrix, code conventions, tailwind palette), each executed
against a violating fixture by `guard-manifest.test.ts` so a dead arm cannot stand in for
enforcement.
