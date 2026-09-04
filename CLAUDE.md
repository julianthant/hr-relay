# HR Automation — rebuild

Paired instruction files (`AGENTS.md` and `CLAUDE.md`) are byte-identical; whenever one changes, update its counterpart in the same commit.

The ground-up rebuild of UCSD's UCPath HR automation. This repository is **not** production. The
legacy repository at `/Users/julianhein/Projects/hr-automation` runs every real HR transaction and
stays the sole production authority until a single all-at-once cutover (D89/D93).

Current status is owned by the plan, not by this file: `npm run cli -- phase` prints the runtime's
`completedThrough`/`active`, and the admitted phase docs under `docs/rebuild/` record what each phase
landed, what it found, and what left it by explicit disposition (Phases 1–2 complete
2026-08-04/2026-08-09).

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
  `02-prove-writes-build-the-tails` · `03a-finish-the-dashboard` · `03b-finish-separations` ·
  `03c-migrate-the-remaining-workflows`. D323 fixes the visible hierarchy: numbered phases run down
  the roadmap spine, lettered parts run horizontally, and each part's tasks run vertically. Phase 3
  is 3A dashboard, 3B Separations, 3C authoring/acceptance and 3D Codex/Claude cooperation. Phase 4
  admits later workflows as 4A/4B/4C only after D319 verification and operator approval; Phase 5 is
  readiness plus the one cutover, and Phase 6 is the desktop app. Stable filenames stay unchanged.
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
- `docs/rebuild/00`–`06` — stable plan-document paths. D323 maps their owning work into the visible
  Phase 0–6 hierarchy even where a preserved filename predates that mapping. Each phase owns its
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
settings authority (`settings.json` + its `.authority.json` / `.prepare.json` / `.rollback.json` /
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

`.env` is gitignored and NOT part of the repo. Create it safely with `umask 077` and
`install -m 600 .env.example .env`, then fill only the required values. CLI and D300 document-number smoke startup
go through `scripts/secure-env-bootstrap.ts`: it opens the fixed path with no symlink following,
fstats and validates that descriptor, reads/parses those exact bytes, preserves an explicit parent
environment, and only then imports the allowlisted CLI or smoke entrypoint. `src/domain/config/resolve.ts`
implements `env > settings.json > default` exactly once;
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

> 2026-08-25 — A named canary looked like reusable fixture data, but two earlier Kuali actions had
> already disappeared between live passes and the current finalization canary still lacked a real
> transaction number before 2026-08-28. Availability without a dated observation turns normal live
> subject decay into misleading test red; availability with incomplete input is instead a named
> registry defect.

> 2026-08-28 — A display name looked less sensitive than an EID, but both identify the live canary
> and both feed load-bearing search/write input. A test-subject registry therefore commits only the
> closed registered name + environment-key pair for every person value; the sole secret reader
> validates the ignored value, and the resolver forms canonical input only after the complete set
> resolves. Pending subjects block before any read, and refusals name only public field/reference/key
> metadata — never the value.

> 2026-08-28 — A fixed `.env` name still followed `process.cwd()`, and import-time runners let direct
> module execution bypass secure admission. The bootstrap now derives the repository's absolute
> `.env` from its own module URL, then solely invokes explicit inert CLI/smoke runners after the
> exact descriptor closes; tests change CWD and execute/import both runner modules directly.

> 2026-09-01 — Three person-value canary secrets looked like a necessary finalization ingress, but
> the composed separations workflow already derives employee name and document EID from Kuali,
> resolves UCPath identity through the gate, and owns its timekeeper constant. D300 therefore admits
> only one strict document-number environment reference and leaves the standalone finalization
> harness blocked by name; never copy a document number into a name or EID field.

> 2026-09-01 — A configured document number proves only that admission can address the named
> subject; it does not make a dated `available` claim current. The first R1 live Action List search
> found the sole separations canary gone, so D284's existing rule applied immediately: keep the
> label and its evidence, change availability to `gone`, block before reading the environment, and
> choose no replacement. Never retry a decayed canary as though configuration were availability.

> 2026-09-03 — A replacement canary can be live-available without satisfying its T1b case. The
> first replacement rehearsal verified the Kuali document and UCPath subject, then failed at New
> Kronos with `EMPLOYEE_NOT_FOUND` and exact-run 0/0/0 write authority. Keep the document number in
> ignored configuration, remove the prior document's observation leaves instead of relabeling them,
> record the target as available, and leave the fresh `met` acceptance gate open.

> 2026-09-01 — Calling the command kernel directly can commit a run without publishing the
> write-once `run.queued` root that every worker span requires. The dry-run scenario start used
> that lower-level path, so its failed live run remained valid authority but made span reconciliation
> unavailable. Every start surface now projects the committed run through one shared queue-root
> builder before a worker may drain; never treat a durable run row as proof its span root exists.

> 2026-09-01 — Rewriting a rootless span file would make a projection green by changing durable
> history, while merely appending an ordinary root would hide that it arrived out of physical order.
> D301 permits one offline repair: under the stopped-system admission, derive the root from the exact
> run/session/consumed-start-plan chain and append a closed `authority-reconstruction` marker bound
> to the preserved prefix's byte count and SHA-256. The doctor replays the preceding events through
> every ordinary validator; unmarked late roots remain malformed and an exact repeat writes nothing.

## Conventions

- **2026-09-03 — the roadmap is an outcome hierarchy, not a session journal (D323).** Only numbered
  phases sit on the vertical spine; each phase's lettered parts run horizontally and each part's
  concrete tasks run vertically beneath it. Phase 4 holds admitted workflow migrations as
  4A/4B/4C, Phase 5 holds readiness and cutover, and Phase 6 holds desktop delivery. Working-session
  history belongs in node `log:` drawers and never becomes a spine marker.

- **2026-09-02 — a workflow's T1a source path is operator-visible authority.** Every registered
  workflow owns exactly one `tests/scenario/workflows/<workflow-id>/structural.scenario.test.ts`;
  the executable scenario manifest serves that path through Explorer, so a move must update the
  manifest, path-sensitive tests/evidence, and parity expectations deliberately. Structural cases
  use synthetic identities and prove graph/task/write semantics only; current external-world truth
  belongs to the uncollected T1b run and its durable result.

- **2026-09-02 — architecture guards are a named Vitest project, not a unit-project overlap.**
  `unit` excludes `tests/unit/architecture/**`; `architecture` recursively owns every
  `tests/unit/architecture/**/*.test.ts`; and `npm run test:architecture` selects that project by
  name. Keep the project include, the unit exclusion, and the script mechanically pinned together
  so a path rename cannot orphan the lane or make coverage execute the guards twice.

- **2026-09-02 — test retention and output are correctness contracts, not count targets.** Retain
  every unique risk/contract; call two tests duplicates only when failure mode, seam, and oracle all
  match, and delete or consolidate only with a mapped survivor plus red-capable evidence (or proof
  the removed test could not fail meaningfully). `unit`, `architecture`, and `scenario` collect
  every offline Vitest file exactly once; the future live-dependent `combined` tier stays excluded
  until it owns a deliberate runner. One configured verbose stream names project, file, suite, and full
  behavior/refusal title; only genuinely multi-stage harnesses add stable phase markers. The
  affected ≤30 s, coverage ≤90 s, and parity ≤75 s goals are measurements, never authority to lower
  a floor, widen an allowance, add an exclusion, or weaken isolation/parallelism. Structural
  performance counters fail the gate; host-dependent durations remain observational.

- **2026-09-02 — a workflow mini-store output is not complete until its implementation records every leaf.**
  Adding a schema leaf without the matching `ctx.recordData` point leaves the task valid in direct
  implementation tests but makes the real executor refuse before checkpointing. R4a exposed this
  when D307 added reconciled-dates `source` without adding its provenance point. Pin these changes
  with the real task plus `createTaskProvenanceCollector`; a no-op recording fake cannot prove the
  executor seam.

- **2026-09-02 — a conditional operator gate is descriptor evidence, never caller permission (D309).**
  A false `when` opens no gate and creates no operator decision or `gate_results` row. Downstream
  provenance and receipts re-evaluate the same condition from canonical input and authenticated
  checkpoints; a skipped gate cannot coexist with a checkpoint/result, and a stale result after the
  condition changes fails loud. Separations conditions only `identity-approval` on a validated
  `name-resolved` packet: exact independently supplied/UCPath-read-back EID is explicit
  `machine-verification`, while name-only always requires the real command-resolved gate. Step
  omission never suppresses or manufactures either arm.

- **2026-09-01 — D307 step omission.** Declare an omission BESIDE the step's own nodes
  (`group(step, { omission })` in the workflow author), never as a separate mechanism. Its
  `produces` map rebuilds TASK node outputs only; a transaction never runs and mints no envelope (D144). Since D313
  (2026-09-02) whole-step omission executes NO entry of the step — a gate inside an omitted step is
  omitted with it — so a mandatory check is authored as its own entry outside the omittable step, and
  `defineWorkflow` refuses a definition where an entry outside an omittable step reads a member the
  omission does not rebuild. A typed fact an omission consumes never crosses a served wire or a span;
  the receipt and result name the assertion (`disposition: "operator-asserted"`, an `{ state:
  "omitted", step }` arm) instead of replaying the value.

- **2026-08-31 — D294 retires mobile/phone document Capture Mode.** Do not reintroduce its QR start,
  page, ingress/tunnel, session/bundle/handoff authority, routes, configuration, or tests. Diagnostic
  screenshots, run Capture tiles, receipts, and Archive evidence are separate diagnostic authority
  and remain supported. `dashboard:prod` static serving landed 2026-09-03 (ref frontend-backend-integration §6.9).

- **2026-09-03 — a long-lived CLI command must own its shutdown, and the process lock is the
  proof.** The `dashboard` branch detached `compose(...).then(...)` and discarded `running.stop`, so
  `composeDashboardRuntime`'s ordering never ran: SIGINT took Node's default terminate and left
  `.tracker/locks/server.lock.json` at `releasedAt: null`, the authority handle abandoned and
  no graceful-drain backup. `startRebuildRuntime` is now `async` and the branch awaits the
  composition, then the FIRST SIGINT/SIGTERM through an injectable `signals` seam, then `stop()` —
  once, awaited, with that ordering still the sole shutdown authority. Register both signals with
  `process.on`, NEVER `process.once`: a `once` listener removes itself as it fires, and a signal with
  zero listeners restores Node's default terminate, so the second Ctrl+C would kill the process
  mid-drain — the same abandoned handle and `releasedAt: null` this fix exists to prevent. Both stay
  subscribed until `stop()` settles; only then does the disposer run, in `finally`. A rejecting stop
  propagates; this library never calls `process.exit`. `runCli` returns that promise and the secure
  bootstrap awaits it. Prove it with a real child (`node --import tsx
  scripts/secure-env-bootstrap.ts cli dashboard`) asserting exit 0 and a `releasedAt` on the lock
  record naming THAT pid — an injected composer cannot see whether the production entrypoint
  registered any handler at all. Spawn that child in a scratch `mkdtemp` cwd holding only
  `package.json`, `package-lock.json` and a `node_modules` symlink (Node resolves the bare
  `--import tsx` specifier against the CWD), because the composition takes `repoRoot = process.cwd()`
  and would otherwise run every per-commit gate over the developer's own authority; send the second
  SIGINT inside the measured ~40ms drain, and assert the child is still draining before you send it.

- **2026-09-03 — `dashboard --prod` serves `dist/dashboard` from the BFF; a flag the runtime ignores
  is a mode that does not exist.** `parseDashboardCommandOptions` refuses any unexpected argument by
  name; `built-bundle` composition realpaths the bundle and requires `index.html` before any
  authority, lock or socket. The static handler (`static-bundle.ts`) is registered LAST, decides
  lexically then physically (realpath containment; a symlink out of the bundle is refused), serves a
  closed extension allowlist (unlisted = 404, never octet-stream), caches only `/assets/*` immutably,
  and never echoes a refused path. Remember the WHATWG URL layer resolves `/../` and `%2e%2e` before
  any handler: test the encoded `..%2f` and backslash forms for the handler's own refusals.
- **2026-09-02 — the SSE hub delivers on demand; never push into a stream controller.** A hub
  connection exposes `next()`/`pending`, and `subscriptions/sse-response.ts` drains it from a Web
  Stream `pull()`, so socket backpressure reaches the hub's ONE bounded queue and overflow becomes
  exactly one `reset-required`. A push listener bypasses the bound the moment it registers. Prove
  slow-consumer behaviour through the real Node adapter with a paused client, not a fake sink.
- **2026-09-02 — every browser-reachable BFF mutation is admitted by the loopback Host/Origin
  door before its handler runs (D75).** Register `app.use(<path>, operatorMutationIngressGuard)`
  (JSON envelope: also requires `application/json`) or `operatorOpaqueIngressGuard` (intake bytes,
  the body-less advisory) BEFORE the `app.post`; the `operator-mutation-admission` guard pins the
  closed route → door table in `routes/api.ts`. A JSON-shaped `text/plain` body parses through
  `c.req.json()`, so media type is part of the admission. Refuse with the body unread and zero
  planner/intake/authority/provider effects; prove it with `Request` read spies and `bodyUsed`.
- **2026-08-29 — BFF request identity is one admission checkpoint.** Every request crosses the
  first middleware exactly once. Solo composition accepts only the strict configured
  `local-operator`; body, query, headers, XLSX metadata and mobile-capture credentials are not actor
  inputs. Schema-valid command-envelope `requestedBy` claims must match before handler effects.
  Pass the derived actor separately to actor-attributed services: XLSX requests stay strict and
  actor-free, new evidence is v2 with `requestedBy`, and immutable v1 rows stay unattributed with no
  backfill. Every browser-reachable durable operator mutation, including XLSX export, requires the
  exact same-origin loopback Host/Origin pair and `application/json` before its body or authority is
  touched. Mirrored evidence columns must agree with JSON at read and boot. (D75)
- **2026-08-31 — D290 admits only the common v18 lineage into the integrated suffix.** Fresh and
  exact-v18 databases run the pinned DCR-primary sequence followed by DCC1 Settings and accepted
  bulk-replay support. Any existing post-v18 pre-integration suffix refuses before connection
  configuration, migration, replay, or effects; source SQL/digests remain evidence, never a silent
  conversion recipe. DCC4's Explorer schema suffix is superseded, not erased.
- **Archived capture resources (DCA4):** `queries/archive.ts` binds resource status and downloads
  to the exact archived run, verifies its immutable content digest, and resolves byte metadata only
  from its frozen capture tiles. Repeated tile ids must agree on the complete byte reference.
  Status uses the shared verify-only stream; downloads independently materialize verified bytes.
  Never consult current runs/indexes/descriptors or infer a purge from a retention deadline. The
  two archive resource routes in `routes/api.ts` report named, path-free archive failures and keep
  downloads no-store, nosniff and attachment-only; resource URLs bind both ids in the strict wire.
- **2026-08-28 — operator skills and internal playbooks are separate surfaces.** The repository's
  operator commands are `hr-manage`, `hr-scan`, `hr-workflow`, and `hr-lesson`. Codex stores
  repo-specific helper guidance under `.agents/skill-library/<name>/REFERENCE.md`; Claude may keep a
  model-visible helper under `.claude/skills/` only with `user-invocable: false`. `hr-debug` is a
  helper reached through the global `debug` router, and workflow resources generated by
  `hr-workflow` are reached through `hr-manage`; neither adds another operator command. Marketplace
  caches are dependencies, never edited as user-owned skills.
- **2026-08-27 — supervised delegation must prove its native role (retiered 2026-09-01).** Codex
  supervised tasks use only `sup_scout`, `sup_analyst`, `sup_luna`, or `sup_terra`; pass the exact
  native `agent_type` and begin `task_name` with that same role. Claude uses only its native
  `sup-scout` / `sup-analyst` research roles and `sup-sonnet` / `sup-opus` execution roles, with the
  role at the start of the visible description. `sup-opus` / `sup_terra` is the default for every
  small-to-medium seam; `sup-sonnet` / `sup_luna` is trivial-only (a review-skippable mechanical edit
  whose gate proves it). `sup-fable` and `sup_sol` workers are retired: that depth is the supervisor's
  own. Never substitute a generic/default/worker/explorer agent or a bare model override. If the
  required role is unavailable, fail loud instead of silently downgrading it. A
  new coordinator owns `docs/coordinator/<task>/` for every task-scoped coordination artifact:
  `project-profile.md`, board, run plan, briefs, research, reports, decisions, evidence, and partial
  handoffs. The profile records this repository's plan authorities (`docs/roadmap/roadmap.md` and the
  active `docs/rebuild/` phase docs), owning references/decisions, gates, permissions, and the
  worktree + `feature/<unit>` + `--no-ff` integration rules above. Product code, tests, fixtures, and
  canonical docs stay in their owning paths. Prompts supply the exact profile/workspace paths and one
  unique artifact path per writer; parallel workers use that relative path in their own worktrees,
  while read-only agents return findings for the supervisor to persist. Existing coordination files
  stay at established paths unless the operator requests migration. Board writes still require the
  exact absolute path and explicit close-out authorization. Once every run closes, the coordinator
  reconciles verified outcomes into only the necessary roadmap, rebuild/phase plan, owning
  spec/decision, and applicable `AGENTS.md`, commits those updates, and closes the board with
  pointers. The workspace is retained unless the operator explicitly requests archival or removal;
  successful close never auto-handoffs. A coordinator enters stateless discussion or grilling only
  when explicitly asked and writes none of it until the operator says to record it.
