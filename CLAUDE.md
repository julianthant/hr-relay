# HR Automation — rebuild

The ground-up rebuild of UCSD's UCPath HR automation. This repository is **not** production. The
legacy repository at `/Users/julianhein/Projects/hr-automation` runs every real HR transaction and
stays the sole production authority until a single all-at-once cutover (D89/D93).

Seeded 2026-07-31 from `hr-automation@5879004` (branch `feature/rebuild-phase1b`, which stays in the
legacy repo as the pre-split record). Phases 1a–1e completed 2026-08-01. Phase 1f is in progress;
its registry/task-binding corrections, worker-owned browser-session lifecycle, and mandatory task
provenance collection landed 2026-08-02. D109's start-plan ingress authority now retains exact raw
JSON beside canonical snapshots for accepted and refused entries, binds both schema hashes and
canonical digests, invalidates pre-D109 short-lived plan rows rather than fabricating raw values,
and exposes the confirmation revision and hashes to the later command-service consume step. D110/
D114 terminal authority now factory-derives successful results from exact stored dependencies,
requires an unforgeable in-process seal for initial success, and stores a strict pre-terminal
authorization with exact structured failures or schema-bound results/outbox through immutable
schema v8, atomically with the matching failed/done run transition; generic run transitions cannot
bypass it. D112's generic provider admission now reserves capability-global fixed-window budgets
through immutable schema v9, binds every decision to exact run/config/request identity, races remote
I/O against kernel-owned abort/deadline, settles before exposing data, and retains conservative cost
on uncertain outcomes; production provider pools and consumers remain Phase 2h.

## Before you start

**`docs/rebuild/` is the plan SSOT — read it, do not re-derive it.**

- `docs/rebuild/07-master-plan.md` — phases, work items, exit criteria. §4 owns the two-repo model.
- `docs/rebuild/04-reconciliation.md` — the decision changelog (D1–D108). A **pointer index**, not a
  spec: it tells you which doc owns a contract. Never implement from it.
- `00-charter` · `01-task-contract` · `02-workflow-model` · `03-tracker-dashboard` ·
  `05-execution-parallelism` · `06-data-intake` · `08-foundation-gap-audit` · `09-write-safety` ·
  `10-guard-test-architecture` · `11-clock-config-secrets` · `12-operator-trust` ·
  `13-frontend-backend-integration` — each owns its contracts.
- `docs/rebuild/guard-inventory.json` — the reviewed guard manifest. `tests/unit/architecture/`
  must match it exactly, both directions.
- `docs/rebuild/reviews/` — history. Superseded by the owning docs wherever they differ.

**A decision is not ratified until it lands in its owning doc, in the same commit that records it.**
Doc 04 gets a one-line pointer; the owner gets the normative text.

## Commands

```bash
npm run typecheck          # tsc --noEmit over src/, tests/, scripts/ — one program, no exclusions
npm run lint               # eslint src tests scripts --max-warnings 0 — zero-debt, no manifest
npm run test               # every vitest project (unit + architecture)
npm run test:architecture  # the guard suite alone
npm run test:coverage      # 60/80 lines/statements/functions floors + the suite-size report
npm run test:watch

npm run rebuild:cli        # the isolated rebuild runtime (help | phase)
npm run rebuild:dashboard  # reserved — lands with the 1g-spine BFF

npm run build:manifest     # regenerate src/domain/workflow/generated-build-manifest.ts
```

`build:manifest` recomputes every descriptor's `contractFingerprint` from its source closure. Run it
after ANY edit under a descriptor's import closure (which includes `src/base/**` and most of
`src/domain/**`) — `descriptor-coverage` regenerates and fails on a diff, so a stale manifest is a
red gate, not a silent drift.

The gate family is deliberately plain (`typecheck`/`lint`/`test`/`test:architecture`); the old
`*:rebuild` names retired with D93. The **runtime** commands stay `rebuild:`-prefixed on purpose —
see "Operational isolation" below.

## What lives where

