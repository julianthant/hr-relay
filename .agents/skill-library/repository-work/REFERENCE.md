# Repository operating reference

Detailed guidance moved from the root instruction pair on 2026-09-04. Read only the
sections relevant to the task, as routed by the root `AGENTS.md`. This is an operating
reference, not a second plan or contract: the roadmap, admitted phase doc, and owning
`docs/rebuild/reference/` contract win on disagreement. The as-built descriptions below
are the pre-1.6 baseline unless they explicitly name a landed 1.6 seam; verify current
status against the owning phase before implementation.

## Before you start

**The plan is the SSOT — read it, do not re-derive it.** It has three parts: the **tree** at
`docs/roadmap/roadmap.md` (the machine-readable plan + the site's source + the governance rules), the
admitted **phase docs** under `docs/rebuild/` (actionable: one per admitted phase), and the
**specs** in `docs/rebuild/reference/` (not actionable; cited by slug).

- `docs/roadmap/roadmap.md` — the plan as written, in the roadmap notation (headings = nodes,
  `builds:`/`needs:`/`doc:` lines); `docs/roadmap/index.html` is GENERATED from it by
  `npm run roadmap`. After `roadmap:end` its **Governance** section owns the one-plan rule, the D1
  ownership map and D263.
- The **phase docs** under `docs/rebuild/` record tasks, evidence, decisions and exit criteria.
  Phases 0-3 are `00-design-the-foundation` · `01-build-the-spine` ·
  `02-prove-writes-build-the-tails` · `03.1-finish-the-dashboard` ·
  `03.2-finish-workflow-authoring` · `03.3-accept-person-lookup-and-separations` ·
  `03.4-co-operate-with-claude`. D326 supersedes D323/D325's split phase grammar for
  Phases 0–3: numbered phases contain decimal parts, each part contains numbered supervisor tasks,
  and each task contains checklist subtasks. The active order is 0.3 authority design, 1.6 authority
  implementation, 2.6 downstream revalidation, 3.1 dashboard, 3.2 workflow authoring/read-only
  acceptance/candidate freeze, 3.3 controlled acceptance, then 3.4 Codex/Claude cooperation. One coordinator owns each decimal part;
  each task is one supervisor session. D328 makes admitted parallel waves visible: peers share the
  ordinal and use consecutive numeric members (`3.1.9-1`, `3.1.9-2`, ...), while serial tasks keep
  `N`; the coordinator run plan still owns their exact worktree lifecycle.
  Phase 4
  admits later workflows as 4A/4B/4C only after D319 verification and operator approval; Phase 5 is
  readiness plus the one cutover, and Phase 6 is the desktop app. D329 retires the old 03a–03d
  filenames and active 3c-A/3c-B labels; their historical evidence lives under `history/superseded/`.
- `docs/rebuild/reference/decisions.md` — the decision changelog (D1–D332; **D131 is a retired gap —
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
- `docs/rebuild/reference/lessons.md` — the dated lessons ledger (`ref lessons`), recording
  "X looked safe and did Y", each naming its decision. Before kernel / driver / dashboard /
  write-safety work, search by seam/decision and read the matching entries; record root-level lessons THERE when requested; follow module lesson pointers for scoped entries.
- `docs/rebuild/00`–`06` — active plan-document paths. D323 maps their owning work into the visible
  Phase 0–6 hierarchy; D329 aligns every Phase 3 filename to its decimal part. Each phase owns its
  tasks, decisions and **exit criteria**;
  `docs/roadmap/roadmap.md` is the summary. The old `07-master-plan.md` was dissolved into them on
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
npm run test               # every vitest project (unit + architecture + scenario)
npm run test:architecture  # the guard suite alone
npm run test:coverage      # 60/80 lines/statements/functions floors + the suite-size report
npm run test:watch

npm run test:parity        # ref frontend-backend-integration §7 visual/a11y parity lane — builds the bundle, ASSERTS every reference
npm run test:parity:update # the ONE deliberate way to re-freeze a reference (PARITY_UPDATE=1)

npm run cli               # the runtime CLI (help | phase | dashboard | worker | dry-run-scenario | explain | storage | ocr)
npm run cli -- dry-run-scenario <workflow> --subject <label> # execute exactly one T1b manifest case
npm run cli -- storage backup  # the ONLY writer of a verified SQLite backup (D322); `storage doctor` / `storage restore --from` beside it
npm run dashboard         # the dev dashboard in ONE terminal: BFF (3938) + vite (5174); Ctrl+C stops both
npm run cli -- dashboard  # the BFF alone; `dashboard:prod` passes --prod and serves dist/dashboard from it (run web:build first)
npm run web               # the vite dev server alone, proxying /api to a BFF you started yourself
npm run web:build         # production bundle into dist/dashboard (test:parity builds this itself)

npm run build:manifest     # regenerate src/domain/workflow/generated-build-manifest.ts
npm run build:manifest:check # fail if the committed manifest is stale
npm run stores:catalog     # regenerate the generated §2 task catalog in docs/rebuild/reference/stores.md
npm run stores:catalog:check # fail if the committed catalog is stale
npm run roadmap            # render docs/roadmap/index.html from docs/roadmap/roadmap.md (the plan, in the roadmap notation)
npm run roadmap:check      # fail if the committed site is stale
```

`build:manifest` recomputes every descriptor's `contractFingerprint` from its source closure. Run it
after ANY edit under a descriptor's import closure (which includes `src/base/**` and most of
`src/domain/**`) — `descriptor-coverage` regenerates and fails on a diff, so a stale manifest is a
red gate, not a silent drift.

Vitest schedules at most four isolated file forks (or the available CPU count when lower).
The 2026-09-02 full coverage gate repeatedly timed out its 30-second fixture/guard checks at the
CPU-derived ten-fork default on an 18 GiB host; the same 388 files / 4,795 tests passed with four.
Keep per-file isolation, in-test concurrency, test membership, coverage floors and the 30-second
limits intact. Run full coverage without a concurrent compiler/linter gate; reduce contention
before treating a full-suite timeout as permission to weaken a check.

The gate family is deliberately plain (`typecheck`/`lint`/`test:coverage`, D191 — `test:coverage` is
a strict superset of the earlier `test`+`test:architecture` pair and measured faster); the old
`*:rebuild` names retired with D93 and the `rebuild:` runtime prefix with D247 (2026-08-20) — this is
its own repository, so its commands are plain `cli` / `dashboard` / `web`. See "Operational
isolation" below for what still MUST differ from the legacy checkout.

## Cross-repo rules (D93/D94)

**The legacy repo is a frozen production reference, not a dependency.**

- **Never import, invoke, proxy, or read the legacy repo's live state from `src/`.** Two
  repositories share no module graph — this is now structural, not merely banned. Finished lint,
  type, test, architecture, parity, performance, smoke, Duo, and generated gates are self-contained
  too: read-only porting work may consult legacy, but a committed gate may not resolve its checkout.
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
  copy of it. `legacy-selector-port-provenance` is unaffected: the checked-in architecture
  provenance snapshot pins all 406 keys to a FIXED legacy commit's source blobs and authenticated,
  identifier-redacted source snapshots, so legacy moving on cannot invalidate it.
- **Nothing in the legacy repo may be deleted** during the rebuild or the initial cutover. The whole
  repository is the D89 rollback asset.
- Architecture guards read `config/ports/legacy-architecture-provenance.json`, whose strict parser
  authenticates every identifier-redacted frozen source and path-inventory snapshot before exposing
  it. The external payload anchor prevents a changed snapshot from authenticating a recomputed
  digest; SSN- and UCSD EID-shaped values must never enter this evidence. Missing, malformed,
  duplicate, reordered, or content-address-mismatched evidence fails loud. Never restore a
  `../hr-automation` or `HRAUTO_LEGACY_REPO` execution dependency to a finished gate.
- Inventories that span both repos (`src/domain/runtime-environment.ts`) mark legacy paths with an
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
dashboard-surfaces §D330.1–§D330.12: identity tuple, three-way existence, the seven-state machine,
`version` CAS + `claimGeneration` fence, one total queue order, D308 delete behind the tombstone, the
adapter boundary and its guard), **D331** the settings catalog and protected `.tracker/settings/` root
(ref clock-config-secrets §D331.1–§D331.12: the closed 88-row catalog, five source classes, two CAS
arms, write-only protected values, `settings > default` with the environment gone as a resolver input),
and **D332** the one stopped-system `cli storage upgrade` with its preflight, journal, rollback, boot
matrix and adapter roster A0–A8 (ref dashboard-surfaces §2.5 D332, its settings half in
clock-config-secrets §D332, the deletion tests in ref guards-and-tests §5.2). Until 1.6 lands, the
as-built authorities described above stay in force. Doc 01 §1.6 binds each 1.6 task to one seam, gate,
integration order and deletion test; 2.6 revalidates downstream consumers, and 3.1 finishes the
dashboard. Provider API keys remain the sole `.env` class; credentials and local canary inputs move
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

`.env` is gitignored and NOT part of the repo. Create it safely with `umask 077` and
`install -m 600 .env.example .env`, then fill only the required values. CLI and D300 document-number smoke startup
go through `scripts/secure-env-bootstrap.ts`: it opens the fixed path with no symlink following,
fstats and validates that descriptor, reads/parses those exact bytes, preserves an explicit parent
environment, and only then imports the allowlisted CLI or smoke entrypoint. `src/domain/config/resolve.ts`
implements `env > settings.json > default` exactly once; the `display` DEFAULT is the host's primary
display (D324, 2026-09-03): `src/infra/host/primary-display.ts` probes it once per process tree,
`hostAwareResolutionEnvironment` in `src/domain/secrets.ts` publishes it as
`HRAUTO_HOST_PRIMARY_DISPLAY` for every child process, and 2560×1440 remains only the headless
fallback — never re-probe in a child, never guess on an unrecognized OS answer;
`src/domain/secrets.ts` is the **only** module permitted to read a credential from `process.env`
(`secrets-single-source.test.ts` enforces it). A credential must never be interpolated into a
message — `no-secret-values-in-logs.test.ts` enforces that half.

Dry-run subjects live in the strict, recursively frozen `config/test-subjects.json` registry. A
scenario asks for a label; the loader requires that label's workflow and kind to match its manifest.
`gone` / `unknown` / `consumed` labels resolve `blocked` before any browser starts. An `available`
entry that cannot form the workflow's exact canonical input is a registry defect and throws with the
label and `lastObserved` date. Since D300 the separations canary commits only one closed Kuali
document-number reference; `src/domain/secrets.ts` reads that value from ignored `.env`, and the
composed workflow derives and verifies every person fact live. No canary name or EID is registry- or
environment-supplied.

## Coding conventions

- `src/workflows/` has exactly two folder kinds (D265/D266): a top-level folder is a rail workflow,
  and a child folder is one declared timeline step. A chunk harness lives in the matching step
  folder with role `{ kind: "chunk-harness", of, step }`; it remains independently startable,
  nests under its composition in the picker/Explorer, and never appears in the rail. There is no
  `src/workflows/proving/` and no registered workflow whose purpose is test equipment. Since the
  2026-09-02 deletion acceptance every workflow folder holds exactly one file, `workflow.ts`; a step
  folder exists only when it carries a harness (`job-summary` is a declared group with no folder),
  and the `workflow-layout` guard refuses any other file beside a `workflow.ts`.
- A workflow's T1 proof lives at
  `tests/scenario/workflows/<workflow-id>/{structural.scenario.test.ts,dry-run.scenario.ts}`: exactly
  one collected structural scenario and one sibling T1b live manifest. D318 gives that manifest two
  exclusive graph-derived arms: `dry-run-preview` for a transaction-bearing graph and `live-read`
  for a zero-transaction graph. `live-read` runs with `dryRun=false`, requires zero transaction
  nodes and proves exact zero deltas in all three write-authority tables; never add a no-op
  transaction to qualify for preview. The live half may write
  ordinary upstream `run_checkpoints`; its submit-free invariant is zero deltas in
  `write_intents`, `write_attempts`, and `durable_outbox`.
- No default exports.
- A `src/dashboard/surfaces/*.tsx` or `src/dashboard/app/*.tsx` module exports **components only**;
  its hooks, folds, vocabularies and object constants live in a sibling `<surface>-model.ts`
  (`dashboard-refresh-boundary`, ref frontend-backend-integration §8.14, `src/dashboard/AGENTS.md`).
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
- All time reads go through `src/domain/clock.ts` (`clock-single-source.test.ts`); `manualClock` is
  test-only (`manual-clock-test-only.test.ts`).
- Registry exports are recursively frozen at module load (`src/domain/immutability.ts`).
- Structured errors, never `console.*` in `src/`.
- Workflow definitions remain browser-safe: value imports are restricted to zod, `src/domain/**`,
  and audited `src/base/**` builders. D311/D317 supersede the old D106 per-workflow `module.ts`
  attachment instruction: author one `workflow.ts`; `compileWorkflow` derives its module requirements.
  Branch cases and parallel branches name nodes downstream of their controller (D104).

- A contract a descriptor uses but no store implements yet must be listed in
  `config/pending-impl-bindings.json`; the guard fails in both directions (D107).

## Authorized orchestration

For roadmap work read [roadmap §Plan, implement, review](../../../docs/roadmap/roadmap.md#plan-implement-review-operator-amendment-2026-09-04).
The operator opens the three sessions. Skills use the exact phase task and approved plan commit;
implementation remains awaiting review until the independent verdict and required gates pass.

Before authorized worker dispatch, read the active platform's
`~/.agents/skill-library/parallel-agent-work/REFERENCE.md` (Codex) or
`~/.claude/skill-library/parallel-agent-work/REFERENCE.md` (Claude). Codex uses native `sup_scout`,
`sup_analyst`, `sup_terra` and `sup_sol`; Claude uses `sup-scout`, `sup-analyst`, `sup-sonnet` and
`sup-opus`. Sol/Opus owns substantive supporting work; Terra/Sonnet execution is exact mechanical
work only. The Astra/Fable supervisor retains the hardest seam and consequential judgment.
Validate native role definitions before dispatch; never substitute generic roles or model overrides.

Each parallel writer has an isolated worktree/branch and non-overlapping scope/artifacts. Record
its exact returned id, base, branch, absolute worktree, gate and integration order. Verify its diff,
ancestry and gate evidence before integrating under the repository's merge policy. After required
integration gates pass, remove only its owned worktree and integrated local branch and verify both
registration and physical cleanup. Nested agents have no sidebar task; any separately assigned task
is associated by exact recorded id, never title or recency. Preserve unrelated sessions and record
cleanup failures as residue. No coordinator runtime, UUID, board or progress footer is required.

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