- **Parallel work has one recorded lifecycle.** Follow the active platform's
  `skill-library/parallel-agent-work/REFERENCE.md`: supervisors own worker rows and coordinators own
  supervisor-task/session rows. Before dispatch, every writable row records the exact task/agent id,
  base SHA, `feature/<unit>` branch, absolute worktree, non-overlapping scope/artifact, gate,
  integration order and state; read-only agents need no worktree. A row is not closed by merging.
  After verified integration and a green gate, remove it with `git worktree remove`, verify both its
  Git registration and physical worktree directory are absent, delete/prune its branch, and record
  residue for any failure. For a separate Codex task, the coordinator then archives that exact
  recorded task from the active sidebar; nested agents have no sidebar step. Never associate or
  archive a task by title or recency.
- `src/workflows/` has exactly two folder kinds (D265/D266): a top-level folder is a rail workflow,
  and a child folder is one declared timeline step. A chunk harness lives in the matching step
  folder with role `{ kind: "chunk-harness", of, step }`; it remains independently startable,
  nests under its composition in the picker/Explorer, and never appears in the rail. There is no
  `src/workflows/proving/` and no registered workflow whose purpose is test equipment. Since the
  2026-09-02 deletion acceptance every workflow folder holds exactly one file, `workflow.ts`; a step
  folder exists only when it carries a harness (`job-summary` is a declared group with no folder),
  and the `workflow-layout` guard refuses any other file beside a `workflow.ts`.
