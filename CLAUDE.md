# HR Automation — rebuild

The ground-up rebuild of UCSD's UCPath HR automation. This repository is **not** production. The
legacy repository at `/Users/julianhein/Projects/hr-automation` runs every real HR transaction and
stays the sole production authority until a single all-at-once cutover (D89/D93).

Phase 1 closed 2026-08-04 (`completedThrough: "1i-spine"`); **Phase 2 — the transaction proof** is
active and **half landed**. `kuali-timekeeper-annotation` is the one-transaction-node workflow that
carries it, and the whole fail-closed spine — staged preview with zero durable footprint, beat-③
subject binding, reload read-back, permanent-key dedupe, post-fence parking — is proved: the
dry-run half **live** on real doc 4489, the crash/recovery/dedupe/lease matrix in fixtures over a
real authority database.

**The ONE authorized controlled commit was performed on 2026-08-04 and could not land (D128).**
Operator-named docs 4489/4490 sit at a workflow step that does not own the `Timekeeper Name:*`
field, and Kuali's `Save` serializes only its own step's section — so the write fenced, clicked,
answered `200` with a rendered `Form saved`, persisted nothing, read `absent`, and parked. The
kernel did exactly the right thing; the target was wrong. Phase 2's write half is **BLOCKED** on a
target at a step that owns the field, and write-heavy workflow migration may not begin. Evidence,
measured numbers and durable row ids: `docs/rebuild/09-write-safety.md` §Phase-2 controlled-commit
as-built.

**Tail 2g — the event/trust layer — has begun (D134).** Authority schema **v10** creates every
durable table 2g needs (diagnostic bundles + attachments, evidence receipts, knowledge and fix
records, the ledger projector's `(system,date)` lease and projection state, a searchable failure
fingerprint, and the notification dedupe fold), and doc 09 §6's ordered actor-attributed ledger
projector is built in `src/infra/ledger/`. **D137/D138/D139** land the next three over it:
automatic diagnostic capture with capture-time redaction and the retention/pin sweep
(`src/services/trust/`), the durable actor-keyed notification inbox whose row is committed before
any OS delivery (`src/services/notifications/`), and knowledge/fix admission with the generated
active-view `KNOWLEDGE.md`.

**2g's D82 core landed 2026-08-04 (D140–D143).** `RunEvidenceReceipt`s are DERIVED from authority
(never minted at settlement) with declared per-field redaction and declared cross-source
obligations, the run-detail `receipt` and `failure` sections serve real content instead of
pointers, and `npm run rebuild:cli explain run <traceId|runId>` reads the same derivation. The
`evidence-receipt` guard is active. **D144 then closed the gap they recorded**: a transaction node
is terminal evidence, so `kuali-timekeeper-annotation` reaches terminal `done` over its real stored
outcome and the controlled commit has a receipt in authority (doc 09 §3.1).

Seeded 2026-07-31 from `hr-automation@5879004` (branch `feature/rebuild-phase1b`, which stays in the
legacy repo as the pre-split record). Phases 1a–1e completed 2026-08-01.

**Phase 1 is COMPLETE as of 2026-08-04** — 1f, 1g-spine and 1i-spine landed, and D74's live exit
test passed: run `4ebf7275-0158-49af-a78f-1f37948efb27` (trace `pl-000619-4ebf`) ran person-lookup
against real UCPath + CRM on the new executor, recovered a dead CRM session mid-run, terminalized
`done` at attempt 2 with a correct result, and rendered all four parity surfaces from the ONE
projection. The program is now at **Phase 2's controlled transaction proof**; the runtime reports
`completedThrough:"1i-spine"` / `active:"2-transaction-proof"`. Three presentation defects are
recorded and deferred to 2i — see doc 03's *Phase 1g/1i-spine as-built presentation deltas* and doc
07 §Phase 1's exit-criteria block. What Phase 1f itself landed, for context on the contracts below:
registry/task-binding corrections, worker-owned browser-session lifecycle, and mandatory task
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
- `docs/rebuild/04-reconciliation.md` — the decision changelog (D1–D144). A **pointer index**, not a
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

npm run test:parity        # doc 13 §7 visual/a11y parity lane — builds the bundle, ASSERTS every reference
npm run test:parity:update # the ONE deliberate way to re-freeze a reference (PARITY_UPDATE=1)

npm run rebuild:cli        # the isolated rebuild runtime (help | phase | dashboard | worker | explain)
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

