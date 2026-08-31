# Original DCC2 merge conflict hunks

A = `ac40292b8e3e8ff9b66242bbf8f8288554335f40` (alternate branch).
B = `13175b13340fec7b5326207fe54f98078d481d7d` (frozen integrated baseline).
Base = `80da38158dea35f781eb69d5e682a779935f9c96`.

These are original unresolved hunk coordinates, not current line numbers. Disposition is in `reports/dcc2-m3.md`. Generated roadmap HTML has two hunks, at original lines 165 and 181; both are regenerated from the reconciled roadmap/doc sources rather than hand-edited.

## AGENTS.md H1 (original line 389)

### A — alternate branch

~~~~text
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
  executor owns each registered monotonic deadline: race detector settlement against the injected
  scheduler, abort on expiry, retain the exact timeout observation, and disarm the timer/listener on
  every prompt exit. Keep the detector's actual settlement as a separate process-owned boundary:
  single-flight admission remains closed after the prompt timeout until late I/O settles, exact
  command replay coalesces to its retained result, and a new rerun refuses instead of waiting or
  starting duplicate work. Startup and rerun therefore cannot hang on a non-cooperative detector or
  promote a late healthy answer.
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
~~~~

### B — integrated baseline

~~~~text
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

- **2026-08-28 — editable settings are one revisioned file authority, not a set of field writes.**
  `settings/apply-settings` validates the current schema hash and the canonical fingerprint of one
  recursively strict multi-leaf patch, then compares one expected file revision. Resolve the whole
  merged candidate through the sole config resolver before staging it. The writer durably prepares
  exact prior/next bytes bound to command id, command/patch/schema fingerprints and expected
  revision, then atomically replaces the file. Reconciliation keeps the next bytes only when the
  exact command journal and audit committed; an absent outcome restores the prior bytes, and any
  identity ambiguity preserves evidence and fails loud. Only the exclusive dashboard owner may
  treat an absent journal row as process loss; concurrent workers refuse because the transaction may
  still be in flight. A committed observation requires the audit's exact result command id, sole
  settings target, expected revision transition and empty dependency vector; replay retries retained
  prepare reconciliation instead of treating `already-applied` as cleanup proof. `applied`/replay
  says `restartRequired`.
  Dashboard boot activates the exact settings/config runtime generation; until that restart, new
  run/worker starts refuse, and workers compare persisted, active and boot identities before every
  claim. The production claim holds the authority transaction across both generation checks and
  `claimNext`, which compares the queued run's retained config fingerprint to the worker's boot
  fingerprint before changing the row; a crossing apply therefore unwinds the claim. Precedence
  remains `env > settings > default`; credentials and environment files are never settings leaves.

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
~~~~

## docs/rebuild/04-close-the-deferrals.md H1 (original line 287)

### A — alternate branch

~~~~text
- [x] the Settings surface exists and remains read-only; its storage section serves health plus the on-demand storage doctor (D169)
- [x] the command family, its target and its atomic N-leaf payload are already contracted (`src/domain/commands.ts:60,190`); only the executor is absent
- [x] the deferral is structural and total — `apply-settings` is the ONE entry in `PHASE1_DEFERRED` across all six families (`src/core/command-kernel.ts:141-148`), so the kernel refuses it with `rejected{code:"capability-unavailable"}` and ZERO authority side effects
- [ ] BE `apply-settings` stops answering `capability-unavailable`
- [x] BE DCC2 composes the exact six-runner dashboard preflight, refuses blocking startup, serves the retained bootstrap report and exposes the bounded/idempotent `POST /api/v1/preflight/rerun`; the former pending-wire entry is gone
- [ ] FE pass `boot.preflight` and an `onPreflightRerun` callback into the Top Bar; the component/client exist, but `DashboardApp` connects neither
- [ ] FE/BE the Settings write path remains separate from DCC2's completed preflight backend
> 2026-08-28 | DCC2 backend reconciliation | verified against `src/core/command-kernel.ts`, `src/server/dashboard/{compose,preflight-authority,preflight-runners,queries/bootstrap,routes/api}.ts`, `src/dashboard/{app/dashboard-app,surfaces/top-bar}.tsx` and `config/pending-wire-bindings.json`; left: the Settings executor/form and the Top Bar connection
<!-- /roadmap-status -->

**What the deferral is.** The Settings gear opens the sections the server serves, and **nothing
there pretends to save.** There is no config editing in the dashboard: every value the runtime
resolves comes from `env > settings.json > default` and is changed by editing the file.

**The decision that deferred it: D169** (round 38, 2026-08-08), which took the doctor/backup wire
live and explicitly left `apply-settings` deferred. D184 later kept
`FrontendBootstrapWireSchema#preflight` declared-unserved until a real backend existed. DCC2 has now
closed that backend binding and removed the pending-wire entry; it did not implement Settings write
or connect the Top Bar. The rule is unchanged: **an absent projection is drawn as absent.**
~~~~

### B — integrated baseline

~~~~text
- [x] the Settings surface is server-owned and bounded — the editable inventory/readback is separate from storage health and the on-demand read-only doctor (D169/DCC3)
- [x] the command family, its target and its atomic N-leaf payload are contracted (`src/domain/commands.ts`)
- [x] BE `apply-settings` is active with exact expected-revision enforcement, strict recursive patch/schema fingerprints, atomic file replacement and command-transaction rollback
- [x] BE both composition roots read the strict settings record and the resolver exhaustively applies all owned groups, including `browser`, while retaining `env > settings > default`
- [x] BE the registry-derived dashboard preflight authority is composed at startup, served by bootstrap and rerun through the strict read-only `POST /api/v1/preflight/rerun` command; the old `FrontendBootstrapWireSchema#preflight` declared-unserved binding is removed
- [x] FE the server-listed Settings write path, persisted readback, preflight rerun and on-demand read-only storage doctor controls
> 2026-08-28 | DCC3 | Settings now forms one revision/schema/patch-bound N-leaf command from the resolver-owned editable inventory; environment-owned leaves remain visible but locked, and preflight refuses until a restart activates persisted settings
<!-- /roadmap-status -->

**What remains deferred.** The Settings surface now edits only the resolver-owned inventory the
server serves. Its one atomic patch command, persisted readback, preflight rerun and read-only doctor
do not make credentials, AI assist, delete/recover, or any resolver-unowned legacy setting editable.
Those broader capability entries remain open in `config/legacy-capabilities.json`.

**The decision that deferred it: D169** (round 38, 2026-08-08), which took the doctor/backup wire
live and explicitly left `apply-settings` deferred, reinforced by **D184** (round 45), which marked
`FrontendBootstrapWireSchema#preflight` `declared-unserved` until a real authority existed rather
than letting the Top Bar render a green stethoscope over checks nobody ran. DCC2 closed that
declaration: bootstrap serves the retained strict report, and DCC3 consumes the rerun route with the
active runtime fingerprint. The invariant is unchanged: **an absent verdict is drawn as absent.**
~~~~

## docs/rebuild/04-close-the-deferrals.md H2 (original line 335)

### A — alternate branch

~~~~text
direction.** DCC2 has since landed the backend preflight service; the Settings executor/form and
Top Bar connection remain open until their own units land. The direction alone was not an
implementation claim, and one completed unit is not completion of the whole deferral.
~~~~

### B — integrated baseline

~~~~text
direction.** DCC1 landed the settings executor, file readback and runtime-generation fence; DCC2
landed the preflight service and read-only rerun authority; DCC3 landed the bounded Settings UI
controls. The scheduling direction itself was not an implementation claim.
~~~~

## docs/rebuild/04-close-the-deferrals.md H3 (original line 352)

### A — alternate branch

~~~~text
The preflight backend is now also built, as a separate seam rather than evidence that Settings is
editable. Dashboard startup runs the registry-selected six checks through one retained authority,
blocks on a failing report, serves that report in bootstrap, and reruns the same authority through
the strict loopback/bounded/idempotent route.

**Not built.** Two independent user-facing halves remain. `apply-settings` still has no executor or
editable form. And `DashboardApp` does not pass the now-served bootstrap report or a rerun callback
to `TopBar`, so the existing popover/button remains unreachable. Keeping those gaps named prevents
the backend route from being mistaken for a completed Settings or Top Bar experience.
~~~~

### B — integrated baseline

~~~~text
**Built in DCC3.** The dashboard reads the strict server-listed editable inventory, retains one
page-wide draft and emits one exact expected-revision/schema/patch-fingerprint command. It renders
persisted readback, conflict/refusal and restart-required states; environment-owned values never become
browser-editable. The retained preflight truth remains visible, and its typed rerun caller binds the
active runtime fingerprint and refuses while restart is required. The read-only storage doctor remains
an on-demand inspection only; the rerun route is no longer `served-unconsumed`.
~~~~

## docs/rebuild/04-close-the-deferrals.md H4 (original line 536)

### A — alternate branch

~~~~text
| editable settings | **D169**'s deferred `apply-settings` family, with **D184**'s formerly `declared-unserved` preflight; DCC2 closed the backend binding while Settings write and Top Bar wiring remain | 38 · 2026-08-08 and 45 · 2026-08-09 |
~~~~

### B — integrated baseline

~~~~text
| editable settings | **D169**'s deferred `apply-settings` family, with **D184**'s former `declared-unserved` preflight arm and DCC1–DCC3's bounded resolver-owned edit/preflight closure | 38 · 2026-08-08, 45 · 2026-08-09 and DCC · 2026-08-28 |
~~~~

## docs/rebuild/reference/clock-config-secrets.md H1 (original line 1003)

### A — alternate branch

~~~~text
- [x] BE the dashboard composes the exact six checks selected by `dashboard.serve` — runtime/package-lock compatibility, strict config, filesystem health, authority/backup/span health, reserved ports and process orphans — through one `PreflightAuthority` (`src/server/dashboard/{preflight-runners,preflight-authority}.ts`)
- [x] BE dashboard composition awaits that authority's initial report before serving, refuses startup on a blocking result, and `buildBootstrap` projects the retained report on `FrontendBootstrapWireSchema#preflight` (`src/server/dashboard/{compose,queries/bootstrap}.ts`)
- [~] the rest of the registry remains contract-only until its owning consumer lands — dashboard boot has its complete selected subset, not an implementation claim for executor/workflow/system/feature checks
- [ ] BOTH there is no `cli doctor` verb and no `test-login`. `cli storage doctor` exists and is the closest thing, but it calls `doctorAuthorityStorage` directly (`src/server/storage/compose.ts:309-332`) rather than composing a preflight report, so the two would drift the moment a second runner lands
- [ ] FE the Top Bar component can render the served checks, but `DashboardApp` passes neither `boot.preflight` nor an `onPreflightRerun` callback; the stethoscope/rerun interaction therefore remains unconnected UI
> 2026-08-28 | DCC2 backend reconciliation | verified against `src/server/dashboard/{compose,preflight-authority,preflight-runners,queries/bootstrap,routes/api}.ts`, `src/dashboard/{app/dashboard-app,surfaces/top-bar}.tsx`, `src/server/storage/compose.ts` and `config/pending-wire-bindings.json`; left: CLI doctor, test-login, every non-dashboard runner subset, and the Top Bar connection
~~~~

### B — integrated baseline

~~~~text
- [x] the dashboard's six selected runners are implemented once from `requiredPreflightChecks(["dashboard.serve"])`: runtime/package-lock, retained config, filesystem, authority/backup/span reconciliation, ports and orphaned worker leases (`src/server/preflight/dashboard-runners.ts`)
- [x] `createPreflightAuthority` owns execution, report readback and exact command-id replay; dashboard composition runs it at startup, bootstrap serves that report, and `POST /api/v1/preflight/rerun` accepts/returns closed schemas with config + descriptor compare-and-set identity
- [x] every selected runner's registered timeout is armed through the injected monotonic scheduler; expiry aborts the runner signal but awaits actual settlement, so non-cooperative I/O is never detached and a late healthy-looking return still fails by check id + timeout
- [x] a selected refresh awaits every runner's settlement before propagating failure; multiple failures retain registry order in a primary-first `AggregateError` whose cause is the primary failure
- [x] FE the typed dashboard client and Settings control consume the strict rerun route; it binds the active runtime fingerprint and refuses a persisted-but-not-restarted settings revision (DCC3)
- [ ] BOTH there is no broad `cli doctor` verb and no `test-login`. `cli storage doctor` now consumes the same strict D282 storage reconciliation and health judgment as `authority.health`, but it is not a projection of the complete preflight registry
> 2026-08-28 | DCC3 Settings caller | strict browser call and rendered control now consume the rerun route; left: non-dashboard capability runners, broad `cli doctor` and `test-login`
~~~~

## docs/rebuild/reference/clock-config-secrets.md H2 (original line 1068)

### A — alternate branch