| Path | Contents |
|---|---|
| `src/` | the rebuild runtime (`domain` → `infra`/`services`/`stores` → `core` → `control`/`workflows`) |
| `src/workflows/<id>/` | `descriptor.ts` (bundle-safe) + `module.ts` (server composition value) |
| `src/control/workflow-registry.ts` | the composition root: the ONE `WORKFLOW_MODULES` tuple every registry derives from |
| `tests/unit/` | domain unit tests |
| `tests/unit/architecture/` | the guard suite; every file registered in `docs/rebuild/guard-inventory.json` |
| `tests/scenario/` | executable scenarios; each reports the coverage points it walked, and `scenario-coverage` audits that corpus against the graph |
| `config/` | `legacy-change-accounting.json`, `legacy-capabilities.json`, `legacy-test-disposition.json`, `runtime-isolation.json`, `pending-impl-bindings.json` |
| `docs/rebuild/` | the plan SSOT — kept at this exact path so every cross-doc link still resolves |
| `duo-autopilot/` | the Duo MFA WebAuthn extension (vendored; credentials are gitignored) |

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

**Not a fallback (these are fine):** retrying the *same* operation on a transient error — that
re-runs the operation, it does not substitute data. Swallowing an error is fine only when the
*action itself* is genuinely optional AND the caller does not treat the result as load-bearing.

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
  repositories share no module graph — this is now structural, not merely banned. The only code
  permitted to reach across is the **guard lane**, which audits legacy as data.
- **Porting = copy with provenance.** When you bring verified knowledge across (a selector, a
  parsing rule, a page-state fact), copy it and record **the legacy commit hash and source path** in
  the ported code. Never link it at runtime — which is impossible anyway.
- **Every legacy maintenance change must be recorded HERE**, in
  `config/legacy-change-accounting.json`. Commit the legacy `src/`/`tests/` change first, then record
  every path under that exact commit with its first-parent/commit blob hashes, affected capability
  ids, impact rationale, and closed rebuild recheck evidence. The legacy `src/`/`tests/` worktree
  must be clean; staged, unstaged, and untracked changes intentionally make the rebuild guards red
  until the named legacy commit exists and is accounted. Doc 10 §3.13 makes this the program's
  *only* drift detector now that the same-tree scan is retired — it is load-bearing, not
  corroborating.
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

| | legacy | rebuild |
|---|---|---|
| state root | `.tracker` | `.tracker-rebuild` |
| artifact root | `.tracker` | `.tracker-rebuild/artifacts` |
| backend / frontend port | 3838 / 5173 | 3938 / 5174 |
| process locks | `.tracker/daemons` | `.tracker-rebuild/locks` |
| browser profile / session | `.auth` / `hrauto-legacy` | `.auth-rebuild` / `hrauto-rebuild` |
| launch commands | `dashboard`, `dashboard:prod`, `dashboard:watch` | `rebuild:dashboard`, `rebuild:dashboard:prod`, `rebuild:cli` |

The runtime command names stay distinct across both repos so a muscle-memory `npm run dashboard` in
the wrong checkout can never start the wrong runtime. Isolation values reach the runtime through one
exported direct-`const` `defineRuntimeIsolation` call that a composition root invokes at top level —
an identifier mention, or a call inside an uninvoked function, is not proof.

## Live verification — standing pre-authorization (always available, never ask)

**The live environment is always available, and reaching it for verification is pre-authorized.
Never ask whether live access is up, whether to spend the live session, or to confirm a Duo prompt —
assume yes and proceed.** This covers the whole range: a read-only selector `snapshot`, a login smoke
check, a live collector, and a full live workflow dry-run against real UCPath / CRM / Kuali /
ServiceNow / I-9. Duo is cleared hands-off by Duo Autopilot on every verification path, so there is
no phone-approval step and nothing to sign off. The safety boundary for a live *workflow* run is
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

Until this repo grows its own driver layer, live *selector* work still happens against the legacy
repo's registry; port what you verify with provenance (see cross-repo rules above).

## Environment

`.env` is gitignored and NOT part of the repo. Copy `.env.example` and fill it, or copy the legacy
repo's `.env`. `src/domain/config/resolve.ts` implements `env > settings.json > default` exactly
once; `src/domain/secrets.ts` is the **only** module permitted to read a credential from
`process.env` (`secrets-single-source.test.ts` enforces it). A credential must never be interpolated
into a message — `no-secret-values-in-logs.test.ts` enforces that half.

## Conventions

- No default exports.
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
- A workflow descriptor value-imports only zod, `src/domain/**`, and the audited `src/base/**`
  builders; `module.ts` is where anything server-side attaches (D106). Branch cases and parallel
  branches name nodes DOWNSTREAM of their controller — forward references, checked at `build()`
  (D104).