- **2026-09-02 — D311–D317: the workflow definition is the authoring authority.** The ONE authoring
  seam is `src/base/workflow-definition.ts`: `defineWorkflow` → `WorkflowDefinition`, and
  `compileWorkflow` → `CompiledWorkflow` (the descriptor, module requirements and the generic
  dashboard/Explorer projections). `steps` is an ordered array of `[timeline group, entries[]]`
  tuples — group keys/labels own timeline presentation, entries are the closed explicit
  `task | parallel | delegate | gate | transaction` algebra, and typed references (never tuple
  order) are the execution edges. A workflow reusing existing tasks/surfaces authors exactly
  `workflow.ts` + structural scenario + dry-run declaration + migration doc, plus the two
  registration edits in the two registry files and `npm run build:manifest`. Nothing else sits beside a `workflow.ts` (no
  `descriptor.ts`/`module.ts`/`nodes.ts`/`step.ts`/`node-ids.ts`/`omission.ts`), a step folder
  exists only when it carries a chunk harness, and there is no other authoring path and no advanced
  escape hatch (guards `workflow-layout`, `workflow-authoring-budget`). Declare an omission as
  `group(step, { omission })` beside that step's entries; every replacement value is complete and
  schema-valid in the run modal before start (D313). Recovery exposes checkpoint resume or root
  restart, and a root restart reruns reads/computes but never re-executes a completed transaction
  (D314). D265 folders stay organization/audit structure, not semantic timeline order; T1 stays per
  workflow and T2/T3 is added only for a genuinely new dashboard capability; "recipe" is analogy
  only. See docs/guides/workflow-authoring.md (practical), ref workflow-model §§1.6, 5.6 and 5.8
  (normative), doc 03c `{#workflow-authoring-model}` (routing).
- A workflow's T1 proof lives at
  `tests/scenario/workflows/<workflow-id>/{structural.scenario.test.ts,dry-run.scenario.ts}`: exactly
  one collected structural scenario and one sibling T1b live manifest. D318 gives that manifest two
  exclusive graph-derived arms: `dry-run-preview` for a transaction-bearing graph and `live-read`
  for a zero-transaction graph. `live-read` runs with `dryRun=false`, requires zero transaction
  nodes and proves exact zero deltas in all three write-authority tables; never add a no-op
  transaction to qualify for preview. The live half may write
  ordinary upstream `run_checkpoints`; its submit-free invariant is zero deltas in
  `write_intents`, `write_attempts`, and `durable_outbox`.
- The dry-run declaration boundary is `src/domain/trust/dry-run-scenario.ts`; the runner/assertions
  are `src/core/dry-run-scenario-runner.ts`, and `src/server/dry-run-scenario/` owns real start-plan,
  start-run, worker-drain, gate-command, receipt, and authority composition. Only `src/cli.ts` may
  dynamically load the non-collected `tests/scenario/**/dry-run.scenario.ts` declaration; no
  production module imports a test module. Blocked targets persist `not-started` before the ready
  runtime factory is called. A ready case declares the receipt service's complete ordered
  `(obligation, authority verdict, mandatory)` tuples, including every `node.*` row; the runner
  compares that list exactly and never projects `absent`/`ambiguous` into a shared verdict.
- **2026-08-30 — dry-run start admits an existing activation; it does not mint one.** Read the
  selected `<stateRoot>/settings.json` through SQLite → `readJournaledSettings`, then resolve
  the supplied environment with those actual Settings. Before any plan/start effect, hold one
  SQLite transaction → exact file fence, recheck the journal, and require the matching activated
  runtime and retained snapshot. Plan and execute synchronously inside that transaction using its
  exact snapshot id/fingerprint; never insert an independent snapshot or activate on behalf of the
  dashboard. A failed start clears unpublished scenario/config identity; publish only after outer
  commit and handle closure. Temp-fixture proof must apply nondefault Settings through the real
  executor/kernel and use the existing activation contract, preserving no-start-effects on refusal.
- **2026-08-30 — deterministic dry-run composition must carry its credential-free gate seam.**
  Fake browser sessions alone do not isolate worker boot from Duo credential identity resolution.
  Composition tests inject the real lease-backed `fixtureDuoCeremonyGates(clock)` through the
  optional `duoCeremony` runtime input and forward it to worker composition. Production CLI callers
  omit that input; absence retains the real production Duo factory and its fail-loud credential
  checks. Never provision operator credentials or replace the real worker drain to make these
  fixture tests pass; preserve their receipt, gate, write-safety, and failure-evidence assertions.
  Tests that inject a browser `sessionFactory` inject that fixture gate too; production omits both
  seams and resolves the registered credential identity.
- No default exports.
- A `src/dashboard/surfaces/*.tsx` or `src/dashboard/app/*.tsx` module exports **components only**;
  its hooks, folds, vocabularies and object constants live in a sibling `<surface>-model.ts`
  (`dashboard-refresh-boundary`, ref frontend-backend-integration §8.14, `src/dashboard/AGENTS.md`).
- Archive subviews are dashboard route state (`archiveView`), not `ArchiveWorkspace` local state; a
  cross-takeover door must name the real Archive view in that state rather than open the ledger and
  require a second click.