~~~~text
**As-built: the registry is complete, and the dashboard owns one exact six-runner subset.**
`createDashboardPreflightRunners` composes runtime/package-lock compatibility, strict config,
filesystem health, `authority.health`, reserved ports and process-orphan detection in registry
order. The authority runner still consumes the same read-only storage doctor used for recovery
decisions; it passes only when authority, verified current backup and span/authority reconciliation
pass. The other five runners inspect only their named local resources, with injected clock/deadline
authority and redacted summaries.

`composeDashboardRuntime` creates one serialized `PreflightAuthority`, awaits its initial refresh,
refuses startup on any blocking result, and only then exposes the retained report through
`buildBootstrap`. `POST /api/v1/preflight/rerun` executes the same authority; exact command replay
returns the retained result and a different canonical request for an existing command id refuses.
That is the backend service this section required, not a second list beside the registry.

The boundary remains deliberately narrower than the full target. There is no `cli doctor` verb or
`test-login`; `cli storage doctor` still calls `doctorAuthorityStorage` directly. Non-dashboard
runner subsets remain unimplemented until their executor/workflow/system/feature consumers land.
And although `TopBar` has a preflight popover and the dashboard client has a typed rerun method,
`DashboardApp` passes neither `boot.preflight` nor the rerun callback, so no stethoscope/control is
reachable in the product UI yet. Backend composition is complete; those CLI, live-login and UI
projections are not.
~~~~

### B — integrated baseline

~~~~text
**As-built: the dashboard slice is one composed authority.** `createPreflightAuthority` derives its
ordered check membership from the registry, executes the six checks selected by `dashboard.serve`,
retains the exact report bootstrap serves, and reruns through a closed read-only command. The command
compares the caller's config and descriptor fingerprints before executing, returns the exact report,
returns the exact prior result for an identical command-id replay, and refuses divergent reuse. It
does not enter the mutation command kernel or author a command journal row because it changes no
authority state. Each registry timeout is enforced by the same injected monotonic scheduler used by
the runtime: expiry aborts that runner's signal, but execution does not race the promise away. A
non-cooperative detector remains process-owned until it settles, and its late result is rejected as
timed out rather than converted into a pass. A refresh awaits every selected detector before it
returns or throws; multiple failures are aggregated in registry order with the primary failure
first and as the aggregate cause.

`AuthorityHealthPreflightRunner` consumes the same read-only storage doctor used for recovery and
now includes D282's exact span/authority reconciliation. It is healthy only when authority is
healthy, the newest backup is verified/current, every current authority run has its queued root,
and every span identity is current or explicitly archived. Missing-span, unaccounted,
malformed-authority, malformed-span and unavailable are distinct; archived is accounted rather than
silently omitted. The CLI storage doctor consumes that same reconciliation judgment. No doctor path
repairs storage, chooses another database/row, kills a process, or substitutes an empty inventory.

The remaining work is narrower and named: non-dashboard capabilities still need their own registry-selected runners; and broad
`cli doctor` plus `test-login` do not exist. `cli storage doctor` is storage truth, not a fabricated
complete preflight projection.
~~~~

## docs/rebuild/reference/dashboard-surfaces.md H1 (original line 1349)

### A — alternate branch

~~~~text
- [x] the two health readings, and which is which: the cheap bootstrap summary versus the doctor's on-demand byte re-verification (`cli storage doctor [--json]`, exit 0 only when authority is healthy, a verified current backup exists, AND `spanAuthority.state === "reconciled"`)
~~~~

### B — integrated baseline

~~~~text
- [x] the two health readings, and which is which: the cheap bootstrap summary versus the doctor's on-demand byte re-verification (`cli storage doctor [--json]`, exit 0 only when authority and span/authority reconciliation are healthy AND a verified current backup exists)
~~~~

## docs/rebuild/reference/dashboard-surfaces.md H2 (original line 1431)

### A — alternate branch

~~~~text
[--json]`, exit 0 only when authority is healthy, a verified current backup exists, AND
`spanAuthority.state === "reconciled"`)
~~~~

### B — integrated baseline

~~~~text
[--json]`, exit 0 only when authority and span/authority reconciliation are healthy AND a verified current backup exists)
~~~~

## docs/rebuild/reference/frontend-backend-integration.md H1 (original line 148)

### A — alternate branch

~~~~text
| Start | descriptor-driven typed/bare/upload/capture/spreadsheet methods, presets/options, dry-run truth, per-system prod/test hosts, capability absence reasons, preflight and enqueue refusals | typed yes (D250/D251); the other four method kinds have no registered declarer; dashboard-startup preflight is served, but no modal projection is wired |
~~~~

### B — integrated baseline

~~~~text
| Start | descriptor-driven typed/bare/upload/capture/spreadsheet methods, presets/options, dry-run truth, per-system prod/test hosts, capability absence reasons, preflight and enqueue refusals | typed yes (D250/D251); the other four method kinds have no registered declarer; preflight is served from the retained DCC2 report |
~~~~

## docs/rebuild/reference/frontend-backend-integration.md H2 (original line 328)

### A — alternate branch

~~~~text
checked. The production dashboard backend serves it: composition awaits the exact six-runner
`dashboard.serve` report before startup, refuses a blocking report, and `buildBootstrap` projects
the retained result in registry order. `FrontendBootstrapWireSchema#preflight` is therefore no
longer a pending-wire binding.

The Top Bar owns the intended projection (§5): the stethoscope carries the worst verdict of the
set, its popover lists the checks, and "Run doctor again" is the paired command. That UI connection
is still open. `DashboardApp` passes neither `boot.preflight` nor an `onPreflightRerun` callback to
`TopBar`, even though the component and typed client method exist, so the popover/control is not
reachable. The verdict itself remains DERIVED on the client from the checks (`fail` beats `warning`
beats `pass`) and is never a second served field, so a wired glyph and list cannot disagree.
~~~~

### B — integrated baseline

~~~~text
checked. The Top Bar owns it (§5): the stethoscope carries the worst verdict of the set, its popover
lists the checks, and "Run doctor again" is the paired command. DCC2 composes one registry-derived
authority at dashboard startup, retains its strict report, serves that report here, and exposes the
closed read-only `POST /api/v1/preflight/rerun` readback. The field remains optional only for
read-forward compatibility with an older producer; current `buildBootstrap` supplies it. DCC3's typed
client/control consumes the rerun route and binds the active runtime fingerprint. The surface renders the whole
popover only when the field is present: a doctor indicator over checks nobody ran would report a
pass the server never made. The verdict itself is DERIVED on the client from the
checks (`fail` beats `warning` beats `pass`) and is never a second served field, so the glyph and
the list cannot disagree.
~~~~

## docs/rebuild/reference/frontend-backend-integration.md H3 (original line 609)

### A — alternate branch

~~~~text
**`apply-settings` is the one command arm that is declared and refused.** It is the sole
`PHASE1_DEFERRED` entry in the kernel: it answers `capability-unavailable` with zero authority
effect, so Settings is read-only in the product today. The family, the target and the atomic N-leaf
payload are already the contract; what is missing is the config-service half
(ref clock-config-secrets §3). Preflight is a separate completed backend seam: §3.1's report and
doctor-rerun route share one process-local authority, while Settings write remains deferred.
~~~~

### B — integrated baseline

~~~~text
**`apply-settings` is active only for the resolver-owned inventory.** DCC1 removed the deferred
arm and provides the strict config-service authority: one expected revision and schema-bound atomic
N-leaf patch, exact persisted readback, restart generation fencing and fail-loud recovery. DCC3
consumes the server-listed inventory; environment-owned leaves remain locked. DCC2's
registry-derived `preflight` report and strict read-only doctor-rerun route are now consumed by the
same bounded Settings surface (§3.1).
~~~~

## docs/rebuild/reference/frontend-backend-integration.md H4 (original line 682)

### A — alternate branch

~~~~text
- [x] Settings RENDERS effective/default/override provenance from `bootstrap.settingsSections`
- [ ] the write half — `apply-settings` is the kernel's one `PHASE1_DEFERRED` arm and answers `capability-unavailable` with zero authority effect (D113)
- [x] the separate backend preflight authority serves bootstrap readback and `POST /api/v1/preflight/rerun` (§3.1); it does not make Settings editable
- [ ] the config service behind the Settings write half (ref clock-config-secrets §3)
> 2026-08-28 | DCC2 backend reconciliation | verified against `src/core/command-kernel.ts`, `src/server/dashboard/{compose,preflight-authority,routes/api}.ts` and `src/dashboard/surfaces/settings.tsx`; left: the whole Settings write path and the Top Bar callback — neither is implied by the served backend report
~~~~

### B — integrated baseline

~~~~text
- [x] Settings renders effective/default/override provenance from the server-listed editable inventory
- [x] the registry-derived `preflight` report and strict doctor-rerun route are served and consumed by DCC3's typed caller
- [x] the resolver-owned `apply-settings` half is active, revision/schema/patch-bound and returns persisted readback with restart fencing
- [x] the settings config-service authority behind `apply-settings` is strict and atomic (ref clock-config-secrets §3)
> 2026-08-28 | DCC6 closure | verified DCC1–DCC3's bounded Settings authority/UI; credentials, AI assist, delete/recover and resolver-unowned legacy settings remain explicit open capability entries
~~~~

## docs/rebuild/reference/frontend-backend-integration.md H5 (original line 822)

### A — alternate branch

~~~~text
| **Settings write / preflight UI** | The backend report rides bootstrap and `POST /api/v1/preflight/rerun` is served. Its ingress requires a loopback Host and loopback-or-absent Origin, accepts at most 4 KiB of strict JSON, admits one active rerun and six starts/minute, and retains up to 256 command identities: exact canonical replay returns the retained result; the same id with a different canonical request refuses. `DashboardApp` still passes neither report nor callback to `TopBar`. The Settings write half remains §3.4's deferred command arm. | `{#def-settings}` for Settings write; §3.1 for the open UI connection |
~~~~

### B — integrated baseline

~~~~text
| **Settings write / preflight** | Bounded authority is served: `GET /api/v1/settings/editable` lists strict resolver-owned leaves, `GET /api/v1/settings/facts` serves status facts, one `POST /api/v1/commands` `settings`/`apply-settings` command applies the reviewed atomic patch, and retained preflight is rerun by `POST /api/v1/preflight/rerun`; `GET /api/v1/storage/doctor` stays read-only. Credentials, AI assist, delete/recover and resolver-unowned legacy settings remain absent. | `{#def-settings}` |
~~~~

## docs/rebuild/reference/frontend-backend-integration.md H6 (original line 943)

### A — alternate branch

~~~~text
| Top Bar + app shell | bootstrap, search, calendar month counts, notification summary, storage/preflight summary | descriptor/config/storage/notification patches | notification lifecycle; doctor rerun | descriptor registry, projection queries, notification/config/storage services | mostly — the backend serves the startup report and bounded/idempotent rerun route, but `DashboardApp` passes neither report nor callback to `TopBar`; search stays within the served day and there are no descriptor/config/storage/notification patch topics |
~~~~

### B — integrated baseline

~~~~text
| Top Bar + app shell | bootstrap, search, calendar month counts, notification summary, storage/preflight summary | descriptor/config/storage/notification patches | notification lifecycle; doctor rerun | descriptor registry, projection queries, notification/config/storage services | mostly — search is within the served day; preflight bootstrap + strict rerun route are served and DCC3's typed caller consumes the latter; there are no descriptor/config/storage/notification patch topics |
~~~~

## docs/rebuild/reference/frontend-backend-integration.md H7 (original line 955)

### A — alternate branch

~~~~text
| Start Run | descriptor start capability + server start plan + preflight | descriptor/config/preflight invalidation | start command referencing plan token/artifact ids | descriptor parser, config resolver, enqueue authority | typed method yes (D250/D251); dashboard startup preflight is built, while upload/capture/spreadsheet/bare methods and a modal preflight projection are not |
| Spreadsheet Intake | artifact inspection, detected headers/samples, saved exact-fingerprint mapping, validation/manifest draft | parse/validation/finalize progress | confirm mapping, correct/exclude, validate, enqueue manifest | ref data-intake-and-edit-data artifact/mapping/intake authority | yes, end to end |
| Mobile Capture | capture session + ordered immutable photo refs | session/photo/finalize/handoff patches | upload/replace/reorder/delete/finalize/retry/discard | ref data-intake-and-edit-data capture authority + artifact/finalize outbox | yes — but over **nine bespoke REST routes**, not the one command route; the phone-host gate is inert (D189) |
| Session Panel | worker cards, browser health, current run, queue/wait reasons | worker/browser/run patches | plan/spawn/stop/refresh/reopen/pause/resume | worker/session authority and browser health services | cards yes (D248); of seven commands only `stop-worker` has a control — the other six have kernel arms and no button |
| Settings + doctor/storage | schema-driven sections, effective/default/override provenance, revision, health/backups | config/storage/preflight patches | atomic settings update; recovery actions when explicitly served | ref clock-config-secrets config/preflight + ref dashboard-surfaces authority recovery | read-only — `apply-settings` is deferred (§3.4); storage doctor plus the backend preflight report/rerun authority are served, but the preflight UI callback is not wired |
~~~~