- **2026-08-04: A durable row's schema hash describes the BYTES IT HOLDS, so the reader moves, not
  the writer (D144).** A transaction node could not be a terminal dependency because beat ⑦ stores
  the whole `TransactionOutcome` envelope while terminal `build` demanded the commit contract's bare
  output hash — and the interpreter never registered the row at all. The tempting fix (make the
  sequencer stamp the commit-output hash) would have made the row lie about its own contents and
  would have demanded a checkpoint nothing wrote, which is exactly D110/D114's "exact stored
  dependencies". The commit contract's identity was never missing: it sits one level down as
  `outcome.output.schemaHash` beside `outcome.proof.schemaHash`, and checking the envelope PLUS both
  nested hashes is strictly stronger than either alone — the composite already existed. The second
  half is shape, not hashing: a transaction node's scope value is `TypedTransactionOutcome<C>`
  (`{disposition, proofSource, output, proof}`), which is what descriptors author against, so the
  terminal factory projects the envelope before `derive` runs. "Which schema owns this node's FIELD
  PATHS" (a detail's `fieldPath`) is a different question with a different answer — one helper
  answering both is what hid the bug. The interpreter now reads beat ⑦'s exact row back and refuses
  if it is absent or does not project to the settlement just reported; it never mints one.
  `TransactionOutcomeSchema` moved into `write-safety-primitives.ts` because `write-safety.ts`
  imports `node:crypto` and a descriptor closure may not reach a Node built-in.
- **2026-08-04: A parked write must outlive an unrelated refactor (D136).** Resolvability binds to
  the SEMANTIC surface a resolution consumes — `workflow-identity`, `descriptor-version`,
  `transaction-node`, `canonical-input`, `permanent-key-identity`, `binding-proof-identity` — not to
  `descriptor.contractFingerprint`, a hash of the whole 31-file source closure. A park waits for a
  human, so expiring it on an edit to `src/domain/ids.ts` is not a recovery path. Byte identity of
  the closure stays the fast path (it proves every check at once); when the closure moves the checks
  run directly, and the load-bearing one re-derives the fenced permanent key from the exact durable
  input — a different key names a DIFFERENT external transaction. Refusals print the whole check
  table with both fingerprints and the moved values, and `[held]`/`[MOVED]`/`[skip]` stay distinct.
  There is no waiver arm on purpose. A resolution releases the WRITE only: the run keeps its planned
  `contractFingerprint`, so doc 02 §5.3 replay and `executeClaimedRun` are untouched.
- **2026-08-04: A forward reference decides the write order, and durability decides the delivery
  order.** `diagnostic_bundles.failure_id` references the failure row while
  `FailureRecord.diagnosticBundleId` is a forward ref the failure must already carry, so capture is
  two phases (D137): `prepare` redacts and writes attachments to the content-addressed store with
  nothing durable moved, then the interpreter terminalizes with the prepared `bundleId` and
  `persist`s the bundle inside the SAME authority transaction as the terminal CAS. Redaction is
  schema-owned and happens AT capture — unclassified fields are dropped with a warning, never passed
  through — and a second lock refuses a bundle where a never-exportable key survived as `allowed`.
  Retention purges the row and its attachment index together but **not** the content-addressed
  bytes: they are shared by digest, so the sweep reports unreferenced artifact ids instead of
  deleting something a receipt might still hold. The inbox (D138) commits create-or-fold in one
  transaction and only then attempts OS delivery; a delivery that throws is reported and never
  written back, so a missed toast still leaves an unread item. Its trigger union is ids, closed
  codes, and counts — no free-text field — which is the only way "notification text carries no
  captured form contents" is enforceable. Knowledge (D139) is insert-only, so admission is audited
  inside the insert transaction and supersession is expressed forward by the new record; the active
  view subtracts it, and nothing rewrites the older row.
