# HR Automation — rebuild

The ground-up rebuild of UCSD's UCPath HR automation. This repository is **not** production. The
legacy repository at `/Users/julianhein/Projects/hr-automation` runs every real HR transaction and
stays the sole production authority until a single all-at-once cutover (D89/D93).

Current status is owned by the plan, not by this file: `npm run cli -- phase` prints the runtime's
`completedThrough`/`active`, and the phase docs `docs/rebuild/00`–`06` record what each phase landed,
what it found, and what left it by explicit disposition (Phases 1–2 complete 2026-08-04/2026-08-09).

## Before you start

**The plan is the SSOT — read it, do not re-derive it.** It has three parts: the **tree** at
`docs/roadmap/roadmap.md` (the machine-readable plan + the site's source + the governance rules), the
**phase docs** `docs/rebuild/00`–`06` (actionable: one per phase, the number IS the phase), and the
**specs** in `docs/rebuild/reference/` (not actionable; cited by slug).

- `docs/roadmap/roadmap.md` — the plan as written, in the roadmap notation (headings = nodes,
  `builds:`/`needs:`/`doc:` lines); `docs/roadmap/index.html` is GENERATED from it by
  `npm run roadmap`. After `roadmap:end` its **Governance** section owns the one-plan rule, the D1
  ownership map and D263.
- The **phase docs** under `docs/rebuild/` — tasks, what is done and what is left, exit criteria, and
  the decisions that phase ratified. `00-design-the-foundation` · `01-build-the-spine` ·
  `02-prove-writes-build-the-tails` · `03a-finish-the-dashboard` · `03b-finish-separations` ·
  `03c-migrate-the-remaining-workflows` · `03d-co-operate-with-Codex` · `04-close-the-deferrals` ·
  `05-cut-over` · `06-ship-the-desktop-app`. Phase 3 is four docs (3a/3b/3c/3d); in prose
  **`doc NN`** means one of these.
- `docs/rebuild/reference/decisions.md` — the decision changelog (D1–D264; **D131 is a retired gap —
  never reuse it**). A **pointer index**, not a spec: it tells you which doc owns a contract. Never
  implement from it.
- `docs/rebuild/reference/` — the contracts, each doc owning its own; in prose **`ref <slug>`**:
  `charter` (the operator's vision + the non-negotiables) · `task-contract` (tasks, stores, drivers) ·
  `workflow-model` (the builder, descriptors, the run state machine) · `dashboard-surfaces` (spans,
  the ONE projection, every surface) · `execution-and-sessions` (workers, queues, browser sessions) ·
  `data-intake-and-edit-data` (extraction, OCR, intake, Edit Data) · `write-safety` (the write
  sequencer, intents, the ALWAYS-GATE) · `guards-and-tests` (the guard/test architecture) ·
  `clock-config-secrets` (clock, config resolver, secrets) · `operator-trust` (failures, receipts,
  knowledge, the explorer) · `frontend-backend-integration` (the BFF, the wire, the parity lane) ·
  `foundation-gap-audit` (frozen — a design input, owns nothing) · `stores` (the DERIVED store
  catalog — read it before authoring a task, and remember the code wins over it).
- `docs/rebuild/reference/lessons.md` — the dated lessons ledger (`ref lessons`): 60 entries of
  "X looked safe and did Y", each naming its decision. Read it before kernel / driver / dashboard /
  write-safety work; add new root-level lessons THERE (module lessons stay in the module's AGENTS.md).
- `docs/rebuild/00`–`06` — the ACTIONABLE plan: one doc per phase, the number IS the phase
  (`03a`/`03b`/`03c` are phase 3). Each owns its phase's tasks, its "Decisions this phase ratified"
  and its **exit criteria**; `docs/roadmap/roadmap.md` is the summary (the tree + the governance
  prose + the phases at a glance). The old `07-master-plan.md` was dissolved into them on
  2026-08-20 and is preserved, with a section-by-section table of where everything went, at
  `docs/rebuild/history/superseded/2026-08-20-master-plan-dissolved.md`.
- `docs/rebuild/guard-inventory.json` — the reviewed guard manifest. `tests/unit/architecture/`
  must match it exactly, both directions.
- `docs/rebuild/history/` — history, organized by kind (`doc-reviews/`, `design-inputs/`,
  `superseded/`) and indexed by its own `README.md`. Superseded by the owning docs wherever they
  differ; never cite as normative.

**A decision is not ratified until it lands in its owning doc, in the same commit that records it.**
`reference/decisions.md` gets a one-line pointer; the owner gets the normative text.

## Commands

```bash
npm run typecheck          # tsc --noEmit over src/, tests/, scripts/ — one program, no exclusions
npm run lint               # eslint src tests scripts --max-warnings 0 — zero-debt, no manifest
npm run test               # every vitest project (unit + architecture)
npm run test:architecture  # the guard suite alone
npm run test:coverage      # 60/80 lines/statements/functions floors + the suite-size report
npm run test:watch

npm run test:parity        # ref frontend-backend-integration §7 visual/a11y parity lane — builds the bundle, ASSERTS every reference
npm run test:parity:update # the ONE deliberate way to re-freeze a reference (PARITY_UPDATE=1)

npm run cli               # the runtime CLI (help | phase | dashboard | worker | explain | storage | ocr)
npm run dashboard         # the dev dashboard in ONE terminal: BFF (3938) + vite (5174); Ctrl+C stops both
npm run cli -- dashboard  # the BFF alone (dashboard:prod — see D189, the prod mode is unbuilt)
npm run web               # the vite dev server alone, proxying /api to a BFF you started yourself
npm run web:build         # production bundle into dist/dashboard (test:parity builds this itself)

npm run build:manifest     # regenerate src/domain/workflow/generated-build-manifest.ts
npm run roadmap            # render docs/roadmap/index.html from docs/roadmap/roadmap.md (the plan, in the roadmap notation)
npm run roadmap:check      # fail if the committed site is stale
```

`build:manifest` recomputes every descriptor's `contractFingerprint` from its source closure. Run it
after ANY edit under a descriptor's import closure (which includes `src/base/**` and most of
`src/domain/**`) — `descriptor-coverage` regenerates and fails on a diff, so a stale manifest is a
red gate, not a silent drift.

The gate family is deliberately plain (`typecheck`/`lint`/`test:coverage`, D191 — `test:coverage` is
a strict superset of the earlier `test`+`test:architecture` pair and measured faster); the old
`*:rebuild` names retired with D93 and the `rebuild:` runtime prefix with D247 (2026-08-20) — this is
its own repository, so its commands are plain `cli` / `dashboard` / `web`. See "Operational
isolation" below for what still MUST differ from the legacy checkout.

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
   selectors and page state; test-pinned for pure logic) — and its verification is recorded (a
   `// verified <date>` comment, a lesson, or a test), AND
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
no debt manifest. The mechanical arms live in `tests/unit/architecture/helpers/ratchet-arms.ts`
(fail-loud-catch-default, nullish-literal-data-fallback, wait-for-timeout, inline selectors,
evaluate-named-fn, import cycles, layer matrix, code conventions, tailwind palette), each executed
against a violating fixture by `guard-manifest.test.ts` so a dead arm cannot stand in for
enforcement.

## Cross-repo rules (D93/D94)

**The legacy repo is a frozen production reference, not a dependency.**s

- **Never import, invoke, proxy, or read the legacy repo's live state from `src/`.** Two
  repositories share no module graph — this is now structural, not merely banned. The only code
  permitted to reach across is the **guard lane**, which audits legacy as data.
- **Porting = copy with provenance.** When you bring verified knowledge across (a selector, a
  parsing rule, a page-state fact), copy it and record **the legacy commit hash and source path** in
  the ported code. Never link it at runtime — which is impossible anyway.
- **Legacy change accounting is RETIRED (D150, 2026-08-05).** The two repositories no longer touch
  each other in either direction: nothing here reads legacy's working tree, and legacy work never
  blocks a rebuild gate. `config/legacy-change-accounting.json` is a frozen historical record of
  what was reconciled through the split — do not extend it. **What replaced it:** the risk was a
  ported selector or page-state fact going stale after legacy fixed it, and that is now covered by
  **live re-verification at each workflow's migration**, which the charter already makes mandatory
  and pre-authorized. A selector checked against the live system beats one diffed against legacy's
  copy of it. `legacy-selector-port-provenance` is unaffected: it pins all 406 keys to a FIXED
  legacy commit's blobs, so legacy moving on cannot invalidate it.
- **Nothing in the legacy repo may be deleted** during the rebuild or the initial cutover. The whole
  repository is the D89 rollback asset.
- The guard lane finds the legacy repo at `../hr-automation`, overridable with
  `HRAUTO_LEGACY_REPO`. It **fails loud** when the repo is missing — a skipped legacy audit is
  exactly the drift D93 warns about.
- Inventories that span both repos (`src/domain/runtime-environment.ts`) mark legacy paths with an
  explicit **`legacy:` scheme**. Both repos have a `src/` — `src/cli.ts` exists in both — so a bare
  path is ambiguous. Unprefixed always means this repo.

## Operational isolation

A repository boundary does not separate two runtimes on **one machine**. `config/runtime-isolation.json`
pins what must differ, and `operational-isolation.test.ts` proves it:

|                           | legacy                                           | rebuild                                                      |
| ------------------------- | ------------------------------------------------ | ------------------------------------------------------------ |
| state root                | `.tracker`                                       | `.tracker-rebuild`                                           |
| artifact root             | `.tracker`                                       | `.tracker-rebuild/artifacts`                                 |
| backend / frontend port   | 3838 / 5173                                      | 3938 / 5174                                                  |
| process locks             | `.tracker/daemons`                               | `.tracker-rebuild/locks`                                     |
| browser profile / session | `.auth` / `hrauto-legacy`                        | `.auth` / `hrauto-rebuild` (D216 — roots are repo-relative and never collide; the SESSION namespace is the distinct half) |
| launch commands           | `dashboard`, `dashboard:prod`, `dashboard:watch` | `dashboard`, `dashboard:prod`, `cli` (D247 — names may coincide; each must be byte-exactly its declared script) |

Command NAMES are not an isolation resource (D247): a muscle-memory `npm run dashboard` in the wrong
checkout starts that checkout's dashboard on its own port under its own roots and locks, which the
rows above make legible and harmless. Isolation values reach the runtime through one
exported direct-`const` `defineRuntimeIsolation` call that a composition root invokes at top level —
an identifier mention, or a call inside an uninvoked function, is not proof.

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

Until this repo grows its own driver layer, live _selector_ work still happens against the legacy
repo's registry; port what you verify with provenance (see cross-repo rules above).

## Environment

`.env` is gitignored and NOT part of the repo. Copy `.env.example` and fill it, or copy the legacy
repo's `.env`. `src/domain/config/resolve.ts` implements `env > settings.json > default` exactly
once; `src/domain/secrets.ts` is the **only** module permitted to read a credential from
`process.env` (`secrets-single-source.test.ts` enforces it). A credential must never be interpolated
into a message — `no-secret-values-in-logs.test.ts` enforces that half.

## Conventions

- No default exports.
- A `src/dashboard/surfaces/*.tsx` or `src/dashboard/app/*.tsx` module exports **components only**;
  its hooks, folds, vocabularies and object constants live in a sibling `<surface>-model.ts`
  (`dashboard-refresh-boundary`, ref frontend-backend-integration §8.14, `src/dashboard/AGENTS.md`).
- Archive subviews are dashboard route state (`archiveView`), not `ArchiveWorkspace` local state; a
  cross-takeover door must name the real Archive view in that state rather than open the ledger and
  require a second click.
- **2026-08-25 — dashboard session joins stay authority-shaped (P4).** Group `QueueSurface` rows
  only by their present `session.sessionId`, join a worker only by exact `currentRun.runId`, and retain an
  absent arm's served reason. A pool's declared `desiredWorkers` is distinct from non-terminal
  authority worker-card facts; a missing pool row is no declaration, never a target of one.
- **2026-08-25 — virtual session rows preserve authority across dashboard ticks (P4).** Flatten every
  served member into a fixed layout, mount only the viewport plus bounded overscan, and memoize that
  renderer away from the one-second elapsed-time tick. Give one mounted `listitem` the roving tab stop;
  keyboard moves mount and then focus the designated row. Native scroll owns focus across the whole row
  and its explicitly registered detail portal: focus stays with a descendant while its owner remains
  mounted, then an owned popover closes before an owner leaves the window and the visible roving row takes
  real focus. Unrelated controls stay outside that transfer, and a clamped boundary key clears deferred
  focus before a later resize. Keep clipped values reachable through a detail popover whose invisible
  44px hit area is proven not to overlap another trigger; visual truncation never drops data.
- Kebab-case filenames; `.tsx` only under `src/dashboard/`.
- `verbatimModuleSyntax` + `.js` extensions on relative imports.
- Every durable / wire / config boundary is a recursively strict zod schema; no open records at a
  boundary, no `any`, no unchecked assertion (`strict-boundary-schemas.test.ts`).
- Browser tasks bind the store's exact invariant `DriverDeclaration<ConcreteDriver>` through
  `defineTask(driver, contract, impl)`; never project a semantic driver down to `{system}` or mint a
  second declaration for tasks registered in the same store. Service/workflow tasks remain
  `defineTask(contract, impl)` and receive no driver.
- All time reads go through `src/domain/clock.ts` (`clock-single-source.test.ts`); `manualClock` is
  test-only (`manual-clock-test-only.test.ts`).
- Registry exports are recursively frozen at module load (`src/domain/immutability.ts`).
- Structured errors, never `console.*` in `src/`.
- **2026-08-25 — pool worker identity:** worker composition accepts no default index. The CLI must
  validate an explicit positive `--pool-index`, and `<workflow>-worker-<index>` is the one identity
  shared by the loop, browser-profile partition and authority lease. Never infer an index from
  current pool or lease rows.
- **2026-08-25 — worker process locks observe a fleet; they do not own identity.** Every worker
  start appends its own durable lock record, including restarts. D181 aggregates all records and the
  legacy root lock into one strict restore arm; any live or malformed record refuses restore. Never
  serialize the fleet with a singleton role lock or preempt the authority lease collision. Offline
  restore owns exclusive admission through the authority swap; every runtime acquisition checks
  before and after writing its record and unwinds if restore won. A persisted recovery snapshot is
  evidence, not current liveness or exclusion. Singleton admission must use the atomic filesystem
  claim, never check-then-rename; new ownership records bind PID to OS process birth, and a process
  record may report stopped only after its authority handle closure returned successfully. Reserve
  generation 1 for the observable never-run baseline, so the first acquisition is generation 2;
  on macOS normalize `ps` under C/UTC before storing epoch seconds (the kernel stamp remains
  one-second resolution). Before authority replacement, displaced WAL/SHM files need a verified
  atomic rollback; any rollback rename/fsync/unlink failure is `companion-state-uncertain`, never
  `unchanged`. A rename primitive returning is not the transition boundary: if it throws, reconcile
  source/destination existence and final staged/live byte identity before classifying the result.
  Staged cleanup failures aggregate behind the primary error and name every failed path.
- A workflow descriptor value-imports only zod, `src/domain/**`, and the audited `src/base/**`
  builders; `module.ts` is where anything server-side attaches (D106). Branch cases and parallel
  branches name nodes DOWNSTREAM of their controller — forward references, checked at `build()`
  (D104).
- A contract a descriptor uses but no store implements yet must be listed in
  `config/pending-impl-bindings.json`; the guard fails in both directions (D107).
- **Lesson 2026-08-25 — fenced-write instrumentation:** a commit task may call `ctx.recordData`
  before `ctx.driver.commit`. Capture and clock that batch at the call, then deliver commit-role
  span events only after the callback itself settles; winning its deadline race merely requests
  cancellation. The ordinary `withDriver` abort race is not sufficient: the write sequencer must
  cross `withTransactionDriver`'s one-way `retainAfterFence()` boundary immediately after the durable
  fence. Until actual settlement, parent abort and task deadline may request cancellation but must
  not emit, park, return, reset, or close the transaction session. An
  indefinitely non-cooperative callback remains process-owned with an `attempting` intent so
  process-loss recovery, not detached I/O, owns the next action. If task and terminal-span delivery
  both fail, preserve them primary-first in an `AggregateError` and carry it through any parked-write
  cause. Post-click verification starts after authority is fenced, so task lookup, input binding and
  `span.started` emission belong inside the `PostFenceWriteFailure` boundary too; none may escape
  without parking. See ref write-safety §3 and doc 03a §Observed logs.

### Dated lessons

- **2026-08-25 — rerun membership is stable-item membership, not row-position equality.** Derive the
  current side again from the immutable intake artifact, durable decisions and their retained
  read instant. `removed` carries the prior manifest row and `added` the current re-derived row,
  keyed only by `itemId`: a mapping that changes identity is remove-plus-add, while one that keeps
  identity uses a separate `changedInputs` vector when its canonical input hash moves. Carry only
  before/after hashes there; the values retain their existing classifications. Missing current
  layout or prior/current row facts must refuse by name; an absent vector is never an empty-vector
  fallback. A reserved manifest id is preflight identity, not proof a manifest exists. Enqueued
  reads bind both terminal projections to their exact committed id; open reads may select only the
  unique latest earlier same-source manifest, never their reservation or a future row. Equal latest
  creation times refuse by session, timestamp and candidate ids rather than selecting by repository
  order. Share the durable
  manifest's field schemas and row refinement with the reviewed wire projection so totals, row
  coverage and stable-item uniqueness cannot drift without broadening data egress.

- **2026-08-25 — an irreversible intake must consume an identity authority reserved before review.**
  Mint `reservedManifestId` in the upload route's durable session write, serve that exact value, and
  make enqueue pass it unchanged into the immutable manifest. Keep terminal `intakeManifestId`
  exclusive to `enqueued` and require equality when a reservation exists. The reservation stays
  optional only for read-forward compatibility; an older row without it refuses by session id and
  must never fall back to a fresh UUID, because that would commit a different plan than the operator
  inspected.

- **2026-08-25 — exact-id readback needs the same identity door at every authority boundary.** A
  repository lookup, recursively strict wire parse, or injected dashboard client can each return a
  valid diagnostic bundle for the wrong id. Compare the requested id to the durable row before
  reading its index or artifacts, compare it again after the wire parse, and keep the requested id
  in the dialog's error state so a foreign response can never rename the selection or its manifest.

- **2026-08-25 — closing an async readback must invalidate its result, not only hide its dialog.**
  Escape can unmount a loading diagnostic-bundle dialog while its durable verification remains in
  flight; an unguarded resolution then remounts the dialog after the operator closed it. Advance a
  request generation on both open and close, and accept a result only for the current generation.
  The manifest fixture must also remain a strict durable `DiagnosticBundle`, distinct from its wire
  projection, or a download test can accidentally prove client reconstruction instead of authority.

- **2026-08-25 — a content-addressed diagnostic row is not evidence of readable bytes.** The D137
  bundle row and attachment index can agree while an artifact has been lost or corrupted; E29 therefore
  re-derives the bundle digest, compares the exact indexed attachments, and drains each content-addressed
  artifact before it serves facts or a manifest. A client-side reconstruction would have made a damaged
  record look download-ready.

- **2026-08-25 — reconnect is not recovery from an unknown event-stream interval.** Bind resume
  evidence to both cursor and projection generation: a cursor from an earlier generation proves
  restart/rebuild, not missed history, and must resnapshot without publishing. Only a same-generation
  historical cursor that retained history cannot replay creates the permanent fact. Its identity is
  the requested cursor plus generation, never the aging reason or moving head; duplicate observation
  leaves the durable row byte-for-byte unchanged. Capture hello and snapshot from one projection
  instant, restart the handshake if publication moves it, and enforce immutability in authority so
  no service, command or direct same-state write can hide or version-bump the fact. All pinned rows
  share the drawer's bounded scroll region with ordinary rows while filters remain reachable.

- **2026-08-25 — exact visual geometry and a usable touch target are separate boxes.** A demo-exact
  `Button ghost sm` may keep its 24px painted box while a transparent pseudo-element on the same
  semantic button supplies the 44px hit region. Prove the outer points hit that button and that its
  effective rectangle intersects no neighboring control; increasing the shared button size would
  silently change every header's fidelity instead.
- **Lesson 2026-08-25 — an observed row's system is a composition fact, never a log fallback.** A
  span supplies its exact `(nodeId, taskId)` and redacted page point; the module/store binding supplies
  a browser system only when that exact origin declares one. The Logs query resolves exactly one
  root-composed data origin for the pair and refuses missing or ambiguous origins by file and line;
  one service origin with no browser system stays absent on wire and screen. Defaulting to `read` or
  a plausible system turns a trustworthy observation into an attributed lie. Observed/fenced span rows are indexed by the
  disk-tail projector at append time; the GET never re-derives their partitions from record-time run
  instants. A continuation cursor binds an immutable combined snapshot, so a later backdated append is
  visible on a fresh first page and cannot duplicate or displace rows in an existing page walk.

## After changes

Run `npm run typecheck && npm run lint && npm run test:coverage` before committing (D191 —
`test:coverage` REPLACES the earlier `test` + `test:architecture` pair as the per-commit gate; both
scripts stay available for a targeted run). Add a new guard file **and** its
`docs/rebuild/guard-inventory.json` entry in the same commit — `guard-manifest.test.ts` checks both
directions. Retiring a guard requires an explicit `retired` entry naming the deciding decision and
where the invariant went; a guard that simply disappears is indistinguishable from an accident.

Never push to any remote without explicit instruction.