### B — integrated baseline

~~~~text
| Start Run | descriptor start capability + server start plan + preflight | descriptor/config/preflight invalidation | start command referencing plan token/artifact ids | descriptor parser, config resolver, enqueue authority | typed method yes (D250/D251); upload/capture/spreadsheet/bare methods are not built; preflight is served from the retained report |
| Spreadsheet Intake | artifact inspection, detected headers/samples, saved exact-fingerprint mapping, validation/manifest draft | parse/validation/finalize progress | confirm mapping, correct/exclude, validate, enqueue manifest | ref data-intake-and-edit-data artifact/mapping/intake authority | yes, end to end |
| Mobile Capture | capture session + ordered immutable photo refs | session/photo/finalize/handoff patches | upload/replace/reorder/delete/finalize/retry/discard | ref data-intake-and-edit-data capture authority + artifact/finalize outbox | yes — but over **nine bespoke REST routes**, not the one command route; the phone-host gate is inert (D189) |
| Session Panel | worker cards, browser health, current run, queue/wait reasons | worker/browser/run patches | plan/spawn/stop/refresh/reopen/pause/resume | worker/session authority and browser health services | cards yes (D248); of seven commands only `stop-worker` has a control — the other six have kernel arms and no button |
| Settings + doctor/storage | schema-driven sections, effective/default/override provenance, revision, health/backups | config/storage/preflight patches | resolver-owned atomic settings update; recovery actions when explicitly served | ref clock-config-secrets config/preflight + ref dashboard-surfaces authority recovery | bounded edit/readback plus preflight; the storage doctor is served and remains read-only |
~~~~

## docs/rebuild/reference/frontend-backend-integration.md H8 (original line 986)

### A — alternate branch

~~~~text
- [x] BE preflight startup/report/rerun authority (§3.1)
- [ ] FE pass `boot.preflight` and the rerun callback to the Top Bar; Settings write remains open (§3.1, §3.4)
> 2026-08-28 | DCC2 backend reconciliation | verified against `src/server/dashboard/**`, `src/dashboard/{app/dashboard-app,surfaces/top-bar}.tsx` and `config/pending-wire-bindings.json`; left: the two unserved panel kinds, per-run stream topics, Settings write, and the named frontend controls above
~~~~

### B — integrated baseline

~~~~text
- [x] preflight bootstrap + strict doctor-rerun route, consumed by DCC3's typed caller (§3.1)
- [x] Settings resolver-owned atomic write/readback subset (§3.4); credentials, AI assist, delete/recover and resolver-unowned values remain later capability scope
> 2026-08-28 | DCC6 closure | verified DCC1–DCC3's typed Settings/preflight control plane; left: the two unserved panel kinds, per-run stream topics, remaining controls and broader legacy settings scope
~~~~

## docs/roadmap/roadmap.md H1 (original line 1648)

### A — alternate branch

~~~~text
- [ ] BE `apply-settings` stops answering `capability-unavailable` — the kernel's ONE `PHASE1_DEFERRED` arm; family, target and atomic N-leaf payload are already contracted
- [x] BE DCC2 composes the exact six-runner dashboard preflight through one authority — startup awaits and retains its report, refuses a blocking result, `buildBootstrap` serves that report, and the bounded/idempotent loopback `POST /api/v1/preflight/rerun` uses the same authority; the former pending-wire entry is gone
- [ ] FE pass `boot.preflight` and an `onPreflightRerun` callback into `TopBar` — the component and typed client method exist, but `DashboardApp` connects neither
- [ ] FE the Settings form/save path — `apply-settings` remains the separate deferred backend arm
- [ ] BE `mergeSettings` must apply `override.browser` — today it silently drops it (ref clock-config-secrets §3)
- [ ] BE a settings-file reader beside the `apply-settings` writer — `settings.json` has no producer (ref clock-config-secrets §3)
~~~~

### B — integrated baseline

~~~~text
- [x] BE `apply-settings` is active with exact revision/schema/patch binding and atomic whole-file persistence
- [x] BE the registry-derived preflight/doctor service — `buildBootstrap` serves its retained strict report and `POST /api/v1/preflight/rerun` returns exact readback
- [x] FE the Settings write path, persisted readback, preflight rerun and read-only doctor controls
- [x] BE `mergeSettings` applies every `ConfigSchema` group through a compiler-exhaustive map, including `browser` (ref clock-config-secrets §3)
- [x] BE both composition roots read the strict revisioned `config/settings.json` authority beside its writer (ref clock-config-secrets §3)
~~~~

## src/domain/dashboard/bootstrap.ts H1 (original line 226)

### A — alternate branch

~~~~text
    // Optional for read-forward compatibility with older BFFs. This runtime
    // always serves the retained strict preflight authority report.
~~~~

### B — integrated baseline

~~~~text
    // Current composition supplies the retained strict report. Optional is a
    // read-forward wire arm for older producers, never permission for this
    // composition to omit a check it failed to execute.
~~~~

## src/domain/dashboard/storage.ts H1 (original line 92)

### A — alternate branch

~~~~text
export const StorageSpanAuthorityWireSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("reconciled"),
    streamRunCount: NonNegativeIntSchema,
    liveRunCount: NonNegativeIntSchema,
    archived: z.array(z.strictObject({ runId: RunIdSchema, archivedAt: IsoInstantSchema })),
  }),
  z.strictObject({
    state: z.literal("degraded"),
    streamRunCount: NonNegativeIntSchema,
    liveRunCount: NonNegativeIntSchema,
    archived: z.array(z.strictObject({ runId: RunIdSchema, archivedAt: IsoInstantSchema })),
    problems: z.array(z.discriminatedUnion("state", [
      z.strictObject({ state: z.literal("missing"), runId: RunIdSchema }),
      z.strictObject({
        state: z.literal("malformed"),
        runId: RunIdSchema,
        table: z.enum(["tasks", "archived_runs", "span_stream"]),
        summary: z.string().min(1),
      }),
    ])).min(1),
  }),
  z.strictObject({ state: z.literal("unavailable"), cause: StorageCauseWireSchema }),
~~~~

### B — integrated baseline

~~~~text
const SpanAuthorityCompleteFindingWireSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("archived"), runId: z.string().uuid() }),
  z.strictObject({ kind: z.literal("missing-span"), runId: z.string().uuid() }),
  z.strictObject({ kind: z.literal("unaccounted"), runId: z.string().uuid() }),
]);

const SpanAuthorityMalformedFindingWireSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("malformed-authority"),
    source: z.enum(["current", "archived"]),
    recordKey: z.string().min(1),
    detail: StorageDiagnosticMessageSchema,
  }),
  z.strictObject({
    kind: z.literal("malformed-span"),
    fileName: z.string().min(1),
    lineNumber: z.number().int().positive().optional(),
    detail: StorageDiagnosticMessageSchema,
  }),
]);

export const SpanAuthorityReconciliationWireSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("complete"),
    counts: z.strictObject({
      current: NonNegativeIntSchema,
      archived: NonNegativeIntSchema,
      missingSpan: NonNegativeIntSchema,
      unaccounted: NonNegativeIntSchema,
    }),
    findings: z.array(SpanAuthorityCompleteFindingWireSchema),
  }),
  z.strictObject({
    state: z.literal("malformed"),
    findings: z.array(SpanAuthorityMalformedFindingWireSchema).min(1),
  }),
  z.strictObject({ state: z.literal("unavailable"), reason: StorageDiagnosticMessageSchema }),
~~~~

## src/domain/dashboard/storage.ts H2 (original line 173)

### A — alternate branch

~~~~text
  spanAuthority: StorageSpanAuthorityWireSchema,
~~~~

### B — integrated baseline

~~~~text
  spanAuthority: SpanAuthorityReconciliationWireSchema,
~~~~

## src/domain/preflight.ts H1 (original line 4)

### A — alternate branch

~~~~text
import { CommandIdSchema } from "./ids.js";
~~~~

### B — integrated baseline

~~~~text
import {
  FingerprintSchema,
} from "./ids.js";
~~~~

## src/domain/preflight.ts H2 (original line 25)

### A — alternate branch

~~~~text
} from "./runtime-dependencies.js";
import {
  PreflightReportWireSchema,
  PreflightResultWireSchema,
} from "./preflight-wire.js";
export { PreflightRerunCommandRequestSchema } from "./preflight-wire.js";
~~~~

### B — integrated baseline

~~~~text
} from "./preflight-contract.js";
import {
  auditPreflightSemanticRegistry,
  expectedPreflightChecks,
  mandatoryCapabilitiesForPreflightCheck,
  providerChecksForFeature,
} from "./preflight-semantics.js";

export {
  PreflightResultWireSchema as PreflightResultSchema,
  PreflightRerunCommandRequestSchema,
} from "./preflight-contract.js";
~~~~

## src/domain/preflight.ts H3 (original line 79)

### A — alternate branch

~~~~text
export const PreflightResultSchema = PreflightResultWireSchema;
~~~~

### B — integrated baseline

~~~~text
/**
 * Executes one detector under its registered deadline. Timeout requests
 * cancellation but never races the runner promise away: a non-cooperative I/O
 * operation remains process-owned until it actually settles, and its eventual
 * healthy-looking return is still rejected as timed out.
 */
export async function executePreflightRunner(
  runner: PreflightRunner,
  signal: AbortSignal,
  clock: Clock,
  scheduler: PreflightDeadlineScheduler,
) {
  const check = PREFLIGHT_CHECKS.find(({ id }) => id === runner.check);
  if (check === undefined) throw new Error(`preflight runner names unknown check ${runner.check}`);
  if (check.runner !== runner.kind) throw new Error(`preflight runner ${runner.check} kind ${runner.kind} does not match ${check.runner}`);
  const deadlineMonotonicMs = clock.monotonicMs() + check.timeoutMs;
  const controller = new AbortController();
  const parentAbortError = (): Error => signal.reason instanceof Error
    ? signal.reason
    : new Error(`preflight runner ${runner.check} was aborted`);
  const forwardAbort = (): void => {
    controller.abort(parentAbortError());
  };
  if (signal.aborted) forwardAbort();
  signal.addEventListener("abort", forwardAbort, { once: true });
  let timedOut = false;
  const timeoutError = new Error(
    `preflight runner ${runner.check} exceeded its registered ${String(check.timeoutMs)}ms timeout`,
  );
  const deadline = scheduler.schedule(deadlineMonotonicMs, () => {
    timedOut = true;
    controller.abort(timeoutError);
  });
  let raw: z.input<typeof PreflightObservationSchema>;
  try {
    raw = await runner.run({
      signal: controller.signal,
      timeoutMs: check.timeoutMs,
      deadlineMonotonicMs,
      redaction: check.redaction,
    });
    if (timedOut) throw timeoutError;
    if (signal.aborted) throw parentAbortError();
  } catch (error) {
    if (timedOut) throw timeoutError;
    if (signal.aborted) throw parentAbortError();
    throw error;
  } finally {
    deadline.cancel();
    signal.removeEventListener("abort", forwardAbort);
  }
  const observation = PreflightObservationSchema.parse(raw);
  if (observation.check !== check.id) {
    throw new Error(`preflight runner ${runner.check} returned observation for ${observation.check}`);
  }
  return observation;
}
~~~~

## src/domain/preflight.ts H4 (original line 166)

### A — alternate branch

~~~~text
export const PreflightReportSchema = PreflightReportWireSchema.superRefine((report, context) => {
  const duplicateCapabilities = duplicateValues(report.requestedCapabilities);
  if (duplicateCapabilities.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["requestedCapabilities"],
      message: `requested capabilities contain duplicates: ${duplicateCapabilities.join(", ")}`,
    });
  }
  const resultIds = report.results.map(({ check }) => check);
  const duplicateResults = duplicateValues(resultIds);
  if (duplicateResults.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["results"],
      message: `preflight results contain duplicate check ids: ${duplicateResults.join(", ")}`,
    });
  }
~~~~

### B — integrated baseline

~~~~text
/** Browser and server parse one semantic report contract; the runner registry is separately bound below. */
export const PreflightReportSchema = PreflightReportWireSchema;
~~~~

## src/domain/runtime-dependencies.ts H1 (original line 26)

### A — alternate branch

~~~~text
import { PreflightCheckIdSchema } from "./preflight-check.js";
import { RuntimeCapabilitySchema } from "./runtime-capability.js";

export { RuntimeCapabilitySchema } from "./runtime-capability.js";
export type { RuntimeCapability } from "./runtime-capability.js";
export { PreflightCheckIdSchema } from "./preflight-check.js";
export type { PreflightCheckId } from "./preflight-check.js";
~~~~