- **2026-08-25 — dashboard session joins stay authority-shaped (P4; the grouped list is retired by
  D305, the per-card join stays).** Join a worker only by exact `currentRun.runId`, and retain an
  absent arm's served reason. A pool's declared `desiredWorkers` is distinct from non-terminal
  authority worker-card facts; a missing pool row is no declaration, never a target of one.
- **2026-08-25 — virtual session rows preserve authority across dashboard ticks (P4). RETIRED by D305
  (2026-09-01): the Session Panel's membership list has no demo counterpart and is gone; the
  technique below is kept for the next virtualized authority list.** Flatten every
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
- **2026-08-28 — a workflow `matchKey` is durable identity, not presentation.** Preserve its
  byte-exact natural-key string unless a versioned identity migration is intended. Redact only
  diagnostics, wires and rendered projections; hashing an existing match key silently mints a new
  `ItemId` lineage for the same subject.
- **2026-08-29 — permanent write keys are authority-only.** Keep the byte-exact natural key in the
  write-intent/ledger authority and use it unchanged for lookup and idempotency. Persisted diagnostic
  text and every current receipt, Archive, Explain and dashboard projection carry only
  `idempotencyKeyDigest` or its bounded `key digest <12>…` reference. Immutable receipt compositions
  1/2 retain their original raw-key wording only so authority can re-derive their exact bytes; their
  operator projection is always withheld, and the compatibility serializer is isolated from
  composition 3. A retained legacy park message stays authority evidence but never crosses a wire.
  The diagnostic guard recognizes direct
  identifier and natural-key aliases through concatenation/join and checks `Error`, `ctx.fail` and
  logger sinks; sanitizer and descriptor exemptions require their canonical imported bindings.
- **2026-08-29 — diagnostic safety is an admission, not an age stamp.** Never stamp an arbitrary
  `Error.message` or caller-supplied validation problem safe. Preserve opaque detail in authority on
  an unstamped failure and let operator projections reconstruct from closed codes/states; stamp only
  producer-authored typed/sanitized sentences. A failed task span therefore carries fixed task-id
  wording, while terminal run authority copies — and never manufactures — its `FailureRecord`'s
  optional admission stamp. Receipt re-derivation mismatches expose only closed paths, row counts
  and bounded evidence digests; neither stored nor derived sentence bytes enter a refusal or wire.
- **2026-08-29 — an executable-source guard owns the transitive local closure, not only its named
  root.** A package-declared Vite config admits one static command segment (including a path-invoked
  Vite binary) and every bounded, repository-local executable import/re-export or static
  import-equals/CommonJS require beneath it; shell chains, missing or escaping local modules, and an
  over-bound walk refuse. Runner identity survives object/array packing, static property selection
  and destructuring. Diagnostic provenance resolves static computed keys at construction and read,
  fails closed on an unresolved read from a proven-sensitive container, and carries console/logger
  sink methods through object/array packing, destructuring, aliases and `call`/`apply`/`bind`.
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
- Treat `dry_run_scenario_results` as insert-only evidence: exact result-id replay may return the
  existing canonical row, while divergent replay, SQL UPDATE, and SQL DELETE must fail. Persist a
  subject label only; the explicit `not-started` arm carries no run/trace ids, and `started`
  requires both ids bound to the real dry-run execution.
- Dry-run write-safety counts are queried by run through
  `writeIntents.countDryRunEvidenceByRun`: attempts and durable outbox rows join through THIS run's
  intent ids. Never compare global table counts or attribute another run's write to the rehearsal.
- Dry-run reached-node evidence maps task span labels back through the registered descriptor; a
  label is not a node id. A transaction that fails before `transaction.previewed` is reached by its
  durable node-bound `FailureRecord`, and failed terminal expectations compare its exact safe
  `(code, nodeId, fingerprint)` tuple. Failure summaries, receipt warnings, spans and worker logs
  must never carry full or suffix person identifiers. Operator-visible write-sequencer messages
  identify a permanent key only by its bounded digest reference; the raw key remains authority-only.
  A parked row retains its original message as authority evidence, but later preview and execution
  refusals project only its typed park code instead of replaying that stored free text. A malformed
  staged subject observation names the required canonical format and owning contract, never the
  observed value.
- A workflow descriptor value-imports only zod, `src/domain/**`, and the audited `src/base/**`
  builders; `module.ts` is where anything server-side attaches (D106). Branch cases and parallel
  branches name nodes DOWNSTREAM of their controller — forward references, checked at `build()`
  (D104).
- 2026-08-25 (D265 review; re-homed 2026-09-02 by the D312 deletion): a workflow-step key's literal
  type never replaces its category-key schema, and an entry identity belongs to the exact frozen
  step object that created it — equal keys are not equal ownership at runtime. Declare each step
  group once in the composition's `workflow.ts` with `defineWorkflowStep`, bind it once with
  `defineStepEntries`, define the step's task/transaction/gate identities through the returned
  factory, and let the harness import them; the compiler refuses a tuple that claims another step's
  identity.
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

- **2026-09-01 — delete means delete, and the tombstone is the admission (D308).** A terminal run on
  the queue or in the Archive leaves the authority database with every row it owns, write ledger
  included, in one journaled transaction. Never remove a `*_never_deleted` trigger to make that
  possible: rewrite it to abort unless an insert-only `deleted_runs` row already names the exact run,
  and write that row first in the cascade. The tree goes leaves-first and refuses while any member is
  non-terminal; a member is never deleted alone; an archived run is deleted only through the Archive
  door that cites its `contentDigest`. Span/notes JSONL are never rewritten (D301) — the storage doctor
  reads the tombstone. The released idempotency key is stated in the confirm copy, not hidden.

- **2026-09-03 — attempts are evidence records, not inputs to an automatic comparison (D289 amendment).**
  A retry stays under the same logical queue item and takes its next attempt number. Its target
  presentation is one item row with separately selectable attempts, each rendering its own ordinary
  timeline, logs, receipt, failure, reuse and outcome. Do not add
  a cross-attempt diff, comparison registry, comparison endpoint, or receipt-tab comparison panel.
  `retryOf` remains lineage, not permission for the product to decide which differences matter.
  The operator opens the separate attempts and compares their facts directly. The current projection
  still emits one top-level row per run, so the item-row fold is explicit unfinished work.

- **2026-08-30 — request-only Settings refusals must precede authority access.** After strict
  input parsing, compare the requested schema hash and canonical patch fingerprint before lock
  acquisition or `readState`: even a read initializes virgin authority evidence. These refusals
  need no current revision and retain their typed code/message without touching the filesystem.
  Prove them against pristine paths, including absent settings/initialization/lock bytes and zero
  lock acquisitions; never pre-initialize the fixture to conceal the write. Valid apply, replay,
  revision CAS and recovery still use the existing exclusive authority and directory checks.

- **2026-08-30 — strict command ingress cannot accept an open intermediate envelope.** Stamp only
  server-owned provenance on an otherwise untrusted object, then parse the canonical single/bulk
  command schema before reading identity or entering the acceptance lane. Keep bulk parse failures
  in the typed refusal arm; an accepted bulk request is always schema-validated. Origin/media tests
  must observe the real Request's read methods and `bodyUsed`, plus unchanged authority: invalid
  JSON alone proves refusal precedence, not zero consumption. Reconstruct expected server envelopes
  independently when checking persisted command hashes, so an editable-schema change cannot leave
  an obsolete golden hash or turn the test into a producer-versus-itself assertion.

- **2026-08-30 — reconciliation must preserve both transaction and file uncertainty.** A Settings
  transaction can commit before its caller reports failure: re-read the exact command/audit/current
  conjunction before settling, and compensate only when the command is proved absent. Never restore
  prior file bytes over a committed revision. Re-check the destination after staging and before
  replacement; a concurrent byte change refuses without overwriting it. Directory integrity is a
  separate check, not established by this byte check or by `mkdir(mode:0700)` (see the lesson below).
  Prepared boot recovery must inspect command, audit, and `settings_current` presence for the exact
  prepared command. Even an audit without its command is evidence, not proved absence: every mixed
  presence state refuses before file settlement and retains the exact prepare, settings and
  initialization bytes plus the durable rows. All three absent permits rollback only after proving
  the prior identity; all three present still requires the full exact command/hash/audit binding.
  The editor consumes one verified reader snapshot containing both record and runtime status.
  Validate THIS process's active identity and reconcile the file in one SQLite transaction with
  one Settings lock acquisition; never derive the pair from separate reads or cache it across applies.
  One private authenticated observation owns the audit lookup for both admission and recovery;
  a second presence-only read site splits that proof. Preserve diagnostic precedence while sharing
  it: ordinary admission reads current, validates command, then reads audit; prepared recovery
  reads command, audit, current before authentication or proved absence. Simultaneously malformed
  rows must not silently choose a different error. Retain fresh final verification after settlement.