- A contract a descriptor uses but no store implements yet must be listed in
  `config/pending-impl-bindings.json`; the guard fails in both directions (D107).

## Lessons learned

- **2026-08-03: authentication is a CONTENT-level observation; a URL is never a proof.** A live
  UCPath login smoke passed in ~3 seconds having never authenticated: the recipe matched a host
  SUBSTRING, so the PUBLIC UCPath portal read as the application, and that early
  `already-authenticated` return also skipped the recipe's own second fact. The neutral reset had
  the same hole from the other side — it validated reuse with a URL predicate alone, so PeopleSoft's
  signon page (same host, same route shape) passed as the app; a person lookup would have scraped a
  sign-in page and reported it as HR data. Every browser system now declares a verifier proving TWO
  independent facts — a server-issued session artifact (`PS_TOKEN` for UCPath, `sid` for CRM) and
  the absence of every sign-in form — and `defineVerifiedLoginRecipe` runs it AFTER the flow on
  every return path, with the reset calling the identical verifier. A URL may be a necessary
  precondition; it is never the conclusion, and a probe that cannot RUN reports "not authenticated"
  with the reason. Two live findings came with it: UC now serves campus discovery from the
  PeopleSoft host ROOT (legacy's `ucpathdiscovery/disco` path is gone), and `click()` resolves
  before the SAML chain does — so the gate waits for what the chain actually presented instead of
  reading a URL mid-flight. Cold-profile live proof (2026-08-03): ucpath 17.4s through
  `a5.ucsd.edu` + `api-*.duosecurity.com`; crm 11.8s the same way.
- **2026-08-03: a stale selector chain hides which realm you are in.** CRM's login failed at
  `credential-fill`, then — once that was fixed — burned the whole Duo window and blamed Duo. The
  real cause: TritON defaults to **Business Systems**, and the login-type picker was probed straight
  after `goto` while the browser was still redirecting, so "picker absent" (a real rendering)
  swallowed the actual page and the credentials went to the wrong realm. Its value comparison was
  broken too — `inputValue()` returns `_eventId_authn/PasswordAD`, never the label. TritON also
  renders the SAME `#ssousername` field under three different labels, one per realm, which is why
  the legacy label-first chain looked "stale": a label identifies the REALM, not the field. Port
  structural anchors (`id`, `name`) first, keep every observed label behind them, and make a
  no-match a loud refusal that names the anchors rather than a navigation timeout.
- **2026-08-03: No test may rewrite a tracked artifact in place — parallel forks share ONE working
  tree.** `ui-catalog-cli.test.ts` regenerated `generated/ui-catalog.json` and both `UI-CATALOG.md`
  files in the checkout, and one case deliberately wrote a stale catalog over the tracked one before
  restoring it in `afterAll`. `ui-registry.test.ts` and the `semantic-ui-registry` guard read those
  same files from a concurrent fork. Under `test:coverage` the child `tsx` spawns are slow enough to
  hold the stale file on disk for ~9s, so the freshness assertion failed there and passed under
  `npm run test` — a mode-dependent verdict from a shared-file race, NOT from instrumentation
  perturbing a fingerprint (`assertSafeUiCatalogFresh` compares parsed semantic content and is
  instrumentation-blind). The in-place regenerate was the more dangerous half: it silently healed a
  genuinely stale checkout mid-run, so a guard could go green over a stale committed artifact.
  Fixtures now generate into a `mkdtemp` root through `ui:catalog -- --out-root` and
  `selector:search -- --catalog`, the generator publishes via atomic rename (plain `writeFile`
  truncates first — a poller caught six zero-length windows a reader could `JSON.parse("")` on), and
  a final case pins every tracked projection byte-identical from import to teardown.
- **2026-08-03: D116 binding belongs to whoever owns the run context, and a precondition failure
  never parks.** The sequencer never binds/releases the run config fingerprint itself: during a
  claimed run its leases run under the worker loop's `withBoundRunConfigFingerprint` window (the one
  shared discipline helper in `src/core/worker-sessions.ts`). Doc-09 §4 recovery leases outside any
  loop, so `recover` binds the TARGET run's retained `configFingerprint` from the authority run row
  — never recomputed from current config, never caller-claimed — around its probe lease, with the
  bind OUTSIDE the probe's catch: an unbound/foreign-bound host throws out of `recover` loudly
  instead of collapsing into a park that reads as a probe verdict, while a genuine probe throw still
  parks `unknown`. The §4.1 operator resolutions lease no driver, so no binding applies. Tests bind
  through the same production API, and each surface pins the D116 refusal arm as a negative test.