### B — integrated baseline

~~~~text
import {
  PreflightCheckIdSchema,
  RuntimeCapabilitySchema,
} from "./preflight-contract.js";
import { auditPreflightSemanticRegistry } from "./preflight-semantics.js";

export {
  PreflightCheckIdSchema,
  RuntimeCapabilitySchema,
  type PreflightCheckId,
  type RuntimeCapability,
} from "./preflight-contract.js";

~~~~

## src/infra/sqlite/authority-database.ts H1 (original line 237)

### A — alternate branch

~~~~text
  SpanAuthorityReadSnapshotSchema,
  SpanAuthorityRunRootSchema,
  SpanAuthorityRunResolutionSchema,
  type AuthorityCopyInspection,
  type SpanAuthorityReadSnapshot,
  type SpanAuthorityRunRoot,
  type SpanAuthorityRunResolution,
~~~~

### B — integrated baseline

~~~~text
  AuthorityRunIdentityInventorySchema,
  type AuthorityCopyInspection,
  type AuthorityRunIdentityInventory,
~~~~

## src/infra/sqlite/authority-database.ts H2 (original line 2222)

### A — alternate branch

~~~~text
  static inspectAuthorityReadIdentityReadOnly(
    path: string,
    busyTimeoutMs = 250,
  ): AuthorityReadIdentitySnapshot {
    return inspectAuthorityReadIdentityReadOnly(path, busyTimeoutMs);
  }

  static inspectSpanRunAuthorityReadOnly(
    path: string,
    roots: readonly SpanAuthorityRunRoot[],
    busyTimeoutMs = 250,
  ): SpanAuthorityReadSnapshot {
    return inspectSpanRunAuthorityReadOnly(path, roots, busyTimeoutMs);
~~~~

### B — integrated baseline

~~~~text
  /** D282: exact current/archive run identities from this path, through a query-only handle. */
  static inspectRunIdentitiesReadOnly(path: string, busyTimeoutMs = 250): AuthorityRunIdentityInventory {
    return inspectRunIdentitiesReadOnly(path, busyTimeoutMs);
~~~~

## src/infra/sqlite/authority-health-runner.ts H1 (original line 27)

### A — alternate branch

~~~~text
    if (report.authority.state === "healthy"
      && report.backup.state === "current"
      && report.spanAuthority.state === "reconciled") {
      return PreflightObservationSchema.parse({
        check: this.check,
        state: "healthy",
        summary: `authority schema ${String(report.authority.inspection.schemaVersion)}, verified backup generation `
          + `${String(report.backup.latest.authorityGeneration)}, and ${String(report.spanAuthority.streamRunCount)} span run(s) are reconciled`,
~~~~

### B — integrated baseline

~~~~text
    const reconciliation = summarizeSpanAuthorityReconciliation(report.spanAuthority);
    if (report.authority.state === "healthy" && report.backup.state === "current" && reconciliation.state === "healthy") {
      return PreflightObservationSchema.parse({
        check: this.check,
        state: "healthy",
        summary: `authority schema ${String(report.authority.inspection.schemaVersion)} and verified backup generation ${String(report.backup.latest.authorityGeneration)} are current; ${reconciliation.summary}`,
~~~~

## src/infra/sqlite/authority-health-runner.ts H2 (original line 55)

### A — alternate branch

~~~~text
      summary: `${authorityState}; backup state is ${report.backup.state}; span authority is ${spanState}`,
      impact: "authority mutations remain blocked until storage health and exact span authority reconcile",
~~~~

### B — integrated baseline

~~~~text
      summary: `${authorityState}; backup state is ${report.backup.state}; ${reconciliation.summary}`,
      impact: "authority mutations remain blocked until an explicit verified recovery succeeds",
~~~~

## src/infra/sqlite/recovery-contracts.ts H1 (original line 130)

### A — alternate branch

~~~~text
/** One run.queued occurrence plus the attempt reached by its ordered stream. */
export const SpanAuthorityRunRootSchema = z.strictObject({
~~~~

### B — integrated baseline

~~~~text
const AuthorityRunRootIdentityFields = {
~~~~

## src/infra/sqlite/recovery-contracts.ts H2 (original line 140)

### A — alternate branch

~~~~text
  spanPath: z.string().min(1),
~~~~

### B — integrated baseline

~~~~text
  attempt: PositiveIntSchema,
~~~~

## src/infra/sqlite/recovery-contracts.ts H3 (original line 149)

### A — alternate branch

~~~~text
  retryOf: RunIdSchema.optional(),
~~~~

### B — integrated baseline

~~~~text
~~~~

## src/infra/sqlite/recovery-contracts.ts H4 (original line 157)

### A — alternate branch

~~~~text
  configSnapshotId: ConfigSnapshotIdSchema,
  queuedAt: IsoInstantSchema,
  initialAttempt: PositiveIntSchema,
  finalAttempt: PositiveIntSchema,
  streamIssues: z.array(z.string().min(1)).readonly(),
}).superRefine((root, context) => {
  if (root.finalAttempt < root.initialAttempt) {
    context.addIssue({
      code: "custom",
      path: ["finalAttempt"],
      message: "final span attempt cannot precede its run.queued attempt",
    });
  }
});

export const SpanAuthorityRunResolutionSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("live"), runId: RunIdSchema }),
  z.strictObject({ state: z.literal("archived"), runId: RunIdSchema, archivedAt: IsoInstantSchema }),
  z.strictObject({ state: z.literal("missing"), runId: RunIdSchema }),
  z.strictObject({
    state: z.literal("malformed"),
    runId: RunIdSchema,
    table: z.enum(["span_stream", "tasks", "archived_runs"]),
    summary: z.string().min(1),
  }),
]);

export const SpanAuthorityReadSnapshotSchema = z.strictObject({
  authorityGeneration: NonNegativeIntSchema,
  authorityContentFingerprint: FingerprintSchema,
  liveRunCount: NonNegativeIntSchema,
  archivedRunCount: NonNegativeIntSchema,
  resolutions: z.array(SpanAuthorityRunResolutionSchema).readonly(),
});

const ArchivedSpanAuthoritySchema = z.strictObject({
  runId: RunIdSchema,
  archivedAt: IsoInstantSchema,
});

const SpanAuthorityProblemSchema = z.discriminatedUnion("state", [
  SpanAuthorityRunResolutionSchema.options[2],
  SpanAuthorityRunResolutionSchema.options[3],
~~~~

### B — integrated baseline

~~~~text
} as const;

export const CurrentAuthorityRunIdentitySchema = z.strictObject({
  ...AuthorityRunRootIdentityFields,
  source: z.literal("current"),
  retryOf: RunIdSchema.optional(),
  configSnapshotId: ConfigSnapshotIdSchema,
});

export const ArchivedAuthorityRunIdentitySchema = z.strictObject({
  ...AuthorityRunRootIdentityFields,
  source: z.literal("archived"),
});

export const AuthorityRunIdentityInventorySchema = z.strictObject({
  currentRuns: z.array(CurrentAuthorityRunIdentitySchema),
  archivedRuns: z.array(ArchivedAuthorityRunIdentitySchema),
  malformedRecords: z.array(z.strictObject({
    source: z.enum(["current", "archived"]),
    recordKey: z.string().min(1),
    detail: z.string().min(1),
  })),
}).superRefine((inventory, context) => {
  for (const key of ["currentRuns", "archivedRuns"] as const) {
    const runIds = inventory[key].map(({ runId }) => runId);
    const duplicate = runIds.find((runId, index) => runIds.indexOf(runId) !== index);
    if (duplicate !== undefined) {
      context.addIssue({ code: "custom", path: [key], message: `${key} contains duplicate run ${duplicate}` });
    }
  }
});

const SpanAuthorityCompleteFindingSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("archived"), runId: RunIdSchema }),
  z.strictObject({ kind: z.literal("missing-span"), runId: RunIdSchema }),
  z.strictObject({ kind: z.literal("unaccounted"), runId: RunIdSchema }),
]);

const SpanAuthorityMalformedFindingSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("malformed-authority"),
    source: z.enum(["current", "archived"]),
    recordKey: z.string().min(1),
    detail: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("malformed-span"),
    fileName: z.string().min(1),
    lineNumber: PositiveIntSchema.optional(),
    detail: z.string().min(1),
  }),
~~~~

## src/infra/sqlite/recovery-contracts.ts H5 (original line 258)

### A — alternate branch

~~~~text
    state: z.literal("reconciled"),
    streamRunCount: NonNegativeIntSchema,
    liveRunCount: NonNegativeIntSchema,
    archived: z.array(ArchivedSpanAuthoritySchema),
  }),
  z.strictObject({
    state: z.literal("degraded"),
    streamRunCount: NonNegativeIntSchema,
    liveRunCount: NonNegativeIntSchema,
    archived: z.array(ArchivedSpanAuthoritySchema),
    problems: z.array(SpanAuthorityProblemSchema).min(1),
  }),
  z.strictObject({
    state: z.literal("unavailable"),
    cause: StorageHealthCauseSchema,
  }),
~~~~

### B — integrated baseline

~~~~text
    state: z.literal("complete"),
    counts: z.strictObject({
      current: NonNegativeIntSchema,
      archived: NonNegativeIntSchema,
      missingSpan: NonNegativeIntSchema,
      unaccounted: NonNegativeIntSchema,
    }),
    findings: z.array(SpanAuthorityCompleteFindingSchema),
  }),
  z.strictObject({
    state: z.literal("malformed"),
    findings: z.array(SpanAuthorityMalformedFindingSchema).min(1),
  }),
  z.strictObject({ state: z.literal("unavailable"), reason: z.string().min(1) }),
~~~~

## src/infra/sqlite/storage-doctor.ts H1 (original line 1)

### A — alternate branch

~~~~text
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  opendirSync,
  openSync,
  readSync,
  readdirSync,
  statSync,
  type Stats,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
~~~~

### B — integrated baseline

~~~~text
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
~~~~

## src/infra/sqlite/storage-doctor.ts H2 (original line 29)

### A — alternate branch

~~~~text
import { AuthorityDatabase } from "./authority-database.js";
~~~~

### B — integrated baseline

~~~~text
import { readEventStreamLines } from "../events/jsonl-streams.js";
import {
  AuthorityDatabase,
  AuthorityRunIdentityReadError,
} from "./authority-database.js";
~~~~

## src/infra/sqlite/storage-doctor.ts H3 (original line 45)

### A — alternate branch

~~~~text
  SpanAuthorityRunRootSchema,
~~~~

### B — integrated baseline

~~~~text
~~~~

## src/infra/sqlite/storage-doctor.ts H4 (original line 54)

### A — alternate branch

~~~~text
  type SpanAuthorityRunRoot,
~~~~

### B — integrated baseline

~~~~text
  type SpanAuthorityReconciliation,
~~~~

## src/infra/sqlite/storage-doctor.ts H5 (original line 1108)

### A — alternate branch

~~~~text
  const stateRootTrustAnchor = resolve(options.stateRootTrustAnchor);
  const stateRoot = resolve(options.stateRoot);
~~~~

### B — integrated baseline

~~~~text
  const spanRoot = resolve(options.spanRoot);
~~~~

## src/infra/sqlite/storage-doctor.ts H6 (original line 1124)

### A — alternate branch

~~~~text
  const initialAuthorityRead: AuthorityIdentityRead = authorityInspection === undefined
    ? inspectAuthorityIdentity(authorityPath, options.busyTimeoutMs)
    : { state: "available", identity: authorityIdentityOf(authorityInspection) };
  const initialAuthorityIdentity = initialAuthorityRead.state === "available"
    ? initialAuthorityRead.identity
    : undefined;
~~~~

### B — integrated baseline

~~~~text
  try {
    spanAuthority = reconcileSpanAuthority(
      spanRoot,
      AuthorityDatabase.inspectRunIdentitiesReadOnly(authorityPath, options.busyTimeoutMs),
    );
  } catch (error) {
    if (error instanceof AuthorityRunIdentityReadError) {
      spanAuthority = SpanAuthorityReconciliationSchema.parse({
        state: "malformed",
        findings: [{
          kind: "malformed-authority",
          source: error.source,
          recordKey: error.recordKey,
          detail: error.detail,
        }],
      });
    } else {
      const detail = error instanceof Error ? error.message : String(error);
      spanAuthority = SpanAuthorityReconciliationSchema.parse({
        state: "unavailable",
        reason: `exact span/authority reconciliation is unavailable: ${detail.replaceAll(dirname(authorityPath), basename(dirname(authorityPath))).replaceAll(spanRoot, basename(spanRoot))}`,
      });
    }
  }
~~~~

## src/server/dashboard/compose.ts H1 (original line 576)

### A — alternate branch

~~~~text
  const artifactRoot = join(repoRoot, input.isolation.artifactRoot);
  ensureOwnerOnlyDirectory(artifactRoot, "dashboard artifact root");