- **2026-08-30 — private Settings files require non-replaceable directory ancestry.** Before
  lock acquisition, walk and verify the complete existing path from the filesystem root; create
  missing directories one component at a time only below verified ancestors. Require a runtime-owned
  authority directory without group/world write. Ancestors may belong to root or the runtime UID,
  with group/world write allowed only on sticky ancestors, never the authority directory itself.
  Safe 0755 directories are legitimate. Application symlinks refuse; root-owned system aliases
  under root-owned parents (macOS `/var` and `/tmp`) retain their inode and verify their target
  ancestry too. Reject a raw symlink target containing a `..` path component before lexical
  normalization: `pivot/../safe` can traverse a symlink at `pivot` and physically reach a different
  parent than `resolve` verifies. Native filesystem traversal, not JS lexical realpath, proves this
  regression. Bind every path's device/inode for that authority instance and recheck before
  admission, file operations and settlement; a replacement or missing bound directory refuses
  without chmod, recreation or evidence cleanup. This is a local POSIX ownership/mode-bit protocol:
  root, same-UID interference, ACL grants and privileged mount changes are outside its guarantee.
  Do not advertise ACL inspection or race-proof protection against the owning UID.

- **2026-08-28 — an atomic settings rename does not make the command journal atomic.** The
  `apply-settings` executor replaces one strict, fingerprinted `.tracker/settings.json` envelope (in `config/` until D321) by
  temp-write → file fsync → atomic rename → directory fsync, then reads the exact bytes back. Claim
  its adjacent lock by atomic hard link before the revision read and retain that claim until the
  SQLite journal/audit transaction commits or exact compensation finishes; otherwise two writers
  can both pass CAS, and releasing after rename still exposes an unjournaled value. Persist the
  fingerprint of the WHOLE canonical command envelope for crash replay, not only command id plus
  revision/schema/patch, because actor/source/time/reason are command identity too. Read the file
  through one no-follow descriptor and require one private, regular, size-bounded runtime-owned
  inode. A private sidecar records `virgin` versus `initialized`: missing settings after initialization
  is deletion and refuses, while file-present/virgin reconciles the one valid file-before-sidecar
  crash window. Represent ENOENT as an explicit valid-absence observation before projecting it to
  the file reader's optional result; any other open or integrity-inspection error remains load-bearing.
  If apply fails after replacement and exact prior/evidence inspection also fails, aggregate both
  errors and retain exclusion rather than reporting only the primary failure. The persisted patch
  schema is a closed server allowlist distinct from the resolver's broad input schema, so environment
  and credential/runtime-state/auth-path leaves never enter this authority. `paths.reportsDir` is the
  sole editable path carveout; DCC3 also admits `ocr.pageConcurrency`, `ocr.maxValidationRetries` and
  `concurrency.defaultWorkers`, without inheriting the broader resolver schema. Bootstrap serves that same named
  editable-schema hash; hashing the broader resolver schema advertises fields the command rejects.
  Validate the complete merged candidate through the composition's exact env/settings/default
  resolver before replacement, because individually valid editable leaves can violate a cross-field
  config invariant on restart. Stale lock removal needs a separate atomic reaper claim retained
  through acquisition-twin repair, stale pathname removal, and main-lock reacquisition; otherwise a
  byte-check followed by unlink can delete a concurrent winner. Fsync the lock directory only after
  removing the acquisition-named hard-link twin, and recover only the exact same-device/inode/bytes
  twin while that reaper claim excludes admission. Bound the canonical next envelope before rename:
  a schema-valid unbounded leaf can exceed the reader's byte limit and must leave the prior file
  untouched. Recover a dead reaper through a hard-link barrier named by its UUID and verified against
  its private owner, PID/birth identity, inode and bytes; retain or adopt that barrier until a live
  main lock exists, so recovery-process loss cannot turn the serialization cure into a permanent DoS.
  Every runtime composition that resolves config, including worker boot, must first read this same
  authority; resolving an empty settings object outside the dashboard creates a restart split-brain.
  A journaled file is pending until dashboard boot atomically records its resolved config snapshot
  and advances the singleton active runtime generation. Worker boot must match that exact
  `(settings revision, settings fingerprint, config fingerprint)` generation. Filesystem exclusion
  belongs to boot reconciliation and settings transitions, not steady worker polling: reacquiring it
  on every idle/claim poll repeats PID observation, hard-link, fsync, and unlink work while holding a
  SQLite writer. Instead `claimNext` owns one SQLite transaction that compares both the active
  runtime row and durable `settings_current` epoch to the worker's boot token, then compares the
  queued run's retained config snapshot before changing `queued` to `claimed`. SQLite serialization
  orders a crossing settings-current advance wholly before or after that claim, so this removes the
  filesystem work without creating a check-then-act gap.
  Compensation writes durable rollback evidence before changing live bytes, restores/removes the
  settings file before restoring the initialization sidecar, and removes that evidence only after
  both states are durably exact. Any surviving evidence refuses restart reconciliation by name.
  Before the live rename, persist a full prepare containing the exact prior/next settings and
  initialization bytes plus the canonical command identity. Commit the command, audit, and one
  `settings_current` singleton in the same SQLite transaction. Dashboard and worker boot reconcile
  under SQLite → settings-file exclusion: retain prepared next bytes only when that exact singleton,
  command, and audit committed; otherwise restore the exact canonical prior bytes. Preserve ambiguous
  evidence and fail loud, and clear the prepare only after the chosen outcome is durable. With no
  prepare, the file must equal the singleton's exact revision, settings fingerprint, command, audit,
  and completion identity; an older byte-exact file that was once journaled is still stale and refuses.
  An applied or exact replay result carries `restartRequired=true` plus the new revision and settings
  fingerprint. If post-transaction file settlement failed, replay must finish that settlement and
  reconcile the exact file, singleton, journal, and audit before returning `already-applied`.
  Advancing `settings_current` while the active runtime row remains on its prior identity is the
  atomic stale marker: planning, start, intake/retry/relaunch fan-out, and worker plan/spawn refuse
  until boot activates the exact new generation. Async worker starts recheck after their process
  effect and before journaling so a settings apply crossing that gap cannot publish stale authority.
  Capture finalization is another fan-out door: require the current runtime generation inside its
  synchronous settlement transaction before inserting the manifest or run. A stale generation may
  settle that capture generation as failed, but its manifest/run identities stay absent; after exact
  restart activation, retry-finalize mints the next generation and performs the handoff once.
  The loopback command ingress is also an authority boundary: before reading a body, require
  `application/json` and an exact HTTP Origin equal to the request's loopback Host. Refuse a
  caller-authored `requestedBy` that differs from the request checkpoint before replay or effects;
  for an absent or matching claim, stamp `requestedBy`, `source`, and accepted time from the BFF's
  operator identity and clock. Serialize one command id from acceptance through kernel settlement;
  an exact replay reuses the durable command's accepted time. Before any bulk child executes, insert
  one immutable parent acceptance that binds the bulk id to the server-stamped canonical envelope,
  including target order and every child CAS value. Exact replay reuses that byte-exact parent and
  accepted time; adding, omitting, reordering, or changing a child refuses before any child effect.
  This keeps settings' whole-envelope fingerprint server-authored without turning a later exact
  delivery into divergent id reuse.
  Descriptor cleanup follows the same evidence rule: when a no-follow read or fsync and its close
  both fail, preserve both errors primary-first in one `AggregateError`; never let `finally` replace
  the integrity/durability cause with the close error.