- **2026-08-03: The write sequencer is the sole MutationCapability mint, and beat ⑦ wraps the
  narrow primitive.** `src/core/write-sequencer.ts` owns doc 09's beats ①–⑦ behind the
  interpreter's `WriteSequencer` seam; `src/core/write-recovery.ts` owns §4 recovery and the
  kernel's `WriteResolutionExecutor`. The capability is runtime-unforgeable via a module-private
  WeakSet (drivers verify with `assertSequencerMintedMutationCapability`), and the
  `task-driver-boundary`/`driver-lease-boundary` ratchets allowlist exactly that file. Beat ⑦ is
  `executeSequencedWriteCommit`: ONE outer authority transaction over run-claim revalidation, the
  Phase-1c four-row primitive (nested savepoint), the `TransactionOutcome` checkpoint, and the run
  transition — `SequencedWriteCommitInputSchema` binds the bundle without widening the primitive.
  Post-fence uncertainty parks intent-first then run (`parked-write`) and raises `WriteParkedError`;
  the Phase-1f interpreter has no parked-write outcome arm yet, so that error surfaces loudly
  through `executeClaimedRun` (durable state is already correct) until the interpreter's owner
  lands the typed arm. Pre-fence indeterminacy refuses with zero fence/zero click. A retryable key
  re-fences generation+1 ONLY via `refenceRetryable` with a FRESH binding proof; operator
  confirmed-absent is the new `operator-confirmed-absent` settlement arm. The staged page-state
  identity comes from the prepare output's `stagedPageState` field, and beat ③ observes via the
  driver's existing semantic `read(observationId)` — no new driver method. Dry-run is the separate
  `executeDryRun` arm (zero intent/fence/commit); `executeTransaction` with dryRun refuses loudly.
- **2026-08-03: A browser session is only "closed" when closure was OBSERVED, and only reusable
  when its whole identity matches.** The real factory (`src/infra/browser/`) launches Playwright's
  FULL bundled Chromium (`channel: "chromium"`, persistent context) with the Duo Autopilot extension
  — the headless shell and Chrome stable both cannot load one. `close()` returns a proof only after
  every page reports `isClosed()` AND the context emits its own `close` event within a bounded
  deadline; `await context.close()` resolving proves nothing by itself. D116 makes
  `configFingerprint` part of the reuse identity (bound per claimed run by the worker loop, absent =
  fail loud), and the fingerprint is in the on-disk profile path too, so a config change cannot be
  inherited through a warm profile. Login recipes stay in `stores/<system>/session.ts`; that file
  and `src/infra/browser/**` are the only raw-browser owners, and tasks/workflows may reach neither.
  Login verifies twice — the ported landing predicate AND the SSO form being gone — because UCPath's
  `?cmd=login` expiry page sits on the same host as a real page, and CRM's login page sits on the
  same host as its app.
- **2026-08-03: The interpreter re-reads authority before every CAS, and replay policy is
  structural.** The worker executor (`src/core/run-executor.ts` + `worker-loop.ts`) never tracks a
  run version locally: heartbeat renewal bumps the version concurrently with node transitions, so
  each transition re-reads the current row and CASes with the constant claim token — a conflict then
  only ever means real ownership loss (abandon, never terminalize over it). Entry validation runs in
  `validating` before any browser and aggregates every §5.4 problem into ONE no-node FailureRecord
  (the atomic failure composite requires `running.currentNodeId` to match any node-bearing failure).
  `always-rerun` nodes structurally never reach `loadCheckpoint`; replayed nodes emit no spans; a
  replayed checkpoint's exact stored record is what terminal evidence reuses. Every task invocation
  races a mandatory injected monotonic deadline so a signal-ignoring driver cannot hold the worker,
  and D118 makes the claim sweeper check `attempting` write intents before any requeue — a running
  row parks as `parked-write`/`unknown`, everything else stays unclaimable until doc-09 recovery.
  The transaction and child-run arms are typed seams that fail loud (`capability-unavailable`) when
  unwired; the SpanEmitter port is required with no no-op default — the JSONL writer is 1g-spine's.