~~~~

### B — integrated baseline

~~~~text
  mkdirSync(artifactRoot, { recursive: true });
~~~~

## src/server/dashboard/compose.ts H2 (original line 760)

### A — alternate branch

~~~~text
  await requestBackup("interval");
  if (backupServiceState.state === "failed") {
    database.close();
    processLock.release();
    throw new Error(`dashboard preflight could not establish a verified authority backup: ${backupServiceState.message}`);
  }
  void publishBackupHealth();
~~~~

### B — integrated baseline

~~~~text
  // Startup preflight is served only after the startup backup lane has settled,
  // so `authority.health` never races a manifest that this process already owns.
  await requestBackup("interval");
  await publishBackupHealth();
~~~~

## src/server/dashboard/compose.ts H3 (original line 1343)

### A — alternate branch

~~~~text
  backendPortOwned = true;
~~~~

### B — integrated baseline

~~~~text
  dashboardPreflightRunners.markBackendOwned(server.port);
~~~~

## src/server/dashboard/queries/bootstrap.ts H1 (original line 11)

### A — alternate branch

~~~~text
import type { PreflightReportSchema } from "../../../domain/preflight.js";
import type { z } from "zod";
~~~~

### B — integrated baseline

~~~~text
import { PreflightReportSchema } from "../../../domain/preflight.js";
import { z } from "zod";
~~~~

## src/server/dashboard/routes/api.ts H1 (original line 46)

### A — alternate branch

~~~~text
  readonly preflight: PreflightAuthority;
~~~~

### B — integrated baseline

~~~~text
  /** Read-only strict preflight authority; no command-kernel mutation or journal row is produced. */
  readonly preflight: Pick<ReturnType<typeof createPreflightAuthority>, "execute">;
~~~~

## src/server/dashboard/routes/api.ts H2 (original line 260)

### A — alternate branch

~~~~text
  app.post("/api/v1/preflight/rerun", async (c) => {
    const origin = inspectLoopbackOrigin(c.req.header("origin"));
    if (origin.state === "malformed") {
      return c.json(wireError(
        "PREFLIGHT_ORIGIN_INVALID",
        "preflight rerun Origin must be one absolute HTTP(S) origin",
        false,
      ), 400);
    }
    if (!isLoopbackHost(c.req.header("host")) || origin.state === "forbidden") {
      return c.json(wireError(
        "PREFLIGHT_INGRESS_FORBIDDEN",
        "preflight reruns require a loopback Host and, when present, a loopback Origin",
        false,
      ), 403);
    }
    const body = await readPreflightBody(c.req.raw);
    if (body.state === "too-large") {
      return c.json(wireError(
        "PREFLIGHT_BODY_TOO_LARGE",
        `preflight rerun bodies may not exceed ${String(PREFLIGHT_RERUN_BODY_MAX_BYTES)} bytes`,
        false,
      ), 413);
    }
    if (body.state !== "parsed") {
      const failure = {
        "invalid-content-type": ["PREFLIGHT_CONTENT_TYPE_INVALID", "preflight reruns require application/json"],
        "invalid-content-length": ["PREFLIGHT_CONTENT_LENGTH_INVALID", "preflight rerun Content-Length must be a bounded decimal byte count"],
        "missing-body": ["PREFLIGHT_BODY_MISSING", "preflight reruns require a JSON request body"],
        "read-failed": ["PREFLIGHT_BODY_READ_FAILED", "the preflight rerun request body could not be read"],
        "invalid-utf8": ["PREFLIGHT_BODY_UTF8_INVALID", "the preflight rerun request body must be valid UTF-8"],
        "invalid-json": ["PREFLIGHT_BODY_JSON_INVALID", "the preflight rerun request body must be valid JSON"],
      } as const satisfies Record<Exclude<PreflightBodyRead["state"], "parsed" | "too-large">, readonly [string, string]>;
      const [code, message] = failure[body.state];
      return c.json(wireError(
        code,
        message,
        false,
      ), 400);
    }
    if (preflightActive || deps.preflight.hasSettlingDetectorIo()) {
      return c.json(wireError(
        "PREFLIGHT_RERUN_ACTIVE",
        "one preflight rerun is already active",
        true,
      ), 429);
    }
    const now = deps.bootstrap.clock.monotonicMs();
    while (preflightStarts[0] !== undefined
      && preflightStarts[0] <= now - PREFLIGHT_RERUN_WINDOW_MS) preflightStarts.shift();
    if (preflightStarts.length >= PREFLIGHT_RERUN_WINDOW_LIMIT) {
      return c.json(wireError(
        "PREFLIGHT_RATE_LIMITED",
        `preflight reruns are limited to ${String(PREFLIGHT_RERUN_WINDOW_LIMIT)} starts per minute`,
        true,
      ), 429);
    }
    preflightStarts.push(now);
    preflightActive = true;
    try {
      return c.json(await deps.preflight.execute(body.value, c.req.raw.signal));
    } finally {
      preflightActive = false;
    }
  });
~~~~

### B — integrated baseline

~~~~text
  // DCC2: a closed read-only command with exact request/result parsing inside the authority.
  app.post("/api/v1/preflight/rerun", async (c) =>
    c.json(await deps.preflight.execute(await c.req.json(), c.req.raw.signal)));
~~~~

## src/server/storage/compose.ts H1 (original line 393)

### A — alternate branch

~~~~text
    && report.spanAuthority.state === "reconciled";
~~~~

### B — integrated baseline

~~~~text
    && summarizeSpanAuthorityReconciliation(report.spanAuthority).state === "healthy";
~~~~

## tests/fixtures/preflight-seams.ts H1 (original line 2)

### A — alternate branch

~~~~text
import { createTimeoutDeadlineScheduler } from "../../src/server/scheduling/timeout-deadline-scheduler.js";
import {
  buildPreflightReport,
  requiredPreflightChecks,
} from "../../src/domain/preflight.js";
import { PREFLIGHT_CHECKS } from "../../src/domain/runtime-dependencies.js";
import { createPreflightAuthority } from "../../src/server/dashboard/preflight-authority.js";