- **2026-08-30 — DCC2 reconciliation has one executor and two accounting directions.**
  `src/domain/preflight.ts` is the sole executor/retained command authority;
  `src/server/preflight/dashboard-runners.ts` is its dashboard composition. Duplicate, missing and
  surplus runners refuse. Deadline and caller cancellation retain admission through actual
  settlement; failed command identities consume the same bounded replay capacity as successes.
  Storage root-to-authority lookup and per-current-run `missing-span` diagnosis share one immutable
  read snapshot. A malformed row without any span still names its record, never "nothing found";
  any malformed current/archive record withholds absence classifications for the whole inspection.
  Duplicate forward/reverse diagnoses of that same row are emitted once, indexed by exact
  record identity and table rather than rescanning all roots per record. The optional process-orphan
  inspector streams the complete worker history, validates released records too, and retains every
  current-owner observation; it neither sorts/materializes the history nor truncates it. Preserve the strict
  diagnostic-message redaction gate on the richer `span_stream`/missing/malformed wire.
  Malformed `spanPath`/`parentSpanPath` diagnoses name the offending field, never the supplied
  value (including an expected path copied from a malformed root). Only the private, internally
  authored safe corpus error carries schema-owned field/line detail across the diagnostic boundary;
  untrusted filenames use grouped SHA-256 identifiers and nested schema-path keys are not echoed.
  Configured-root basenames retain their existing policy; intermediate ancestor components are
  identified only by ordinal, never their supplied names. Raw I/O or
  parser failures receive a closed errno-based summary. The browser wire and CLI JSON must both
  withhold synthetic private-path, secret and person markers in regression tests.

- **2026-08-28 — preflight readback and rerun share one retained authority.** Compose exactly the
  registry-selected runners, complete the initial report before serving bootstrap, and route reruns
  through the same serialized, bounded idempotent command authority; retain successful and failed
  command identities so exact replay cannot execute again. Rerun ingress is loopback-only,
  byte-bounded, rate-bounded and single-flight. A Vite occupant counts as owned only when its strict
  proof matches the current launcher's fresh nonce and both public markers arrive within the runner
  deadline and byte limit; public markers or another launcher's nonce refuse. The shared preflight
  wire imports only browser-safe check/capability/report leaves; the Node-backed runtime registry
  stays server-side. Raw Vite HTTP belongs to one `infra/providers` adapter whose discriminated
  refusal survives into the detector summary. Register the launch nonce as process-ownership
  environment authority, including the launcher's bounded pass-through and Vite's exact read.
  Parse Origin before applying loopback policy, and keep content type/length, stream read, UTF-8 and
  JSON body failures distinct rather than collapsing them into one plausible invalid request.
  The domain executor owns each registered monotonic deadline: abort on expiry, await actual
  detector settlement, then reject any late healthy answer. There is no detached prompt result or
  second server authority. Admission remains closed until every selected detector settles, and
  failures aggregate in registry order, primary first.
  Reconcile every ordered `run.queued` root against only the configured live `tasks` and
  `archived_runs` rows from a streamed,
  bounded corpus through one synchronous, non-reentrant descriptor-relative traversal: enter the
  explicit trust anchor once, resolve each no-follow descendant against the kernel-held cwd, use a
  held directory stream for enumeration, and open leaf files relative with `O_NOFOLLOW`. Restore cwd
  and close every directory/file descriptor in `finally`, including identity-check failures, so a
  timed regular-directory A-to-B-to-A swap cannot redirect bytes. Enforce the file cap while the
  directory stream is being consumed, stream authority validation/fingerprint rows instead of
  materializing whole tables, reuse one prepared live/archive lookup pair for the entire bounded
  root batch, and use only one broad authority inspection plus transaction-bound intermediate/final
  identities. Retain the full immutable root
  tuple and its corpus order; duplicate roots, foreign workflow/trace paths, task/root mismatches,
  non-increasing item attempts, and exact live/archive tuple mismatches are malformed. A requeue's
  next attempt must strictly increase but may skip attempts consumed by sibling runs. A valid
  archived resolution requires the schema's retained `tasks` row and its `archived_runs` row to
  coexist: validate the complete retained task/root tuple (including priority) first, then the
  retained lifecycle and archive/root tuple. The retained lifecycle must be terminal, and its
  outcome, end instant and failure identity must exactly match the frozen archive row/detail;
  every non-terminal state is a named contradiction. A frozen failure binds its complete
  `(failureId, runId, traceId, attempt, workflowId)` identity to the retained terminal
  lifecycle/envelope and the archive record; a matching failure id with any foreign coordinate is
  malformed by field name. Coexistence itself is not duplicate authority;
  a missing, malformed or contradictory pairing is malformed and names both authorities. Serve
  basename-only sanitized defects, name archived runs, and degrade missing or malformed authority. A missing `spans`
  directory is reconciled only for the exact zero-live/zero-archive never-produced baseline; once
  either authority has held a run, absence is unavailable evidence, never an empty corpus.
  Broad endpoint validation, metadata, fingerprint and counts share one SQLite read transaction;
  each exact resolution read likewise returns its generation and content fingerprint from one
  transaction. Retain initial and final identity-read failures as structured transition evidence,
  and require those identities or exact failure observations to agree, so a hybrid read or
  A-to-B-to-A replacement refuses. Queue projection keeps its live-authority refusal;
  doctor diagnosis never selects a substitute row or database. The browser doctor wire must retain
  `span_stream` as an explicit malformed-authority source beside `tasks` and `archived_runs`, or the
  diagnosis itself fails schema parsing. Preflight catches never append filesystem-originated
  `error.message`; emit a closed safe reason code and, where the registered policy permits a path,
  only the configured root's basename.
- **Explorer recovery admission (D283, 2026-08-30).** The BFF reconciles prepared override claims
  against the exact command journal, audit and live bytes before serving Explorer; journal/audit
  observation stays in the command kernel's shared read-only adapter for both read admission and
  ordinary command recovery. A recovered audit must carry exactly empty `affectedDependencyIds`:
  presentation-only edits have no dependency effects; a nonempty vector refuses with the claim
  unchanged. An unjournaled
  prepared claim blocks GET/validation, not the sole exact-command replay door; partial or divergent
  evidence refuses startup. Replays repeat directory fsync before applied acknowledgement or claim
  release, and fsync/close/cleanup errors preserve primary-first causes and failed paths. Prepared
  next bytes must equal the prior document plus the exact closed command changes, including untouched
  workflows. Even cold no-claim recovery fsyncs the directory and rechecks absence: unlink returning
  does not prove durable removal. It neither restores a marker nor deletes a newly observed claim. See
  ref operator-trust §5.4 and ref lessons. D290 preserves the exact DCC4 v19 SQL and digest only as
  source-lineage test evidence and refuses that divergent suffix before mutation; its dormant
  tables and record schemas are omitted from the integrated registry. That history is not permission
  to restore the superseded broad/token/outbox runtime or add historical label egress.
  Claim/file presence is a strict filesystem observation: only explicit `ENOENT` means absent;
  permission, I/O, or metadata errors retain uncertainty and refuse without cleanup.

- **Explorer read admission (D283, 2026-08-30).** Reconcile once per GET or validation request,
  then read and recursively freeze the whole override document inside that same authority
  transaction. Build every workflow row and validation's revision/presentation basis from that
  request-local view. The next request re-admits current authority; never retain a cross-request
  cache or perform recovery/fsync and file rereads per workflow row. See ref operator-trust §5.4.

- **2026-08-29 — redaction does not make historical free text safe retroactively.** Version the
  producer boundary. Immutable receipt compositions and archive generations stay byte-exact;
  unstamped failure/note/log text is withheld or reconstructed from typed codes/digests at every
  operator projection. Write uncertainty retains a closed authority-only reason code plus evidence
  digest, while public copy stays generic. Never discard a probe exception, merge missing evidence
  with schema failure/key drift, or turn unknown into success to obtain safer-looking text.

- **2026-08-29 — a permissive parser and a safe-looking alias are not admission proofs.** Node's
  environment parser may accept bytes the project does not mean to support, and a descriptor-shaped
  local can still alias a raw credential or person identifier. Consume the complete `.env` grammar
  before applying any key, then require the parser's output keys to match one-to-one. At diagnostic
  sinks, resolve import/call and value provenance through aliases, assignments, destructuring and
  simple function returns before granting canonical sanitizer or descriptor exemptions.