- **2026-08-04: A required config leaf is a durable-schema change, and a snapshot is evidence — so
  it is read forward, never back-filled (D133).** D125's `timeouts.sessionAcquireMs` shipped with a
  default for fresh resolves and no path for stored `config_snapshots`, which parse strictly at
  database OPEN — so every authority database created before it stopped opening entirely, every
  unrelated row included. The repair is NOT a migration: `fingerprint` hashes exactly the stored
  `config` bytes, the table is insert-only, and writing `60000` into an old row would claim a bound
  that run never had (its absence is why a dead CRM session burned 262.9 s). Instead
  `src/domain/config/snapshot-generations.ts` pins the leaf set per generation, `StoredConfigSchema`
  lets exactly the registered post-baseline leaves be absent, `configSnapshotAbsentLeaves` reports
  them, and reading a stored config applies NO group default — that hole is how `browser.*` landed
  silently. Four earlier leaves (`urls.ucpath.*.login`, `paths.duoExtensionDir`,
  `paths.browserProfileRoot`, and `paths.duoCredential`'s tightening to `AbsolutePathSchema`) were
  the same defect and only escaped because no older database survived them.
- **2026-08-04: A reference corpus that rewrites itself documents behavior instead of holding it
  (D132).** `npm run test:parity` asserted only the `.png` and rewrote every `.a11y.yml`/`.meta.json`
  unconditionally, so an accessible-name change rewrote 56 references, changed zero screenshots, and
  stayed green — and it served a `dist/dashboard` it never rebuilt, so a run could pass against code
  that was not in the working tree. Both halves of a pair are now compared; a mismatch fails with a
  diff naming the reference and leaves the file untouched; a missing reference fails rather than
  being minted. `PARITY_UPDATE=1` (`npm run test:parity:update`) is the single switch driving
  Playwright's `updateSnapshots` AND the a11y/provenance writer, so the halves cannot re-freeze
  independently. The lane builds the bundle itself and stamps it with the working-tree input digest
  plus the emitted output digest; every parity server asserts that stamp before binding a port and
  must declare `proof: "working-tree"` or an explicitly reasoned `proof: "unverified"`. Both arms
  carry negative controls executed through the lane's own entry points — the same reason the ratchet
  arms run against violating fixtures. Generalize the shape, not the file: any "write the
  expectation, then pass" tool is a check that cannot fail.
- **2026-08-04: the controlled commit proved the kernel and disqualified the target (D128/D129).**
  Phase 2's ONE authorized real write fenced, clicked `Save`, got HTTP `200` and a rendered
  `Form saved`, and still persisted nothing — Kuali serializes only the CURRENT workflow step's
  section, and `Timekeeper Name:*` belongs to a later step. Both staging techniques put the value
  into React's own state, so no driver change reaches it. **A field being rendered and editable is
  not evidence the step can write it, and a positive save signal is worth nothing.** The kernel
  behaved as designed: fence durable before the click, read-back `absent`, intent parked `unknown`,
  ZERO checkpoint / ledger / terminal-span rows, and a later run on the same key refused in 1ms with
  no browser. The parked row is LEFT parked — a human decision is genuinely required.
  `recoveryAbsence` stays `operator-only`: a write that never lands measures no propagation window,
  and inventing `minSinceFenceMs` is the banned constant. Two side defects fell out — a real write
  was refusable only on the caller's `dryRun` claim rather than the run's own envelope (now both),
  and Kuali Build paints client-side (menubar ~1s, document heading ~3s after `domcontentloaded`,
  with an EMPTY heading beside "Action"/"Action List" decoys at ~1.5s), so two probes that sampled
  once now bound-wait for the same fact and the heading recipe is NARROWED to exactly one level-1
  heading whose accessible name is a document number.
- **2026-08-04: a live run found three defects fixtures could not — two surfaces that misled, and a
  bound that was the wrong instrument (D123/D124/D125).** `skipped` had no timeline arm, so a node
  the descriptor's own `when` excluded rendered as **Cancelled** — a word that names an act somebody
  took. `skipped` is now its own arm and every timeline event carries `notRun`: the executor stamps
  the skip reason on the `span.ended` task span using the SAME closed vocabulary the durable result
  records, the projector folds it verbatim, and a span with no reason stays explicitly reasonless.
  The queue row computed `now − startedAt` for every non-`queued` status, so a finished run counted
  forever (2h 47m for ~14.5 minutes of work); the wire now serves `endedAt` in its own right, an
  in-flight row is schema-refused from carrying one, and a terminal row with none renders
  `duration unknown` rather than substituting `now`. Third: a dead CRM session took **262.9s** to
  surface, and the cause is structural — every step inside a login recipe is bounded, nothing
  bounded the CHAIN, and the only outer bound was `timeouts.taskMs`, which must stay generous for
  the real read. It never even fired: claim expiry (a RECOVERY mechanism, on the wall clock) requeued
  the run first. Acquisition now has its own leaf, `timeouts.sessionAcquireMs` (60s, >3x the
  live-verified ~17s/~12s logins), failing loud — never retrying — and poison-closing a session that
  lands after its bound.
- **2026-08-04: the first commit contract is real, and everything about it is fail-closed by
  construction.** `kuali/save-timekeeper-annotation` writes ONE benign, restorable field on a Kuali
  RRSS document. Kuali's save is UI-silent, so `verify-timekeeper-annotation` reloads and reads the
  field back; the commit's own output is a claim the kernel never promotes. Post-fence absence is
  `operator-only` — not because the negative read is weak but because no propagation window has been
  measured, and a guessed `minSinceFenceMs` is exactly the unverified constant this tree bans. The
  mutation-capability registry moved to `src/base/mutation-capability.ts` so a `stores/**` driver can
  refuse an unminted capability before its click without a layer inversion; `write-sequencer.ts` is
  still the only permitted minting caller, and `task-driver-boundary` now enforces that plus "a
  `commit` implementation lives only in a store driver owner that validates its capability". Dry-run,
  wrong-subject, unknown-subject, stale-probe, and every post-fence park arm assert DURABLE absence
  (no `write_intents` / `run_checkpoints` / `durable_outbox` rows), never log inspection.
- **2026-08-04: a Kuali `actionId` names a workflow step, not a document.** The 2026-07-23 probe
  recorded the document deep link as stable; re-opening doc 4453's captured action id on 2026-08-04
  silently redirected to the Action List with no form. A run therefore carries the action id AND the
  document number, and the driver proves the number from the page's level-1 heading before touching
  anything. Live read-only re-verification also confirmed the three ported anchors resolve to exactly
  one node each, and that `Save` sits beside `Send Back` and `Mark Complete` — which is why the port
  drops legacy's three-deep `.or()` fallback chain entirely.
- **2026-08-04: the live exit test found three classes of defect no fixture could — and each one was
  green on every gate.** D74's whole argument is that a real run falsifies contracts a fixture
  cannot; here is what it actually caught, so the next live gate is read as a *test*, not a demo.
  **(1) Identity must carry the WHOLE span identity, because only a real failure re-runs a node.**
  `cross-verify` died on a poisoned CRM session, the run re-attempted, and the node ran again at the
  same `spanPath` — so the projector's `spanPath` fold key and the timeline's
  `<trace>/<node>#<taskAttempt>` React seed each collapsed two genuinely distinct executions (262.9s
  cancelled, 12.8s done) into one. Every fixture had one attempt, so `(runId, attempt, spanPath)`
  looked satisfied by using two thirds of it. Fold and seed by `(attempt, spanPath)`; a folded span
  is a fact about ONE execution, never a per-node latest-wins slot.
  **(2) A browser-reachable module that statically imports a Node built-in is a latent prod bug that
  dev reports as a crash and prod reports as a warning.** `typecheck`, `lint` and the whole unit
  suite passed with `node:path` six modules deep under `src/dashboard`'s reach. Dev threw at module
  evaluation (a blank page before any component rendered); the prod build only warned and shipped a
  bundle that would fail later, if at all — so the two environments fail *differently* and neither
  is trustworthy alone. Never resolve it with an alias, polyfill, or browser stub: a stubbed
  `resolve()` returns a plausible-but-wrong absolute path. See the entry below for the structural
  fix and its guard.
  **(3) A login is proven by CONTENT, never by a URL** — and the live lane is what exposed it (a
  smoke "passed" in 3s having authenticated nothing). D120, entry below.
  The corollary for the next live gate: budget for the failure path, not the happy path. Discovering
  the dead CRM session cost **262.9s** of the run's ~14.5 minutes, and that latency — not
  correctness — is the honest open item this test leaves behind.
- **2026-08-04: "Browser code" is not a directory — the dashboard bundle's reach is.**
  `src/domain/config/schema.ts` statically imported `node:path` for its filesystem `paths` default,
  and `src/domain/commands.ts` → `src/dashboard/client/commands.ts` put it in the browser bundle six
  hops from the entry. Vite's dev server replaces an externalized built-in with a proxy that THROWS
  on the first property read, so the named-import BINDING killed the app at module evaluation — shell
  and title rendered, React rendered nothing. Making the default lazy (an earlier fix) could never be
  enough; only removing the import is. Dev and prod fail DIFFERENTLY here: the production build only
  warns and ships a bundle that fails later, if at all, so a green prod build is not evidence. The
  structural fix is that a browser-reachable module keeps the pure contract while anything needing a
  filesystem, a process, or a working directory moves to a server-only module — `paths` is now
  REQUIRED in `ConfigSchema` and supplied by `src/domain/config/runtime-paths.ts` through the one
  `env > settings.json > default` resolver, so a caller without it gets a loud zod error naming the
  leaf. An alias, polyfill, or browser stub for `node:path` would be strictly worse: a stubbed
  `resolve()` invents a plausible-but-wrong absolute path, which is the exact silent-wrong-value
  failure this program forbids. `dashboard-wire-boundary.test.ts` (doc 13 §8.13) now walks the entry
  declared in `index.html` and fails on any reachable Node built-in, printing the whole import chain.
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
- **2026-08-04: The ledger's sequence is assigned BEFORE the append, and degraded stops everything.**
  `src/infra/ledger/ledger-projector.ts` is the only module that appends `.tracker-rebuild/ledger/`.
  Its five durable facts are ordered lease → reconcile → assign `seq` + line digest → append + fsync
  → mark appended/projected. Assigning first is what makes the append window repairable: the line's
  bytes are a pure function of the stored outbox payload and its stored `seq`, so recovery
  re-derives *the same* line and compares the digest rather than composing a replacement; a crash
  after the append re-marks without re-appending. The partition comes from the entry's own
  `confirmedAt` in UTC — never wall-clock now — so a restart days later reconciles into the same
  file. A duplicate, gap, out-of-order line, torn tail, digest mismatch, or unrecorded line stops
  that partition for **every** entry including valid waiting ones, because projecting past ledger
  corruption is how history gets quietly renumbered. `ledger/` is never pruned structurally:
  `pruneEventStreams` can only see `spans`/`notes`, and a ratchet fails any module that both names
  `ledger/` and calls a deletion primitive.
- **2026-08-04: A durable notification is the one authority row that is UPDATED, and that is not a
  weakened ledger.** Schema v10 folds a repeated identical trigger into the one row its
  `(actorId, dedupeFingerprint)` owns — `count`, `lastSeenAt`, and a version that advances by
  exactly one — because the folded firings leave no rows behind to derive those values from, and
  doc 03 §2.6 forbids spamming the inbox. Identity and `createdAt` are frozen by trigger. The ledger
  tables in the SAME migration go the other way: abort-on-delete, one `assigned → appended`
  transition, immutable seq/digest/partition. Never let "notifications are mutable" leak into
  anything that records what was actually filed.
- **2026-08-04: A trust receipt is DERIVED from authority, and its redaction is declared.** The
  D82 receipt (`src/core/evidence-receipt.ts`) is a pure function of the run record, terminal
  result/failure, checkpoints + provenance, and write intents: identities fold from the run
  identity and `generatedAt` is the terminal instant, so re-deriving one run yields the same bytes
  and `evidenceReceipts.insert` refuses a divergent rebuild by name. It is deliberately NOT minted
  inside `terminalizeSuccess` — authority must never depend on a projection to settle a real HR
  transaction, and the two runs this program already produced would otherwise be permanently
  receipt-less. Redaction is declared per field in `src/domain/trust/evidence-classification.ts`
  and an UNDECLARED leaf fails loud: dropping it would make a receipt look complete while hiding
  what the run read. Leaf granularity matches `task-provenance.ts` exactly (an array is one leaf)
  so every fact is dated by a stored `FactProvenance` row instead of a guess, and `evidenceLeaves`
  walks keys SORTED because a stored record round-trips through canonical JSON while an in-memory
  value keeps its authored order — otherwise one run yields two byte-different receipts. Declared
  cross-source obligations (`evidence-obligations.ts`) carry the SERVER's verdict plus the facts it
  compared, so the operator never eyeballs two `last4` identifiers. Two gotchas: putting the
  receipt on the run-detail wire made `src/domain/redaction.ts` browser-reachable and Vite turns an
  externalized `node:*` import into a proxy that throws at module evaluation, so it lost
  `node:crypto`/`node:path`; and a transaction checkpoint's provenance covers the WRAPPER fields
  (`disposition`/`proofSource`/`proof`/`output`), so commit-output leaves are dated through the
  prefix-covering rule rather than an exact path match.
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