/** Real strict authority plus the equivalent initial report for synchronous BFF harnesses. */
export function createPreflightHarness(
  clock: Clock,
  configFingerprint: string,
  beforeRun?: () => Promise<void>,
) {
  const selected = requiredPreflightChecks(["dashboard.serve"]);
  const observations = selected.map((check) => ({
    check,
    state: "healthy" as const,
    summary: `${check} healthy in the test harness`,
  }));
  const authority = createPreflightAuthority({
    configFingerprint,
    requestedCapabilities: ["dashboard.serve"],
    runners: selected.map((check) => ({
      check,
      kind: PREFLIGHT_CHECKS.find((candidate) => candidate.id === check)?.runner ?? "pure",
      async run() {
        await beforeRun?.();
        return observations.find((observation) => observation.check === check)
          ?? { check, state: "healthy" as const, summary: `${check} healthy in the test harness` };
      },
    })),
    clock,
    deadlineScheduler: createTimeoutDeadlineScheduler(clock),
  });
  const report = buildPreflightReport({
    configFingerprint,
    requestedCapabilities: ["dashboard.serve"],
    observations,
    clock,
  });
  return Object.freeze({ authority, report });
~~~~

### B — integrated baseline

~~~~text
import {
  buildPreflightReport,
  PreflightRerunCommandRequestSchema,
  PreflightRerunCommandResultSchema,
  requiredPreflightChecks,
} from "../../src/domain/preflight.js";

/** Healthy probe-boundary fixture; selection still comes from the production registry. */
export function healthyDashboardPreflightReport(clock: Clock) {
  return buildPreflightReport({
    configFingerprint: "a".repeat(64),
    descriptorFingerprint: "b".repeat(64),
    requestedCapabilities: ["dashboard.serve"],
    observations: requiredPreflightChecks(["dashboard.serve"]).map((check) => ({
      check,
      state: "healthy" as const,
      summary: `${check} is healthy`,
    })),
    clock,
  });
}

/** Transport adapter for BFF suites; authority semantics are pinned in the direct domain suite. */
export function healthyDashboardPreflightExecutor(clock: Clock) {
  return Object.freeze({
    async execute(input: unknown) {
      const command = PreflightRerunCommandRequestSchema.parse(input);
      return PreflightRerunCommandResultSchema.parse({
        state: "completed",
        commandId: command.commandId,
        report: healthyDashboardPreflightReport(clock),
      });
    },
  });
~~~~

## tests/parity/helpers/seeded-bff.ts H1 (original line 66)

### A — alternate branch

~~~~text
import { createPreflightHarness } from "../../fixtures/preflight-seams.js";
~~~~

### B — integrated baseline

~~~~text
import { healthyDashboardPreflightExecutor, healthyDashboardPreflightReport } from "../../fixtures/preflight-seams.js";
~~~~

## tests/unit/architecture/storage-recovery.test.ts H1 (original line 101)

### A — alternate branch

~~~~text
const PASSIVE_DEADLINE_SCHEDULER: MonotonicDeadlineScheduler = Object.freeze({
  schedule: () => Object.freeze({ cancel: () => undefined }),
~~~~

### B — integrated baseline

~~~~text
const NEVER_PREFLIGHT_DEADLINE = Object.freeze({
  schedule: () => Object.freeze({ cancel: (): void => undefined }),
~~~~

## tests/unit/architecture/storage-recovery.test.ts H2 (original line 3866)

### A — alternate branch

~~~~text
    const healthy = await executePreflightRunner(runner, new AbortController().signal, CLOCK, PASSIVE_DEADLINE_SCHEDULER);
    assert.equal(healthy.state, "healthy");

    rmSync(directory, { recursive: true });
    const unhealthy = await executePreflightRunner(runner, new AbortController().signal, CLOCK, PASSIVE_DEADLINE_SCHEDULER);
~~~~

### B — integrated baseline

~~~~text
    const healthy = await executePreflightRunner(
      runner,
      new AbortController().signal,
      CLOCK,
      NEVER_PREFLIGHT_DEADLINE,
    );
    assert.equal(healthy.state, "healthy");

    rmSync(directory, { recursive: true });
    const unhealthy = await executePreflightRunner(
      runner,
      new AbortController().signal,
      CLOCK,
      NEVER_PREFLIGHT_DEADLINE,
    );
~~~~

## tests/unit/architecture/strict-boundary-schemas.test.ts H1 (original line 885)

### A — alternate branch

~~~~text
  { name: "StorageDoctorOptions", schema: StorageDoctorOptionsSchema, fixtures: [{ stateRootTrustAnchor: "/tmp", stateRoot: "/tmp/state", authorityPath: "/tmp/state.sqlite", backupDirectory: "/tmp/backups", maxBackupAgeMs: 60_000, busyTimeoutMs: 250 }] },
~~~~

### B — integrated baseline

~~~~text
  { name: "StorageDoctorOptions", schema: StorageDoctorOptionsSchema, fixtures: [{ authorityPath: "/tmp/state.sqlite", spanRoot: "/tmp/state", backupDirectory: "/tmp/backups", maxBackupAgeMs: 60_000, busyTimeoutMs: 250 }] },
~~~~

## tests/unit/preflight-runtime-dependencies.test.ts H1 (original line 12)

### A — alternate branch

~~~~text
~~~~

### B — integrated baseline

~~~~text
  createPreflightAuthority,
  executePreflightRunner,
  PreflightRerunCommandRequestSchema,
~~~~

## tests/unit/preflight-runtime-dependencies.test.ts H2 (original line 42)

### A — alternate branch

~~~~text
const PASSIVE_DEADLINE_SCHEDULER: MonotonicDeadlineScheduler = Object.freeze({
  schedule: () => Object.freeze({ cancel: () => undefined }),
});

class ManualPreflightDeadlineScheduler implements MonotonicDeadlineScheduler {
  #entries: Array<Readonly<{ fire: () => void; cancelled: () => boolean }>> = [];

  schedule(_deadlineMonotonicMs: number, onDeadline: () => void): MonotonicDeadlineHandle {
    let cancelled = false;
    const entry = {
      fire: () => {
        if (!cancelled) onDeadline();
      },
      cancelled: () => cancelled,
    };
    this.#entries.push(entry);
    return Object.freeze({ cancel: () => { cancelled = true; } });
  }

  fire(): void {
    const entry = this.#entries.at(-1);
    if (entry === undefined) throw new Error("preflight deadline was not scheduled");
    entry.fire();
  }

  fireAll(): void {
    if (this.#entries.length === 0) throw new Error("preflight deadlines were not scheduled");
    for (const entry of this.#entries) entry.fire();
  }

  cancelled(): boolean {
    return this.#entries.at(-1)?.cancelled() ?? false;
~~~~

### B — integrated baseline

~~~~text
const NEVER_DEADLINE_SCHEDULER: PreflightDeadlineScheduler = Object.freeze({
  schedule: () => Object.freeze({ cancel: (): void => undefined }),
});

class ManualPreflightScheduler implements PreflightDeadlineScheduler {
  deadlineMonotonicMs: number | undefined;
  cancelled = false;
  #onDeadline: (() => void) | undefined;

  schedule(deadlineMonotonicMs: number, onDeadline: () => void) {
    this.deadlineMonotonicMs = deadlineMonotonicMs;
    this.#onDeadline = onDeadline;
    return {
      cancel: (): void => {
        this.cancelled = true;
      },
    };
  }

  fire(): void {
    const onDeadline = this.#onDeadline;
    if (onDeadline === undefined) throw new Error("no preflight deadline is scheduled");
    onDeadline();
~~~~

## tests/unit/preflight-runtime-dependencies.test.ts H3 (original line 357)

### A — alternate branch

~~~~text
  it("produces the exact registered dashboard report through the rerun authority", async () => {
    const expectedChecks = [
      "runtime.compatibility",
      "config.valid",
      "filesystem.health",
      "authority.health",
      "ports.available",
      "process.orphans",
    ] as const;
    const authority = createPreflightAuthority({
      configFingerprint: CONFIG_FINGERPRINT,
      requestedCapabilities: ["dashboard.serve"],
      runners: expectedChecks.map((check) => ({
        check: PreflightCheckIdSchema.parse(check),
        kind: PREFLIGHT_CHECKS.find((candidate) => candidate.id === check)?.runner ?? "pure",
        async run() {
          return check === "process.orphans"
            ? { check, state: "unhealthy" as const, summary: "one stale process record", impact: "operator review required" }
            : { check, state: "healthy" as const, summary: `${check} healthy` };
        },
      })),
      clock: CLOCK,
      deadlineScheduler: PASSIVE_DEADLINE_SCHEDULER,
    });

    const result = await authority.execute({
      commandId: "00000000-0000-4000-8000-000000000001",
      requestedAt: "2026-08-10T19:00:00.000Z",
      requestedBy: "local-operator",
      source: "settings-surface",
      type: "rerun-preflight",
      target: { expectedConfigFingerprint: CONFIG_FINGERPRINT },
    }, new AbortController().signal);

    assert.deepEqual(PreflightRerunCommandResultSchema.parse(result), {
      state: "completed",
      commandId: "00000000-0000-4000-8000-000000000001",
      report: {
        configFingerprint: CONFIG_FINGERPRINT,
        descriptorFingerprint: undefined,
        checkedAt: "2026-08-10T19:00:00.000Z",
        requestedCapabilities: ["dashboard.serve"],
        results: [
          { status: "pass", check: "runtime.compatibility", summary: "runtime.compatibility healthy" },
          { status: "pass", check: "config.valid", summary: "config.valid healthy" },
          { status: "pass", check: "filesystem.health", summary: "filesystem.health healthy" },
          { status: "pass", check: "authority.health", summary: "authority.health healthy" },
          { status: "pass", check: "ports.available", summary: "ports.available healthy" },
          {
            status: "warning",
            check: "process.orphans",
            summary: "one stale process record",
            impact: "operator review required",
            remediation: "review and explicitly clear stale rebuild processes or leases",
          },
        ],
      },
    });
  });

  it("refuses a runner outside the selected dashboard registry", () => {
    const selected = requiredPreflightChecks(["dashboard.serve"]);

    assert.throws(() => createPreflightAuthority({
      configFingerprint: CONFIG_FINGERPRINT,
      requestedCapabilities: ["dashboard.serve"],
      runners: [...selected, PreflightCheckIdSchema.parse("provider.gemini")].map((check) => ({
        check,
        kind: PREFLIGHT_CHECKS.find((candidate) => candidate.id === check)?.runner ?? "pure",
        async run() {
          return { check, state: "healthy" as const, summary: `${check} healthy` };
        },
      })),
      clock: CLOCK,
      deadlineScheduler: PASSIVE_DEADLINE_SCHEDULER,
    }), /extra runners: provider\.gemini/);
  });

  it("refuses duplicate detector ownership for one selected check", () => {
    const selected = requiredPreflightChecks(["dashboard.serve"]);
    const duplicated = [...selected, selected[0]].map((check) => {
      if (check === undefined) throw new Error("dashboard preflight selected no checks");
      return {
        check,
        kind: PREFLIGHT_CHECKS.find((candidate) => candidate.id === check)?.runner ?? "pure" as const,
        async run() {
          return { check, state: "healthy" as const, summary: `${check} healthy` };
        },
      };
    });

    assert.throws(() => createPreflightAuthority({
      configFingerprint: CONFIG_FINGERPRINT,
      requestedCapabilities: ["dashboard.serve"],
      runners: duplicated,
      clock: CLOCK,
      deadlineScheduler: PASSIVE_DEADLINE_SCHEDULER,
    }), /duplicate runner runtime\.compatibility/);
  });

  it("retains the exact completed report for bootstrap readback", async () => {
    const selected = requiredPreflightChecks(["dashboard.serve"]);
    const authority = createPreflightAuthority({
      configFingerprint: CONFIG_FINGERPRINT,
      requestedCapabilities: ["dashboard.serve"],
      runners: selected.map((check) => ({
        check,
        kind: PREFLIGHT_CHECKS.find((candidate) => candidate.id === check)?.runner ?? "pure",
        async run() {
          return { check, state: "healthy" as const, summary: `${check} healthy` };
        },
      })),
      clock: CLOCK,
      deadlineScheduler: PASSIVE_DEADLINE_SCHEDULER,
    });
    const result = await authority.execute({
      commandId: "00000000-0000-4000-8000-000000000002",
      requestedAt: "2026-08-10T19:00:00.000Z",
      requestedBy: "local-operator",
      source: "settings-surface",
      type: "rerun-preflight",
      target: { expectedConfigFingerprint: CONFIG_FINGERPRINT },
    }, new AbortController().signal);

    assert.deepEqual(authority.readLatest(), result.report);
  });

  it("replays one exact rerun command and refuses divergent command-id reuse", async () => {
    const selected = requiredPreflightChecks(["dashboard.serve"]);
    let executions = 0;
    const authority = createPreflightAuthority({
      configFingerprint: CONFIG_FINGERPRINT,
      requestedCapabilities: ["dashboard.serve"],
      runners: selected.map((check) => ({
        check,
        kind: PREFLIGHT_CHECKS.find((candidate) => candidate.id === check)?.runner ?? "pure",
        async run() {
          executions += 1;
          return { check, state: "healthy" as const, summary: `${check} healthy` };
        },
      })),
      clock: CLOCK,
      deadlineScheduler: PASSIVE_DEADLINE_SCHEDULER,
    });
    const command = {
      commandId: "00000000-0000-4000-8000-000000000003",
      requestedAt: "2026-08-10T19:00:00.000Z",
      requestedBy: "local-operator",
      source: "settings-surface",
      type: "rerun-preflight",
      target: { expectedConfigFingerprint: CONFIG_FINGERPRINT },
    } as const;

    const first = await authority.execute(command, new AbortController().signal);
    const replay = await authority.execute(command, new AbortController().signal);

    assert.deepEqual(replay, first);
    assert.equal(executions, selected.length);
    await assert.rejects(
      authority.execute({ ...command, requestedAt: "2026-08-10T19:00:01.000Z" }, new AbortController().signal),
      /command .* was already used for a different request/,
    );
  });

  it("replays a failed command identity without running its detector again", async () => {
    let executions = 0;
    const authority = createPreflightAuthority({
      configFingerprint: CONFIG_FINGERPRINT,
      requestedCapabilities: ["provider.gemini"],
      runners: [{
        check: PreflightCheckIdSchema.parse("provider.gemini"),
        kind: PREFLIGHT_CHECKS.find(({ id }) => id === "provider.gemini")?.runner ?? "pure",
        async run() {
          executions += 1;
          throw new Error("injected preflight failure");
        },
      }],
      clock: CLOCK,
      deadlineScheduler: PASSIVE_DEADLINE_SCHEDULER,
    });
    const command = {
      commandId: "00000000-0000-4000-8000-000000000004",
      requestedAt: "2026-08-10T19:00:00.000Z",
      requestedBy: "local-operator",
      source: "settings-surface",
      type: "rerun-preflight",
      target: { expectedConfigFingerprint: CONFIG_FINGERPRINT },
    } as const;

    await assert.rejects(authority.execute(command, new AbortController().signal), /injected preflight failure/);
    await assert.rejects(authority.execute(command, new AbortController().signal), /injected preflight failure/);
    assert.equal(executions, 1);
  });

  it("serializes refreshes through one detector pass at a time", async () => {
    let release = (): void => undefined;
    let markStarted = (): void => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    let executions = 0;
    let active = 0;
    let maximumActive = 0;
    const authority = createPreflightAuthority({
      configFingerprint: CONFIG_FINGERPRINT,
      requestedCapabilities: ["provider.gemini"],
      runners: [{
        check: PreflightCheckIdSchema.parse("provider.gemini"),
        kind: PREFLIGHT_CHECKS.find(({ id }) => id === "provider.gemini")?.runner ?? "pure",
        async run() {
          executions += 1;
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          if (executions === 1) {
            markStarted();
            await gate;
          }
          active -= 1;
          return { check: "provider.gemini" as const, state: "healthy" as const, summary: "provider healthy" };
        },
      }],
      clock: CLOCK,
      deadlineScheduler: PASSIVE_DEADLINE_SCHEDULER,
    });

    const first = authority.refresh(new AbortController().signal);
    await started;
    const second = authority.refresh(new AbortController().signal);
    release();
    await Promise.all([first, second]);

    assert.equal(maximumActive, 1);
    assert.equal(executions, 2);
  });

  it("keeps single-flight admission after a timeout until non-cooperative detector I/O settles", async () => {
    const scheduler = new ManualPreflightDeadlineScheduler();
    let release = (): void => undefined;
    const lateSettlement = new Promise<void>((resolve) => { release = resolve; });
    let executions = 0;
    const authority = createPreflightAuthority({
      configFingerprint: CONFIG_FINGERPRINT,
      requestedCapabilities: ["provider.gemini"],
      runners: [{
        check: PreflightCheckIdSchema.parse("provider.gemini"),
        kind: PREFLIGHT_CHECKS.find(({ id }) => id === "provider.gemini")?.runner ?? "pure",
        async run() {
          executions += 1;
          if (executions === 1) await lateSettlement;
          return { check: "provider.gemini" as const, state: "healthy" as const, summary: "provider healthy" };
        },
      }],
      clock: CLOCK,
      deadlineScheduler: scheduler,
    });

    const first = authority.refresh(new AbortController().signal);
    await Promise.resolve();
    scheduler.fire();
    const timedOut = await first;
    assert.equal(resultFor(timedOut, "provider.gemini").status, "warning");

    await assert.rejects(
      authority.refresh(new AbortController().signal),
      /previous detector I\/O is still settling/,
    );
    assert.equal(executions, 1);

    release();
    await lateSettlement;
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    const recovered = await authority.refresh(new AbortController().signal);
    assert.equal(resultFor(recovered, "provider.gemini").status, "pass");
    assert.equal(executions, 2);
  });

  it("retains single-flight admission until every independently settling selected runner finishes", async () => {
    const scheduler = new ManualPreflightDeadlineScheduler();
    let releaseConfig = (): void => undefined;
    let releaseFilesystem = (): void => undefined;
    let markConfigStarted = (): void => undefined;
    let markFilesystemStarted = (): void => undefined;
    const configGate = new Promise<void>((resolve) => { releaseConfig = resolve; });
    const filesystemGate = new Promise<void>((resolve) => { releaseFilesystem = resolve; });
    const configStarted = new Promise<void>((resolve) => { markConfigStarted = resolve; });
    const filesystemStarted = new Promise<void>((resolve) => { markFilesystemStarted = resolve; });
    const selected = requiredPreflightChecks(["dashboard.serve"]);
    let pass = 0;
    const authority = createPreflightAuthority({
      configFingerprint: CONFIG_FINGERPRINT,
      requestedCapabilities: ["dashboard.serve"],
~~~~

### B — integrated baseline

~~~~text
  it("reruns the exact selected registry and serves the completed report as its readback", async () => {
    const requestedCapabilities = ["dashboard.serve"] as const;
    const selected = requiredPreflightChecks(requestedCapabilities);
    const authority = createPreflightAuthority({
      configFingerprint: CONFIG_FINGERPRINT,
      descriptorFingerprint: DESCRIPTOR_FINGERPRINT,
      requestedCapabilities,
~~~~

## tests/unit/preflight-runtime-dependencies.test.ts H4 (original line 661)

### A — alternate branch

~~~~text
          if (pass === 0 && check === "config.valid") {
            markConfigStarted();
            await configGate;
          }
          if (pass === 0 && check === "filesystem.health") {
            markFilesystemStarted();
            await filesystemGate;
          }
          return { check, state: "healthy" as const, summary: `${check} healthy` };
        },
      })),
      clock: CLOCK,
      deadlineScheduler: scheduler,
    });

    const first = authority.refresh(new AbortController().signal);
    await Promise.all([configStarted, filesystemStarted]);
    scheduler.fireAll();
    const timedOut = await first;
    assert.equal(resultFor(timedOut, "config.valid").status, "fail");
    assert.equal(resultFor(timedOut, "filesystem.health").status, "fail");
    assert.equal(authority.hasSettlingDetectorIo(), true);

    releaseConfig();
    await configGate;
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    assert.equal(authority.hasSettlingDetectorIo(), true);
    await assert.rejects(authority.refresh(new AbortController().signal), /previous detector I\/O is still settling/);

    releaseFilesystem();
    await filesystemGate;
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    assert.equal(authority.hasSettlingDetectorIo(), false);
    pass += 1;
    const recovered = await authority.refresh(new AbortController().signal);
    assert.equal(recovered.results.every(({ status }) => status === "pass"), true);
  });

  it("bounds retained command identities without evicting an earlier replay", async () => {
    const authority = createPreflightAuthority({
      configFingerprint: CONFIG_FINGERPRINT,
      requestedCapabilities: ["provider.gemini"],
      runners: [{
        check: PreflightCheckIdSchema.parse("provider.gemini"),
        kind: PREFLIGHT_CHECKS.find(({ id }) => id === "provider.gemini")?.runner ?? "pure",
        async run() {
          return { check: "provider.gemini" as const, state: "healthy" as const, summary: "provider healthy" };
        },
      }],
      clock: CLOCK,
      deadlineScheduler: PASSIVE_DEADLINE_SCHEDULER,
    });
    const command = (index: number) => ({
      commandId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
~~~~

### B — integrated baseline

~~~~text
          return { check, state: "healthy" as const, summary: `${check} observed healthy` };
        },
      })),
      clock: CLOCK,
      scheduler: NEVER_DEADLINE_SCHEDULER,
    });

    const result = await authority.execute({
      commandId: "00000000-0000-4000-8000-000000000001",
~~~~

## tests/unit/preflight-runtime-dependencies.test.ts H5 (original line 731)

### A — alternate branch

~~~~text
      target: { expectedConfigFingerprint: CONFIG_FINGERPRINT },
    } as const);
    let first: Awaited<ReturnType<typeof authority.execute>> | undefined;
    for (let index = 1000; index < 1256; index += 1) {
      const result = await authority.execute(command(index), new AbortController().signal);
      if (index === 1000) first = result;
    }

    await assert.rejects(
      authority.execute(command(1256), new AbortController().signal),
      /retained command identity capacity 256 is exhausted/,
    );
    assert.deepEqual(await authority.execute(command(1000), new AbortController().signal), first);
~~~~

### B — integrated baseline

~~~~text
      target: {
        expectedConfigFingerprint: CONFIG_FINGERPRINT,
        expectedDescriptorFingerprint: DESCRIPTOR_FINGERPRINT,
      },
    }, new AbortController().signal);

    assert.equal(PreflightRerunCommandResultSchema.safeParse(result).success, true);
    assert.equal(PreflightRerunCommandRequestSchema.safeParse({
      commandId: "00000000-0000-4000-8000-000000000001",
      requestedAt: "2026-08-10T19:00:00.000Z",
      requestedBy: "local-operator",
      source: "settings-surface",
      type: "rerun-preflight",
      target: {
        expectedConfigFingerprint: CONFIG_FINGERPRINT,
        expectedDescriptorFingerprint: DESCRIPTOR_FINGERPRINT,
      },
      unexpectedBoundaryKey: true,
    }).success, false);
    assert.equal(PreflightRerunCommandResultSchema.safeParse({ ...result, unexpectedBoundaryKey: true }).success, false);
    assert.deepEqual(result.report.results.map(({ check }) => check), selected);
    assert.deepEqual(authority.readLatest(), result.report);
    await assert.rejects(authority.execute({
      commandId: "00000000-0000-4000-8000-000000000002",
      requestedAt: "2026-08-10T19:00:01.000Z",
      requestedBy: "local-operator",
      source: "settings-surface",
      type: "rerun-preflight",
      target: {
        expectedConfigFingerprint: CONFIG_FINGERPRINT,
        expectedDescriptorFingerprint: "c".repeat(64),
      },
    }, new AbortController().signal), /expected descriptor/);
  });

  it("coalesces an identical in-flight command replay into one registry execution", async () => {
    const requestedCapabilities = ["dashboard.serve"] as const;
    const selected = requiredPreflightChecks(requestedCapabilities);
    const began = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let calls = 0;
    const authority = createPreflightAuthority({
      configFingerprint: CONFIG_FINGERPRINT,
      descriptorFingerprint: DESCRIPTOR_FINGERPRINT,
      requestedCapabilities,
      runners: selected.map((check) => ({
        check,
        kind: PREFLIGHT_CHECKS.find(({ id }) => id === check)?.runner ?? "pure",
        async run() {
          calls += 1;
          began.resolve();
          await release.promise;
          return { check, state: "healthy" as const, summary: `${check} observed healthy` };
        },
      })),
      clock: CLOCK,
      scheduler: NEVER_DEADLINE_SCHEDULER,
    });
    const command = {
      commandId: "00000000-0000-4000-8000-000000000003",
      requestedAt: "2026-08-10T19:00:02.000Z",
      requestedBy: "local-operator",
      source: "settings-surface",
      type: "rerun-preflight",
      target: {
        expectedConfigFingerprint: CONFIG_FINGERPRINT,
        expectedDescriptorFingerprint: DESCRIPTOR_FINGERPRINT,
      },
    };

    const first = authority.execute(command, new AbortController().signal);
    await began.promise;
    const replay = authority.execute(command, new AbortController().signal);
    await assert.rejects(authority.execute({
      ...command,
      requestedAt: "2026-08-10T19:00:03.000Z",
    }, new AbortController().signal), /replayed with a divergent request/);
    release.resolve();

    assert.deepEqual(await replay, await first);
    assert.equal(calls, selected.length);
  });

  it("settles the complete selected registry before propagating failures in registry order", async () => {
    const requestedCapabilities = ["dashboard.serve"] as const;
    const selected = requiredPreflightChecks(requestedCapabilities);
    const primaryBegan = Promise.withResolvers<void>();
    const heldBegan = Promise.withResolvers<void>();
    const releaseHeld = Promise.withResolvers<void>();
    const primaryFailure = new Error("runtime identity failed");
    const secondaryFailure = new Error("config failed after release");
    const authority = createPreflightAuthority({
      configFingerprint: CONFIG_FINGERPRINT,
      descriptorFingerprint: DESCRIPTOR_FINGERPRINT,
      requestedCapabilities,
      runners: selected.map((check) => ({
        check,
        kind: PREFLIGHT_CHECKS.find(({ id }) => id === check)?.runner ?? "pure",
        async run() {
          if (check === "runtime.compatibility") {
            primaryBegan.resolve();
            throw primaryFailure;
          }
          if (check === "config.valid") {
            heldBegan.resolve();
            await releaseHeld.promise;
            throw secondaryFailure;
          }
          return { check, state: "healthy" as const, summary: `${check} observed healthy` };
        },
      })),
      clock: CLOCK,
      scheduler: NEVER_DEADLINE_SCHEDULER,
    });

    const refresh = authority.refresh(new AbortController().signal);
    await Promise.all([primaryBegan.promise, heldBegan.promise]);
    let settled = false;
    void refresh.then(
      () => { settled = true; },
      () => { settled = true; },
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(settled, false, "a failed detector must not detach an unsettled sibling");
    releaseHeld.resolve();

    await assert.rejects(refresh, (error: unknown) => error instanceof AggregateError
      && error.cause === primaryFailure
      && error.errors.length === 2
      && error.errors[0] === primaryFailure
      && error.errors[1] === secondaryFailure);
~~~~

## tests/unit/preflight-runtime-dependencies.test.ts H6 (original line 891)

### A — alternate branch

~~~~text
    }, controller.signal, CLOCK, PASSIVE_DEADLINE_SCHEDULER);
~~~~

### B — integrated baseline

~~~~text
    }, controller.signal, CLOCK, NEVER_DEADLINE_SCHEDULER);
~~~~

## tests/unit/preflight-runtime-dependencies.test.ts H7 (original line 903)

### A — alternate branch

~~~~text
    }, controller.signal, CLOCK, PASSIVE_DEADLINE_SCHEDULER), /kind io does not match pure/);
  });

  it("refuses a schema-valid observation for a different registered check", async () => {
    await assert.rejects(executePreflightRunner({
      check: CONFIG_VALID_CHECK,
      kind: "pure",
      async run() {
        return { check: "runtime.compatibility", state: "healthy", summary: "wrong registered check" };
      },
    }, new AbortController().signal, CLOCK, PASSIVE_DEADLINE_SCHEDULER),
    /preflight runner config\.valid returned observation for runtime\.compatibility/);
  });

  it("returns the exact timeout observation even when a detector later reports healthy", async () => {
    const scheduler = new ManualPreflightDeadlineScheduler();
    let release = (): void => undefined;
    const late = new Promise<void>((resolve) => { release = resolve; });
    const execution = executePreflightRunner({
      check: CONFIG_VALID_CHECK,
      kind: "pure",
      async run() {
        await late;
        return { check: "config.valid", state: "healthy", summary: "late healthy answer" };
      },
    }, new AbortController().signal, CLOCK, scheduler);

    scheduler.fire();
    const result = await execution;
    release();
    await Promise.resolve();

    assert.deepEqual(result, {
      check: "config.valid",
      state: "unhealthy",
      summary: "config.valid timed out after 1000ms",
      impact: "config.valid did not settle before its registered deadline",
    });
    assert.equal(scheduler.cancelled(), true);
  });

  it("aborts a non-cooperative detector and returns without awaiting its settlement", async () => {
    const scheduler = new ManualPreflightDeadlineScheduler();
    let detectorSignal: AbortSignal | undefined;
    const execution = executePreflightRunner({
      check: CONFIG_VALID_CHECK,
      kind: "pure",
      run(context) {
        detectorSignal = context.signal;
        return new Promise(() => undefined);
      },
    }, new AbortController().signal, CLOCK, scheduler);
    await Promise.resolve();

    scheduler.fire();

    const observation = await execution;
    assert.equal(observation.state, "unhealthy");
    assert.equal(detectorSignal?.aborted, true);
    assert.match(String(detectorSignal?.reason), /registered 1000ms deadline/);
    assert.equal(scheduler.cancelled(), true);
  });

  it("propagates caller abort and disarms the detector deadline", async () => {
    const scheduler = new ManualPreflightDeadlineScheduler();
    const controller = new AbortController();
    let detectorSignal: AbortSignal | undefined;
    const execution = executePreflightRunner({
      check: CONFIG_VALID_CHECK,
      kind: "pure",
      run(context) {
        detectorSignal = context.signal;
        return new Promise(() => undefined);
      },
    }, controller.signal, CLOCK, scheduler);
    await Promise.resolve();
    controller.abort(new Error("caller stopped preflight"));

    await assert.rejects(execution, /caller stopped preflight/);
    assert.equal(detectorSignal?.aborted, true);
    assert.equal(scheduler.cancelled(), true);
~~~~

### B — integrated baseline

~~~~text
    }, controller.signal, CLOCK, NEVER_DEADLINE_SCHEDULER), /kind io does not match pure/);
  });

  it("aborts at the registered monotonic timeout, awaits runner settlement, and rejects a later healthy return", async () => {
    const clock = manualClock(new Date("2026-08-10T12:00:00-07:00"), 700);
    const scheduler = new ManualPreflightScheduler();
    const began = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let runnerSignal: AbortSignal | undefined;
    const execution = executePreflightRunner({
      check: CONFIG_VALID_CHECK,
      kind: "pure",
      async run(context) {
        runnerSignal = context.signal;
        began.resolve();
        await release.promise;
        return { check: "config.valid", state: "healthy", summary: "late healthy answer" };
      },
    }, new AbortController().signal, clock, scheduler);
    await began.promise;
    assert.equal(scheduler.deadlineMonotonicMs, 1_700);

    let settled = false;
    void execution.then(
      () => { settled = true; },
      () => { settled = true; },
    );
    scheduler.fire();
    await Promise.resolve();
    assert.equal(runnerSignal?.aborted, true);
    assert.equal(settled, false, "timeout cancellation must not detach a still-running detector");

    release.resolve();
    await assert.rejects(execution, /preflight runner config\.valid exceeded its registered 1000ms timeout/);
    assert.equal(scheduler.cancelled, true);
~~~~

## tests/unit/server/bff-flow.test.ts H1 (original line 27)

### A — alternate branch

~~~~text
import { RunRecordSchema } from "../../../src/domain/run/record.js";
~~~~

### B — integrated baseline

~~~~text
import { EditableSettingsWireSchema } from "../../../src/domain/dashboard/settings-editor.js";
~~~~

## tests/unit/server/bff-flow.test.ts H2 (original line 66)

### A — alternate branch

~~~~text
import { createPreflightHarness } from "../../fixtures/preflight-seams.js";
import { PreflightRerunCommandResultSchema } from "../../../src/domain/preflight.js";
~~~~

### B — integrated baseline

~~~~text
import { healthyDashboardPreflightExecutor, healthyDashboardPreflightReport } from "../../fixtures/preflight-seams.js";
~~~~

## tests/unit/server/bff-flow.test.ts H3 (original line 865)

### A — alternate branch

~~~~text
  it("serves a sanitized span-stream structural diagnosis through the real storage doctor", async () => {
    const h = harness();
    const run = RunRecordSchema.parse(personLookupQueuedRun({ runId: RUN_ID }));
    h.database.authority.runs.enqueue(run);
    createSpanJsonlWriter({ stateRoot: h.stateRoot, clock: h.clock, pid: 4242 }).emit({
      t: "run.queued",
      kind: "run",
      ts: run.envelope.enqueuedAt,
      workflow: run.envelope.workflow,
      runId: run.envelope.runId,
      attempt: run.envelope.attempt,
      traceId: run.envelope.traceId,
      spanPath: `${run.envelope.traceId}/foreign-root`,
      itemId: run.envelope.itemId,
      shape: run.envelope.shape,
      priority: run.envelope.priority,
      dryRun: run.envelope.dryRun,
      actorId: "local-operator",
      title: "malformed root path fixture",
      descriptorVersion: run.envelope.descriptorVersion,
      contractFingerprint: run.envelope.contractFingerprint,
      resolvedInstance: run.envelope.resolvedInstance,
      configFingerprint: run.envelope.configFingerprint,
      configSnapshotId: run.envelope.configSnapshotId,
    });

    const response = await h.app.request("/api/v1/storage/doctor");

    assert.equal(response.status, 200);
    const report = StorageDoctorWireSchema.parse(await response.json());
    assert.equal(report.spanAuthority.state, "degraded");
    if (report.spanAuthority.state !== "degraded") throw new Error("span structural corruption must degrade the doctor wire");
    assert.deepEqual(report.spanAuthority.problems, [{
      state: "malformed",
      runId: run.envelope.runId,
      table: "span_stream",
      summary: `run.queued root spanPath ${run.envelope.traceId}/foreign-root does not equal traceId ${run.envelope.traceId}`,
    }]);
~~~~

### B — integrated baseline

~~~~text
  it("reruns preflight through the closed read-only command and returns the exact report", async () => {
    const h = harness();
    const response = await h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        commandId: "00000000-0000-4000-8000-000000000091",
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator",
        source: "settings-surface",
        type: "rerun-preflight",
        target: {
          expectedConfigFingerprint: "a".repeat(64),
          expectedDescriptorFingerprint: "b".repeat(64),
        },
      }),
    });

    assert.equal(response.status, 200);
    const result = await json(response);
    assert.equal(result.state, "completed");
    assert.equal(result.commandId, "00000000-0000-4000-8000-000000000091");
    assert.deepEqual(
      (result.report as { results: { check: string }[] }).results.map(({ check }) => check),
      requiredPreflightChecks(["dashboard.serve"]),
    );
  });

  it("serves the resolver-owned editor inventory and reads the persisted settings revision back", async () => {
    const h = harness();
    const initial = EditableSettingsWireSchema.parse(await json(await h.app.request("/api/v1/settings/editable")));
    assert.equal(initial.revision, 1);
    assert.deepEqual(initial.sections.map((section) => section.id), ["general", "display", "performance", "paths"]);
    const initialWidth = initial.sections.flatMap((section) => section.leaves).find((leaf) => leaf.path === "display.screenWidth");
    assert.equal(initialWidth?.source, "default");

    const patch = { display: { screenWidth: 1980 } };
    const applied = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        commandId: "00000000-0000-4000-8000-000000000096",
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator",
        source: "settings-surface",
        family: "settings",
        type: "apply-settings",
        target: { expectedRevision: initial.revision },
        payload: {
          settingsSchemaHash: initial.settingsSchemaHash,
          patchFingerprint: deriveSettingsPatchFingerprint(patch),
          patch,
        },
      }),
    });
    assert.equal(applied.status, 200);
    const readback = EditableSettingsWireSchema.parse(await json(await h.app.request("/api/v1/settings/editable")));
    assert.equal(readback.revision, 2);
    const persistedWidth = readback.sections.flatMap((section) => section.leaves).find((leaf) => leaf.path === "display.screenWidth");
    assert.equal(persistedWidth?.source, "settings");
    assert.equal(persistedWidth?.effectiveValue, 1980);
    assert.equal(persistedWidth?.settingsValue, 1980);