- **2026-08-28 — loading an ignored secret file does not make its filesystem exposure safe.** A
  committed `0644` example copied under the usual umask produced a group/other-readable `.env`, and
  `tsx --env-file` let Node parse and apply it before the runtime could judge the source. Launch only
  through the closed secure bootstrap: open the fixed path with `O_NOFOLLOW`, fstat that descriptor,
  require an exact regular file with `mode & 0o077 === 0` and bounded size, read/parse its bytes from
  that same descriptor, close it, then apply only keys absent from the explicit parent environment.
  Dynamic import is a two-arm allowlist (`cli` or D300 document-number smoke), never a caller-supplied target. Test
  injection may replace filesystem access; production entry points get no skip or alternate path.

- **2026-08-28 — Explorer validation attests what stayed unchanged and requires what source must
  re-prove.** A presentation-only draft is bound to the live descriptor version, contract
  fingerprint and override revision, so validation can re-derive and record the exact factory seal,
  workflow/task schema hashes, graph identity, runtime registry round-trip and resolved scenario
  sources as `held`. It must not call those checks `passed`: the BFF did not execute the architecture
  or scenario suites. A policy/Edit Data source brief carries the opposite state—all five checks are
  `required` after the canonical patch—plus the exact current identity, next version and a
  `must-change` fingerprint obligation. Its TypeScript replacement expressions are canonical JSON
  parsed through the closed policy/Edit Data schemas, not arbitrary code strings. Mixed hot/source
  drafts and no-op source drafts refuse, including a `partial-no-op` refusal when one target is
  unchanged and another is effective; validation never drops part of the reviewed draft. Patch
  changes and TypeScript operations have exact cardinality and order, semantic policy rows bind
  their exact path/before/after expressions, and every other semantic arm is either derived (Edit
  Data node ids) or required unchanged. An unallowlisted Edit Data value refuses before any draft
  can become a brief.

- **2026-08-28 — storage diagnosis reconciles exact span and authority identities.** Read only the
  configured authority database and configured span root; classify current, archived, missing-span
  and unaccounted identities without selecting a plausible alternate. Reconcile the full immutable
  root tuple plus attempt/order/path relationships: duplicate roots, foreign workflow/trace paths,
  task/root mismatches and out-of-order attempts are malformed, not matching run-id sets. A
  requeue attempt must strictly increase but need not be adjacent because sibling runs can consume
  intermediate allocations; it still binds the exact authority/path/identity tuple. Any
  malformed authority row or span line stops absence classification and stays named as malformed.
  Archived evidence is accounted evidence, while missing-span or unaccounted evidence degrades
  preflight and CLI doctor.
  The queue projection keeps its exact refusal for a span-only run; the doctor explains that refusal
  and never weakens it or repairs state. Registered preflight timeouts abort through the injected
  monotonic scheduler but await detector settlement; non-cooperative I/O stays process-owned and a
  late healthy-looking answer cannot become a pass. A selected refresh awaits every runner before
  propagating failure and aggregates multiple failures in registry order, primary first.

- **2026-08-28 — an XLSX attachment is evidence over one exact authority snapshot, not a second
  report reader.** Search exports replay the caller's strict DCR3 query across only the named
  generation/order and refuse any moved, foreign, repeated or incomplete page; Activity exports
  bind the served inclusive date report. Compose only redacted served facts, omit query text and
  every full or shortened person/run/trace/retry identifier from cells, and carry source, snapshot
  and caveats inside the workbook. Normalize ZIP timestamps so identical documents have identical
  bytes. Content-address and read back those bytes, insert the exact selection/artifact/attachment
  evidence, then verify digest, size, type and filename before one dedicated download returns. The
  evidence is insert-only, and this command never implies a generic artifact-byte read route.
  (DCR5)

- **2026-08-28 — cross-date search is a snapshot of run authority, not a span index.** Query only
  non-archived `tasks` rows; the measured corpus has 7 authority runs but 57 span folds and 50
  orphan span identities, so admitting span-only identities would fabricate searchable runs. Keep
  the selected page bounded and totally ordered by match strength, enqueue instant descending, then
  run id ascending. Bind every opaque continuation to the canonical query, source-database
  identity, authority generation and order version, then authenticate it with one random process-
  held HMAC key composed per BFF instance. A restart-invalid signature, malformed token, foreign
  source, changed query or stale generation refuses distinctly instead of restarting against
  current/latest data; source identity is public binding material, never a signing key. Serve only the
  closed redacted row (run/trace/workflow identity plus measured authority facets), with exact zero,
  absent and present arms kept distinct. ISO instants with offsets must become epoch milliseconds
  for SQL bounds/order/keysets and canonical UTC for persisted order keys, cursor anchors and wire
  results; textual ISO order is not instant order, especially across a Pacific DST boundary. Query
  facets stay closed to the measured corpus: separations; done/failed/parked-gate; single; dry-run
  true; and kuali/new-kronos/ucpath. Priority remains a served fact, not a query facet, because its
  current cardinalities were not measured. The result wire repeats those same closed values and the
  exact descriptor-owned `Separations` presentation; a broader reader would turn an authority
  refusal into a client-visible row. Every non-archived row must match that corpus, pass its strict
  record schema and reconcile denormalized search columns
  before any query text, facet, rank or count is evaluated; otherwise false absence and differing
  parse behavior become a raw-record substring oracle. A validation cache names one exact authority
  generation plus SQLite data version, invalidates on every in-process authority write, and rebuilds
  synchronously on mismatch. Hold generation, reconciliation, ranking, paging and wire construction
  in one deferred WAL read snapshot: it retains one database instant while another connection writes,
  and same-connection mutation refuses until the snapshot closes. Materialize the matched corpus once,
  carry its exact total through a window, and emit one summary arm so an empty keyset page still knows
  the query's total without a second ranked pass. Match rank has one domain-owned order consumed by
  both SQL selection and wire validation. When a strict raw record fails to parse, the route-visible
  error may name only its already-validated run key; parser/Zod detail stays on the internal `cause`,
  because refinement messages can repeat sensitive durable values verbatim. A corpus-dimension
  mismatch follows the same boundary: its outer message names only the run key and fixed dimension,
  while the observed value stays on the internal `cause`. (D283 / DCR3)
- **2026-08-30 — a returned artifact URL is consumed only when a mounted browser sink receives it.**
  The Archive route guard drives `ArchivedRunDetail` through Evidence and capture, uses the real
  query/parser, and credits only strict same-pair native `href`/`src` observations. An unused URL
  builder earns nothing. Keep scanner roots, patterns and both-direction pending accounting intact;
  observation failures remain fatal beside orphan-route diagnostics. File-local jsdom proves this
  parent-to-DOM connection, not shell reachability, downloaded bytes, decode or browser geometry.

- **2026-08-30 — an exact resource URL still needs its D183 origin declaration.** Register the
  complete archived-capture wire, not just its unfamiliar paths: UUIDs and state literals are
  closed, while the exact-id URL and fixed availability copy are repository-authored free text.
  Prove that origin through the real archive query and verifier with planted canaries, including
  typed missing/corrupt errors; raw errors alone are normalized before the query and can hide an
  accidental `error.message` substitution. No origin exception or scanner waiver is needed.

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

- **2026-08-28 — a content-addressed object is not permission to serve it.** The loopback artifact
  route resolves a complete ref only through the diagnostic attachment index, then prepares a single-use
  verified-byte lease after re-verifying its digest, size and media type. It and exact-bundle readback share
  one verifier engine while selecting explicit modes: readback drains and hashes without retaining chunks,
  while a selected response snapshots, decodes and verifies into private unlinked scratch before streaming
  through a response-owned lease. HEAD and refused Range responses dispose before returning; GET transfers
  ownership to the HTTP adapter, whose cancellation and shutdown paths await disposal. Each caller retains
  its own identity/error labels. An uncomposed
  attachment authority is an unavailable capability, not corrupt evidence. A valid id that exists only in
  storage, capture, archive or phone authority is foreign and answers 404; an indexed id whose physical
  object disappeared stays a distinct typed verifier failure and answers a non-retryable 500 here.
  Even an unsupported Range is refused only after verification, and the capture Host keeps the
  byte route behind the same byte-identical 404 gate as every other operator surface.