- **2026-08-03: Provider admission is durable authority, and timeout must race the invocation.**
  Capability counters are global even though every decision uses and retains the run's immutable
  budget snapshot. Reserve request count and maximum cost before I/O; reconcile cost only after a
  strict measured result; retain the maximum on abort, timeout, crash, invalid outcome, or lease
  expiry. A signal alone does not bound a non-cooperative adapter, so the kernel races invocation
  against its injected monotonic deadline/cancellation channel, safely observes late rejection, and
  durably releases concurrency before returning unavailable. Settlement failure after remote I/O is
  uncertain and can never return produced data. Fixed UTC minute/day boundaries make `retryAt`
  exact, and a zero cost limit is a hard zero-estimate cap, never unlimited.
- **2026-08-03: Released migrations are immutable, and authorization must bind its consequence.**
  Never add a table to a released migration without advancing the schema version: an already-v7
  database will skip the changed body. The exact released v7 creates terminal failure/result/outbox
  facts; v8 alone adds `run_terminal_authorizations`. A literal SHA-256 table pins every version and
  ordered statement byte in released v1–v9; future schema work starts at v10 and extends that table.
  Recovery and replay require the terminal row to be the authorization's exact consequence: version
  is `expectedVersion + 1`, claim generation is retained, state/outcome and failure id match the
  arm, and both `lifecycle.endedAt` and `updatedAt` equal `authorizedAt`.
- **2026-08-02: Task provenance is an executor-owned data channel, never inferred from logs.** Every
  task context carries a real `recordData` collector. Read completion validates that strict,
  execution-attributed points cover every canonical output leaf and agree with the parsed value;
  derived outputs also resolve the exact static `dependsOn` set from the factory-authenticated
  descriptor (never from caller claims), require one whole, fact-complete authority checkpoint for
  each node, reject undeclared checkpoints, and retain the validated union's oldest original
  observation. Tests use explicit recording fakes, so a missing runtime collector cannot hide
  behind a no-op.
- **2026-08-02: Worker browser resources are callback-leased and uncertain closure stays visible.**
  Serialize driver use by `(worker, system)`; an authored fresh boundary closes before replacement,
  and park/stop waits behind in-flight callbacks. Task, cancellation, reset, login-cleanup, or close-
  proof uncertainty must poison-close the resource. If closure cannot be proved, retain the resource
  as poisoned and refuse reuse; never erase it from ownership or infer that cleanup succeeded.
- **2026-08-02: Start plans bind raw ingress separately from canonical input.** Every accepted and
  refused entry retains strict JSON `rawInput`; a non-JSON submission fails planning before any
  proposal can be minted. Accepted entries additionally retain the schema-bound canonical snapshot
  and its digest. The plan binds ingress/canonical schema hashes and derives its confirmation
  fingerprint from every ordered raw + canonical identity, so defaults/transforms never erase what
  an operator submitted. Schema v6 deletes incompatible, short-lived pre-D109 proposals rather than
  fabricating raw ingress, and an exact replay validates all bindings against its pre-consume
  revision before D113 consumes the plan inside its outer authority transaction.
- **2026-08-02: A terminal lifecycle is the commit marker for terminal authority.** Failed runs are
  settled only with the exact existing `FailureRecord`; done runs are settled only with a strict,
  schema-bound `RunResultRecord` plus a pending `run_terminal_outbox` record. Both paths validate the
  current run identity, version, and claim, write every durable row and the terminal CAS in one outer
  authority transaction, and accept only byte-exact replay. Result dependencies come from a
  factory-authenticated terminal view and explicitly retain either the exact checkpoint identity,
  output/provenance digests and fingerprints or a closed `not-run` reason for a conditional node.
  Schema hashing stays browser-safe because descriptor closures cannot import Node built-ins. The
  initial success path also carries the descriptor factory's unforgeable seal over the exact parsed
  current run and factory-derived result; a schema-valid caller-built result is not authority. A
  strict `run_terminal_authorizations` row retains the original expected version and claim for exact
  replay, and NULL-safe recovery invariants reject every partial or cross-bound terminal settlement.

## After changes

Run `npm run typecheck && npm run lint && npm run test && npm run test:architecture` before
committing. Add a new guard file **and** its `docs/rebuild/guard-inventory.json` entry in the same
commit — `guard-manifest.test.ts` checks both directions. Retiring a guard requires an explicit
`retired` entry naming the deciding decision and where the invariant went; a guard that simply
disappears is indistinguishable from an accident.

Never push to any remote without explicit instruction.