~~~~

## tests/unit/server/bootstrap-start-surface.test.ts H1 (original line 38)

### A — alternate branch

~~~~text
import { createPreflightHarness } from "../../fixtures/preflight-seams.js";
~~~~

### B — integrated baseline

~~~~text
import { healthyDashboardPreflightReport } from "../../fixtures/preflight-seams.js";
~~~~

## tests/unit/server/bootstrap-storage-arms.test.ts H1 (original line 21)

### A — alternate branch

~~~~text
import { PreflightReportSchema } from "../../../src/domain/preflight.js";
~~~~

### B — integrated baseline

~~~~text
import { requiredPreflightChecks } from "../../../src/domain/preflight.js";
~~~~

## tests/unit/server/bootstrap-storage-arms.test.ts H2 (original line 94)

### A — alternate branch

~~~~text
  it("projects the retained strict preflight report in registry order", () => {
    const world = makeWorld();
    try {
      const wire = buildBootstrap(depsOf(world, { authorityReachable: true, backup: "current" }));
      assert.deepEqual(wire.preflight, [
        {
          id: "runtime.compatibility",
          label: "runtime.compatibility",
          verdict: "pass",
          detail: "runtime compatible",
          blocks: [],
          checkedAt: AT.toISOString(),
        },
        {
          id: "config.valid",
          label: "config.valid",
          verdict: "pass",
          detail: "config valid",
          blocks: [],
          checkedAt: AT.toISOString(),
        },
        {
          id: "filesystem.health",
          label: "filesystem.health",
          verdict: "pass",
          detail: "filesystem healthy",
          blocks: [],
          checkedAt: AT.toISOString(),
        },
        {
          id: "authority.health",
          label: "authority.health",
          verdict: "pass",
          detail: "authority healthy",
          blocks: [],
          checkedAt: AT.toISOString(),
        },
        {
          id: "ports.available",
          label: "ports.available",
          verdict: "pass",
          detail: "ports available",
          blocks: [],
          checkedAt: AT.toISOString(),
        },
        {
          id: "process.orphans",
          label: "process.orphans",
          verdict: "warning",
          detail: "one stale process record",
          blocks: [],
          remediation: "review and explicitly clear stale rebuild processes or leases",
          checkedAt: AT.toISOString(),
        },
      ]);
    } finally {
      world.dispose();
    }
  });

  it("projects retained preflight failures with their exact blocks and remediation", () => {
    const world = makeWorld();
    try {
      const deps = depsOf(world, { authorityReachable: true, backup: "current" });
      const retained = deps.preflightReport();
      const failing = PreflightReportSchema.parse({
        ...retained,
        results: retained.results.map((result) => result.check === "filesystem.health"
          ? {
              status: "fail",
              check: result.check,
              summary: "artifact root is not privately writable",
              blocks: ["dashboard.serve"],
              remediation: "restore the configured artifact root with mode 0700",
            }
          : result),
      });

      const wire = buildBootstrap({ ...deps, preflightReport: () => failing });

      assert.ok(wire.preflight);
      assert.deepEqual(wire.preflight.find(({ id }) => id === "filesystem.health"), {
        id: "filesystem.health",
        label: "filesystem.health",
        verdict: "fail",
        detail: "artifact root is not privately writable",
        blocks: ["dashboard.serve"],
        remediation: "restore the configured artifact root with mode 0700",
        checkedAt: AT.toISOString(),
      });
~~~~

### B — integrated baseline

~~~~text
  it("projects the one strict preflight report without reselecting checks", () => {
    const world = makeWorld();
    try {
      const wire = buildBootstrap(depsOf(world, { authorityReachable: true, backup: "current" }));
      assert.deepEqual(
        wire.preflight?.map(({ id, verdict, detail }) => ({ id, verdict, detail })),
        requiredPreflightChecks(["dashboard.serve"]).map((check) => ({
          id: check,
          verdict: "pass",
          detail: `${check} is healthy`,
        })),
      );
~~~~

## tests/unit/server/compose-real-port.test.ts H1 (original line 9)

### A — alternate branch

~~~~text
import { copyFileSync, mkdtempSync, rmSync, statSync } from "node:fs";
~~~~

### B — integrated baseline

~~~~text
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
~~~~

## tests/unit/server/compose-real-port.test.ts H2 (original line 36)

### A — alternate branch

~~~~text
  it("creates the artifact root as an owner-only directory", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-private-artifacts-"));
    copyFileSync(join(process.cwd(), "package.json"), join(repoRoot, "package.json"));
    copyFileSync(join(process.cwd(), "package-lock.json"), join(repoRoot, "package-lock.json"));
    cleanups.push(() => rmSync(repoRoot, { recursive: true, force: true }));
    const runtime = await composeDashboardRuntime({
      isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0,
      frontendPortOverride: 0,
      env: {},
      repoRoot,
    });
    cleanups.push(() => runtime.stop());

    const permissions = statSync(join(repoRoot, rebuildRuntimeIsolation.artifactRoot)).mode & 0o777;
    assert.equal(permissions, 0o700);
~~~~

### B — integrated baseline

~~~~text
  it("keeps an applied revision restart-required until a dashboard restart activates it", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "hrauto-compose-settings-"));
    writeFileSync(join(repoRoot, "package.json"), JSON.stringify({ name: "probe", version: "0.1.0" }));
    cleanups.push(() => rmSync(repoRoot, { recursive: true, force: true }));
    const generationPath = join(
      repoRoot,
      rebuildRuntimeIsolation.stateRoot,
      "settings",
      "runtime-generation.json",
    );
    const commandId = "72727272-7272-4272-8272-727272727272";
    const patch = { display: { screenWidth: 1980 } };
    const command = {
      commandId,
      requestedAt: new Date().toISOString(),
      requestedBy: "local-operator",
      source: "settings-surface",
      family: "settings",
      type: "apply-settings",
      target: { expectedRevision: 1 },
      payload: {
        settingsSchemaHash: CURRENT_SETTINGS_SCHEMA_HASH,
        patchFingerprint: deriveSettingsPatchFingerprint(patch),
        patch,
      },
    } as const;

    const first = await composeDashboardRuntime({
      isolation: rebuildRuntimeIsolation,
      env: {},
      repoRoot,
      backendPortOverride: 0,
    });
    try {
      const client = createDashboardClient({ baseUrl: `http://127.0.0.1:${String(first.port)}` });
      const before = await client.editableSettings();
      assert.equal(before.revision, 1);
      const applied = await client.applySettings(command);
      assert.equal(applied.state, "applied");
      if (applied.state === "applied") assert.equal(applied.restartRequired, true);
      const readback = await client.editableSettings();
      assert.equal(readback.revision, 2);
      assert.equal(readback.runtimeStatus.state, "restart-required");
      const screenWidth = readback.sections.flatMap((section) => section.leaves).find((leaf) => leaf.path === "display.screenWidth");
      assert.equal(screenWidth?.effectiveValue, 1980);
      assert.equal(screenWidth?.settingsValue, 1980);
      assert.match(readFileSync(join(repoRoot, "config", "settings.json"), "utf8"), /"screenWidth":1980/u);
      const activation = JSON.parse(readFileSync(generationPath, "utf8")) as {
        identity: { settingsRevision: number };
      };
      assert.equal(activation.identity.settingsRevision, 1);
      const replay = await client.applySettings(command);
      assert.equal(replay.state, "already-applied");
      if (replay.state === "already-applied") assert.equal(replay.restartRequired, true);
    } finally {
      await first.stop();
    }

    const restarted = await composeDashboardRuntime({
      isolation: rebuildRuntimeIsolation,
      env: {},
      repoRoot,
      backendPortOverride: 0,
    });
    try {
      const activation = JSON.parse(readFileSync(generationPath, "utf8")) as {
        identity: { settingsRevision: number };
      };
      assert.equal(activation.identity.settingsRevision, 2);
    } finally {
      await restarted.stop();
    }
~~~~