- **2026-08-31 — a disconnect test must wait for the owned cleanup, not one race-specific error arm.**
  After response handoff, a client close can be observed before a body write, while waiting for drain,
  or before finish. Every arm must cancel and dispose the response-owned verified-byte lease, but only
  the rejected transfer arm reaches the local transfer-error observer. A real-socket lease test destroys
  the response synchronously in its callback and awaits the lease-close authority; separate adapter tests
  own the exact error-reporting branch. Never make correct cleanup depend on an observer promise that a
  valid normal-cancellation arm does not resolve.

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

### Dated lessons

- **2026-08-28 — a generation label does not prove which pseudonym key produced it.** Bind every
  public pseudonym generation to one durable, irreversible, generation-bound HMAC key commitment;
  the commitment contains neither key material nor a person-derived value. Compare or append that
  binding inside the reviewed batch transaction before inserting evidence, so changing the secret
  under an existing generation refuses the whole unseen-run batch while a real rotation appends a
  new generation. Protect the binding itself from UPDATE, DELETE and SQLite's non-recursive
  `INSERT OR REPLACE` path. An old evidence row cannot be assigned a commitment after the fact:
  refuse it inside the same migration transaction that would create the binding table, so schema
  metadata and DDL roll back together instead of leaving a committed orphan schema. (D288)

- **2026-08-28 — a schema-valid pseudonym is not proof that the reviewed HMAC derived it.** Keep
  `activityPersonPseudonyms` read-only and issue its writer only as the reviewed backfill capability;
  that capability accepts run ids, authenticates the secret-backed domain, re-reads the exact
  terminal current Separations result, prevalidates the complete replay set and commits one batch.
  Production composition must obtain that domain directly from
  `requireActivityPersonPseudonymDomain()`—a caller-supplied derivation object can claim any 64-hex
  value. Exclude archive authority explicitly rather than treating `tasks` as current by itself.
  SQL UPDATE/DELETE triggers are also insufficient for insert-only evidence: with recursive triggers
  disabled, SQLite `INSERT OR REPLACE` can bypass the DELETE trigger, so a later `BEFORE INSERT`
  conflict guard must refuse before replacement begins. (D288)

- **2026-08-28 — a historical person count needs generated authority, not a fresh identifier read.**
  D288's backfill may inspect only a current, done Separations run's strict terminal
  `run_results.result.value.approved.emplId`; inputs, items, termination/finalization receipts and
  nearby identifier-shaped values are not substitutes. Persist only the generation-bound HMAC row,
  keyed by `(runId, keyGeneration)`, and return a named unavailable arm without writing when the run,
  result identity, current schema or exact binding is missing, foreign, malformed or ambiguous.
  Rotation appends another generation; replay never rewrites either pseudonym evidence or a receipt.

- **2026-08-25 — a parity fixture must contain the state it claims to prove.** The ordinary Start
  Run fixture truthfully covered Person Lookup's input/plan flow, but that meant it could not see the
  Separations picker hierarchy at all. Keep that focused fixture, and add a separate strict bootstrap
  profile for the registry shape under review; a broad fixture that redraws unrelated references hides
  the reason the new reference exists.

- **2026-08-25 — a harness's HR category is not its dashboard placement.** The Kronos timecard
  harness truthfully remains `timekeeping`, but its role address says it is a step of `separations`.
  Fold harnesses by `role.of` before partitioning categories; once nested, the composition's category
  owns the picker and Explorer heading. Partitioning first turns a real step into a top-level peer.

- **2026-08-25 — a graph walk cannot inherit an executor-backed transaction proof.** Retiring a
  proof workflow also retires tests bound to its descriptor; re-home the invariant on the current
  workflow through the real interpreter, beat-⑦ checkpoint read-back, terminal authority and
  receipt derivation. A `walkDescriptor` assertion proves binds and derive shape, but it cannot
  prove that any durable row was read or that a run terminalized from it.

- **2026-08-25 — a preview has to be asserted in the receipt's real vocabulary.** A dry-run
  transaction stores no transaction checkpoint, so Kuali finalization receipts derive four
  cross-source obligations as `unknown` and the literal reload-read-back obligation as `absent`;
  inventing one aggregate obligation, collapsing `absent` with `ambiguous`, omitting an upstream
  node row, or claiming partial confidence makes the manifest lie about authority. Compare the
  whole ordered tuple list. Likewise, `replay: "always-rerun"` forbids reuse but still writes the
  current claim generation's checkpoint, and a failed transaction can be reached only from its
  durable failure before a `transaction.previewed` event exists. Malformed subject text looked
  useful in a format error, but that message fans out to failure, receipt, span and log sinks; keep
  the contract/format actionable and omit the observed text entirely.

- **2026-08-25 — retiring a proof workflow does not retire the real workflow's vocabulary.** The
  timekeeper annotation staging/read-back schemas and tasks belonged only to D266's dismantled test
  workflow, but `KUALI_RRSS_TIMEKEEPER_FIELD` is also one of the twelve fields staged by real
  separation finalization. Audit every deleted contract through driver, fake, receipt and catalog
  dependents; preserve shared semantic elements under the real task that still consumes them.

- **2026-08-25 — Dry-run evidence must model pre-browser blockage explicitly.** A gone subject has
  no run or trace identity to record, so nullable identities invite fabrication; use the strict
  `not-started` blocked arm. Keep assertion diagnostics to safe reason slugs: free text can leak the
  resolved subject value into otherwise label-only evidence.

- **2026-08-25 — Write-safety tables do not share one run key.** `write_intents` carries the run id,
  while `write_attempts` and `durable_outbox` carry only `write_intent_id`. A global before/after
  count looked like a delta but could blame concurrent work on the rehearsal; derive all three
  counts from the named run's intent set, before and after, and assert the exact zero tuple.

- **2026-09-02 — D310 pending deletion authority is an exact stable transaction set, and the real
  filing must survive through Kuali finalization.** A person-only sweep key lets an earlier empty
  no-op suppress a later nonempty set. Bind the v2 key to the canonical eligible/protected SS Smart
  HR row set; refuse any immutable v1 intent rather than reinterpreting it. Immediately before
  selection, re-read the stable T-ID source and uniquely join every eligible row to the separate
  Transactions in Progress grid by its shared facts; a positional checkbox suffix is not identity.
  Verify the selected set absent and every protected row unchanged. After the ordinary sweep and
  filing, always re-read the exact filed T ID immediately before Kuali staging and require matching
  EID, date, name, termination action and accepted current status. That read proves current presence
  only: it never upgrades a D307 asserted receipt into controlled-write evidence and never authorizes
  re-filing as downstream repair.

## After changes

- **2026-08-30 — deduplicating capture bytes must not deduplicate provenance (D292).** Live run
  captures serve one verified artifact ref with every same-run diagnostic-bundle membership.
  Compare complete ref metadata before joining origins; never let last-write-wins choose an
  origin or infer `failure` from a run's status or another origin's failure id. Accumulate origins
  in one request-local mutable list, then strictly parse and recursively freeze each complete wire
  artifact once; copying the whole prior list per membership makes a shared artifact quadratic.
  Keep the initial availability distinct from the lazy strict list, and retain old archived-detail
  compatibility without enriching it from current authority.

Run `npm run typecheck && npm run lint && npm run test:coverage` before committing (D191 —
`test:coverage` runs the disjoint `unit`, `architecture`, and `scenario` projects exactly once and
REPLACES the earlier `test` + `test:architecture` pair as the per-commit gate; both scripts stay
available for a targeted run). Add a new guard file **and** its
`docs/rebuild/guard-inventory.json` entry in the same commit — `guard-manifest.test.ts` checks both
directions. Retiring a guard requires an explicit `retired` entry naming the deciding decision and
where the invariant went; a guard that simply disappears is indistinguishable from an accident.

Never push to any remote without explicit instruction.
