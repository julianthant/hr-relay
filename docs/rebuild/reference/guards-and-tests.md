# 10 — Guards & Tests: the test suite and the guard umbrella

Status: **as-built through 2026-09-02, and normative for the testing tiers R10 ratifies.** Every
guard named here is checked against `docs/rebuild/guard-inventory.json` and
`tests/unit/architecture/` at HEAD, never against this document's own earlier prose (D252). At HEAD
the tree carries **81 inventory entries — 70 active, 9 retired, 2 planned**, exactly 70 files under
`tests/unit/architecture/`, nine executable ratchet arms in
`tests/unit/architecture/helpers/ratchet-arms.ts`, 17 scenario files under `tests/scenario/`, 222
parity reference triples, and a measured `test:coverage` of **87.34 % lines / 85.40 % statements /
89.41 % functions / 76.39 % branches** (28,534 / 33,412 statements). §10 is the normative half:
`tests/` is organized by **what a test needs**, and every test that must RUN a workflow is a live
dry-run scenario.

**Where to start.** §10 if you are writing tests or adding a workflow. §5.1 if you are adding or
retiring a guard. §2 and §3 for what each guard actually holds. §11 is the phase-by-phase activation
ledger — history, kept because "which guard activated when, and what was deliberately NOT activated"
is the record that stops a planned guard being reported as green.

Owns gap-audit (`08`) BLOCKER #2: ratchet port map, safety guards, descriptor projection coverage,
guard inventory, TDD topology, the testing tiers, and the live lane.

## Ownership header (D1)

| | |
|---|---|
| **This doc OWNS** | The test/guard suite: ratchet inventory, strict-boundary/driver/subject/control/delegation/storage guards, transaction/write/outbox/provenance/artifact safety guards, descriptor projection coverage, accidental-shrink meta-test, **the testing tiers and the `tests/` layout (§10)**, the subject registry, the dry-run scenario contract, and the live lane. |
| **Imports (never redefines)** | Task contract / `effect` / `example` / `fakeCtx` / mutation primitive / dry-run overloads — **ref task-contract**. Descriptor shape + `descriptor-coverage.test.ts` §1.4 + run-state/checkpoint/delegation — **ref workflow-model**. Span/event schema + command protocol + storage recovery + notifications + completion and the cross-repo runtime/cutover boundary — **ref dashboard-surfaces**. Worker/session/sleep-budget guards, the worker pool and the Duo ceremony lease — **ref execution-and-sessions**. Receipt/idempotency/fence/subject contract and the dry-run beat order — **ref write-safety**. Clock/config/secrets single-source — **ref clock-config-secrets**. Semantic UI registry, scenarios, evidence, knowledge/fix records, editor projections — **ref operator-trust**. The visual/a11y parity lane's own contract — **ref frontend-backend-integration §7**. |
| **Charter bindings** | "Same quality umbrella from day one"; "fail loud"; §1a fill/submit split is the dry-run safety model. Descriptor SSOT replaces parity lists in the rebuild repo; the legacy repo's own guard tests remain through initial cutover. |

**One-sentence thesis.** ONE place owns *how* every doc's per-§ guard promise lands in
`tests/unit/architecture/`, what each of the nine ported ratchet arms scans, why descriptor
projection coverage replaces parallel parity lists, and — since R10 — **what a test needs in order to
run**, because that is the only split that tells an agent which suites a change must re-run.

---

## 1. The suite today — what the rebuild repo inherits (grounded inventory)

**This section is a dated inventory of what the LEGACY repo had at the split**, kept because §2's
port map is meaningless without it. What the rebuild repo actually carries is §5.1 (the registered
set at HEAD) and §2's as-built block (the nine executable arms). Nothing here is a claim about this
tree.

In the legacy repo, `npm run test:architecture` runs `tests/unit/architecture/**` (dot reporter).
23 guard files today, in four mechanism families. Under D93 the rebuild repo stands up its own
`tests/unit/architecture/**` suite behind its own plain `test:architecture`; §2 is the port map
that says which of these 23 travel and in what form.

- **Grep-ratchets** with a per-file `Record<file,{count,reason}>` allowlist, fail-both-ways (a new
  hit OR a stale over-count): `fail-loud-catch-default`, `wait-for-timeout-allowlist`,
  `inline-selectors-workflows` (extends the base `tests/unit/systems/inline-selectors.test.ts`),
  `nullish-literal-data-fallback`.
- **Registry-parity coverage guards** — side-effect-import the kernel registry (`getAll()`) and diff
  it against a hand-list: `instance-labels-coverage` (vs `INSTANCE_LABELS`), `queue-row-kind-coverage`
  (vs `SUBJECT_TO_KIND`), `archetype-coverage`, `runtime-policy-coverage`. **These exist ONLY because
  of the ~10 parallel registries the rebuild replaces**. The descriptor removes the need to copy
  these lists into the rebuild repo; the legacy guards/lists stay where they are while legacy
  automation is preserved.
- **Structural bans / import-boundary guards** (an exact allowlist or SCC set): `cancel-mechanism`,
  `delegate-to-usage`, `delegate-to-all-impl-callers`, `workflow-boundaries`, `control-layering`,
  `import-cycles` (SCC vs `ALLOWED_CYCLES`), `i9-check-import-guard`, `origin-workflow-banned`,
  `evaluate-named-fn`, `tracker-row-emission` (bans `trackEvent`/`appendFileSync` off the typed emit
  path), `deletion-tombstones`, `dashboard-security-boundary`, `code-conventions` (default-exports /
  filenames / no `.tsx` outside dashboard / console guard), `frontend-tailwind-compliance`.
- **The meta-guard** — `gate-coverage` (2026-07-17): pins the *gates themselves* — `typecheck:all`
  runs BOTH `tsc` programs, `lint --max-warnings 0`, the dashboard tsconfig exists. This is the seed
  of the guard-of-guards manifest (§5), which the rebuild repo re-derives against its own plain
  script family.

Allowlist discipline (verbatim, ported): every survivor is read-in-context with a one-line reason;
a new occurrence fails immediately and needs the same review, never a silent add.

### 1.1 Measured pre-rebuild gate baseline (refreshed 2026-07-31)

<!-- roadmap: p1-base -->

This baseline was executed in the **legacy repo**, after the full plan reread, with a clean worktree
and no rebuild tree present:

| Command | Result | Meaning for the plan |
|---|---|---|
| `npm run typecheck:all` | **PASS** | both existing TypeScript programs are a sound starting toolchain |
| `npm run test` | **PASS — 479 unit files / 4,619 tests; 11 serial files / 20 tests** | existing behavior is green; this does not test proposed rebuild contracts |
| `npm run test:architecture` | **PASS — 23 files / 129 tests** | current guard harness works and can host the new manifest |
| `npm run build:dashboard` | **PASS** | the existing dashboard build toolchain is healthy |
| `npm run lint` | **PASS** | ordinary production source is a green coexistence baseline |
| `npm run lint:tests` | **FAIL — 1,344 errors / 2 warnings** | pre-existing test debt must be fingerprinted/no-new-debt; new rebuild tests remain zero-debt |

The last result forbids two dishonest shortcuts: Phase 1 cannot claim the whole repository was
green, and it cannot weaken ESLint or dump broad exceptions into a new-code allowlist. Item
1a creates a machine baseline for **legacy test files only**, keyed by normalized repo-relative file,
rule id, message id/text, start/end column, and SHA-256 of the diagnostic source line. The ratchet fails on any new
fingerprint even if another diagnostic disappears, while removals are accepted and shrink the
manifest. A touched legacy test file may preserve pre-existing fingerprints on untouched lines but
may not add or replace a diagnostic; a count-only “one out, one in” swap cannot pass. Every legacy
maintenance change is also mapped to the capability and rebuild evidence it may invalidate (D90).

**D93 re-addressing.** The rebuild repo's own plain `npm run lint` targets its `src/**` and
`tests/**`, resolves to non-empty file sets, and runs with `--max-warnings 0` plus **no debt
manifest** — zero-debt from its first file. The split `lint:rebuild` / `lint:rebuild-tests` names
and the "absent tree is a planned state, present-but-empty fails" activation dance are **retired by
D93**: the rebuild repo's roots exist from its first commit, so an arm activates with the first file
in its target family and every active arm must still resolve a non-empty set (§5 #4). Everything in
the table above stays a **legacy-repo** obligation: its ordinary `npm run lint` returns green during
coexistence, its projects remain runnable through initial cutover, and its fingerprint manifest may
remain non-zero — deleted only in a separately authorized retirement after reaching zero. Until then
the legacy repo's `lint:legacy-tests-ratchet` is the truthful coexistence gate, not a false claim
that `npm run lint:tests` passes.

---

## 2. Ratchet port map

<!-- roadmap: p1-base -->

<!-- roadmap-status: p1-base -->
- [x] the nine ratchet arms exist and are executable — each run over the real tree AND its own violating fixture by `guard-manifest` (§2.1, `tests/unit/architecture/helpers/ratchet-arms.ts`)
- [x] the reviewed guard inventory is the machine SSOT and matches `tests/unit/architecture/` by `deepEqual`, both directions (§5)
- [x] zero per-file allowlists — the legacy `Record<file,{count,reason}>` shape did not travel
- [ ] two port-map invariants are held by nothing named: `cancel-mechanism` (one-mechanism cancel) and `tracker-row-emission` (no arm bans an `appendFileSync` to the event JSONL outside the emitter) — §2.1 and §5.1's open list
> 2026-08-20 | docs-cohesion ref guards-and-tests | verified against `helpers/ratchet-arms.ts`, `guard-manifest.test.ts` and `guard-inventory.json` at HEAD — 9 arms, 75 entries (65 active / 8 retired / 2 planned); left: the two unheld invariants, written down rather than implied
<!-- /roadmap-status -->

Each existing guard's fate. **Every fail-loud ratchet must cover the rebuild tree from day one**
(charter): ported grep-ratchets are re-homed into the rebuild repo's own suite scanning its `src/**`,
with a **ZERO allowlist for new rebuild code** and shrink-only entries for verbatim-ported leaves.
They are activated atomically with the first file in their target family; every active scan must
prove its resolved file set is non-empty.

**Read "EXTEND" as "PORT + re-address" (D93).** These fates were written when both trees shared one
repository, so "EXTEND" meant "add `temp_src/**` to the existing guard's glob." With the rebuild in
its own repository, the same fate means: the rebuild repo carries its own copy of the arm, scanning
its `src/**`, while the legacy repo keeps its arm unchanged over legacy paths. The globs below are
therefore rebuild-repo-relative, and the old absent-tree activation semantics retire with `temp_src`
— the rebuild roots exist from the first commit.

| Today's guard | Fate | How, under the new kernel |
|---|---|---|
| `fail-loud-catch-default` | **PORT (was EXTEND)** | glob `src/**` in the rebuild repo; zero-allowlist for new code. The single most important ratchet — it is what makes ref write-safety's probe safe (a `catch{return notFound}` on an idempotency probe is banned here). |
| `nullish-literal-data-fallback` | **PORT (was EXTEND)** | scan all rebuild `src/**` except dashboard presentation code; zero-allowlist. This ratifies the Step-1a correction—the old five-folder subset silently omitted `base`, `exec`, `events`, `server`, `intake`, and `forms`. |
| `wait-for-timeout-allowlist` | **PORT (was EXTEND)** | glob `src/stores/**` in the rebuild repo; **zero-allowlist new** (ref execution-and-sessions §7 #3); shrink-only ported. Ref execution-and-sessions adds the per-task `sleepMs` budget ratchet beside it. |
| `inline-selectors-workflows` (+ base) | **RE-DERIVE, STRONGER** | task impls may contain neither raw selectors nor Playwright `Page`/`Locator` calls. Selectors are private to `stores/<system>/driver/**`; tasks call typed semantic driver methods (refs task-contract/operator-trust). Driver selector literals must belong to the canonical UI registry entry they implement. |
| `evaluate-named-fn` | **PORT** | glob `src/stores/**` in the rebuild repo; unchanged rule (`__name` in `page.evaluate` still throws live). |
| `import-cycles` | **PORT (was EXTEND)** | SCC over the rebuild repo's `src/`; `ALLOWED_CYCLES` starts empty for the new tree. |
| `control-layering` | **PORT → matrix (was EXTEND)** | absorb gap-audit `08` #9: enforce the full `domain → infra/services/systems → core → control/workflows` direction over the rebuild `src/` (today only the `control` edge is guarded). |
| `code-conventions` | **PORT + FIX MATCHING (was EXTEND)** | same rules over the rebuild `src/` (no default exports, kebab/Pascal filenames, no `.tsx` outside dashboard, console guard). Replace `path.includes(prefix)` exemptions with normalized repo-relative exact roots/segments: today's `/scripts/` exemption must not pre-authorize a future `src/**/scripts/**`. |
| `cancel-mechanism` | **RE-DERIVE** | the one-mechanism invariant re-expressed against ref execution-and-sessions's worker runtime + `runRegistry` successor; still a structural ban on a second cancel path. |
| `delegate-to-usage` / `delegate-to-all-impl-callers` | **RE-DERIVE** | delegation is now workflow-composition (refs task-contract/workflow-model). Re-expressed as "child runs enqueue only via the kernel composition API," but note: peer-to-peer store reuse is now *allowed* (charter §1), so the old "no cross-workflow internal import" shape loosens — see `workflow-boundaries`. |
| `workflow-boundaries` | **RE-DERIVE (loosened)** | charter §1 makes tasks peer-reusable, so importing another workflow's *task contract* is legal. New rule: a workflow may import another's **contracts** and store tasks, never its `descriptor.ts` internals or non-task private helpers. |
| `tracker-row-emission` | **RE-DERIVE** | archetype-stamping is gone; the new invariant is ref dashboard-surfaces's: writes go only through the typed span-emit path, `appendFileSync` to event JSONL banned outside the rebuild repo's `src/tracker/`. |
| `deletion-tombstones` | **PRESERVE LEGACY + RE-DERIVE** | Keep the existing legacy guard unchanged. The rebuild UI exposes reversible `hide/unhide`, never ambiguous Delete; runtime physical delete of authority/audit tables is forbidden and exact-id offline purge requires verified backup + receipt. No lift path exists. |
| `dashboard-security-boundary` | **RE-DERIVE FOR LOCAL SCOPE + ISOLATION** | Both servers bind distinct configured loopback ports and accept only their own same-origin UI. No shared middleware, proxy/remount, route forwarding, state root, process lock, or browser profile/session is allowed; Phase 1 does not build a user/account system (refs dashboard-surfaces/clock-config-secrets/operator-trust/frontend-backend-integration). |
| `frontend-tailwind-compliance` | **PORT (was EXTEND)** | over the rebuild repo's `src/dashboard`. |
| `i9-check-import-guard` | **GENERALIZE** | a descriptor with no transaction/commit contract is structurally read-only; graph coverage proves it cannot reach a mutation capability. |
| `origin-workflow-banned` | **DROP-OR-PORT** | the lineage field it bans does not exist in the rebuild; keep a banned-term guard only if the concept resurfaces. Decide at Phase 1. |
| `archetype-coverage` | **STAYS IN THE LEGACY REPO; rebuild uses descriptor** | The legacy guard remains there through initial cutover; `descriptor.surface.shape` covers the rebuild. |
| `runtime-policy-coverage` | **STAYS IN THE LEGACY REPO; rebuild uses descriptor** | The legacy guard remains there; rebuild shape/actions/gates derive from the descriptor. |
| `instance-labels-coverage` + `INSTANCE_LABELS` | **STAYS IN THE LEGACY REPO; rebuild uses descriptor** | Guard/list remain in the legacy repo; rebuild label = `descriptor.sessionLabel ?? label`. |
| `queue-row-kind-coverage` + `SUBJECT_TO_KIND` | **STAYS IN THE LEGACY REPO; rebuild uses descriptor** | Guard/list remain in the legacy repo; rebuild kind derives from `descriptor.inputSubject`. |
| `gate-coverage` (meta) | **PORT + RE-DERIVE (was KEEP + EXTEND)** | becomes the rebuild repo's guard-of-guards manifest (§5) over its plain script family: also asserts `test:architecture` still globs the rebuild `src/`, each activated arm resolves ≥1 file, ESLint's command *and actual config* cover `src/` and `tests/`, and every named guard file exists + is registered. |
| `inline-selectors-workflows` — the DRIVER half | **SCOPE DECISION, 2026-08-14** | see the note below the table: the arm stays `/tasks/`-scoped, and the driver-side invariant is relocated to a declared anchor table rather than widened into a ratchet that would fire on the registry interpreters. |
| — | **NEW** | `descriptor-coverage`, `strict-boundary-schemas`, `semantic-ui-registry`, `task-driver-boundary`, `subject-before-fence`, `scenario-coverage`, `control-command-single-path`, `authority-target-no-fallback`, `delegation-manifest`, `storage-recovery`, `notification-durability`, `evidence-receipt`, `knowledge-fix-integrity`, `workflow-editor-compile-integrity`, `legacy-capability-disposition`, `capture-durability-and-scope`, `ai-advisory-no-authority`, `preflight-coverage`, `dry-run-composition-submit-free`, `transaction-pairing`, `write-safety-contract`, `commit-routes-through-mutation`, `no-positional-identity`, atomic-outbox/ledger guards, `clock-single-source`. |

#### 2.1 As-built — the nine arms that landed, and the fates that did not

**Nine arms exist, and they are executable.** `tests/unit/architecture/helpers/ratchet-arms.ts`
declares exactly the set `guard-inventory.json`'s `rebuildRatchetActivation.requiredGuardNames`
names, and `guard-manifest.test.ts` runs each one twice — once over the real tree (where an `active`
arm resolving an empty file set FAILS) and once over a per-arm violating fixture materialized into a
fresh temp root (where the arm must report `active`, resolve files, and produce a violation matching
that fixture's expected pattern). A dead arm therefore cannot stand in for enforcement:

| arm | roots it scans | what it forbids |
|---|---|---|
| `fail-loud-catch-default` | `src` | a `catch` block (or a promise `.catch`) that returns/assigns/initializes a bare default — `null`, `true`, `false`, `undefined`, `0`, `""`, `[]`, `{}` — instead of propagating |
| `nullish-literal-data-fallback` | `src`, minus `src/dashboard/` | `??` whose left root is a data-shaped identifier (`data`, `row`, `input`, `item`, `entry`, `record`, `payload`, `fields`, `opts`, `args`) and whose right side is a literal string, `0` or `true` |
| `wait-for-timeout-allowlist` | `src/stores` | any `.waitForTimeout(...)` call |
| `inline-selectors-workflows` | `src/stores`, files whose path contains `/tasks/` | raw `page.locator/getByRole/getByText/getByLabel/getByTestId/frameLocator` calls and raw `Page`/`Locator` type references in a task impl |
| `evaluate-named-fn` | `src/stores` | a NAMED function expression passed to `.evaluate()`/`.evaluateAll()` (`__name` still throws live) |
| `import-cycles` | `src` | any cycle among relatively-resolved source modules; there is no `ALLOWED_CYCLES` set |
| `control-layering` | `src` | a lower layer value-importing a higher one, over the fixed map `domain(0) < {infra, services, systems, stores}(1) < core(2) < {control, workflows, server}(3)` |
| `code-conventions` | `src` | a raw control byte, a non-kebab filename outside `src/dashboard/`, a `.tsx` outside `src/dashboard/`, `export default`, any `console.*` |
| `frontend-tailwind-compliance` | `src/dashboard` | a palette colour utility or raw hex, an `<img>` without `alt`/`loading`, `@keyframes`, a raw `animation:`, an arbitrary `animate-[…]`, an unguarded `animate-spin/pulse/ping/bounce`, an arbitrary `z-[…]` outside `dsLayer`, `flex-shrink-0` |

**There is no per-file allowlist in any of them.** The table above is the whole rule; the legacy
`Record<file,{count,reason}>` shape did not travel, which is the strongest possible reading of "zero
allowlist for new rebuild code" and is why §8 row 1's residual risk is smaller here than the entry
describes.

**Seven port-map fates did NOT land as named guards, and saying so is the point of this block.**
None of `cancel-mechanism`, `delegate-to-usage`, `delegate-to-all-impl-callers`,
`workflow-boundaries`, `tracker-row-emission`, `deletion-tombstones` or `dashboard-security-boundary`
exists in `tests/`, in `src/`, or in the inventory; `i9-check-import-guard` generalized into
`descriptor-coverage` as the table says, and `origin-workflow-banned` was dropped because the lineage
field it banned does not exist here. Where each invariant is held today, verified against the tree:

| port-map fate | as-built |
|---|---|
| `delegate-to-usage` / `delegate-to-all-impl-callers` | held by `delegation-manifest` — child runs exist only as typed descriptor nodes with declared cardinality/join/failure/cancel policies |
| `workflow-boundaries` | held structurally by `descriptor-coverage`'s bundle-safety walk (a descriptor's value-import closure may leave `src/domain/`, `src/base/`, `src/validation/` only) plus the `control-layering` arm |
| `deletion-tombstones` | held by `archive-invariants` and the v13 archive tables, which abort `UPDATE` and `DELETE` **in SQL** |
| `dashboard-security-boundary` | split across `operational-isolation` (ports, roots, locks, profiles) and `dashboard-wire-boundary` (no Node built-in reachable from the bundle); D294 retires the former phone-route arm |
| `cancel-mechanism` | **NOT held by a named guard.** `control-command-single-path` proves authority is mutated only through the D67 command family, which makes a second cancel path unable to reach authority — but nothing asserts one-mechanism directly. Open; see §5.1's open list. |
| `tracker-row-emission` | **NOT held by a named guard.** The typed span-emit path is the only writer in practice (D218 deleted the `onEvent` hook), and `code-conventions` bans `console.*`, but no arm bans an `appendFileSync` to the event JSONL outside the emitter. Open; see §5.1's open list. |

#### The driver half of `inline-selectors` — a scope decision, not an oversight

<!-- roadmap: p1-authority -->

**Decided 2026-08-14.** The row above wants "driver selector literals must belong to the canonical UI
registry entry they implement", and the obvious way to get it is to widen the arm's `select` from
`/tasks/` to a store's `driver` directory. **The survey that question demands says no.** A driver's
registry INTERPRETER is built out of `page.locator(recipe.selector)` — that is how a recipe becomes a
locator, and `crm/driver/interpreter.ts`, `kuali/driver/interpreter.ts`,
`new-kronos/driver/interpreter.ts` and `ucpath/driver/registry-locators.ts` all do exactly it — so a
widened arm would fire on the mechanism it exists to enforce, alongside every legitimate structural
bind (`:scope > td`, `row.locator("tr")`, `page.locator("body")`). Widening it and then allowlisting
those files back is strictly worse than not widening it: the allowlist would be the real rule, and it
would be a per-file count nobody reads.

**Where the invariant went instead.** A store driver resolves through the registry wherever a
registry element covers the anchor, and every remaining anchor is declared **once**, in a named
table, with the reason it cannot be a registry element. That reason is structural rather than
discretionary: `ElementDefinitionSchema` requires `provenance: LegacySelectorProvenanceSchema`, so a
control **legacy has no key for** cannot become a registry element without a fabricated provenance —
the exact thing `semantic-ui-registry` exists to refuse. `src/stores/ucpath/driver/smart-hr-operation.ts`'s
`DRIVER_ANCHOR` is the worked example.

**What actually failed here was a claim, not a missing ratchet.** That module's header asserted every
anchor was registry-pinned with dual evidence while binding eight of them as bare strings at the call
site, and nothing could see the contradiction because the arm does not reach the file. A declared
table cannot make that claim without also showing its exceptions, which is the property being bought.
The trigger that would revisit this: an arm that can distinguish a recipe-driven `locator(...)` from
an authored literal — at which point the driver directory becomes enforceable without an allowlist.

---

## 3. The safety guards

<!-- roadmap: p1-authority -->

<!-- roadmap-status: p1-authority -->
- [x] the safety-guard core is active: strict boundary schemas, the semantic UI registry, the task/driver boundary, canonical-input snapshot, selector port provenance, `descriptor-coverage` (§3.8, §4)
- [x] `no-positional-identity`, `transaction-pairing`, `permanent-key-dedupe`, `recovery-negative-proof-settlement`, `atomic-write-outbox` all active with violating fixtures
- [x] D71's type proof exists as `tests/types/{task-contracts,flow-graph}.typecheck.ts` inside the one `tsc` program — a 21-node real-scale graph plus `@ts-expect-error` controls (§3.12 as-built)
- [ ] D71's BUDGET half is unmeasured — nothing runs `tsc --extendedDiagnostics` against that graph, so the 5 s / 1 GiB acceptance value is unenforced (§3.12)
> 2026-08-20 | docs-cohesion ref guards-and-tests | verified against the 65 active inventory entries and `tests/types/`; left: the type-budget measurement, and §3.1/§3.6's retirements are recorded in the sections themselves
<!-- /roadmap-status -->

Each guard below keys off a **closed union** (the contract `effect`, the sealed mutation-primitive
registry, the descriptor node list) — never a text heuristic — so it cannot false-positive on prose.
The subsections were written as a specification and are kept in their original numbering because
other docs cite them; each now states **as-built** what actually enforces it at HEAD, and three of
them (§3.1, §3.6, §3.9's `authority-target-no-fallback`) record a guard **retired by D188** because
a stronger executable check already held the invariant. A retirement is an inventory entry naming
the successor, never a silent shrink (§5).

### 3.1 `dry-run-composition-submit-free` — charter §1a as a static invariant (RETIRED by D188)

<!-- roadmap: p2-proof -->

**RETIRED 2026-08-09 (D188), replaced by `write-safety-contract` plus the executable
`separations-kuali-finalization/dry-run-preview` scenario.** The retirement is recorded in
`guard-inventory.json` with that successor named. The argument is the one this program applies
everywhere: the retired guard would have inspected a *composition* for a missing call, while the
successor asserts **durable absence** — zero `write_intents`, zero `write_attempts`, zero
`durable_outbox`, zero fence — over the real sequencer and a real database. Ordinary upstream task
`run_checkpoints` do exist and are required to reach that preview boundary; they are not write
evidence. A run that minted no write authority or output is a stronger fact than a graph that
contains no commit node. §10.4 makes that assertion the standing shape of every dry-run scenario
rather than one workflow's fixture.

The normative text below is unchanged and still describes what a dry-run composition must be; what
moved is only which file proves it.

**Thesis: a workflow's dry-run composition provably contains NO reachable submit — the dangerous
action is *absent by construction*, not skipped by a branch.**

For every descriptor, compile the executable graph with `RunEnvelope.dryRun=true`. Assert:
1. each reachable transaction becomes a preview containing its prepare arm only;
2. zero commit contracts, mutation capabilities, fences, or mutation-helper imports are reachable;
3. `dryRun:"unsupported"` transactions fail planning before browser launch; and
4. downstream continuation is legal only when it has no dependency on commit output.

Mutation helpers require a commit-only capability, so the runtime type boundary backs the graph
proof. The live lane asserts prepare spans/preview evidence exist while commit spans/intents do not.

### 3.2 `transaction-pairing.test.ts` — prepare and commit share one lease scope

<!-- roadmap: p1-authority -->

**Thesis: every real submit has a paired fill; you cannot compose a submit whose fill is absent.**

Every prepare contract appears only in `transaction.prepare`; every commit only in
`transaction.commit`. The pair uses one system and one transaction-scoped lease, has no
checkpoint/gate between arms, binds commit input only from workflow input+declared upstream outputs
(never prepare output), and exposes only commit output downstream. There is no atomic-write
allowlist: a one-click write uses a no-op prepare so dry-run still has an honest preview.
Prepare/commit impls have no task-local retry; an optional transaction retry may rerun the whole
preflight+prepare on a reset lease only before a write intent exists. Runtime fixtures prove the
live probe uses/releases a read lease before transaction acquisition, `probeToFenceMaxMs` is
positive, expiry or a lost fence CAS discards staged state with zero clicks, and cleanup/reset never
occurs between prepare and commit.

### 3.3 `write-safety-contract.test.ts` — completion union + fenced, evidence-qualified recovery (HOSTS ref write-safety's guard)

<!-- roadmap: p1-kernel -->

<!-- roadmap-status: p1-kernel -->
- [x] `write-safety-contract` is active and now also carries the retired `dry-run-composition-submit-free`'s invariant, asserted as DURABLE ABSENCE over a real database rather than as a missing call in a composition (D188)
- [x] `control-command-single-path` proves the dispatcher is exhaustive across family AND action; `command-result-exhaustive` (D253) adds the refusal-arm half
> 2026-08-20 | docs-cohesion ref guards-and-tests | verified against `guard-inventory.json` and §11's Phase 1f boundary; left: nothing in this doc's scope
<!-- /roadmap-status -->

**Thesis:** every `effect:"commit"` contract has write safety; no escape hatch. Every completion
arm—receipt/save/upload—has a nontrivial `proofSchema`, normal-output extractor, recovery-probe
extractor, `outputFromProof` reconstruction, and same-store live probe.

- `receipt` (UCPath / ServiceNow) — a non-empty proof schema. Unit-pinned: a commit returning success with proof
  failing its schema throws.
- `save-verify` / `upload-verify` — a read task returning `ProbeVerdict` plus a typed state/artifact
  proof schema. These satisfy the guard without a confirmation number,
  demanding a `receipt` of them would be a guard bug (a type-level test pins that). They still can't
  pass without *earning* a post-submit read-back that doesn't exist today — so the guard forces doc
  09's one genuine addition rather than waving them through.
- `upload-verify` carrying **`unverifiableByPage`** — legal ONLY with an allowlist + `{ reason }`
  entry (§3.5) and a guard-parsed operator-attestation proof example; the submit then always-parks,
  never auto-`done`.

The crash-recovery fixture injects `write.attempting`-without-`write.committed` and asserts: the probe
re-runs FIRST (probe-then-park, D17); a `present` receipt and reconstructed transaction output are
schema-validated before backfill (D19);
one early/bare `absent` cannot authorize a retry; only D64/D69 schema-valid same-key negative evidence
whose **every counted observation** was captured after the propagation window and clears the
repeated-read policy may mark retryable, while
inconsistent/malformed/`operator-only` absence parks; and simultaneous **or later sequential**
same-key runs cannot create a second fence. Crash
injection proves intent/checkpoint/ledger-outbox/span-outbox atomicity. Parked-write fixtures prove
generic Done/Retry is absent; present proof uses the same parser/atomic commit, absent evidence is
intent-generation/version locked, and stale/double-click resolution changes nothing. A preflight
live `present` fixture atomically records `observed-present` + an `already-present` transaction
outcome but asserts zero write-ledger outboxes, so observation cannot masquerade as filing.

### 3.4 `no-positional-identity.test.ts` — items/checkpoints keyed by stable id, never index

<!-- roadmap: p1-authority -->

**Thesis (the docs-1/2 invariant): identity is a stable key, never an array position.** A row keyed
by index silently binds the wrong person when the list reorders — the class of the real wrong-person
incident. Guard: ban `members[<int>]` / `items[<int>]` / `checkpoints[<int>]`-style positional lookups
as a row/checkpoint **identity** in the rebuild repo's `src/{core,workflows,stores,tracker}/**` (iteration is fine;
using the index as the persisted key is not). Structurally reinforces ref workflow-model's `(workflow, item_id)`
logical key (D9) and ref dashboard-surfaces's `(runId, attempt, spanPath)` span identity (D10) — both are id-keyed.

### 3.5 `unverifiableByPage` requires an allowlist + reason (D22 — closes the verify escape hatch)


- [x] the `unverifiableByPage` escape hatch is enforced at CONTRACT SEAL time — `src/domain/contracts/base.ts:406-416` against `REVIEWED_UNVERIFIABLE_BY_PAGE_POLICY`, proved by a fixture contract (§3.5 as-built)
- [ ] the reviewed policy table is EMPTY, so the reverse arm (a stale row whose contract dropped the flag) has nothing to find and nothing audits it — OnBase's migration is what makes it necessary
> 2026-08-20 | docs-cohesion ref guards-and-tests | verified against `src/domain/contracts/write-safety.ts:130` (`contracts: []`) and `tests/unit/task-contracts.test.ts:296`

Ref write-safety's `upload-verify.unverifiableByPage` is the one place a commit contract may declare "this page
genuinely cannot prove landing" and fall to always-park. Left unguarded it is a silent escape from
proof-of-landing (review 09 #5). Ratchet: any `completion` carrying `unverifiableByPage` MUST have a
matching `Record<contractId, { reason }>` allowlist entry and its
`operatorAttestationExample` MUST parse the proof schema's operator-attestation arm, fail-both-ways: a
new `unverifiableByPage` with no argued entry fails, and a stale entry whose contract dropped the
flag fails the reverse. "We can't verify this write" becomes a reviewed, enumerated decision, never a
quiet default — today only OnBase is a candidate, and it must earn its line.

**AS-BUILT 2026-08-20 — the enforcement point is the contract SEALER, and the allowlist is empty.**
`defineTaskContract` refuses at seal time (`src/domain/contracts/base.ts:406-416`): an
`upload-verify` completion carrying `unverifiableByPage` must appear in
`REVIEWED_UNVERIFIABLE_BY_PAGE_POLICY` (`src/domain/contracts/write-safety.ts:130`) **with the same
reason string**, and its `operatorAttestationExample` must parse the completion's own proof schema
into an `operator-attestation` arm. `REVIEWED_UNVERIFIABLE_BY_PAGE_POLICY.contracts` is `[]` — no
shipped contract claims the flag — so the arm is proved by a fixture contract in
`tests/unit/task-contracts.test.ts:296` rather than by a production subject. Sealing is strictly
stronger than a ratchet here, because a scan can be out-scoped and a seal cannot: the contract does
not exist unless the check passed. What a seal cannot see is the reverse direction §3.5 asks for — a
policy row whose contract has dropped the flag — and nothing audits that today, because an empty
table has no stale rows to find. The first entry is what makes that arm necessary; it lands with
`order-7`'s OnBase migration.

### 3.6 `commit-routes-through-mutation` (D22 — closes the fence-bypass overclaim) (RETIRED by D188)

<!-- roadmap: p2-proof -->

<!-- roadmap-status: p2-proof -->
- [x] the controlled-commit proof is RECORDED, not re-runnable — `reference/write-safety.md` §Phase-2 controlled-commit as-built is the citation, and re-running it would be a second real HR write (§10.1)
- [x] `commit-routes-through-mutation` RETIRED by D188 → `task-driver-boundary`, which refuses a `commit` outside a capability-validating store driver against a violating fixture, over a WeakSet-unforgeable capability (D127)
> 2026-08-20 | docs-cohesion ref guards-and-tests | verified against the inventory's retired set and `src/base/mutation-capability.ts`; each workflow still owes its own controlled-commit proof at its migration
<!-- /roadmap-status -->

**RETIRED 2026-08-09 (D188), replaced by `task-driver-boundary`.** That guard already refuses a
`commit` implementation outside a capability-validating store driver, **against a violating
fixture**, over a `MutationCapability` that is runtime-unforgeable by module-private WeakSet (D127) —
so the routing is a type-and-runtime fact rather than an import-graph inference. The mint boundary
itself is held by `write-sequencer.ts` being the only permitted minting caller
(`src/base/mutation-capability.ts`), which `task-driver-boundary` and `driver-lease-boundary`
allowlist by exact path. The text below stays as the statement of the invariant.


Ref write-safety's fence-before-click is only "unbypassable" if every real submit actually goes through the
sealed `stores/common/mutation.ts` primitive, which requires the open-intent capability. A leaf
could otherwise fire a raw click. Ratchet: every `effect:"commit"` impl must route its transaction
action through the mutation module—an import/capability graph check. Driver methods capable of a
click/press-class external submit require that capability in their public signature and reach the
sealed primitive internally; a commit impl or driver reaching such an action without it fails. This
complements the raw-page boundary (§2): raw clicks live only in driver internals, and external-write
clicks additionally require the one fenced choke point. Together they make ref write-safety's
"fence-before-click is unbypassable" a structural fact.

### 3.7 `artifact-effect-boundary.test.ts` — downloads are immutable; mutable files are projections

<!-- roadmap: p2-2h -->

<!-- roadmap-status: p2-2h -->
- [x] `artifact-effect-boundary` is active: the path-free content-addressed ref, the temp→fsync→atomic-rename sequence, crash-boundary recovery, byte-identical idempotency, and an AST canary against direct mutable filesystem access from a task impl
> 2026-08-20 | docs-cohesion ref guards-and-tests | verified against the inventory; the download-bearing workflows that will exercise it are `order-2`
<!-- /roadmap-status -->

- [x] the guard the download workflows land on already exists — `artifact-effect-boundary` (§3.7), so a browser download is structurally immutable before the first of them is written
- [ ] the T1 pair for each of `crm-doc-download` / `sharepoint-download` / `old-kronos-reports` (§10.11)
> 2026-08-20 | docs-cohesion ref guards-and-tests | guard side verified against the inventory; the migration's own tests are §10.11's checklist, unwritten

Read contracts that materialize bytes must declare `artifacts:"content-addressed"`; only the kernel
writer may be reachable from their impl import graph. Direct filesystem write/append imports in task
impls fail, and workflow mini-stores cannot declare artifacts. Descriptor artifact projections are
validated against exact producing node/field and stable non-positional key paths. Fixtures prove
checkpoint+outbox atomicity, duplicate-delivery idempotence, one active projector per sink,
head-hash conflict parking without overwrite, and that `blocking:true` prevents terminal done until
projection acknowledgement. This keeps i9's workbook update from being mislabeled as a retryable
read while still permitting replay-safe browser downloads.

### 3.8 Strict schemas + semantic driver/UI registry

<!-- roadmap: p1-base -->
<!-- roadmap: p1-authority -->

- **`strict-boundary-schemas.test.ts`.** Enumerate every external/durable boundary export (workflow
  input/result, task input/output, run envelope, checkpoint, command, event/note, SSE wire,
  settings, intake, artifact, evidence/failure, notification, knowledge/fix). Each must expose a zod
  schema and infer its TypeScript type from that schema. Object schemas are strict; discriminated
  unions are exhaustive; unknown keys fail. AST guards reject exported persistence/wire interfaces
  with no schema, decision-bearing `Record<string,unknown|JsonValue>`, `any`, unchecked `as`, and
  catch/default parsing at these seams. Runtime corruption fixtures exercise JSONL, SQLite, HTTP,
  SSE, and config reads.
- **`canonical-input-snapshot.test.ts`.** Ingress input applies defaults/coercions/transforms once;
  the stored canonical value round-trips through the descriptor's validation-only `canonicalInput`
  schema on every DB/resume read. A deliberately non-idempotent transform proves resume does not
  reapply it; a corrupted stored value proves validation is not skipped (D62).
- **`semantic-ui-registry.test.ts`.** Every driver action/observation/page-state dependency resolves
  to one same-system canonical registry id. IDs are unique; search terms never create identity;
  `supersedes` references resolve without cycles. Entries have owner/intent/state/selector-strategy/
  verification metadata and scenario refs. Generated `UI-CATALOG.md` must match the registry.
  Removed ids require an explicit `supersedes` migration that updates all dependents—never a second
  name for the same element.
- **`task-driver-boundary.test.ts`.** Task/workflow modules cannot import Playwright types, driver
  internals, selector registry implementation, or call `locator/newPage/evaluate` directly. Public
  driver signatures reject selector strings, Page, Locator, and untyped maps; they expose domain
  inputs/outputs and semantic ids. Driver internals remain the sole allowlisted raw-page area.

### 3.9 Subject binding, control commands, and delegation

<!-- roadmap: p1-kernel -->

- [x] `delegation-manifest` is active and carries the retired `delegate-to-usage` / `delegate-to-all-impl-callers` invariants (§2.1): stable edge/item ids, concrete schemas, explicit cardinality/join/failure/cancel/retry policies, an atomic immutable manifest
- [ ] the T1 pair for the delegating workflow, whose structural scenario must walk the fan-out at each declared cardinality (§10.11 step 2)
> 2026-08-20 | docs-cohesion ref guards-and-tests | guard side verified against the inventory; no landed descriptor delegates yet, so the scenario matrix has no production subject

- **`subject-before-fence.test.ts`.** Every prepare/commit contract has compatible subject specs;
  every write observation resolves to a driver operation. A transaction trace must order
  prepare-end < fresh subject-match < fence-commit < mutation-call on the same lease/run/attempt.
  Mismatch, unknown, missing/stale observation, navigation after proof, or changed attempt produces
  zero fence/click and a structured failure/evidence bundle. Alternating-EID pooled-page and
  file-digest mismatch scenarios are mandatory. A commit with `subject.kind:"none"` instead needs
  a fail-both-ways allowlisted reason and exact staged-page-state `UnscopedBindingProof`; every
  mutation capability is bound to one `WriteBindingProof` digest, never an empty subject placeholder.
- **`control-command-single-path.test.ts`.** Dashboard/CLI/gate/recovery/notification/capture
modules can mutate authority only through ref dashboard-surfaces's D67 command family. Command ids are idempotent
and target versions are carried on every wire arm; CAS is checked only for cancel-tree,
edit-vs-resume, gate resolution, and write-recovery races. Hide is presentation-only; runtime
physical deletes and UI label `Delete` fail. Enqueue
policies get transaction/concurrency fixtures, including an injected active-run lookup error that
must create zero new runs. Coverage is bidirectional over every mutating route/action; typed gate
results parse the descriptor result schema and store a checkpoint/ref, notification commands are
limited to read/unread/snooze, and capture mutation cannot target a run id.
Journal and audit writes remain kernel-only. D331's settings-runtime and copied-backup authenticators
may only perform their exact registered `commandAudits.findByCommand` reads (two and three respectively);
new readers, any other audit method, or any write outside the kernel fails the guard.
  The runtime dispatcher is exhaustive across family **and action**. In Phase 1f the active
  start/worker-browser/run/gate/write-resolution actions execute, `run/edit-checkpoint` and every
  later family/action return `rejected:capability-unavailable` with zero authority-generation
  advance, and an unhandled/throwing “not implemented” arm fails the guard.
  **D334 successor, assigned to 1.6.4:** `run/edit-checkpoint` leaves the product command registry
  entirely; source-bound Rerun may only produce a confirmed start plan and a new service-owned
  run. The implementation candidate retires `edit-data-field-policy` in
  `guard-inventory.json` with `retiredBy: D334`, replaces it with the active
  `rerun-prefill-boundary` guard, and proves both the retired command's absence and the replacement's
  descriptor/source/version/value-provenance closure against violating fixtures. D335 extends this
  boundary to exact warned-confirmation acknowledgment and source-bound execution: a generic force
  flag, stale warning digest, inherited transaction proof, or completion-history veto must fail its
  assigned proof. Keep ordinary/internal compatibility recovery proofs separate and unchanged.
  The manifest change
  and deciding red/green evidence land with the code, not in this documentation-only decision commit.
- **`authority-target-no-fallback` — RETIRED 2026-08-09 (D188), replaced by `storage-recovery`.**
  The invariant is unchanged and is held one layer down: `open` REFUSES an existing-but-empty file by
  name, read-only inspect refuses any non-exact schema, and the corrupt / truncated / newer /
  foreign-key-invalid / invariant-invalid / record-invalid family all degrade **read-only with zero
  bytes written**. A caller cannot be handed a fallback root because an unusable database is never
  opened as a usable one. The original text: cancel/cascade/retry/bump resolve exact targets and
  dependency trees from SQLite; fixtures make the DB unavailable/inconsistent and pass tempting
  caller-visible roots; the expected result is zero transitions + typed error, never a fallback.
- **`delegation-manifest.test.ts`.** Every child-run has stable edge/item ids, concrete input/result
  schemas, explicit cardinality/join/failure/cancel/retry/visibility policies, and an atomic immutable
  manifest. Scenario matrix covers zero/one/many, duplicate replay, partial failure, all vs
  all-settled, cascade/independent cancel, child retry, parent resume, and two distinct edges.

### 3.10 Trust surfaces: storage recovery, scenarios, evidence, and notifications

<!-- roadmap: p2-2j -->
<!-- roadmap: p2-2g -->

<!-- roadmap-status: p2-2g -->
- [x] the trust-surface guards are active: `migration-history-immutability`, `storage-recovery`, `scenario-coverage`, `evidence-receipt`, `notification-durability`, `knowledge-fix-integrity`, `workflow-editor-compile-integrity`
- [x] D185's corpus-layout audit closes the direction the registered-set audits were blind to — a file of neither kind, an unregistered claim, a manifest row nothing executes (§3.10 as-built)
> 2026-08-20 | docs-cohesion ref guards-and-tests | verified against `guard-inventory.json` and `src/domain/workflow/scenario-execution.ts`; §10.9 extends the same audit across the per-workflow folders
<!-- /roadmap-status -->

- **`migration-history-immutability.test.ts`.** Every released authority migration is pinned by a
  literal SHA-256 over its version and length-framed ordered statement bytes. The pinned version
  list also fixes migration count and order. A schema change appends a new version and reviewed
  digest; it never edits or reorders history. Canary fixtures prove that metadata changes,
  statement edits, insertion, deletion, and reordering all change the digest.
  D290 (ref dashboard-surfaces §2.4) is the one approved integration-only exception after the
  common v18 for the conflicting remaining-worktree suffixes. It preserves original
  commits/SQL/digests, pins the reviewed integrated sequence, proves fresh/v18 upgrade and refuses
  divergent existing suffixes. It is not permission to recompute any other released digest or
  convert a real database.
- **`storage-recovery.test.ts`.** Boot quick-check/invariants fail closed into read-only degraded
  mode. The infra-owned authority adapter retains `DatabaseSync` privately and proves
  `node:sqlite.backup` works without exposing the handle to repositories. Online backups are
  checksummed/manifests verified; schema/page count/authority generation are read from the completed
  backup itself, and a trigger newer than an in-flight copy causes one follow-up backup. Tests ban
  live-WAL file copy/`VACUUM INTO` fallback. Every registered authority repository mutation
  increments `authority_generation` exactly once per outer transaction; projection-only changes do
  not, and adding an authority table without generation coverage fails. A restore drill corrupts a copied
  real-shaped DB, restores the newest verified backup, rebuilds projections only, and proves
  commands/dependencies/checkpoints/write-intents/outboxes survive. No code path creates a fresh
  empty authority DB over an invalid existing file.
- **`scenario-coverage.test.ts`.** Descriptor/task/UI entries reference real, unique, strict
  `ScenarioManifest`s. The production execution manifest is independent of descriptor/contract
  references, and the observed side is derived from the named executable test files rather than
  either declaration list. Typo references, orphan rows, duplicate ids, and registered scenarios
  with no executable declaration are proven failing fixtures. Every task has happy/empty or
  no-match/schema-failure/transient/permanent
  coverage as applicable; every write has subject/proof/crash cases; every branch/delegation/gate
  arm is covered. A production bug fix cannot close without a regression scenario id in its
  `FixRecord`. Orphaned, stale-fingerprint, and never-executed scenarios fail.

  **AS-BUILT 2026-08-09 (D185) — the corpus has exactly TWO kinds, and the directory is guarded.**
  Everything above audits the REGISTERED set, which means it is structurally blind to the corpus as
  a *directory*: a `tests/scenario/*.scenario.test.ts` that nothing registers, and an `it` inside a
  registered file naming an id nobody registered, are invisible to all three of its directions.
  That was not hypothetical — `person-lookup/ucpath-drill-subject-mismatch` had been executing
  unregistered since it landed, and was registered against `ucpath/search-person-org` (mirroring
  `person-lookup/crm-subject-mismatch` on the CRM read contracts) as part of this decision.

  The two kinds are:

  - a **graph scenario**, `<name>.scenario.test.ts`, which walks ONE declared path of ONE descriptor
    and claims the coverage points it exercised. Every id it declares is either an
    `EXECUTABLE_SCENARIO_MANIFEST` row naming *that* file, or — for a fixture descriptor with no
    production reference to be registered against — an id in `tests/scenario/coverage-claims.ts`;
  - an **integration walk**, `<name>.walk.test.ts`, which crosses SLICES rather than following one
    graph. It therefore claims no coverage point and carries no manifest row (the manifest's own
    `file` regex refuses a walk path outright), and it exists for the joins only composition can
    falsify.

  `auditScenarioCorpusLayout` (in `src/domain/workflow/scenario-execution.ts`, pure over an injected
  listing so it can be proved against corpora it will never find on disk) closes both directions: a
  file of neither kind, a graph scenario that claims nothing, an empty file, a duplicate listing, an
  unregistered id, an id declared in a file its row does not name, a manifest row nothing executes,
  a manifest row naming an absent file, and a walk that claims a graph path are each refused BY
  NAME, and each has a negative control that moves exactly one thing in the REAL corpus. The
  recogniser is the corpus's existing convention made mechanical: an `it` title whose head (before
  `" — "`) parses as a `ScenarioId` is a CLAIM. A typo is slug-shaped, so it stays a claim and
  FAILS — reclassifying an unrecognised id as prose is precisely how the drift above survived.

  **What an integration walk is for, and what it may not do.** `tests/scenario/operator-lifecycle.walk.test.ts`
  is the first: spreadsheet bytes → intake session → `enqueue-intake-manifest` fan-out → one run
  settled `done` through the real D110/D114 composite → receipt → notification → version bump →
  archived record rendered → relaunch, over ONE real authority database and the production read
  models (`createRunQueueProjection`, `buildRunDetail`, `createArchiveSnapshotSource`,
  `createReceiptService`). It asserts JOINS, never behaviour a slice suite already owns — the
  manifest `itemId` that joins the runs it minted, an un-run intake row BLOCKING a version bump, the
  archived row/detail being byte-identical to the LAST LIVE projection, the archived receipt being
  the exact record the receipt service derived beforehand, and a relaunch sharing only the ITEM.
  Duplicating a slice suite in a walk is worse than absence: a capture walk was considered and
  refused because `capture-surface`'s property 4 already drives capture session → finalize outbox →
  handoff refusal → durable `failed` → retry-finalize end to end.

  **Where a producer does not exist, the walk asserts the REFUSAL by name rather than skipping the
  step.** Three are recorded as of 2026-08-09: (1) no registered workflow declares an intake
  projection, so the fan-out leg necessarily runs on `intake-fixture`; (2) a fixture workflow's
  evidence leaves are undeclared in `EVIDENCE_FIELD_CLASSIFICATIONS`, so its receipt derivation
  refuses with *"no declared evidence classification for …"* and the archived record freezes
  `receipt: absent` WITH the reason — the positive half of that join runs on the registered
  `person-lookup` exit run, the only place today where declared evidence and terminal authority are
  both true; (3) nothing in `src/` publishes a notification, so terminal settlement is asserted to
  file NO inbox row before the walk publishes the `verified-done` trigger through the real inbox
  itself. Each of these is a real production gap, and the walk is where they are visible.
- **`evidence-receipt.test.ts`.** Every terminal run produces a strict receipt with input/config/
  graph fingerprints, node outcomes, provenance, artifact/proof/failure refs, exclusions, and an
  explicit confidence (`verified|partial|unknown`). `done` requires all mandatory evidence and no
  unresolved write/subject/storage condition. Diagnostic bundle tests prove schema redaction and
  assert no env/cookie/storage-state/raw-SSN leakage.

  **ACTIVE as of 2026-08-04 (D140–D143).** Both halves execute. Strictness is proven by violating
  fixtures — `verified-done` is refused for non-verified confidence, an unresolved mandatory fact,
  an `unknown`/`ambiguous` mandatory obligation, any warning, and a failure id; a `verified` write
  without a filed proof ref and a commit claiming it was never attempted are rejected. Redaction is
  proven by canaries (password, cookie, storage state, SSN, private key, every registered env key)
  plus three structural arms: a forbidden (classification, transform) pairing is refused at
  DECLARATION time, an undeclared leaf fails loud instead of dropping, and a receipt classification
  that disagrees with `domain/secrets.ts` for the same field name fails. Coverage walks every
  registered canonical-input sample and every used contract's sealed `example`, so a new contract
  lands unclassified and this guard goes red before any receipt could quietly drop its fields. The
  **diagnostic-bundle** arm of this spec activates with the bundle capture slice, which owns the
  capture triggers this guard would otherwise have nothing to run against.
- **`notification-durability.test.ts`.** Each closed trigger commits a durable inbox item; dedupe,
  read/unread state, snooze, redaction, and run/failure links are pinned. An injected OS delivery
  failure must leave the critical inbox notification durably unread; no per-attempt delivery state
  is required.
- **`knowledge-fix-integrity.test.ts`.** Knowledge records have status/scope/evidence/validity and
  supersession refs; no two active records may claim the same scoped rule without an explicit
  conflict. Fix records link failure, changed contracts/UI ids/scenarios, verification, and commit.
  A verified FixRecord requires a commit plus non-empty evidence; drafts stay out of active
  guidance. Raw chronological lesson append is not accepted as active architecture authority.
- **`workflow-editor-compile-integrity.test.ts`.** Phase-2 read-only explorer projections
  round-trip from the real descriptor/contract/UI registries. Editable drafts are limited to the
  closed presentation/policy union; stale-base apply, graph/schema/selector/bind/proof edits, or an
  apply without reviewed semantic diff fail and yield a code-change brief. Presentation validation
  re-attests the exact builder/schema/graph/runtime-registry/scenario-source facts at the bound
  descriptor fingerprint without claiming tests ran. A source brief carries canonical JSON plus a
  closed TypeScript property-replacement plan whose operations exactly match patch changes in count,
  order and kind. Its policy diff is byte-bound to those operations; Edit Data node changes derive
  from their canonical before/after field sets; presentation, edges, effects and UI ids must remain
  empty. All-no-op and partial-no-op source drafts refuse, rather than deleting a reviewed target.
  The brief carries full impacts, requires the next descriptor version and a changed fingerprint,
  and leaves all five source checks required. No DSL/codegen artifact exists (ref operator-trust §5).

### 3.11 Old-capability closure and advisory AI

<!-- roadmap: p2-2i -->
<!-- roadmap: cross-cutting -->
<!-- roadmap: def-sanity-check -->

<!-- roadmap-status: p2-2i -->
- [x] `ai-advisory-no-authority` is active; D294 retires `capture-durability-and-scope`; `redaction-surface-scan` (D183) is the one sweep over every egress class (§3.15)
- [x] `preflight-coverage` is active in 3.1.11.1: the manifest executor injects registry-derived faults through production detectors; `runtime-dependency-coverage` continues to hold declaration closure.
> 2026-09-19 | 3.1.11.1 | executed fault coverage supplements the existing declaration and dashboard checks.
<!-- /roadmap-status -->

<!-- roadmap-status: cross-cutting -->
- [x] `legacy-capability-disposition` audits the inventory five ways and derives the completed set by INVOKING the real `phase` command, so closing a tail arms the next sweep (§3.11 as-built, D184)
- [ ] 50 entries remain genuinely `open`, each now owned by `workflow-admission-backlog` with the reason in the entry; `cutoverRequiresZeroOpen` is what they gate
> 2026-08-20 | docs-cohesion ref guards-and-tests | verified against §3.11's as-built record; the entry-by-entry state lives in `config/legacy-capabilities.json`, not here
<!-- /roadmap-status -->

<!-- roadmap-status: def-sanity-check -->
- [x] the advisory guard exists — `ai-advisory-no-authority` proves an advisory module cannot reach command, gate resolution, workflow state, UI-registry writes, subject matching, completion confidence or a mutation capability
- [ ] D192's re-disposition of `legacy-tool-ops-sanity-check-record` is still open in the capability inventory (§3.11 as-built)
> 2026-08-20 | docs-cohesion ref guards-and-tests | verified against the inventory; the panel itself is a deferral, not a guard gap
<!-- /roadmap-status -->

- **`legacy-capability-disposition.test.ts`.** Ref workflow-model §1.6.3's strict non-workflow inventory covers every old
  workflow directory, `services/*` module, route file/endpoint family, top-level dashboard component
  family, CLI subcommand/ops script, exporter/codegen/maintenance/dev tool exactly once. New legacy
  paths fail until classified. Runtime proxy is forbidden. Cutover-readiness mode rejects open/
  undecided entries, missing native/replacement targets, target retirement without evidence,
  duplicate path ownership, or CLI/navigation inventory mismatch; it never authorizes source/test
  deletion. A deletion/retirement mode may be designed only after separate operator ratification.
- **`capture-durability-and-scope.test.ts`.** Capture session/photo/finalization schemas are strict
  authority; commands are idempotent, version-stamped, and transactionally validate current state
  without blanket CAS; photo refs are content-addressed; finalize reaches bundle/artifact/intake
  enqueue only through one stable outbox. Restart fixtures cover an open session and mid-finalize;
  outbox fault injection around publish/enqueue converges to one artifact and one handoff. Phone-origin
  route enumeration is fail-closed: every allowed route is token-scoped and every non-capture,
  operator-only, catch-all, or newly added route returns unavailable externally until explicitly
  reviewed. Expiry uses the Clock and cannot race a finalizing handoff into deletion.
- **`ai-advisory-no-authority.test.ts`.** AI request/result schemas apply redaction before the
  provider call and distinguish produced/unavailable/invalid-response. Import/capability graph checks
  prove advisory modules cannot reach command, gate resolution, workflow state, UI-registry writes,
  subject matching, completion confidence, or mutation capability. Fixtures inject missing keys,
  quota exhaustion, provider errors, malformed output, and prompt injection text; deterministic
  evidence/rules remain unchanged and no empty result is interpreted as “safe” or “no issue.”
- **`preflight-coverage.test.ts` — active (3.1.11.1).** Executes all fourteen manifests through
  the production runtime detector factory and strict authority. Registry expansion covers every
  dependency member, with positive controls, real input faults, restoration, exact terminal/evidence/
  failure expectations, digest-bound reports and zero intercepted effects. Missing/extra/duplicate
  cases and mismatched evidence fail; the companion unit suite injects a false-healthy runner.
  `preflight-admission-consumer.test.ts` separately exercises the released plan/kernel/lifecycle,
  worker spawn, claim and browser consumers against production detectors. Setup and doctor share
  served reports. This activation does not introduce CLI doctor/test-login commands or claim live
  system acceptance, which remains with 3.1.19.
- **`provider-capability-boundary.test.ts`.** Every service task with remote I/O declares a D63
  capability and receives only its narrowed injected client. Direct provider SDK/raw network imports
  are allowed only in registered `infra/providers/**` adapters. Every capability has timeout/abort,
  concurrency/rate admission, config/secret preflight, redaction, evidence, and unavailable/invalid
  scenarios; every adapter has a consuming contract. Scheduler fixtures prove an exhausted provider
  cannot bypass its provider budget or occupy a worker indefinitely.
  The generic admission service and those budget/exhaustion fixtures activate in 1f against
  deterministic adapters. Requiring a production key pool or OCR/geocoding/AI consumer before 2h
  would overclaim the later milestone; 2h extends this same guard rather than adding a second
  admission path.
- **`runtime-dependency-coverage.test.ts`.** D68 compares the closed BrowserSystemId/provider sets,
  endpoint route schemas, secret/config registries, preflight checks, and legacy env/capability
  inventory in both directions. A missing ServiceNow/SharePoint/Old-Kronos endpoint or provider key,
  an unregistered `process.env` read, and a stale registry entry all fail with the exact owner.

#### 3.11 as-built — the capability-closure sweep (D184, 2026-08-09, 2j)


- [x] D184's sweep is done and its rule holds: a wrong `native` claim is worse than an honest `open`, so a family whose operator-visible half did not land stays open and says what is missing
- [ ] D192's re-disposition is the doc-side item still open here
> 2026-08-20 | docs-cohesion ref guards-and-tests | verified against §3.11 as-built; the other two calls in this node belong to `reference/dashboard-surfaces` and the migration record

The normative text above is unchanged. What follows is what actually landed, and what the guard
had been failing to hold until it did.

**What was broken.** `legacy-capability-disposition` proved exactly two things: every discovered
legacy path is owned exactly once, and every `sourcePaths` entry still exists in the legacy repo.
It never read a *disposition*. So 73 of 78 entries sat at `status:"open"` with
`disposition:{kind:"open"}`, and **53 of those named a milestone that had already shipped** — 49 on
`2i`, 4 on `2h`, plus the 1b/1f/1i-spine strays. An entry that says "open, owner 2i" after 2i ships
is not a work item; it is a claim nobody can act on, and this is the file that gates cutover
(`cutoverRequiresZeroOpen: true`). "Cutover-readiness mode" had been prose here since round 8.

**The re-disposition.** Every entry was re-decided against the rebuild *tree*, never against the
plan. 27 close as `native`/`replaced` with the real paths and the accepted differences; one closes
as `retired`; 50 stay open because they are genuinely not built, each moved to the milestone that
will build it with the reason recorded. The rule applied throughout: **a wrong `native` claim is
worse than an honest `open`**, so a family whose core landed but whose operator-visible half did
not (the Log Panel without its screenshot gallery, Settings without an editor, capture without an
operator photo review) stays open and says exactly what is missing.

**Three vocabulary additions**, all sanctioned by ref workflow-model §1.6.3 rather than invented here:

- `open` gains a required non-empty `reason`. A bare `{kind, milestone}` is *how* 73 entries came
  to name shipped milestones — there was nothing in the record to contradict.
- `retired` joins the used dispositions (one entry: legacy's dev-only `?view=` scaffolding).
- `status` becomes `open | implemented | retired | retirement-candidate`, an exact projection of
  the disposition. A two-valued flag would have had to call a retirement "implemented".

Every disposition arm also carries `milestone`, including `candidateForRetirement`, so
`ownerMilestone` has something to be checked against.

**The five audits.** The inventory is now parsed by a recursively strict zod schema inside the
guard — which *is* the proxy-free arm, since `proxy` is not in the union — and:

1. `status` is the disposition's projection through one closed table, both ways.
2. `ownerMilestone` must equal the milestone of the disposition that decided it.
3. every `native.targetIds` / `replaced.replacement` resolves to a git-visible path in **this**
   repo, directories included.
4. no entry may be `open` while its owner is at or before the milestone the runtime reports as
   `completedThrough`.
5. every `verificationEvidence` token parses as one of four checkable forms — `npm run <script>`
   present in `package.json`, `legacy-source-present:<path>`,
   `ported-with-provenance:<commit>:<path>:<blob>`, or a repo path — **and a decided entry must
   cite at least one rebuild path or script.** "The legacy file still exists" was the only evidence
   73 entries carried, and it proves nothing about this repo.

**The completed set is DERIVED, not typed.** The phase docs' ordered work items are the guard's one
milestone enum, and the marker is obtained by invoking the real `phase` command
(`startRebuildRuntime(..., ["phase"])`) — the same thing an operator runs. A hand-typed list of
finished milestones is a second answer that can disagree with the product. **Closing a tail is
therefore what arms the next sweep:** advancing `COMPLETED_THROUGH` in
`src/core/runtime-composition.ts` is the act that forces the next re-disposition, and it will fail
loud, by entry id, naming every stranded item. Two non-vacuity assertions stop the sweep from
passing by looking at nothing. Nine negative controls drive the audit against mutated fixtures,
one per arm plus the schema refusals.

**Where the unbuilt entries actually belong.** The first pass parked sixteen on `2i` and one on
`2j`, which was the wrong reading of what this file is for. `cutoverRequiresZeroOpen` gates
**cutover** — doc 05 §Exit criteria's whole-program flip — not a Phase-2 tail, and §2's row 3 already names the
home for everything Phase 2 does not build: *per-workflow migration, **plus explicit non-workflow
capability closure (§3.6)***, with its exit requiring every inventory entry to reach
native/replaced/retired. Assigning 49 legacy operator surfaces to "milestone 2i" was an early guess
made in 1a, long before 2i was sliced; the operator's actual 2i (2i-A…2i-G, D168–D180) never
contained them. D184 originally re-milestoned all seventeen to `phase-3-workflow-migration`; D319
moves the still-open program obligation to `workflow-admission-backlog` — a
re-milestoning, never a re-classification: every one keeps `status:"open"`, and nothing was
promoted to `native`/`replaced` to make a gate green. Four groups, each with the deciding reason in
the entry itself:

- **Explorer Phase B (4)** — `workflow-modifier`, `workflow-design`, `workflow-presentation`,
  `build-data-bank`. D283/DCC4–DCC5 now complete the existing-workflow boundary: label/icon/category
  hot-apply; timeline/grouping and notification are named unavailable without owners; policy and
  descriptor-allowlisted Edit Data return strict source briefs. **D186** still governs absent
  new-workflow authoring and broader design/data-bank work at the second-workflow trigger.
- **Settings editing (2)** — the surface and its route. DCC1–DCC3 now serve the strict
  resolver-owned editable inventory, one atomic command/readback, preflight rerun and read-only
  doctor; credentials, AI assist, delete/recover and resolver-unowned legacy values remain open.
- **The producerless advisory surfaces (5)** — `ai-assist`, `service-llm`, and the three ops
  scripts. **D178** records run summary, record sanity check and selector suggestion as having no
  producer and no surface arm, and `AdvisorySurfaceIdSchema` is closed, so each is a declared schema
  change. §3.6 calls these adapters *optional* with the deterministic paths primary, so each closes
  as a build-or-retire decision.
- **Consumer-gated operator surfaces (6)** — bulk/browser controls, per-instance daemon stop,
  cross-run search and its nav surface, the operator-side capture photo review, and static asset
  serving. Each is a fact about operating *many* runs, or is blocked on the artifact-bytes route;
  the tree has two workflows and no run corpus, so shaping them now would fix their facets and
  affordances against nothing.

The milestone id is coarse by construction — the phase docs have no finer ordered item past 2j — so the
granularity lives where D184 put it: every entry's `reason` names what is missing and what decides
it, and §3.3's order plus §3.6's grouped decisions are where each one actually lands.

**One item is called out because 2j closed over it.** `legacy-route-static`: the production BFF
serves **no frontend bytes at all** — `http-server.ts` has no static handler, `api.ts` 404s
everything unrouted through `app.notFound`, and the only `dist/dashboard` servers in the tree are
test-only. `api.ts` allow-lists `/capture.html` for the phone host gate while nothing in production
serves it, so the phone capture page has no delivery path from the BFF. That is base-integration
work, which was 2j's own scope, and 2j closed (D181–D186) without it. It is a **hard cutover
blocker**: cutover flips the operator onto this runtime, and a runtime that cannot deliver its own
frontend has no operator surface at all.

**The inventory must never gate the program's own progress.** A tail that closes with an entry
still parked on it is a record-keeping defect, not a reason to stop — so the guard runs the sweep
AHEAD, asserting a clean audit for *every* base work item through `2j`. `completedThrough` stays
strictly typed as a phase-doc work item, because its position in that order is the whole mechanism;
`active` is deliberately a plain string, since past 2j it names a §3.3 **migration** rather than a
base work item, and parsing it strictly would make an unrelated schema refuse to run the moment the
marker advanced.

**The two sibling sweeps in the same decision.** D107's pending-impl bindings already audit both
directions plus two extras, and the checked-in empty set is correct against the as-built — but its
"a store now implements this, delete the entry" arm had **no fixture**, so it was enforced only by
the empty set happening to be right. An empty allowlist cannot prove an arm; it now has one.
`provider-capability-boundary`'s exact `src/infra/providers` file list is airtight in the
tree→guard direction, but two defects sat on the other side: `ADMISSION_MODULE_IMPORTERS` listed
the admission module as its own importer (unreachable — the arm resolves *imports*), and the D68
declared provider inventory had drifted from the built adapter tree with nothing watching (groq,
mistral, openrouter and sambanova declare `ocr.extract` + `ai.advisory` and have no adapter
module). Both are now reconciled both ways: every allowlisted path must be a git-visible module,
and every `ProviderId` carries either a reviewed adapter-module list whose paths exist or a
reviewed declared-without-adapter reason.

### 3.12 D71 executable contract/type-budget suite

<!-- roadmap: p1-authority -->

The Phase-0 disposable spike is converted—not copied blindly—into committed tests against the real
Phase-1 exports:

- `contract-inference.test-d.ts` pins literal error-code inference, effect-specific required fields,
  prepare/commit illegality as standalone tasks, wrong child input/result rejection, undeclared
  provider-client rejection, duplicate node ids, and no erased `any`/`unknown` target. Every
  intentional failure uses `@ts-expect-error` plus a neighboring positive control so a weakened API
  that merely stops checking causes the suite to fail.
- `workflow-real-scale.test-d.ts` builds a representative 15–25-node graph containing every node
  kind and real schema transforms. On the Phase-0 baseline machine its isolated
  `tsc --extendedDiagnostics` check must stay below 5 seconds and 1 GiB; the measured values are
  recorded as test output. The simplified 40-node 0.68s/~212MB feasibility result is context, not
  the acceptance value.
- Runtime tests pin ingress-transform-once/canonical-revalidate-many, unknown-key rejection,
  command-family arm separation, two target paths sharing one canonical concept, proof-union
  rejection, and D69 settlement where a pre-window observation contributes zero votes.
- The SQLite feasibility cases live in `storage-recovery.test.ts`: permanent key conflict, atomic
  intent+outbox commit/rollback, foreign-key integrity, authority-generation behavior, native
  online backup, and read-only self-verification.

These tests land immediately before or with the real contract they exercise. A standalone scratch
file outside the repository is never a Phase-1 gate and is deleted after its findings are captured.

**AS-BUILT 2026-08-20 — the suite exists under two different filenames, and it is inside the one
`tsc` program rather than a separate type-test runner.** There is no `*.test-d.ts` in this tree and
no `vitest typecheck` project; the proof lives in `tests/types/`, which `tsconfig.json` includes, so
`npm run typecheck` IS the runner and a weakened API fails the ordinary gate:

- `tests/types/task-contracts.typecheck.ts` (121 lines) is D71's `contract-inference` half — a
  `@ts-expect-error` per illegal shape (a service driver in a browser task context, an undeclared
  provider client, a read context reaching a mutation) with a neighbouring positive control, so an
  API that merely stops checking fails the build. Three architecture guards read this file as their
  fixture rather than restating it: `task-store-boundaries.test.ts:62`,
  `provider-capability-boundary.test.ts:181`, `task-contract-sealing.test.ts:141`.
- `tests/types/flow-graph.typecheck.ts` (619 lines) is the `workflow-real-scale` half: a
  representative **21-node** graph exercising every builder transform — read steps, a prepare/commit
  transaction pair, an output-dependent branch, fork/join, typed child runs at both cardinalities and
  both await modes, operator/children/external gates, decorations and a terminal result — with the
  negative controls that catch a transform eroding to `any`/`unknown`/`RuntimeFlowNode`.

The one part of D71 that is NOT as-built is its BUDGET: nothing measures the isolated
`tsc --extendedDiagnostics` time and memory of that graph, so the "under 5 s and 1 GiB on the
Phase-0 baseline machine" acceptance value is unenforced. It is the same shape as §10.1's
performance budgets — a number nobody measures is a number nobody can fail — and it is listed as
open rather than quietly dropped.


### 3.13 Round-8 guards (2026-07-26) — the decisions that need mechanical teeth

<!-- roadmap: p1-spine -->
<!-- roadmap: dash-defaults -->

<!-- roadmap-status: p1-spine -->
- [x] the four round-8 guards landed: `one-projection-counts` (D81), `identity-gate-before-commit` (D77), `archive-invariants` (D80), and the isolation pair `operational-isolation` + `test-runtime-root-isolation`
- [x] `runtime-isolation`'s cross-tree half is RETIRED by D93 and `legacy-change-accounting` by D150 — both with successors named in the inventory, never a silent shrink
> 2026-08-20 | docs-cohesion ref guards-and-tests | verified against the inventory's retired set; the D94 accounting narrative moved to `history/superseded/2026-08-20-guards-and-tests-legacy-change-accounting.md`
<!-- /roadmap-status -->

<!-- roadmap-status: dash-defaults -->
- [x] `one-projection-counts` holds D81: no count reachable from a surface path originates outside the single run/queue projection payload
- [x] `wire-connectivity` audits FOUR joints, not three — section arms, command keys, routes ↔ client, and the wire MIRRORS of durable vocabularies (`guard-inventory.json` corrected 2026-08-20)
- [ ] T2 dashboard feature scenarios per feature, and the `scenario-dashboard` project that collects them (§10.9, §10.12) — spec only
> 2026-08-20 | docs-cohesion ref guards-and-tests | the guard side is verified against `wire-connectivity.test.ts`; the test file's own header comment still says "Three joints" and is reported for the code unit
<!-- /roadmap-status -->

Four ratified decisions are worthless as prose. Each gets a guard, and each guard is listed in the
§5.1 registered set.

- **`one-projection-counts.test.ts` (D81 — ref dashboard-surfaces §10.1).** The operator's standing complaint is
  that legacy per-workflow badges "always error out"; the audit found ≥4 historical fixes for
  count/badge divergence. Root cause is structural — several surfaces each free to derive their own
  count. This guard asserts that **no count or aggregate reachable from a surface path originates
  anywhere but the single run/queue projection payload**: no client-side `.filter().length` over
  entries feeding a badge, no second aggregate endpoint, no "just for the badge" query. Backed by a
  fixture whose seeded world contains hidden, archived, delegated, and rejected rows and asserts
  Workflow Panel total == Status Bar sum == rendered Queue Row count **by construction**. Failure
  mode it prevents: a future surface quietly re-deriving a number and re-opening a 4-fix bug class.

- **`identity-gate-before-commit.test.ts` (D77, amended by D309 — ref write-safety §14).** For every
  separation-class descriptor, walk the graph and assert every commit and identity-bearing terminal
  result crosses the shared `verify-identity-approval` authority task. The task emits either exact
  supplied-EID machine verification or operator approval; a side read added after it cannot feed a
  sink. The guard separately pins the gate's exact condition to
  `comparison.packet.emplIdSource == name-resolved`, its `resolvedBy: operator`, typed
  `IdentityApprovalResult`, and the authority task's dependency on it. This is the static half of
  the wrong-person control; the runtime half refuses an unproved supplied EID, a name-resolved EID
  with no gate result, and stale or contradictory evidence before a fence can be minted.

- **`archive-invariants.test.ts` (D80 — ref dashboard-surfaces §10.2).** Three assertions: (1) rendering an
  archived run touches **zero** version-conditional code paths — the archived payload is
  self-contained, so a fixture with an archived run from a prior descriptor version renders through
  the same single path as a current run; (2) a version bump **refuses** while any prior-version run
  is non-terminal, and the refusal lists them — the write-safety carve-out that stops an unresolved
  possible-submit being buried; (3) archiving never touches the write ledger.

- **`runtime-isolation.test.ts` — RETIRED BY D93 (cross-tree half); `operational-isolation.test.ts`
  + `legacy-change-accounting.test.ts` survive (D88/D90/D93 — charter/ref dashboard-surfaces).** The original arm was
  a finite TypeScript-AST normal form over a closed `forbiddenBridgeClasses` registry: it proved that
  no file on either side reached the other through a dynamic import/`require`, process, filesystem/
  state/profile, runtime HTTP, or proxy/forward/remount sink, with a `legacy-preservation.json`
  path→whole-file-SHA map deciding which legacy files were scanned strictly. **That entire cross-tree
  scan is retired**, along with the preservation manifest and its activation replay, because two
  repositories share no module graph: a legacy→rebuild import is no longer a violation the scanner
  must catch, it is an expression that cannot resolve. Retiring it is an **explicit replacement
  recorded in the guard inventory, not a silent shrink** (§5) — the invariant it defended is now held
  structurally, and the rationale is this entry.

  **What survives, because a repo boundary does not separate one machine.** `operational-isolation`
  keeps the configuration half verbatim: exact distinct commands and an exported direct-`const`
  `defineRuntimeIsolation` call for the state/artifact roots, ports, process lock, and browser
  profile/session. The manifest pins the config factory and every composition factory by module +
  export and declares the exact binding argument path (for example `0.isolation`); each composition
  root must use unshadowed named imports in one direct top-level call. Identifier mention or a call
  hidden in an uninvoked function is not proof. A shared port, lock, state root, or browser profile
  is a real collision that no repository boundary prevents, so this arm stays hard.

  **D247 (2026-08-20) narrows the COMMAND half to drift only.** The rebuild's launch commands are
  plain — `cli`, `dashboard`, `dashboard:prod` (and `web`, `web:build`, `web:preview` for the vite
  half, which are not isolation rows) — and the distinct-NAME check across the two checkouts is
  retired: the `rebuild:` prefix dated from the plan to grow this runtime inside the legacy tree, and
  a name is not a resource two processes can collide on. What the guard still holds is that each
  declared command is byte-exactly the script in its own `package.json` (both checkouts), plus every
  resource row above. A muscle-memory `npm run dashboard` in the wrong checkout now starts that
  checkout's dashboard on its own port, under its own roots and locks — legible, and harmless.

  **`test-runtime-root-isolation.test.ts` (2026-08-03 — ref clock-config-secrets §4) covers the other direction: the
  TEST suite mutating a real runtime root.** `operational-isolation` proves the two runtimes bind
  distinct roots; it says nothing about who writes to them. A unit test did — the browser-session
  factory suite created profile directories under the real `.auth-rebuild` (because `open()` really
  `mkdirSync`s) and then `rmSync(rebuildRuntimeIsolation.browserProfileRoot, { recursive: true,
  force: true })`'d the lot, destroying the Duo WebAuthn credential on every `npm run test` while the
  gate stayed green. Fresh Duo enrollment is the one ceremony Autopilot cannot do unattended, so this
  is asset destruction, not untidiness. The guard scans `tests/**` only (production code writing to
  the real roots is the point of production code) and holds two arms: no real-root-derived path — an
  isolation-binding root property, a `.auth*`/`.tracker*` literal, or a local binding carrying either
  — may reach a `node:fs` mutator; and a test that constructs `PlaywrightWorkerSessionFactory` must
  bind its own non-real `paths.browserProfileRoot`. Taint is positional (only a path joiner's FIRST
  argument roots the result), so `join(temporaryWorkspace, ".tracker-rebuild/artifacts")` fixtures
  stay legal and the guard does not cry wolf.

  **`legacy-change-accounting` is RETIRED (D150, 2026-08-05) — the paragraph below is history.**
  The operator's decision is that the two repositories touch each other in neither direction: every
  workflow is rebuilt here anyway, so there is no ongoing ledger to reconcile, and an unrelated
  in-flight edit in the production repo must not be a red gate in the rebuild. The invariant it
  carried — a ported selector or page-state fact going stale after legacy fixed it — moves to **live
  re-verification at each workflow's migration**, which §3 already requires and which is strictly
  stronger than a diff against legacy's copy. `legacy-selector-port-provenance` is untouched: it
  reads a FIXED commit's blobs. `config/legacy-change-accounting.json` stays in the tree as a frozen
  historical record and is never extended. What the guard enforced while it existed is preserved at
  `docs/rebuild/history/superseded/2026-08-20-guards-and-tests-legacy-change-accounting.md`.

**Two live-compatibility guard families remain rejected (D88).** Continuous real-tracker replay
and a runtime legacy wire-schema adapter would legitimize the forbidden live lift/proxy. If an
optional one-time historical importer is built, a dedicated offline fixture proves explicit source
version, immutable-backup-only input, idempotent import manifest, reconciled source/result/
quarantine counts, and no importer dependency from a production composition root. This is an
explicit replacement in the guard inventory, not a silent shrink.

### 3.14 Testing standard (D85) — what replaces the e2e ritual

<!-- roadmap: p2-2j -->

<!-- roadmap-status: p2-2j -->
- [x] D190 closed the safety-critical floor (70.08 % → 99.43 % on `run-queue-projection.ts`) and D191 made `test:coverage` the per-commit gate
- [x] `redaction-surface-scan` (D183) and the D188 inventory re-disposition landed — six placeholder `planned` guards became four retirements with successors and two kept with real triggers
- [ ] D91's BRANCH half is UNMET and its Phase-2-exit trigger has passed: `coverage.thresholds` configures lines/statements/functions only, so branches are report-only at a measured 76.39 % global (§3.14 as-built, §10.10)
- [x] D85's parts 2 and 3 landed later under R10's names: `config/test-subjects.json`, insert-only `dry_run_scenario_results`, and `cli dry-run-scenario <workflow> --subject <label>` (§10.5–§10.6)
> 2026-08-25 | test-tiers | the first finalization case exercised the unavailable-subject path: durable `blocked`/`not-started`, no run or trace id, and no browser runtime composed; the honest live green waits for the 2026-08-28 canary
<!-- /roadmap-status -->

The operator asked for a better standard than the `custom-hr-e2e-test` skill ritual. The ratified
answer has four parts, and they are *kernel behavior*, not a skill:

1. **The scenario corpus is the everyday lane.** Registered `ScenarioManifest`s (D53) execute in CI;
   a bug fix links a regression scenario. This is the default way a workflow is tested.
2. **Structural dry-run** — `cli test workflow <id> --dry-run` runs through the **real kernel**, not
   a parallel stub harness, so what is tested is what ships.
3. **A typed `TestTargetRegistry`** — test employees, fixture files, and authorized sacrificial
   documents (e.g. Kuali Action List docs 4444–4453) with their usage rules recorded as data:
   read-only vs write-allowed-if-restored, cleanup obligation, and owner. A live probe or controlled
   commit names its target from this registry rather than from a comment in a session transcript.
4. **Positive no-write proof.** A dry-run's safety claim is proven by an **empty per-run
   write-intent ledger**, not by the absence of a screenshot or a log line. This replaces the old
   heuristics with a fact the kernel already records: no intent row means no fence, means no click.

Three habits from the old ritual are kept and promoted into kernel behavior: **"a workaround is a
finding"** (a step that needed manual help is recorded, not smoothed over), **double-entry ground
truth** (a UI assertion is paired with an independent source), and the **append-only issue ledger**.

**AS-BUILT 2026-08-25 — all four D85 mechanisms exist; R10 supplied the final names and the durable
evidence boundary.**

| D85 part | as-built |
|---|---|
| 1 · the scenario corpus is the everyday lane | **LANDED.** 16 files under `tests/scenario/`, audited three ways by `scenario-coverage` (§3.10) — claims vs. graph, references vs. executions, and D185's corpus-directory layout. |
| 2 · structural dry-run through the real kernel | **LANDED under R10's entry point.** `cli dry-run-scenario <workflow> --subject <label>` creates a real start plan with `dryRun:true`, executes the start command, drains the production worker, resolves the declared gate through the command kernel, drains again and judges authority/receipt evidence. |
| 3 · a typed `TestTargetRegistry` | **LANDED.** `config/test-subjects.json` carries strict labels, kinds, availability/date, public fields and usage rules; sensitive EIDs resolve only through `src/domain/secrets.ts`. Gone/unknown subjects record `blocked` before runtime/browser composition, while a target marked available but incomplete fails as a registry defect. |
| 4 · positive no-write proof from an empty write-intent ledger | **LANDED and used.** The runner reads per-run counts for `write_intents`, `write_attempts` and `durable_outbox`, joining the latter two through that run's intents; its manifest requires zero deltas while allowing the checkpoints, gate and terminal rows a dry run truthfully writes. |

The three kept habits are the topology R10's T4 tier formalises (§10.8).

**D91 coverage/sizing/preservation policy (ratified 2026-07-31).** The rebuild repo's
`test:coverage` measures its authored `src/` code with the reviewed exclusions in the testing-system
plan. Lines,
statements, and functions gate at **60 global / 80 safety-critical** from activation. Branches are
reported through Phase 1 and become hard **50 global / 70 safety-critical** gates at Phase-2 exit.
The suite-size report is reviewed at every phase exit but is not a hard file-count gate. Legacy
tests and Vitest projects remain runnable through initial cutover; neither test paths nor their
projects may be removed without a later explicit operator-ratified retirement. New/touched legacy
diagnostics are governed by §1.1; rebuild tests are zero-debt from their first file.

**AS-BUILT 2026-08-20 — the branch half of D91 is UNMET, and its trigger has passed.** Phase 2 closed
2026-08-09. `vitest.config.ts`'s `REBUILD_COVERAGE_FLOORS` declares
`branches: { phase1ReportOnly: true, phase2Global: 50, phase2SafetyCritical: 70 }`, but the
`coverage.thresholds` block configures **lines, statements and functions only** — no `branches` key,
global or per-glob. So branches are still report-only past the exit that was supposed to harden
them, and nothing fails when they fall. The 2026-09-02 measurement at HEAD is **76.39 % global**
(15,367 / 20,115), comfortably over D91's 50 % global floor, so adopting the global half costs nothing today;
the 70 % safety-critical half needs a per-glob measurement first. The suite-size report at HEAD:
**unit 306 files / 111,789 lines · scenario 17 files / 7,105 lines · architecture 70 files / 27,587
lines**, printed by `scripts/suite-size.ts`, which `test:coverage` chains and `gate-coverage` pins as
still chained (never as still passing — see D190 below for why that distinction is the whole
lesson).

#### D190 — the safety-critical coverage floor as-built (2j, 2026-08-09)

<!-- roadmap: p2-2j -->

**The floor above was RED and had been red for a whole tail.** `npm run test:coverage` failed the
`src/**/*projection*.ts` safety-critical threshold from D180 (2i-G) until this decision closed it:

| measured at | lines | statements | functions |
|---|---|---|---|
| `f0b1fca` (pre-2j) | 78.12% ❌ | 76.80% ❌ | 79.85% ❌ |
| `56eb93d` (2j, before this) | 78.67% ❌ | 77.28% ❌ | pass |
| after | **97.61%** | **97.14%** | **96.27%** |

One file carried the whole deficit. Every other file in the glob was already 87–96%;
`src/server/dashboard/projectors/run-queue-projection.ts` was at **70.08% lines / 68.47%
statements**, because D180 added ~140 lines of range aggregation — `buildActivityReportWire` — and
**no test ever executed it**. It is now 99.43%. Nothing else moved: no threshold was lowered, no
exclusion added, no test written to touch a line. What closed it is behaviour that was genuinely
unproved — the by-day/workflow/category/status/outcome rollups, D124 at scale (a terminal run whose
surface carries no end instant is reported as `unmeasuredRuns`, never counted as a zero), a retired
workflow's runs counting while carrying `unregistered{reason}`, the failure breakdown refusing a
failure id authority does not hold, and the D81 half that asserts the report AGREES with the day
payload it summarises rather than re-deriving it — plus the fold arms a run only reaches when
something moves (a recovery requeue, a gate resolving, a restart closing a span it never opened, a
worker stopping, the two write-once identity refusals, and `refreshRun`'s span-less hide/archive).

**One line stays deliberately unreached, and it is not dead weight.** `#endedAt`'s final arm — "run
reads `<status>` but neither authority nor its run span recorded an end instant" — cannot be reached
through `#surface`, because a *terminal* status can only come from a terminal lifecycle or a folded
run end, and both earlier branches return on exactly those. It is a defensive refusal guarding a
coupling between two private methods; deleting it to buy a coverage point would pin `#endedAt` to
`#status`'s current shape. A guard against a state the code cannot currently reach is not the same
thing as an untested feature, and the two must not be conflated to make a number.

**Why nobody saw it, which is the useful half** (present tense as of 2026-08-09; D191 below reverses
it, and the paragraph is kept because the REASON is what generalizes). `test:coverage` was **not in
the per-commit gate family** (`typecheck` · `lint` · `test` · `test:architecture` · `test:parity` ·
`build:manifest --check`). It was an end-of-slice check — and *an end-of-slice check that a slice forgets is a check
that cannot fail*. `gate-coverage` did its job the whole time: it asserts the lane stays
**registered** (`--coverage` and `suite-size.ts` still in `package.json`), never that it was **run**,
so registration was green across every red commit. That is the same rot shape as §5 item 4 (an
active scan that resolves an empty file set) and item 9 (a lane that rewrites the expectation it
compares against): the check exists, the check is wired, the check never executes against reality.

**Recommendation, with the measurement behind it: `test:coverage` should REPLACE `test` and
`test:architecture` in the per-commit family.** It is a strict superset of both — `vitest run
--coverage` runs every project, and `tests/unit/architecture` is inside the `unit` project's glob, so
`test:architecture` is already a re-run of a subset — and on this machine the whole family measured
**`test` 21.5 s + `test:architecture` 17.4 s ≈ 39 s** against **`test:coverage` 28.2 s**. Adding the
floors is therefore not a cost, it is a saving; the only reason to keep them apart is that a
mid-slice commit can honestly dip a floor when a production module lands one commit ahead of its
tests. That objection is exactly this failure inverted — the floor was red for a *tail*, not a
commit, and "the slice will check at the end" is the assumption that just failed. A commit that must
land under a floor should be a stated exception, which is the posture this tree takes everywhere
else. **The change is NOT applied here.** What runs before every commit is a rule about how the
program works, so it is recorded as a named, measured recommendation for the operator rather than
slipped in behind a coverage fix.

<a id="phase-exit-gates-from-3-2"></a>

#### Phase 3.2 onward — focused tasks, full phase-exit gates (2026-09-19)

The operator-approved [task/cadence amendment](../../roadmap/roadmap.md#tangible-tasks-and-phase-exit-gates)
overrides D191's default per-candidate and prerequisite/group full-gate cadence for Phase 3.2
and later delivery phases. It applies equally to sequential tasks, prerequisites, parallel workers
and intermediate integration. Phase 3.1 and earlier admitted assignments keep their own schedules.

| Stage | Required verification |
| --- | --- |
| Task/subtask implementation and integration | Add or update meaningful regression coverage. Run `npm run test -- <exact affected test paths>`, scoped lint with zero warnings, and the type/static/generated checks affected by the change. Bind actual paths and commands in the brief. Repair failures now; do not defer a red focused check. No whole test/architecture suite, full coverage or broad parity run per task/group. |
| Phase exit | Run `npm run typecheck`, `npm run lint`, then `npm run test:coverage`; coverage includes unit, architecture and scenario projects, so do not append duplicate whole-suite runs. Also run every applicable phase-wide parity, generated-freshness, build, performance, recovery and live acceptance gate. Fix failures, rerun invalidated focused checks and re-establish the full exit gates on the corrected combined tree before phase completion. |
| Documentation/evidence only | Use the existing documentation-only and unchanged-input rules below; a recording-only commit is not another full test cycle. |

A phase here is an executable delivery part: 3.2, 3.3, 3.5, each admitted 4.x, 5A/5B and each
scheduled 6A–6F part. Optional 3.4 binds a selected feature batch and one end-of-batch full gate;
unselected features are never release prerequisites. A later batch gets its own exit evidence.
The owning plan names the final gate outcome and carries an explicit list of deferred broad checks.
Focused PASS is task evidence, not proof that those deferred checks passed.

Independent reviews remain as required by the owning phase. Phase 3.2's final audit/freeze remains
read-only: a defect returns to bounded remediation and restarts the audit. Phase 3.3 may not repair
its immutable candidate. Pre-write authorization, target checks and no-write rehearsal still precede
every controlled action, and cutover readiness gates still precede switching production authority.
No safety proof is moved after the effect it authorizes. Preserve test membership, assertions,
isolation, coverage floors and timeouts; use at most four test-file workers, without this task's
compiler/linter contention during coverage. This amendment changes scheduling, not the gate family.

#### D191 — the recommendation is adopted: `test:coverage` becomes the per-commit gate (operator decision, 2026-08-12)

For Phase 3.2 onward, the [2026-09-19 phase-exit cadence](#phase-exit-gates-from-3-2) takes precedence over the default and group-finalizer rules below.

For remaining Phase 3.1 work, the [2026-09-13 exception](#phase-3-1-focused-finalization) below takes precedence: focused tasks/prerequisites and group integration, full gates and repairs only at 3.1.19, no independent review.

<!-- roadmap: phase-3 -->

<!-- roadmap-status: phase-3 -->
- [x] the default implementation gate is `typecheck && lint && test:coverage` (D191; documentation-only and parallel-worker exceptions below) — a strict superset of the old `test` + `test:architecture` pair, measured faster (28.2 s vs ≈39 s)
- [ ] the gate gains nothing new from R10: T1 structural and T2 are inside `test:coverage`, and every dry-run tier is deliberately outside it (§10.9)
> 2026-08-20 | docs-cohesion ref guards-and-tests | verified against `package.json` and `CLAUDE.md`'s After-changes section
<!-- /roadmap-status -->

**Historical adoption record (2026-08-12).** The operator adopted the D190 recommendation as written:
the per-commit gate family is `npm run typecheck && npm run lint && npm run test:coverage`,
REPLACING the separate `npm run test && npm run test:architecture` pair. `test:coverage` runs every
Vitest project `test` ran at adoption (`tests/unit/architecture` was then inside the `unit` project's
glob) plus the lines/statements/functions floors, and it measured faster — **28.2 s against `test` 21.5 s +
`test:architecture` 17.4 s ≈ 39 s** — so the floors are a saving, not a cost. `test` and
`test:architecture` stay available as scripts for a targeted run; `test:parity` and
`build:manifest --check` are unchanged obligations, unaffected by this decision. Root `CLAUDE.md`'s
"After changes" section and its `## Commands` gate-family note both carry the new command. The
objection D190 raised — a mid-slice commit can honestly dip a coverage floor — stays true and stays
the operator's to accept case by case; nothing here waives a floor, it only moves WHEN the floor is
checked, from "the slice will check at the end" (the assumption that just failed) to every commit.

**2026-09-02 amendment — D191 now binds the self-contained three-project gate actually shipped.**
`test:coverage` collects each offline authored Vitest file exactly once across the disjoint `unit`,
`architecture`, and `scenario` projects; architecture is no longer inside the unit glob. The command
remains the per-commit gate because it still strictly contains the cases available through `test`
and `test:architecture`, adds coverage floors, and runs without the legacy checkout. `test` is the
all-project targeted convenience and `test:architecture` is the guard-only targeted convenience;
neither is an additional per-commit obligation. The 2026-08-12 timings above remain the historical
evidence that adopted D191, not a claim about today's topology or runtime.

**2026-09-05 test-run reliability amendment (operator-approved maintenance).** The npm gate
names, test membership, four-worker ceiling, timeouts, suite-size assertion and coverage floors stay
unchanged. Batch Vitest entrypoints now execute through `scripts/test-runner.ts`, which launches
the installed Vitest CLI with the original arguments and preserves its failure exit. Full coverage
already proves the architecture project; the standalone command is a targeted convenience unless
an admitted assignment explicitly requires it. Do not append duplicate suite runs to unchanged
coverage evidence, or change an existing assignment's gate schedule implicitly.

Interactive `test:watch` retains its direct Vitest entrypoint and terminal controls; its scratch
is outside this batch-run ownership scheme. Child processes retain a private file-creation mask.

Each invocation receives a private temporary root in the short canonical `/tmp/hrt-<uid>` namespace
(to preserve macOS UNIX socket path limits). Workers inherit its `TMPDIR`, `TMP` and `TEMP`. The
runner removes successful scratch only after its process group is gone. Failures retain their root,
exit/signal and bounded output tail; `npm run test:reap` explicitly reclaims only validated private
run directories whose recorded process group is absent. Active groups, incomplete startup records,
unknown paths, symlinks, malformed ownership and uncertain liveness never authorize deletion. A
parent SIGKILL leaves the child group protected until it exits. Darwin's empty orphaned group may
return EPERM to a signal probe; in that case an independently validated process-group listing must
prove absence. No cleanup is based on age and no legacy scratch directories are swept.

The parity wrapper uses the same containment and fails after 180 seconds without child output,
retaining diagnostics and terminating its owned group (TERM, then KILL if needed). This is an outer
runner failure, never a passed/skipped test or a retry; existing per-test deadlines, exact reference
checks and zero counted pixel-difference allowance are unchanged. Child progress and final duration
remain visible. This bounds silent hangs; sustained output from a stuck child is not proof of
progress and is not detected by this inactivity bound.

Regression evidence lives in `tests/integration/scripts/test-runner.test.ts` and the existing parity JSON
and gate-manifest suites: real child success/failure, silent stall, worker/parent SIGKILL, live-group
preservation, safe reclamation, path/ownership refusal and actual failing Vitest CLI execution.

**2026-09-06 gate-cadence amendment (operator-approved).** Implementation commits/candidates and
materially changed integration trees retain typecheck, lint and full coverage. During iteration,
use focused checks that can inform the next change and group related corrections into logical
commits. Do not add a full run for each green micro-cycle. Existing admitted assignments retain their
explicit gates and ordering unless the operator revises them; this amendment does not reschedule
Task 1.6.5 or waive an explicitly required standalone suite.

Documentation-only planning, instruction, contract, evidence and completion commits run applicable
documentation checks, existing instruction-pair equality and link checks, affected generated-output
checks, and `git diff --check`. Full code gates may be reused only when an inspected diff establishes
that their relevant code, tests, configuration, dependencies and other inputs are unchanged. File
extensions alone do not establish this: documentation consumed by a guard/generator and generated
runtime artifacts require their affected checks. Changed acceptance requirements or material contracts
need substantive assessment; prior green code tests do not establish new behavior. This approved
policy-only amendment uses these scoped checks; it does not claim runtime verification.

Record each reused command/result, tested commit/tree, current candidate and unchanged-input evidence
in the existing plan/evidence record or commit body. Missing evidence, affected inputs, unresolved
uncertainty, failures and explicit assignment boundaries require the applicable rerun. A recording-only
SHA change does not by itself require full coverage or renewed review of unchanged implementation.
Do not present reused evidence as independently rerun or use stale live-state evidence as current.

New plans bind a gate schedule for iteration, implementation commit/candidate, integration and
recording-only changes, with exact commands, reuse/rerun triggers and concurrent groups or exclusive
resources. Independent typecheck, lint and generated checks may overlap within verified host limits;
generation precedes its freshness check and shared mutable outputs remain serialized. Keep coverage
free of compiler/linter contention, use the demonstrated worker count within the four-worker ceiling,
and serialize only evidenced resource conflicts. Preserve membership, assertions, coverage floors,
isolation, deadlines and every required acceptance proof.

**2026-09-09 parallel-finalizer amendment (operator-approved).** For Phase 3.2 onward, use the newer [phase-exit cadence](#phase-exit-gates-from-3-2); intermediate finalizers run focused checks. Phase 3 parallel groups and
future parallel implementation plans use prerequisite → independent workers → finalizer, as owned
by [roadmap D344](../../roadmap/roadmap.md#parallel-finalizer-cadence). This explicitly replaces
per-worker full-suite gates for those groups, including candidate commits and review corrections.
Other standalone implementation and prerequisite candidates retain the default D191 gates; existing
in-flight assignments outside Phase 3 retain their recorded cadence unless explicitly revised.

| Stage | Required verification and exit |
| --- | --- |
| Prerequisite | Complete shared interfaces, registration, fixtures and ownership; run typecheck, lint and full coverage for implementation changes; obtain independent review and accept the integrated base before workers launch. |
| Parallel worker | Add/update meaningful regression tests and run the exact affected tests, scoped lint and other explicitly selected quick checks. Use `npm run test -- <exact test paths>`; the brief names real paths and lint/static-check commands. Do not run full coverage, the entire test/architecture suite or broad parity on every worker candidate. Repair failed focused checks before review/handoff. |
| Finalizer | Combine all exact reviewed worker candidates in its owned integration worktree; reconcile generated output; run `npm run typecheck`, `npm run lint`, then `npm run test:coverage`, plus every applicable parity, generated, build, performance and acceptance gate. Diagnose and fix failures within the approved group, add regression tests, re-review changed code, and rerun affected checks and the full gate family on the final code tree before completion. |

The worker brief records the focused command set, expected quick-check budget, candidate SHA,
results, independent review and the named finalizer with every deferred broad/expensive proof.
A review may accept the candidate for finalizer intake under that scoped schedule; it does not claim
full acceptance or green unrun gates. Documentation-only workers retain the scoped documentation
checks above. A failing focused test or lint check is never deferred as if it passed. No missing
required proof disappears: expensive acceptance work is assigned explicitly to the finalizer, with
current live-state evidence obtained at its required boundary. Do not duplicate full suites merely
because a candidate was committed, merged into the finalizer's temporary tree, or independently
reviewed. Full-suite failure corrections may iterate with focused checks; the final corrected
implementation must pass the complete required gate family. Preserve coverage floors, assertions,
membership, isolation, worker ceilings and deadlines. Coverage still runs without compiler/linter
contention. A red finalizer leaves the group and its downstream release blocked.

<a id="phase-3-1-focused-finalization"></a>

**2026-09-13 Phase 3.1 focused-execution amendment (operator-approved; final-gates correction).**
Prerequisites, standalone tasks, workers and corrections use meaningful focused tests, scoped lint
and affected quick/generated checks. Group finalizers 3.1.9.8, 3.1.11.3 and 3.1.14.6 combine
inputs, fix integration defects, run `npm run typecheck`, focused integration/regression tests,
scoped lint and affected build/generated checks, then release their existing downstream consumers.
These are focused development releases; full repository acceptance remains open.

**3.1.19 is the sole full-gate boundary.** It owns `npm run typecheck`, `npm run lint`,
`npm run test:coverage` and all required architecture/generated/parity/build/production/performance/
recovery/live acceptance proofs, including every frozen A01–A42 and D01–D05 outcome. It repairs
gate-found defects in the same session across the consumed required Phase 3.1 paths, adds regression
proof and verifies the final corrected tree; it no longer hands ordinary repairs back to earlier
tasks. The [phase execution table](../plans/phase-3/3.1-finish-the-dashboard/README.md#execution-cadence--operator-amendment-2026-09-13)
and [3.1.19 plan](../plans/phase-3/3.1-finish-the-dashboard/task-19-final-acceptance-and-close-phase-3-1.md)
own exact intake, repair scope and proof scheduling. Product scope and contract decisions remain
bounded by the approved frozen outcomes.

No independent review step is required at any remaining 3.1 stage. This explicitly supersedes
older per-group full-suite, prerequisite/full-gate, review and audit-only rules for Phase 3.1;
other phases keep their recorded cadence. Each task records commands/results, candidate SHA and
all deferred broad proof at its existing owner. Task-specific targeted proof still runs when it
establishes the assigned behavior. Group finalizers do not run broad suites merely for a release.

Use focused repair iteration; establish all required gates on the final corrected code tree.
Reuse valid unchanged evidence and rerun invalidated checks under D191; recording-only changes
do not duplicate full runs. A failed check remains a failure. Preserve assertions, membership,
coverage floors, timeouts, isolation, the four-worker ceiling and coverage without compiler/linter
contention. Integration, live-write and cutover permissions do not expand. Governance:
[2026-09-13 final-gates correction](../../roadmap/roadmap.md#phase-31-full-gates-and-repairs-at-final-acceptance-operator-amendment-2026-09-13).

**2026-09-09 scoped combined-database exception (operator-approved).** Only newly planned
Phase 2.6 database-modernization assignments in the [combined workflow](../plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/README.md)
use focused tests, lint and affected generation/freshness checks for iteration and committed
development releases. Record actual commands, exits, tested SHA/tree and proof rows; these releases
may unlock their explicit dependents before independent review. They are not accepted master
integrations or full product acceptance. Completed prerequisite/peer cards mean their scoped development
release only; full acceptance-finalizer/phase completion still requires full gates and review. Existing in-flight timeline T1 and other admitted tasks
keep their original cadence.

The operator removed intermediate/nested finalization tasks. L (2.6.7) consumes P/D/G/S
and V (2.6.8) consumes A/Q directly. Each prerequisite combines inputs, fixes immediate integration
issues and uses focused checks/lint/freshness as part of its existing work. One final **2.6.9**
session combines all candidates, fixes remaining defects itself, runs typecheck, lint, full coverage,
architecture, parity/build, generated and original recovery/scenario/concurrency/redaction/production-
route proofs, then obtains fresh independent review of the complete candidate. Finalization includes
handover and cleanup; no task follows it. Findings are fixed there with required reruns/review;
no repair handbacks and no master integration before PASS and required gates.
This moves timing only: every proof, assertion, membership rule, coverage floor, isolation and deadline
remains binding. Coverage runs without this batch's compiler/linter contention; observed resource
conflicts are assigned explicitly. General D191 reuse/rerun and documentation-only rules still apply.

**Rename-first trial clarification (2026-09-09).** This cadence applies only to Phase 2.6.
New 2.6.2 R uses focused tests, lint and affected freshness, including targeted fresh/historical
rename checks; no full coverage, whole architecture suite or broad parity per task. Full gates and
independent review belong to 2.6.9, with required reruns after repairs. Handover within finalization verifies
and reuses unchanged final evidence. Other phases and existing in-flight assignments are unchanged.

**2026-09-09 L integration exception.** The operator approved 2.6.7
[L01–L06](../plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/prerequisites.md#approved-l-execution-brief--2026-09-09): focused tests, lint and affected freshness, then local master
merge and owned cleanup by the L supervisor. Repeat invalidated integration checks; full gates
and complete independent review remain 2.6.9. This supersedes final-only master timing for L.

**2026-09-09 C integration exception.** The operator explicitly approved 2.6.5 C local master
integration and owned cleanup after the focused checks in its
[approved C01–C05 brief](../plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/run-completion.md#approved-execution-brief--2026-09-09).
This overrides the earlier no-master-integration-until-final-PASS rule for C only. Run meaningful
focused unit/architecture checks, lint, affected freshness and filtered Storage Doctor verification;
repeat invalidated checks after integration changes and verify unchanged inputs before reuse.
Full typecheck/coverage, broad architecture/parity/build/performance and fresh complete independent
review remain in 2.6.9. C completion is a merged development release, not final phase acceptance.
No live application, push or automatic successor is authorized. Other assignments retain their rules.

**2026-09-09 F integration exception.** The operator approved 2.6.6 F local master merge and
owned cleanup after its [F01–F07 focused proof](../plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/foundation.md#approved-execution-brief--2026-09-09).
This overrides generic no-master/retention timing for F only. Run its explicit focused unit and
architecture selectors, lint, affected freshness and filtered existing UI proof; prove real baseline
transactions/recovery and four-domain independence before release. Integration repairs require
invalidated checks again; unchanged-result reuse requires tested input comparison. Full typecheck,
coverage, broad architecture/parity/build/performance, complete phase acceptance and fresh independent
review remain in 2.6.9. F completion is a merged scoped development release, not final acceptance.
Preserve all inherited proof, floors and failure semantics; no operator database application,
automatic successor, push or waiver of a failing focused check is authorized.

**2026-09-09 D integration exception.** The operator approved 2.6.6.2 D local master merge and
owned cleanup after the focused gates in its
[D01–D05 brief](../plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/diagnostics.md#approved-execution-brief--2026-09-09).
Run the assigned unit/architecture selectors, lint, affected freshness and dedicated desktop proof;
recheck invalidated integration inputs before release. This overrides generic no-peer-merge and
retained-branch timing for D only. Full typecheck, coverage, whole architecture/parity, broad
build/performance and fresh complete independent review remain at 2.6.9. The filtered desktop lane
may build its required candidate bundle. Preserve every product proof, assertion, floor, isolation
and timeout; scoped PASS is not phase acceptance and a failing focused check cannot be deferred.

**2026-09-09 P integration exception.** The operator approved 2.6.6.1 P local master merge
and owned cleanup after the [P01–P06 focused proof](../plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/provider-usage.md#approved-execution-brief--2026-09-09),
including mixed generic/legacy reservation integrity and historical valid/corrupt controls. This
supersedes generic no-master/retained-candidate timing for P only. Run assigned/affected focused
units/guards, lint and freshness; rerun invalidated integration checks or verify exact input reuse.
Full typecheck/coverage, broad architecture/parity/build/performance and complete independent review
remain 2.6.9. No proof, floor, failure semantics or sibling ownership is waived.

**2026-09-09 G integration exception.** The operator approved 2.6.6.3 G
[G01–G06](../plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/artifacts.md#approved-execution-brief--2026-09-09).
After repaired F, one supervisor runs the assigned focused tests, lint and affected freshness,
merges locally into master and cleans up only G’s owned checkout/ref. This overrides generic
retained-candidate/no-master timing for G; rerun invalidated checks after integration changes and
verify input equality before reuse. Full typecheck/coverage, broad architecture/parity/build/
performance, combined archive/recovery proof and complete independent review remain in 2.6.9.
G completion is a scoped development release only; no push, live application or sibling launch.

**2026-09-09 S integration exception.** The operator approved 2.6.6.4 S
[S01–S06](../plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/decisions.md#approved-s-execution-brief--2026-09-09).
After complete repaired F, run the assigned focused units/guards, lint, affected freshness and
isolated/filtered desktop proof; merge locally and remove only S's owned checkout/ref. This
supersedes S's generic no-master/retained-candidate timing. Rerun invalidated integration checks
or prove exact unchanged-input reuse. Full typecheck/coverage, whole architecture/parity, broad
build/performance, original phase-wide recovery/scenario proof and complete independent review
remain 2.6.9. No failing assertion, floor, safety boundary or sibling ownership is waived. S
completion means a merged scoped development release, not full phase acceptance.

**2026-09-09 A integration and proof-allocation exception.** The operator approved 2.6.7.1 A
[A01–A06](../plans/phase-2/2.6-revalidate-tails-against-canonical-authorities/database-modernization/decisions.md#approved-a-execution-brief--2026-09-09),
including three bounded existing-test updates. Run its exact focused unit/architecture selectors,
lint and affected freshness; merge locally after focused PASS and verify owned cleanup. Recheck
invalidated integration inputs or prove exact input reuse. A proves generic display data and parser
independence; V/H retain served preview/viewer and desktop rendering/accessibility. L owns physical
old-table retirement and shared upgrade/readers after A's populated conversion proof. Combined
completion requires that follow-up. Full typecheck/coverage, broad architecture/parity/build and
fresh complete independent review remain 2.6.9. No assertions, floors, safety or peer ownership are
waived; no failing focused check is deferred. No push, live application or successor dispatch.

### 3.15 `redaction-surface-scan.test.ts` — the redaction surface scan (D183, 2j)

<!-- roadmap: p2-2j -->

Ref clock-config-secrets §6 already says redaction is schema-owned and that "tests seed canary passwords, cookies,
storage state, SSNs, DOBs, and private keys and scan every produced note/failure/screenshot
metadata/bundle/notification." Until D183 nothing owned that sentence: redaction appeared only as a
**clause** inside §3.10's `evidence-receipt`, the notification guard, §3.11's `ai-advisory-no-authority`
and `provider-capability-boundary` — four partial views of one rule, each looking at one producer,
none of them able to answer *"what about the surface nobody thought of?"*. This guard is that sweep,
and it has two halves that catch different failures. Neither is sufficient alone.

**Egress is the axis, not "is it a wire".** A value's obligation depends on where the bytes go:

| egress class | what it is |
|---|---|
| `operator-loopback` | the dashboard bound to `127.0.0.1` (ref clock-config-secrets §6.1), read by the one authorized operator |
| `phone-scoped` | ref operator-trust §7's single non-loopback ingress — the operator's own phone |
| `durable-authority` | a row in the authority database, retained and re-served |
| `durable-file` | bytes under the state root that are never pruned (the ledger) |
| `process-egress` | bytes handed to a third party — today an AI provider |
| `os-notification` | text the operating system renders, possibly on a locked screen |

**(a) The declaration audit.** Every registered surface is walked through `z.toJSONSchema`, and each
leaf is either provably harmless — an enum, a literal, a number, a boolean, a pattern- or
format-constrained string — or a **redacted subtree**, or it must carry a declared **origin**:

- `repository-authored` — composed inside `src/` from literals, closed vocabularies, branded ids and
  numbers; it cannot hold a captured value.
- `declared-redacted` — pushed through `redactValue` under a declared `(classification, transform)`.
- `local-filesystem-name` — a file this repository itself created.
- `captured-hr-value` — read from an external HR system or the operator's own uploaded file.
- `external-text` — free text authored OUTSIDE this repository and copied verbatim (a thrown
  `error.message`, a page title, a provider's answer). Nobody here controls what it contains.

The matrix is where the teeth are. `os-notification` admits **only** `repository-authored` — ref dashboard-surfaces
§2.6's "no raw secrets or captured form contents in notification text" as a schema property rather
than a promise. `process-egress` admits only what this repository wrote or explicitly redacted.
`durable-file` needs a written **exception** for a captured value and refuses external text outright.
`durable-authority` needs an exception for external text — which is how `FailureRecord.summary`
(`error.message` verbatim, D142) and the receipt warning that copies it end up **named** rather than
assumed. `operator-loopback` admits every origin, because the operator is entitled to their own run's
data; its teeth are that every leaf is dispositioned at all, plus half (b).

**Superseded Explorer history (D290 reconciliation, 2026-08-31).** DCC4's exact v19 SQL and digest
remain test-only source-lineage evidence, and an existing exact DCC4 v19 database is refused before
mutation. `explorer_edit_reviews` and `explorer_edit_outbox` are omitted from the integrated registry;
their inert declarations in `src/domain/dashboard/explorer-edit.ts` have no repository, writer, read
surface, or registered durable egress. They therefore do not create `durable-authority` redaction
surfaces or retention exceptions. Active Explorer wire results and the current SQLite override record remain audited through
`src/domain/dashboard/explorer.ts`; migration 51 and the stopped source receipt implement D337.

Redaction arms are recognised **structurally** — every arm declares `state`, `classification` and
`transform` — never by comparing bytes against a standalone serialization of `RedactedFieldSchema`.
The byte comparison is the obvious check and it silently stops working exactly when a schema is
embedded and `z.toJSONSchema` hoists the shared subtree behind a `$ref`; every redacted value would
then decompose into a free-text `key` plus an open `value`, and the table would fill with
dispositions for leaves that already carry their own.

Because the audit reads the schema rather than a list, **a field added to a wire contract cannot
ship without a decision**: it lands as a new undispositioned leaf and the guard goes red. The
completeness check runs in both directions at two levels — every module that can declare a surface
(everything under `src/domain/dashboard/`, plus a named set covering capture, intake, the ledger,
notifications and the trust records) must be registered, and every exported `*WireSchema` must be
either a registered surface or carried by one.

A `*Redacted`-suffixed leaf must be declared `declared-redacted`, or its **name** must be waived with
a written reason; a source arm additionally refuses any `<name>Redacted:` write in `src/` that is not
a schema declaration. Both halves exist because of what the first sweep found: `valueRedacted` on the
run-detail Data and context sections **is not redacted** — `src/server/dashboard/queries/run-detail.ts`
serves the raw recorded scalar, which ref dashboard-surfaces §1.1(c) entitles that rail to — so the value is fine and
the NAME is the defect, waived by decision rather than quietly accepted. In the other direction,
`page.urlRedacted`, `page.titleRedacted` and `subject.*.displayRedacted` have **no producer at all**
today: they are declared, consumed by the run-detail wire and dropped by the advisory's table, and
never filled. The first code that fills one is what the producer arm exists to stop, which is why it
ships before the code it guards.

**(b) The canary sweep.** Ref clock-config-secrets §6's exact sentinel list — a password, a cookie, a storage-state
blob, a private key, a credential-file path, an unissued SSN, an impossible DOB — plus a person name
and an EID, each impossible in real data so a hit is never a coincidence. The plant is asserted to
have reached the source **before** anything is derived from it: a sweep whose sentinels never landed
proves nothing and goes green forever. Then the real producers run:

- `buildFailureTriagePrompt` over a maximal `FailureRecord` whose every free-text leaf carries a
  sentinel. Nothing survives, and every dropped path still appears as a **withheld** fact — silence
  would tell the model the fact does not exist, which is a different and false statement.
- `projectNotificationTrigger` over all seven trigger arms, plus a proof that each arm's schema
  **refuses** free text in every one of its fields. D138's "there is nowhere to put it" as a checked
  property, not a review note.
- `ledgerLineForOutbox`: no universal canary in the line, and an undeclared key cannot ride along —
  the ledger is never pruned, so a value that reaches it is permanent.
- `buildRunEvidenceReceipt` over the REAL 2026-08-04 person-lookup exit run seeded into a real
  authority database. The subject's full name is genuinely in the stored checkpoints and absent from
  the receipt, which still answers the operator's question with its declared `last4`.
- `redactDiagnosticFields`: an unclassified field is dropped **with** a warning, never passed through.

Every mechanical arm runs against a violating fixture through the guard's own entry points —
undispositioned leaf, refused origin, missing exception, gratuitous exception, stale disposition,
orphan disposition, a decoy shape that merely resembles a redacted arm, a fixture producer writing
`urlRedacted: page.url()` — plus a positive control proving the canary scanner fires on a planted
value. An arm that would pass a deliberately-leaking fixture is not enforcement.

This guard deliberately does **not** restate `no-secret-values-in-logs.test.ts` (a credential
interpolated into a `log.*` call), `secrets-single-source.test.ts`, `evidence-receipt.test.ts` (the
receipt's own canaries and its declaration-time refusals), the unit `advisory-redaction.test.ts`,
`notification-durability.test.ts` or `capture-durability-and-scope.test.ts`. It audits in one sweep,
in both directions, the surfaces those guards each see one at a time.

---

## 4. `descriptor-coverage.test.ts` — the ONE rebuild guard replacing parity-list design

<!-- roadmap: p1-authority -->

Owned by **ref workflow-model §1.4**; this doc owns the **crosswalk** (which legacy invariants it replaces in
the rebuild repo, while the legacy repo's own guard files remain through initial cutover) and the
**exhaustiveness argument**. A table-driven test over the core composition-root registry and its
generated client projection. It is exhaustive because every named projection in this matrix is derived
from the descriptor, and the guard walks the whole projection set—a descriptor that fails to
project any surface fails the build:

| Projection (the surface) | Old parallel list it kills | descriptor-coverage check (§1.4) |
|---|---|---|
| id + `code` (trace prefix) | `operationTraceCode` switch | ids unique; codes unique + 2 chars (#1) |
| `icon` | `WORKFLOW_ICONS` | `icon ∈ ICON_NAMES` exhaustive (#1) |
| `label` / `sessionLabel` | `INSTANCE_LABELS` | `sessionLabel ?? label`; round-trip (retires parity) |
| `inputSubject` → queueRowKind | `SUBJECT_TO_KIND` | kind derived, not hand-listed (retires parity) |
| `surface.shape` (archetype) | archetype hand-decl | shape read off descriptor (retires parity) |
| run surfaces (`inputRun`/`uploadRun`) | `INPUT_RUN_REGISTRY`, `RUN_MODAL_REGISTRY`, the two `DASHBOARD_*_WORKFLOWS` lists | pure `DESCRIPTORS.filter(...)` derivations (#2) |
| steps + gates (timeline source) | step-label switches (`formatStepName`, `types.ts:405`) | node ids unique; labels from contract `title`; timeline computed from spans + these (#3/#4) |
| `systems` (session planner input) | hand `systems:` list | derived union of contract `<system>/` prefixes; each a known `SystemId`/service store (#4) |
| `verdicts` | `queue-row-status-index` + `statusExtensions` | closed tuple keys unique; emitted verdict must belong to descriptor (ref dashboard-surfaces) |
| `completion` targets | OCR approve branching | targets typecheck vs target descriptors' strict `input` and terminal `result` (#5) |
| graph branch/fork/child/gate subscriptions | handler-side delegation and wait registries | all edges/joins/targets/results/policies typed and validated; target input/result generics may not erase to unknown |
| scenario corpus | e2e stub map | descriptor references every branch/delegation/gate/control scenario in the checked manifest corpus. **As-built:** the "examples seed the minimal happy execution" half never shipped — no runtime reads a contract's `example` (§7), and what replaced it is the structural scenario over `walkDescriptor` plus the T1b live scenario (§10.3, §10.4) |
| runtimePolicy actions | `runtime-policy-coverage` | actions/gates read off descriptor (retires parity) |
| `details`, capabilities, coordinator, completion-consumption, artifact projections | detail/runtime-policy special cases and i9 retention append | every emitted detail/action/member/coordinator projection validates; Edit Data paths exist in producing schemas and exclude identity/idempotency/proof/provenance; artifact source/key paths exist in exact node outputs and every sink kind resolves |
| `enqueue`, actions, delegation policies | workflow-specific route/control handlers | only closed ref dashboard-surfaces policies/actions; every action projects the standard versioned command target, CAS is enforced only for ref dashboard-surfaces's real-race arms, and no custom row mutation callback exists |
| task UI dependencies + subjects | selectors/helpers scattered through workflows | every semantic id resolves in the same-system driver registry; every write has an enforceable subject observation; raw page access is absent |
| workflow terminal `result` | parent reading child tracker blobs | strict result derives only from declared terminal dependencies and every awaited child consumes that exact schema |
| evidence requirements | implicit “done means probably okay” | required receipts/proofs/artifacts/failure/confidence project from the descriptor/contracts; terminal completeness validates |
| presets, match key, item-id derivation | per-workflow input/control registries | input presets parse; identity functions return stable non-positional ids |
| presentation/queue title/operator subject | queue presentation switches | client projection carries resolved policies; no workflow-id branching in components |
| version/fingerprints | implicit deploy compatibility | stamped consistently into run/checkpoint/span/client projection; clean-checkout reproducibility + source/schema-change sensitivity prove deterministic manifest (no path/mtime/function-string input) |

Plus two guarantees: bundle-safety—descriptor modules import only zod/domain; the core registry
is the only layer importing workflows, and the dashboard imports only generated/wire projections.
A **new-hand-list
ratchet** — any object literal in the rebuild `src/` (outside `descriptor.ts`/`workflow-registry.ts`) whose
keys include ≥3 known workflow ids fails with "derive it from DESCRIPTORS instead." That ratchet is
is a smell detector, not the completeness proof: it misses arrays, maps, JSON, and one/two-workflow
exceptions. The explicit projection matrix above and source-surface inventory are authoritative.

---

## 5. The guard-of-guards manifest — accidental shrink protection, not an undeletable law

<!-- roadmap: p1-base -->

Rot vector: a guard file is deleted, renamed, or dropped from the `test:architecture` glob, and
nobody notices the umbrella shrank. Extends the existing `gate-coverage` meta-guard.

`docs/rebuild/guard-inventory.json` is the reviewed design inventory (owner, invariant, replacement
required on removal); under D93 it travels with the plan docs into the rebuild repo, where
`tests/architecture/guard-manifest.test.ts` loads it rather than defining a second inline name
set. The test asserts:
1. every inventory name maps to a real file recursively under `tests/architecture/`;
2. every recursively discovered `*.test.ts` file is in the inventory (no unregistered guard — forces a
   conscious add, and forces this doc's inventory to stay honest);
3. the named `unit`, `integration`, `architecture`, and `scenario` Vitest projects form one exhaustive,
   non-overlapping collection of every offline authored `*.test.ts`/`*.test.tsx` file; the future
   live-dependent combined tier stays uncollected until it has its own runner; architecture includes
   the complete recursive guard directory exactly, `unit` and `integration` use disjoint roots, the architecture
   project excludes nothing, and `test:architecture` selects only that project while forcing empty
   collection to fail; an
   independently collected unit test exercises that refusal so
   the architecture lane cannot be its sole witness (a rename or nested guard cannot orphan or
   double-run it);
4. every active rebuild-`src/` scan resolves at least one file; a family is activated in the same
   commit as its first file, and `ENOENT`/an unmatched glob is never converted to green;
5. the rebuild-scoped ratchets (the port-set in §2) each have a registered executable scanner;
   every scanner is run against a violating fixture so a comment or dead declaration cannot stand in
   for enforcement, and active scanner results are non-empty;
6. `gate-coverage`'s assertions are kept inline and pin the exact per-commit command family
   (`typecheck`, `lint --max-warnings 0`, `test:coverage`) plus the targeted `test` convenience, so an
   inert wrapper cannot satisfy the gate by merely containing the expected words;
7. ESLint's CLI target and the matching `eslint.config.js` typed rule blocks both include the three
   authored roots and the exact root TypeScript configs admitted by `tsconfig.json`;
8. D70's scope split survives the repo split, and **as-built the rebuild half is enforced as a
   BAN**: `gate-coverage.test.ts` asserts that no script in this `package.json` matches
   `legacy-tests-ratchet` or `:rebuild`, and that `lint` carries `--max-warnings 0` over each of the
   three authored roots (`src`, `tests`, `scripts`) with `--no-error-on-unmatched-pattern` forbidden
   anywhere. The legacy repo's own obligation (ordinary source lint green; its test ratchet
   consuming the reviewed fingerprint manifest rather than ignoring failures or comparing a total
   count) is a LEGACY-repo rule this tree no longer reads — D150 retired the cross-repo accounting.
9. **The visual-parity lane is held to the same standard as a guard arm (D132).** `npm run
   test:parity` (ref frontend-backend-integration §7, owner) is outside the vitest projects, so §5's file-set audit cannot see
   it; `parity-reference-authority.test.ts` covers it from inside the architecture suite instead. It
   proves the lane can FAIL in both of the ways it silently could not: a stored `.a11y.yml` /
   `.meta.json` reference is compared and left untouched on mismatch rather than rewritten (refresh
   is the deliberate `npm run test:parity:update`, one switch for the pixel and semantic halves
   alike), and the served `dist/dashboard` must carry a stamp binding the working-tree input digest
   and the emitted output digest. Both arms run against violating fixtures AND through the lane's
   own entry points, because a check that cannot fail reads as coverage — the same failure mode as a
   scan that resolves an empty file set (item 4).
   **D145 adds the third arm: a guard's THRESHOLD is part of what it claims.** The pixel half's
   allowance is `maxDiffPixels: 0`, so one moved pixel fails; its per-pixel colour tolerance is
   pinned explicitly and calibrated against a recorded measurement (ref frontend-backend-integration §7.1). The prior
   `maxDiffPixelRatio: 0.001` was chosen, not measured, and it hid a visible content change — and
   because `updateSnapshots: "changed"` decides what to rewrite with the same comparison, a
   too-wide allowance also disables the deliberate refresh, shipping pairs whose semantic half was
   current and whose pixel half was stale. The guard asserts the config's *resolved* comparison, not
   its text, and refuses any per-call override under `tests/parity`. Generalize it: a guard whose
   stated guarantee is stronger than the number it enforces is the same defect as a guard that
   cannot fail, and the number needs evidence in its owning doc.
10. **The durable config leaf set is pinned per generation, the same way released migration bytes
    are (D133).** `config-snapshot-generations.test.ts` (ref clock-config-secrets §4.1, owner) is
    `migration-history-immutability.test.ts`'s sibling for the OTHER durable contract: a required
    config leaf added — or tightened — without registering it in `CONFIG_SNAPSHOT_GENERATIONS` and
    bumping `CURRENT_CONFIG_SNAPSHOT_GENERATION` invalidates every stored `config_snapshots` row and
    makes an existing authority database unopenable. The guard proves both directions against
    synthetic leaf sets: an unregistered addition fails with the remedy named, and a released
    generation's pinned set cannot be edited away. It also pins that a stored snapshot tolerates
    exactly the registered post-baseline leaves being absent, and that a missing group is a loud
    failure rather than a silently applied default.

ESLint's known empty-pattern behavior is part of the ordering contract: no unmatched glob argument
is added before the first real file in its family, and `--no-error-on-unmatched-pattern` is
forbidden. The first file, CLI target, and full config coverage land atomically.

The manifest prevents accidental file deletion, rename, or glob orphaning. It **cannot** prevent a
deliberate coordinated edit that deletes both a guard and its inventory entry; no self-owned test can.
Guard removal therefore requires an explicit architecture decision entry naming the retired
invariant and its replacement/manual rationale, checked by CI for removed inventory keys and by
code review. Existing legacy guards may not be removed during rebuild or initial cutover. The plan
makes no stronger mechanical claim.

### 5.1 The full registered set — where every doc's guards converge

<!-- roadmap: p1-base -->

The inventory is the one machine-readable place the umbrella is enumerated. Each doc owns its
guards' contracts; the manifest owns that they exist and stay wired. **This list is the as-built set
at HEAD, read from `docs/rebuild/guard-inventory.json` — 97 entries: 85 `active`, 11 `retired`, 1
`planned`** — not an aspiration. `guard-manifest.test.ts` compares the active `file` list against a
recursive walk of `tests/architecture/` with `deepEqual`, which is bidirectional by
construction and has one consequence worth stating outright: **a retired or planned guard's
`.test.ts` file must not exist on disk**, or the walk finds a file the inventory does not claim.

**The nine ratchet arms (§2.1) are not inventory entries.** They are named in
`rebuildRatchetActivation.requiredGuardNames` and executed by `guard-manifest` itself, each against
the real tree and against its own violating fixture.

**Active, by owning contract:**

- **Meta — the guard-of-guards and the gates (this doc, §5):** `guard-manifest`, `gate-coverage`,
  `parity-reference-authority` (item 9), `roadmap-doc-binding` (D263 — the plan ↔ docs binding),
  `config-snapshot-generations` (item 10), `migration-history-immutability`,
  `operational-isolation`, `test-runtime-root-isolation`, `test-target-registry`.
- **Descriptor and contract SSOT (ref workflow-model §1.4, ref task-contract):** `descriptor-coverage`,
  `task-contract-sealing`, `task-store-boundaries`, `task-driver-boundary`, `semantic-ui-registry`,
  `canonical-input-snapshot`, `strict-boundary-schemas`, `intake-canonical-field-registry`,
  `intake-mapping-boundary`, `edit-data-field-policy`, `ucpath-person-org-strict`,
  `ocr-producer-parity`, `explorer-prose-declared`.
- **Write safety (ref write-safety):** `write-safety-contract` (the completion union plus the
  `unverifiableByPage` reading of §3.5), `transaction-pairing`, `subject-before-fence`,
  `identity-gate-before-commit`, `permanent-key-dedupe`, `recovery-negative-proof-settlement`,
  `atomic-write-outbox`, `ledger-projector`, `no-positional-identity`, `artifact-effect-boundary`.
- **Execution, sessions and providers (ref execution-and-sessions):** `driver-lease-boundary`,
  `fresh-session-boundary`, `single-flight-login`, `authentication-proof-not-url` (D120 — no login
  recipe concludes authentication from a URL, and every landed browser-system binding supplies a
  content verifier), `multi-worker-overlap`, `worker-teardown-soak`, `bounded-task-deadline`,
  `provider-capability-boundary`.
- **Authority, commands and the archive:** `storage-recovery` (which since D188 also carries the
  retired `authority-target-no-fallback`'s invariant), `control-command-single-path`,
  `delegation-manifest`, `command-result-exhaustive` (D253 — a dashboard module naming one refusal
  arm without the other), `archive-invariants`.
- **Dashboard and the wire (ref dashboard-surfaces, ref frontend-backend-integration):**
  `dashboard-wire-boundary` (no Node built-in reachable from the bundle entry),
  `dashboard-refresh-boundary` (doc 13 §8.14 — a surface module exports components only),
  `dashboard-memo-prop-stability`, `wire-connectivity` (the four joints), `one-projection-counts`.
- **Trust surfaces (ref operator-trust):** `evidence-receipt`, `notification-durability`,
  `knowledge-fix-integrity`, `workflow-editor-compile-integrity`, `phone-capture-retired`,
  `ai-advisory-no-authority`, `redaction-surface-scan` (§3.15), `scenario-coverage` (§3.10, and the
  guard §10 extends), `workflow-layout`, `step-omission-invariants`.
- **Clock, config and secrets (ref clock-config-secrets):** `clock-single-source`,
  `manual-clock-test-only`, `secrets-single-source`, `no-secret-values-in-logs`.
- **Legacy-facing inventories (audited as DATA, never linked at runtime):**
  `legacy-selector-port-provenance` (406 keys pinned to one legacy commit's blobs),
  `legacy-capability-disposition` (§3.11), `legacy-test-disposition`,
  `runtime-environment-coverage`, `runtime-dependency-coverage`.
- **Authentication ceremony:** `duo-ceremony-lease`.

**Planned — cutover input remains:** `one-time-import-offline`
(the cutover data migration, doc 05 §Exit criteria). `preflight-coverage` is active under 3.1.11.1. D332's adapter deletion tests are planned entries
too; §5.2 lists them.

**Retired — nine, each naming its successor or disposition in the inventory:** `runtime-isolation` → `operational-isolation`
(D93), `rebuild-gates` → `gate-coverage` (D93), `legacy-preservation` → nothing, deliberately (D93),
`legacy-change-accounting` → live re-verification at each migration (D150),
`capture-durability-and-scope` → `phone-capture-retired` (D294), and D188's four:
`authority-target-no-fallback` → `storage-recovery`, `commit-routes-through-mutation` →
`task-driver-boundary`, `dry-run-composition-submit-free` → `write-safety-contract` plus the
`separations-kuali-finalization/dry-run` T1 manifest and its structural executor proof,
`sleep-budget` → the `wait-for-timeout` arm plus `bounded-task-deadline`. `guard-manifest` holds a retirement to a real standard: `retiredBy`
must match `/^D\d+$/`, the `invariant` must be longer than 40 characters (a retirement has to explain
where the invariant went), and `replacementRequired` stays `true`.

**Open — an invariant §2's port map named and nothing holds by name.** Two, and they are listed
here rather than left implicit: **`cancel-mechanism`** (one-mechanism cancel; `control-command-single-path`
makes a second path unable to reach authority but nothing asserts uniqueness) and
**`tracker-row-emission`** (no arm bans an `appendFileSync` to the event JSONL outside the span
emitter, though D218 deleted the in-process `onEvent` hook that was the other half of the risk).
Neither is a silent gap any more; each is a candidate the next guard-touching slice can close or
argue away in an inventory entry.

A guard added to any doc that never lands in the inventory fails the manifest — so a doc's §guards
promise cannot quietly stay a promise. The manifest still **cannot** prevent a deliberate
coordinated edit deleting both a guard and its entry; no self-owned test can (§5's closing
paragraph).

### 5.2 D332 compatibility adapters and their deletion tests (0.3 Task 3, 2026-09-04)

**Task 1.6.6 implementation binding (D336), retired by 2.6.9.** SQLite remains the only
runtime ordinary settings authority; `sqlite-settings-authority` stays active. The four A0/A1
settings adapters are removed. `authority-upgrade-adapters-retired` replaces the retired isolation
guard, preserving the dynamic stopped dispatch and checking module/import/API absence plus actual
legacy-input non-adoption. Supported conversion belongs to `src/infra/sqlite/stopped-database-conversion.ts`
through `src/server/storage/upgrade.ts`. A2/A3 retain their existing assignments.

#### Phase 2.6.9 retirement proof amendment — 2026-09-10

The operator-approved [D332.9 separation](dashboard-surfaces.md#phase-269-recovery-separation--2026-09-10)
retains supported stopped database conversion/historical archive recovery while deleting the four
expired settings adapters and their import behavior. Before deletion, execute and preserve the
fresh/v29 migration and migrated-copy recovery proof. At deletion, activate
`authority-upgrade-adapters-retired` and retire `authority-upgrade-adapters-isolated` in the same
implementation commit and inventory update. Keep `sqlite-settings-authority` active. The retirement
guard must fail for any restored adapter module/import or equivalent old settings import behavior;
module absence alone cannot excuse copying that behavior to another file.

Add named below-floor database/backup refusal tests at the actual stopped entry boundaries, proving
no replacement, conversion or credential access, with successful supported-source controls. Retain
historical-reader grammar/integrity tests and supported populated archive conversion/interruption/
replay cases. Rebind old fixtures only with an assertion-by-assertion historical/current/refusal
mapping; never blanket-delete their coverage or execute deleted adapters from another checkout in
finished gates. A renamed/refactored supported conversion entry must remain behind explicit stopped
admission and have import/consumer coverage. This planning amendment changes no guard status yet.

The following strict-reader implementation binding remains applicable after retirement.

Strict historical-backup readers `backup-inspection.ts`, `d331-settings-current.ts`,
`d331-settings-root.ts` and `d331-protected-journal.ts` under `src/infra/compat/` remain after
adapter expiry. Immutable journal grammar in `src/domain/commands-history.ts` and
`src/domain/config/settings-v29-schema.ts` also remains: neither is a runtime settings fallback.
The SQLite implementation boundary now includes the private historical backup and stopped
conversion adapters; no server/core/domain module receives a raw connection or imports
`node:sqlite`. `sqlite-authority-boundary.test.ts` enumerates that closed implementation set and
keeps the public SQLite entrypoint and `AuthorityDatabase` repositories free of SQL escape hatches.
The lifecycle SQL guard admits only the exact stopped tombstone ordinal UPDATE in that adapter;
all other lifecycle SQL and mutators retain the service/adapter boundary. The migration proof
pins rollback, trigger restoration and every protected ordinal column.
The new guards' injected violations and the full candidate gates are required evidence.


> **D336 target amendment (2026-09-06):** Task 1.6.6 replaces ordinary file/SQLite coupling with
> SQLite-owned settings and independent credential operations (ref clock-config-secrets §D336).
> The A0/A1 and settings-pathname obligations below must be rebound to the actual supported source
> formats and a resolver that reads no settings file, rather than requiring a new settings pathname.
> Its focused plan must disposition every affected D331 P-proof and D332 M-proof and every adapter:
> retain the invariant, replace its implementation-specific test, or retire the removed mechanism
> with evidence. Until that implementation lands, the current guard inventory and active tests remain
> intact. A2/A3 lifecycle-reader cleanup and the protected-value exclusions remain required.


A *compatibility adapter* is defined by ref dashboard-surfaces §D332.9, whose five rules — named at
birth in one place; born with its deletion test; never a fallback; expiry is a deletion, not a switch;
pre-floor artifacts refuse by name after expiry — are cited here, not restated. The roster lives in
THIS doc because §5's manifest is where deletion tests converge: rule 2 makes every adapter's expiry a
`planned` `guard-inventory.json` entry whose `activationMilestone` is its phase, and §5.1's walk rule —
**a planned or retired entry's `.test.ts` file must not exist on disk** — is what stops a promised
deletion test from becoming a written-but-inert one. Two things this section is NOT. It is not the
migration proof list: the twenty-four proofs 1.6 owes for the upgrade itself are ref dashboard-surfaces
§D332.11's, and no row of them is repeated below. It is not the D330/D331 proof lists either
(§D330.11, ref clock-config-secrets §D331.11); where a `P<n>` or numbered proof row there already owns
an adapter's oracle, the roster says `n/a` and adds no second inventory entry. Every as-built line
cited below was re-read at `ea6985b9` and re-verified at `98d9cf69` (no `src/` change between them).

| Adapter | What it reads / translates | Owning module (1.6 fixes the path; name illustrative) | Allowed importers | Expiry phase | Deletion test | Red-capable oracle | Inventory entry |
|---|---|---|---|---|---|---|---|
| **A0** | the upgrade command's pre-floor readers: the old-layout parser and sidecar reader, the widened `.env` admission that classifies migrated leaves, the tombstone ordinal backfill, the orphan-gate sweep | `src/infra/compat/pre-floor-upgrade-readers.ts` | exactly the `storage upgrade` command module; never a dashboard, worker or dry-run composition, never `scripts/secure-env-bootstrap.ts` | 2.6 | `authority-upgrade-adapters-retired` (arm 1) | while the module exists, a reachability scan from every production composition root finds it and the arm FAILS; after 2.6's deletion the module path does not exist and the arm passes | `planned` now → `active` at 2.6 |
| **A1** | the old-pathname prepare/rollback reconciler the upgrade runs before the move (A0's dependency) | `src/infra/compat/old-pathname-reconciler.ts`, composing `join(stateRoot, "settings.json")` and its four siblings | A0 alone | 2.6 | `authority-upgrade-adapters-retired` (arm 2) + `settings-root-single-pathname` | module absence is arm 2; the pathname half is separate — `settings-root-single-pathname` FAILS while any `src/` module composes the OLD pathname and passes when `<stateRoot>/settings/` is the only settings authority any module names | `planned` now → `active` at 2.6 (two entries) |
| **A2** | the D268 fold arms in `run-status.ts` as lifecycle inputs — `row.ended` and `row.claimedBy` | `src/server/dashboard/run-status.ts:113` and `:117` (two lines inside `deriveRunStatus`, no new module) | its two existing callers, `queries/run-detail.ts:703` and `projectors/run-queue-projection.ts:1125` | 2.6 | `run-status-fold-contributes-no-lifecycle-arm` (a unit test, not a guard — see below) | a table-driven test over `(authority lifecycle × fold)` pairs whose expectations are authority-only; two pairs FAIL while the arms exist and pass once they are gone | n/a — unit test; §D330.12 item 1 is the ruling |
| **A3** | `runs_view` — NOT an adapter (§D332.9): a dead rebuildable table with zero readers, removed at 2.6 with the projector's rewire; listed for roster completeness. Nothing here can "fail while the read exists", because no read exists | the table (`migrations.ts:619`, `:647`; `src/domain/authority.ts:60`) and `repositories.runsView` (`authority-database.ts:972`, `:7565`) | as built: NO reader — the projector `clear()`s at `run-queue-projection.ts:718` and `upsert`s at `:1005` and serves from its in-memory fold via `deriveRunStatus` at `:1125` | 2.6 | `runs-view-has-no-reader` — an ARM of §D330.10's `no-lifecycle-sql-outside-the-adapter` guard, not a new entry (see below) | red-capable already at 1.6: the arm FAILS on any `SELECT`/`get`/`list` against `runs_view` outside the adapter, and the negative control is a stubbed `repositories.runsView.get` that THROWS, under which the whole dashboard query suite must stay green | n/a — an arm of the §D330.10 guard's entry |
| **A4** | the resolver's environment layer: `CONFIG_ENV_BINDINGS` (`resolve.ts:241`), the env application at `resolve.ts:388–394`, `configResolutionEnvironment` (`secrets.ts:569`), the `"env"` provenance arm (`provenance.ts:7`), the Settings editor's env-provenance read (`queries/settings-editor.ts:106–107`), and the `src/`-dead `resolveConfig` export (`resolve.ts:415`) | `src/domain/config/resolve.ts` + `provenance.ts` + `settings-editor.ts` | the nine composition callers of `resolveConfigWithProvenance` (`resolve.ts:419`), all of which lose the parameter at 1.6 | 1.6 | `n/a` — ref clock-config-secrets §D331.11 P3 + P4 own it | the `env` parameter is FIRST in both signatures, so its removal is compile-time red across every caller; P4's runtime half resolves under a hostile `process.env` populated for every retired key and asserts byte-identical output and no `"env"` provenance value anywhere | n/a — P3/P4 under the `settings-catalog` entry |
| **A5** | `secrets.ts`'s `process.env` reads for migrated non-provider names, and `TIMEKEEPER_NAME`'s `config-and-secret` dual channel | `src/domain/secrets.ts` (the accessors; `optionalTestTargetSecret` at `:470` is one of them) | `secrets.ts` is already the sole module permitted to read a credential from `process.env` (`secrets-single-source`), so the list is the accessors' own callers | 1.6 | `n/a` — ref clock-config-secrets §D331.11 P34 + P39 own it | P34 plants each migrated key in `.env` and in `process.env` and asserts the two named refusals with NO accessor read; P39's `secrets-single-source` WRITE arm is the other half — the guard gains an arm asserting the migrated names are written by the protected store and read from nowhere else | n/a — P34/P39 under the existing `secrets-single-source` and `runtime-environment-coverage` entries |
| **A6** | the pre-floor tombstone reader: NULL-ordinal `deleted_runs` rows (DDL `migrations.ts:419–430` has no ordinal columns) and `tallyVersion` 1 | the lifecycle service's tombstone reads and `DeletedRunTableSchema` | permanent — the ordinary readers | **permanent** — NOT an adapter (§D332.7 items 2–3): it reads history that legitimately lacks the fields | none — a permanent read-forward PROOF instead | the proof, not a deletion: §D332.11 row 11 plus §D330.11 test 25's watermark oracle over migrated rows. The negative control is that a NULL-ordinal row must never be back-filled with a guess; today's two-source watermark reads `tasks` alone (`authority-database.ts:5517–5518`, `:5541–5542`, under comments `:5511–5513`/`:5531–5533` that assume runs are never deleted) | n/a — §D332.11 row 11; never expires |
| **A7** | the `snapshot-generations` retirement arm | `src/domain/config/snapshot-generations.ts` (`CURRENT_CONFIG_SNAPSHOT_GENERATION = 4` at `:97`; the `retired` member at `:47–48`; `auditConfigSnapshotGenerations` at `:206`) | permanent — the ordinary readers | **permanent** — NOT an adapter (§4.1, §D332.7 item 4) | none — an ARM of the existing `config-snapshot-generations` entry: `retired-leaves-are-a-closed-list` | the proof is §D332.11 row 14. The NEGATIVE CONTROL is the load-bearing half: a vanished registered leaf that is NOT on the closed retired list must still refuse, exactly as `:234–235` refuses today | n/a — a new ARM of the `config-snapshot-generations` entry; never expires |
| **A8** | the eleven frozen parity references carrying the Settings surface's `settings.json: not set` line, and DCC3's eight-leaf editor inventory | `tests/parity/references/{settings,storage-settings}--*.yml` and the Settings surface inventory | the parity lane | 3.1 | `n/a` — ref clock-config-secrets §D331.11 P40 owns it | P40's oracle is a DELIBERATE re-freeze: `npm run test:parity` shows the eleven fail, `npm run test:parity:update` re-freezes, and the diff is reviewed as bytes. `parity-reference-authority` (§5 item 9) is what makes that failure real rather than a silent rewrite | n/a — P40; the parity lane's own entry already exists |

#### A0 — the upgrade command's pre-floor readers

*Name* `authority-upgrade-adapters-retired` (arm 1). *Invariant:* after 2.6 no module under `src/`
reads a pre-floor shape — no old-layout settings parser, no sidecar reader, no widened `.env`
admission, no tombstone backfill, no orphan-gate sweep — and the module that held them is gone.
*Red-capable oracle:* two arms, and both must be red for the right reason. Before deletion, a
reachability arm walks the import closure of every production composition root
(`src/server/dashboard/compose.ts`, `src/server/worker/compose.ts`,
`src/server/dry-run-scenario/runtime.ts`, `scripts/secure-env-bootstrap.ts`) and FAILS if the adapter
module is reachable from any of them — this is the arm that holds §D332.9 rule 3 while the adapter is
alive, since its widened `.env` admission is a parameter of the `storage upgrade` call and never of the
bootstrap. After 2.6 the arm asserts the module path does not exist at all. The violating fixture is a
composition root that imports the compat module transitively through one hop; `guard-manifest` runs the
arm against it so a deleted arm cannot stand in for enforcement. The two arms answer differently, so a
test that passed before and after deletion — §D332.9 rule 2's stated failure — is impossible here.

> 2026-09-04 | phase-0-3-authority-design C31da5310 R04 (cross-contract close) | the reachability arm cannot live inside a `planned` entry — §5.1's walk rule says a planned entry's `.test.ts` must not exist until activation, and a guard whose arm changes by phase would need a phase input, which is a flag §D332.9 rule 4 forbids. So A0/A1 carry TWO entries: **`authority-upgrade-adapters-isolated`** (`tests/unit/architecture/authority-upgrade-adapters-isolated.test.ts`, `active` from 1.6 Task 6's commit that lands the compat modules; invariant: the A0/A1 modules are unreachable from every production composition root and from `scripts/secure-env-bootstrap.ts`; violating fixture: a composition root importing the compat module through one hop) and **`authority-upgrade-adapters-retired`** (`planned` from that same commit, `activationMilestone` 2.6; invariant: the module paths do not exist). At 2.6 Task 2 the deletion commit flips `-retired` to `active` and marks `-isolated` `retired`, naming that decision and `-retired` as where the invariant went, exactly as §5's retirement rule requires. Intended entry 2 below is read with this split (two entries, six in all).

#### A1 — the old-pathname prepare/rollback reconciler

*Name* `authority-upgrade-adapters-retired` (arm 2), plus the separate `settings-root-single-pathname`.
*Invariant:* the reconciler that settles a `settings.json.prepare.json` / `.rollback.json` at the OLD
pathname exists only inside the upgrade, and after 2.6 the old pathname is composed nowhere.
*Red-capable oracle:* arm 2 has A0's shape (reachable-from-a-composition-root before, path-absent
after). `settings-root-single-pathname` is the second, different oracle and it is needed because a
module can be deleted while a stray pathname survives: three sites compose the old pathname today —
`src/server/dashboard/compose.ts:606`, `src/server/worker/compose.ts:415`,
`src/server/dry-run-scenario/runtime.ts:209`, each `join(stateRoot, "settings.json")`, with the four
siblings derived at `src/infra/config/settings-file.ts:577–578` and `:1104–1106`. At activation the
guard scans `src/` and FAILS on any composition of the old pathname or its siblings, passing only when
`<stateRoot>/settings/` is the sole settings authority a module names. Violating fixture: a composition
module that rebuilds the old pathname from `stateRoot`.

#### A2 — the D268 fold arms as lifecycle inputs

*Name* `run-status-fold-contributes-no-lifecycle-arm`. **A unit test, not a guard**, and deliberately:
the invariant is a value-level behaviour of one exported function over an enumerable input space, which
a table-driven test proves directly, whereas a guard would have to assert the absence of two source
lines — a text assertion about code that a rename defeats. §D330.12 item 1 is the ruling it enforces.
*Invariant:* `deriveRunStatus` derives status from the authority record alone; the span fold
contributes no lifecycle arm. *Red-capable oracle:* two pairs whose expectations are authority-only
and which today's `src/server/dashboard/run-status.ts:113` and `:117` get wrong — authority `claimed`
with fold `{ ended: { outcome: "done" } }` must answer `running` (line 113 answers `done` today), and
fold `{ claimedBy }` with authority `queued` must answer `queued` (line 117 answers `running` today).
Both callers, `queries/run-detail.ts:703` and `projectors/run-queue-projection.ts:1125`, are exercised
through their real queries so the fold cannot be removed from one and left in the other. Red-capable
from 1.6, deleted at 2.6.

#### A3 — `runs_view` (not an adapter: a dead table with no reader)

§D332.9 rule 2 needs a test that FAILS while the adapter exists and passes once it is gone; for
`runs_view` no such test can exist, because as built nothing reads it — so A3 is classified with A6/A7
as NOT an adapter. What replaces the deletion test is a guard ARM plus a negative control, and the
table is simply removed at 2.6. *Name* `runs-view-has-no-reader`. It folds into §D330.10's `no-lifecycle-sql-outside-the-adapter` guard
as an ARM rather than becoming its own inventory entry, because that guard already owns the closed
allowlist of modules permitted to issue lifecycle SQL and already parses the SQL text it forbids;
adding `runs_view`'s read forms to that table is one row in an existing mechanism, while a separate
entry would be a second place the same allowlist is written. *Invariant:* `runs_view` is written and
never read — §D330.10's "projection tables are never a lifecycle input". *Red-capable oracle:* the arm
FAILS on any `SELECT … FROM runs_view` or any `repositories.runsView.get`/`.list` call outside the
adapter; its violating fixture is a query module that reads the table for a status. The negative
control proves the as-built claim rather than assuming it: stub `repositories.runsView.get` to THROW,
run the dashboard query suite, and require it green — today it is, because the projector's only uses
are `clear()` at `run-queue-projection.ts:718` and `upsert` at `:1005` and it serves from the in-memory
fold at `:1125`. That control is what makes the table's removal at 2.6 a deletion rather than a
migration.

#### A4 — the resolver's environment layer

*Name:* none of its own — ref clock-config-secrets §D331.11 P3 and P4 own it, and this roster adds no
entry. *Invariant:* the resolver takes no environment input and `ConfigProvenanceSchema` has no `"env"`
arm. *Red-capable oracle, two halves.* Compile-time: the `env` parameter is FIRST in both
`resolveConfig` (`src/domain/config/resolve.ts:415`) and `resolveConfigWithProvenance` (`:419`), so
removing it is red at every one of the nine composition call sites — no silent widening is possible.
Runtime: P4 resolves with a hostile `process.env` populated for every retired key and asserts
byte-identical output and no `"env"` value anywhere; P3 asserts `CONFIG_ENV_BINDINGS` (`resolve.ts:241`)
is empty and `runtime-environment.ts`'s `config` channel has zero members. Note for 1.6: `resolveConfig`
has zero `src/` callers today but THIRTEEN files import it (ten under `tests/unit/**`, two under `tests/parity/helpers/**`, and `scripts/live-browser-login-smoke.ts:57`, inside the `typecheck` program — corrected 2026-09-04 by R04 from "five test files"), so its deletion is a test AND scripts edit too —
§D331.11 P39's "changed deliberately in the same commit" rule covers exactly this.

#### A5 — `secrets.ts`'s migrated `process.env` reads

*Name:* none of its own — ref clock-config-secrets §D331.11 P34 and P39 own it. *Invariant:* a migrated
non-provider name is never read from the environment as a value, and `TIMEKEEPER_NAME`'s
`config-and-secret` dual channel is gone with its leaf. *Red-capable oracle:* P34 plants each migrated
key in the admitted `.env` and in the parent `process.env` and asserts the two named refusals (bootstrap
by key name; dashboard and worker boot by key name) with zero accessor reads — a read is the failure,
not a wrong value. The second half is P39's new WRITE arm on the existing `secrets-single-source` guard:
the migrated names must be readable only from the protected store, so a restored `process.env` read
inside `secrets.ts` is red at the guard, not merely at a unit test. `optionalTestTargetSecret`
(`src/domain/secrets.ts:470`) is the D300 document-number reference this moves, and it keeps its
two-arm selector.
That set includes `providerModelChain`'s `legacyModelEnv` fallback (`src/domain/secrets.ts:666–667`; the five
singular `OCR_*_MODEL` names are already `retired-in-target`): model chains become ordinary catalog rows
(§D331.2) and the fallback is deleted with the accessor, never kept as a second source (R04, 2026-09-04).

#### A6 — the pre-floor tombstone reader (permanent read-forward, never an adapter)

*Name:* none — it never expires, so it has a proof and no deletion test. *Invariant:* a pre-floor
`deleted_runs` row that legitimately lacks the three ordinals and carries `tallyVersion` 1 is read
forward as it is, and is never completed, re-settled or guessed. *Proof:* §D332.11 row 11
(`tombstone-backfill-with-provenance`) plus §D330.11 test 25's watermark oracle over migrated rows —
neither is repeated here. The as-built reason it is read-forward rather than transitional: the DDL at
`src/infra/sqlite/migrations.ts:419–430` has no ordinal columns at all, and the two watermarks read
`tasks` alone (`src/infra/sqlite/authority-database.ts:5517–5518` and `:5541–5542`) under comments at
`:5511–5513` and `:5531–5533` that say in as many words that runs are never deleted. The negative
control is §D332.7 item 2's rejected alternative: a fabricated ordinal in the one row that exists to
tell the truth is a lie, so `ordinal_source = unknown` plus a doctor finding is the correct answer and
a test that accepts a back-filled number for a rootless tombstone is red.

#### A7 — the `snapshot-generations` retirement arm (permanent)

*Name* `retired-leaves-are-a-closed-list` — an ARM of the existing `config-snapshot-generations` entry
(§5 item 10), not a new entry, because that guard already owns the per-generation leaf-set ratchet and
this is one more direction of the same ratchet. *Invariant:* a leaf may be ABSENT from a stored
snapshot at or after the generation that retired it, and only then; every stored `fingerprint` still
verifies over its exact stored bytes. *Red-capable oracle:* §D332.11 row 14 — a pre-floor snapshot WITH
`operator.timekeeperName` and a post-floor snapshot WITHOUT it both parse, and a post-floor snapshot
WITH it refuses by leaf name. The **negative control is the load-bearing half**: a registered leaf that
vanished from the current schema WITHOUT being on the closed retired list must still refuse, exactly as
`src/domain/config/snapshot-generations.ts:234–235` refuses today ("a released generation is never
rewritten"). Without that control the arm would read as "absence is fine", which is the opposite of the
rule. `CURRENT_CONFIG_SNAPSHOT_GENERATION` is 4 at `:97`; 1.6 registers generation 5 as the registry's
first retirement.

#### A8 — the `settings.json: not set` parity references

*Name:* none of its own — ref clock-config-secrets §D331.11 P40 owns it. *Invariant:* the eleven frozen
parity references carrying the Settings surface's `settings.json: not set` line, and DCC3's eight-leaf
editor inventory, are re-frozen DELIBERATELY at 3.1 and never tolerated as drift. *Red-capable oracle:*
run `npm run test:parity` and see exactly those eleven fail; re-freeze with the one deliberate
`npm run test:parity:update`; review the diff as bytes. What makes that a real oracle rather than a
rewrite is §5 item 9's `parity-reference-authority`, which proves a mismatched reference is compared and
left untouched rather than silently updated, and §5 item 9's D145 arm, which pins `maxDiffPixels: 0` so
a moved pixel cannot hide inside an allowance.

#### Intended `guard-inventory.json` entries (1.6 lands them; 0.3 changes no config file)

0.3 is design (D326): `docs/rebuild/guard-inventory.json` is config-class and does not change in this
phase. What follows is the intended shape, in prose, for 1.6 to land — each as
`name · file · status · owner · activationMilestone · invariant`.

1. **`settings-root-single-pathname`** · `tests/unit/architecture/settings-root-single-pathname.test.ts`
   · status: `planned` · owner: `docs/rebuild/reference/clock-config-secrets.md` (with
   `docs/rebuild/reference/guards-and-tests.md` as the manifest half) · `activationMilestone`: `2.6` ·
   invariant: after A1 expires, no `src/` module composes `<stateRoot>/settings.json` or its four
   `.authority.json` / `.prepare.json` / `.rollback.json` / lock siblings — `<stateRoot>/settings/` is
   the only settings authority any module names.
2. **`authority-upgrade-adapters-retired`** ·
   `tests/unit/architecture/authority-upgrade-adapters-retired.test.ts` · status: `planned` · owner:
   `docs/rebuild/reference/dashboard-surfaces.md` · `activationMilestone`: `2.6` · invariant: the A0 and
   A1 compatibility modules are unreachable from every production composition root while they exist and
   absent from the tree after 2.6; no flag, mode or environment value re-enables a pre-floor reader.
3. **`runs-view-has-no-reader`** — NOT a new entry. It lands as an arm of §D330.10's
   `no-lifecycle-sql-outside-the-adapter` guard (whose own entry 1.6 adds), because that guard already
   holds the two-module lifecycle-SQL allowlist and the forbidden SQL forms; a separate entry would
   write the same allowlist twice. Invariant carried by the arm: `runs_view` is written by the projector
   and read by nothing, so 2.6 removes the table with the projector's rewire.
4. **`run-status-fold-contributes-no-lifecycle-arm`** — NOT an inventory entry either. It is a **unit
   test** under `tests/unit/`, because the invariant is a value-level behaviour of `deriveRunStatus`
   over an enumerable `(authority × fold)` space; a guard could only assert the absence of two source
   lines, which a rename defeats and which proves nothing about the derived answer. §D330.12 item 1 is
   the ruling; 2.6 deletes the arms.
5. **`config-snapshot-generations`** gains an ARM, not an entry: `retired-leaves-are-a-closed-list`,
   with the negative control that an unregistered vanished leaf still refuses. The entry's `invariant`
   text is extended in the same commit that lands the arm.

**`one-time-import-offline` is not reused.** Its subject is the doc 05 cutover legacy data import, and
overloading it with D332's authority upgrade would make one planned entry answer two unrelated
questions and leave the cutover import without a name. D332's upgrade gets its own entries above.

Two manifest rules bind all of these. A `planned` entry's `.test.ts` file **must not exist on disk**
until activation (§5.1: `guard-manifest` `deepEqual`s the active `file` list against a recursive walk of
`tests/unit/architecture/`, so an early file is a red gate). And at expiry the entry flips to `active`
in the SAME commit that deletes the adapter's module, its allowlisted imports and the schema or path it
read (§D332.9 rule 4) — the deletion and its proof are one commit, or the adapter outlives its phase.

---

## 6. TDD topology for the rebuild repo — four tiers, each an owned home

<!-- roadmap: phase-1 -->

<!-- roadmap-status: phase-1 -->
- [x] the four-tier write order is as-built and unchanged: pure-logic unit → contract/type → architecture ratchets → the scenario tiers (§6)
- [x] tier 4's name is corrected — there is no stub lane to pair with the live one (§7), so the tier is §10's scenario tiers
> 2026-08-20 | docs-cohesion ref guards-and-tests | verified against `tests/scenario/helpers/pure-walk.ts` and the absence of any stub wiring in `src/`
<!-- /roadmap-status -->

"Same quality umbrella, made concrete." A new task or workflow is built **test-first** against these:

The current local execution layout distinguishes deterministic units from integration proofs.
`tests/unit/` may read a tracked fixture or wire a DOM component with injected ports. A test that
actually opens SQLite (including `:memory:`), a server socket, a child process, a browser, or a
composed workflow belongs under `tests/integration/`; a mixed suite moves intact until its owner
extracts pure cases. Structural repository guards live under `tests/architecture/`. Scenario and
browser parity sources retain their separate owners. The four write-order tiers below describe
how new task evidence accumulates; they do not make a real database test a unit.

1. **Pure-logic unit** — `task.impl.run({ input, ctx: fakeCtx })`. Ref task-contract §7B makes every task run a
  plain-object call; the `fakeCtx` contract uses the matching effect-specific ctx with a fake typed
   `driver`/`recordData` and, only for commit tests, an explicit test mutation capability.
   No fake Page/Locator is exposed. `dryRun` is
   never a ctx flag; it changes graph composition before execution.
   "Pure logic extracted and unit-tested" = the impl's decision logic is a pure
   function the run composes, tested with a fake ctx and no browser — the *primary* hardening tier
   (charter #2: types first, then this).
2. **Contract / type** — every contract's mandatory `example` parses through its own `output` schema
   (ref task-contract guard #4); type-level tests pin that undeclared `errorCodes` fail `tsc`, a commit
   contract missing typed completion proof fails the write-safety guard, and no task ctx has a `dryRun` member
   (so a mis-declared read can't branch on dry-run — ref task-contract §2.3). **Fixtures come from `example`**
   (D3): the mandatory canonical output is the single reusable fixture — stubs, unit tests, and the
   dashboard preview all consume it, so it can't drift.
3. **Architecture ratchets** — §2.1's nine executable arms + §3–§5's guards. Each arm scans the
   roots §2.1 names with **no allowlist at all**, and each is proved against a violating fixture by
   `guard-manifest`.
4. **The scenario tiers** — §10. A workflow gets ONE structural scenario over the pure graph walk
   (no browser) and ONE T1b live scenario against real systems: `dry-run-preview` for a transaction
   graph or D318 `live-read` for a zero-transaction graph, each with exact zero write-authority
   deltas. A dashboard feature gets a feature scenario plus its parity references. §7 explains
   why there is no stub lane between tiers 3 and 4.

Write order for a new task (red→green): write the contract (`example` fails to parse → red) → write
the impl `run` typed against the contract → pure-logic unit test with `fakeCtx` (red → green) →
register in the store index (reachability guard green) → add the node to a descriptor
(descriptor-coverage green) → if it commits, add typed proof+probe (write-safety green) and its prepare
pair (pairing green) → claim the graph paths the new node created in
`tests/scenario/.../coverage-claims` and walk them in the workflow's structural scenario
(scenario-coverage green) → extend the workflow's dry-run scenario manifest with the node it now
reaches (§10.11).

---

## 7. The live lane (the stub lane was never ported)

**There is no stub lane, and this section says so rather than describing one.** The legacy
`HRAUTO_E2E_STUBS=1` mechanism — `maybeWrapE2EStub` cloning a `RegisteredWorkflow`, a hand-written
`StepDataFn` per workflow in `stub-workflows.ts`, file-based hold and fail gates — did not travel,
and the D3 plan to derive it from each contract's `example` was never built. Verified against the
tree on 2026-08-20: zero occurrences of `maybeWrapE2EStub`, `StepDataFn` or `stub-workflows` in
`src/`, `tests/`, `scripts/` or `config/`; `HRAUTO_E2E_STUBS` appears only as inventory metadata in
`src/domain/runtime-environment.ts` naming the legacy paths, with no `process.env` read anywhere;
and although `defineTaskContract` requires an `example` and parses it through its own `output` schema
at seal time (`src/domain/contracts/base.ts:474`), **no runtime module reads `.example`** to stand in
for a task's output. The migration plan is preserved at
`docs/rebuild/history/superseded/2026-08-20-guards-and-tests-stub-lane.md`.

**What took its place is stronger, and it is why the absence is not a gap.** A stub lane exists to
run a graph without touching a real system. This tree does that two ways instead, both against the
real kernel:

- **the pure graph walk** — `tests/scenario/helpers/pure-walk.ts`'s `walkDescriptor` executes a
  descriptor's bind / `when` / choose / gate-resolve / delegation-plan-join / terminal-derive path
  against caller-supplied node outputs, re-parsing every value through its owning schema, and reports
  the coverage points it actually walked. That is §10.3's structural scenario: no browser, no stub
  map to drift, and the walk cannot pass on a value the runtime would reject.
- **the live dry run** — `envelope.dryRun=true` through the production start plan, which reads the
  real systems and writes nothing. That is §10.4, and it is what a stub lane could never give: a
  stub proves the graph agrees with the fixtures, a dry run proves the graph agrees with UCPath.

**Live lane.** Real Chromium, real UCSD SSO, Duo cleared hands-off by the enrolled WebAuthn
credential (charter §9 — no phone step). Its safety boundary is `envelope.dryRun` — a durable field
on `RunEnvelopeSchema` (`src/domain/run/envelope.ts:79`, D6's only home), set once at enqueue and
never recomputed — and the boundary is enforced in two independent places: `services/start/plan.ts`
refuses `dry-run-unsupported` before a run exists when the descriptor does not derive
`supportsDryRun`, and `write-sequencer.ts`'s `executeDryRun` mints no `MutationCapability` and calls
no `commit`, so there is no code path from a dry run to a fence. `executeTransaction` called with
`dryRun` refuses loudly rather than quietly previewing. What a dry run does write, and what it must
not, is §10.4's checkpoint manifest.

The dashboard headless `playwright-cli` verification loop is unchanged and is a separate lane again:
seed a fixture BFF → boot the real bundle → drive → assert on the a11y snapshot. Its frozen form is
the parity corpus (§10.1).

---

## 8. Adversarial self-review — how the guard set rots, and the meta-guard for each

| # | Rot vector | Meta-guard |
|---|---|---|
| 1 | **Allowlists grow unchecked** — every failure "fixed" by an allowlist add | Each entry needs a one-line `reason` (ported discipline); the fail-both-ways ratchet fails on a *stale over-count* too, so a shrunk violation forces the entry down; periodic review is a lesson, not a guard — honest residual risk, mitigated by zero-allowlist for *new* rebuild code. |
| 2 | **A guard is deleted or dropped from the glob** | inventory catches accidental deletion/orphaning; coordinated removal requires a checked decision record and review—honest non-mechanical boundary (§5) |
| 3 | **A ported ratchet quietly narrows to a subtree** in the rebuild repo | Manifest check #5, as-built: every arm in `requiredGuardNames` is EXECUTED against the real tree and must resolve a non-empty file set while `active`, and then executed again against its own violating fixture in a temp root where it must both activate and fire. An arm narrowed to nothing fails the first half; an arm whose detection rotted fails the second. Note the arms are scoped by `roots` per §2.1 (four of the nine scan `src/stores` or `src/dashboard` deliberately) — the check is non-emptiness and fixture-firing, not a literal `src/**` token. |
| 4 | **The rebuild tree escapes coverage or an empty family passes vacuously** | Each target family activates atomically with its first file; every active arm asserts a non-empty file set. Missing paths/unmatched ESLint patterns fail rather than skip, and CLI+config coverage are both pinned. |
| 5 | **A new parity/hand-list registry reappears** | explicit projection inventory/coverage is primary; ≥3-id heuristic is secondary only |
| 6 | **The composition/pairing guard false-positives on prose** | both key off closed unions and graph nodes; one-click writes use a no-op prepare, not an escape hatch |
| 7 | **This doc becomes a stale prose index** | §5's manifest is the machine SSOT; the two-way file↔inventory check exposes drift even if this prose lags. |
| 8 | **Meta-risk: three new safety docs (09/10/11) drift** | Each is a D1-owned contract doc the master plan (07) *references*, never redefines; this doc imports their contracts and only hosts their guards. |
| 9 | **The write-safety guard regresses to demanding a flat `receipt`** (would wrongly reject Kuali/OnBase) | §3.3 walks ref write-safety's `completion` UNION (`receipt\|save-verify\|upload-verify`, D22): save-verify/upload-verify pass with a typed `ProbeVerdict` read-back and NO confirmation number; a type-level test pins that demanding `receipt` of a save-verify contract is itself a guard bug. The `unverifiableByPage` allowlist (§3.5) and the mutation-primitive fence-routing ratchet (§3.6) each fail-both-ways, so the verify escape hatch and the fence bypass can't quietly re-open. |
| 10 | **A broad path exemption leaks into a nested rebuild directory** | `code-conventions` matches normalized repo-relative roots/segments, never `includes(prefix)`; a fixture proves `src/x/scripts/y.ts` is not exempt merely because `/scripts/` appears inside it. |
| 11 | **A schema guard checks only top-level objects while nested records stay open** | schema walker recursively inspects object/union/lazy members and mutation-tests unknown keys at every nested object boundary |
| 12 | **A scenario exists on disk but no lane ever executes it** | `scenario-coverage` audits three directions (§3.10 as-built): claims vs. derived graph points, production references vs. observed `it(...)` executions, and D185's corpus-DIRECTORY layout — a file of neither kind, a graph scenario claiming nothing, an id declared in a file its manifest row does not name, and a manifest row nothing executes are each refused BY NAME, each with a negative control that moves exactly one thing in the real corpus. §10.9 extends the same audit across the per-workflow folders. |
| 14 | **A test tier exists in the spec and nothing runs it** | §10.9's run policy names, per tier, the `npm run` script that executes it and the commit class that must re-run it; `gate-coverage` pins that `test:coverage` still carries `--coverage` and still chains `suite-size.ts`. D190 is the standing lesson that registration is not execution — the safety-critical floor was RED for a whole tail while `gate-coverage` correctly reported the lane still registered. A tier whose script nobody chains is the same defect one level up, which is why §10.9 states the script AND the trigger. |
| 13 | **A recovery test “restores” only rebuildable projections** | restore drill asserts exact hashes/counts for non-rebuildable authority families and deliberately wipes projection tables before replay; swapping the roles makes the fixture fail |

---

## 9. Worked example — adding one new submit-bearing workflow

<!-- roadmap: migrations -->

- [x] the worked example is as-built for the guard half — every RED it names is a guard that exists at HEAD
- [x] steps 6–7 have their first concrete implementation: the `separations-kuali-finalization` pair, typed subject registry, durable result table and production CLI runner; its first green live canary remains date-blocked until 2026-08-28
> 2026-08-25 | test-tiers | blocked execution persisted the no-browser result; the migration node's PROOF stays open because blocked is evidence that the test did not run, not a green result

<!-- roadmap-status: migrations -->
- [x] the per-workflow guard loop is unchanged and every guard it fires is active
- [x] the per-workflow TEST loop (§10.11's seven steps) has its first T1 pair and the shared registry/result/CLI machinery; later migrations repeat it per workflow
> 2026-08-25 | test-tiers | first blocked authority result proves the unavailable-subject branch; left for this first pair: the date-gated live green and migration-record line
<!-- /roadmap-status -->

Scenario: a new `badge-reissue` workflow that fills and submits a UCPath form. Red→green, and what
must be registered:

1. **Contracts.** Write `ucpath/fill-badge-reissue` (`effect:"prepare"`) and `ucpath/submit-badge-reissue`
   (`effect:"commit"`). RED: `write-safety-contract` fails — the commit contract has no proof/
   `idempotency.probe`. Add `receipt` (the `T…` transaction number, ported from
   `readLatestTransactionNumber`) + `probe: "ucpath/find-existing-badge-reissue"`. RED: the
   add compatible EID subject declarations and scenario ids. The `example` guard fails until each
   contract's example parses; subject/scenario coverage remains red until the observation and
   mismatch/proof/crash fixtures exist. GREEN.
2. **Impls + unit.** Write both `run`s in `stores/ucpath/tasks/`; they use only the typed UCPath
   driver and the submit fires through `stores/common/mutation.ts`. Pure-logic unit tests with
   `fakeCtx` for the fill's field-mapping and
   the submit's receipt-parse (red→green). Reachability guard: both must be in the store index.
3. **Descriptor.** Add a `badge-reissue` transaction node pairing fill+submit under one lease, plus version, complete presentation/runtime fields, `code`, `icon`,
   `inputSubject`, strict terminal result, enqueue/action policy, scenarios, run surfaces. RED:
   `descriptor-coverage` fails until id/code unique, icon ∈
   ICON_NAMES, systems union resolves. GREEN.
4. **Safety guards fire.** `transaction-pairing`: GREEN (one lease, no boundary). `dry-run-
   composition-submit-free`: the dry-run plan contains the prepare preview and no commit capability.
   `commit-routes-through-mutation`: GREEN because the submit fires
   through `stores/common/mutation.ts`; raw Page/selector access would fail the driver boundary.
   `subject-before-fence` proves staged EID match and mismatch/no-read stop before fencing.
   `write-safety-contract`:
   GREEN — the `receipt` completion arm is satisfied (a UCPath `T…` receipt); a Kuali form here would
   instead pass via the `save-verify` arm with no confirmation number (§3.3). `no-positional-identity`:
   GREEN as long as members key on EID, not index.
5. **Register.** Add `badgeReissueModule` once to the composition root's `WORKFLOW_MODULES` tuple;
   `SERVER_REGISTRY` and `DESCRIPTORS` derive from it and coverage proves key parity. Stub happy path is
   derived from the `example`s automatically; registered fail/cancel/subject/proof scenarios come
   from the descriptor/contract scenario ids. No `INSTANCE_LABELS`/`SUBJECT_TO_KIND`/icon-map edits—those lists no
   longer exist. **Guard-manifest**: unchanged (no new guard *file*), but if this workflow needed a
   bespoke guard, it must be added to the inventory or the manifest test fails.
6. **Tests, per §10.11.** ONE `tests/scenario/workflows/badge-reissue/structural.scenario.test.ts`
   walking the graph over `walkDescriptor` and claiming every point `deriveGraphCoveragePoints`
   derives from the new transaction node (`dry-run`, `subject-mismatch`, `committed`,
   `already-present`) — `scenario-coverage` is RED until every one is claimed and walked. ONE
   `dry-run.scenario.ts` beside it: the checkpoint manifest (§10.4) plus the subject LABEL this
   workflow runs against — a label names a SUBJECT in `config/test-data.json` (`subjects`), the
   subject declares an ARM for this workflow, and the manifest carries one case per arm (§10.5); the
   subject's private value stays in ignored `config/test-data.local.json` (D341). If the migration also wires a dashboard surface, its T3
   combined pair (§10.7).
7. **Live proof.** `npm run cli -- dry-run-scenario badge-reissue --subject <label>` runs the
   manifest against the real systems with `dryRun=true` and asserts the durable rows over authority:
   the nodes reached, the checkpoints written, zero `write_intents` / `write_attempts` /
   `durable_outbox`, and a terminal `dry-run-preview` result whose `externalCommit` is `none`. The
   result is recorded durably (§10.4) and the dated line it writes into the migration record is what
   the tree's `PROOF` tick cites. The transactional proof also crash-injects after a controlled
   commit and validates recovery.

Net: the safety suite plus descriptor projection coverage replace synchronized hand-edits and parity
guards—one contract change, and the compiler plus ratchets force the rest.


## 10. The test family, and the split by what a test needs (R10)


- [x] DOCS the spec — §10 rewritten as-built with the tiers, layout, naming, run policy, subject registry, durable result and the two checklists (this commit)
- [ ] BE T1 layout — `tests/scenario/workflows/<workflow-id>/` with ONE structural scenario per workflow and its `dry-run.scenario.ts` manifest; the pretending scenarios rewritten (§10.3, §10.4)
- [x] BE T2 dashboard / non-run scenarios per feature, seeded from `tests/unit/dashboard` (§10.12) — the first feature is `separations` at `tests/scenario/dashboard/separations/` (2026-08-27); the corpus audit learned the tier as its THIRD kind (`DASHBOARD_SCENARIO_FILE_PATTERN`), which carries the integration walk's obligations because it walks no graph
- [ ] BE T3 dashboard conditions attachable to a dry-run scenario — the first: separations §9.22 as a file (§10.7)
- [x] BE the subject registry (`config/test-subjects.json`, values via `src/domain/secrets.ts`) + the insert-only `dry_run_scenario_results` row + `cli dry-run-scenario` (§10.5, §10.6)
- [ ] PROOF T4 the agent-operated parallel e2e runner + the first journey, recorded — needs `{#parallel-runs}` and `{#duo-lease}` first (§10.8)
- [ ] BE coverage floor 80/80/80 global, with D91's 50 % global branch gate adopted alongside it (§10.10)
- [x] BE the FIRST T1 pair in the tree — `tests/scenario/workflows/separations-kuali-finalization/{structural.scenario.test.ts, dry-run.scenario.ts}`, seeded from the valid proof contracts/helpers of the dismantled annotation workflow (D266; ref workflow-model §1.2.2)
> 2026-08-20 | docs-cohesion ref guards-and-tests | the spec is written against the code (`vitest.config.ts`, `src/core/run-executor.ts`, `src/core/write-sequencer.ts`, `tests/scenario/**`, `tests/parity/**`, `docs/rebuild/migrations/separations.md` §9.22); left: the four code units 5.2b–5.2d. Two as-built findings recorded rather than assumed: `TransactionDryRunPreviewSchema`'s `mismatch` subject arm is unreachable, and a real subject's EID is hardcoded across seven tracked files
> 2026-08-25 | test-tiers | registry, authority row and CLI runner built; the finalization canary now records `blocked`/`not-started` before browser composition because its honest subject is unavailable until 2026-08-28. The T1 PROOF remains open until that manifest records `met`
> 2026-09-02 | test-suite-rationalization R5a | the T1a structural half is complete for all seven registered workflows: each owns exactly one `workflows/<workflow-id>/structural.scenario.test.ts`, the architecture lane refuses split/flat ownership, and all structural person/document identities are synthetic. The overall T1 item remains open: only `separations` and `separations-kuali-finalization` have T1b manifests, and their sole retained canary is honestly `gone`/blocked rather than `met`.

This section is normative and it is the one an agent writing tests reads first. **R10's rule:
`tests/` is organized by what a test NEEDS in order to run**, because that is the only split that
answers the question every change actually asks — *which suites must I re-run?* A split by subject
(“the separations tests”) cannot answer it; a split by mechanism (“unit vs integration”) cannot
either. A split by need can: a test that needs nothing but the tree runs on every commit, and a test
that must RUN a workflow needs a browser, a real system and a real subject, so it runs when somebody
asks for it and its result is recorded.

### 10.1 The test family, as built

Ten members. Folder, runner, when it runs, what it may touch, what it proves. R7 refreshed the
family-wide census and taxonomy on 2026-09-02.

| family | folder | runner | when | may touch | proves |
|---|---|---|---|---|---|
| **unit** | `tests/unit/**` (306 files / 111,789 lines, architecture excluded) | vitest project `unit` | every commit | pure functions, fake ctx, temp dirs, its own SQLite files under a temp root — **never** a real runtime root (`test-runtime-root-isolation`) | one module's decision logic, against its own schemas |
| **architecture guards** | `tests/unit/architecture/**` (70 files / 27,587 lines) | vitest project `architecture`; `npm run test:architecture` selects that project by name | every commit | this repository as DATA — source text, ASTs, registries, `package.json`, and TypeScript configs; authenticated frozen provenance may describe legacy facts, but no finished gate reads the legacy checkout | that a rule holds everywhere, and — through `guard-manifest` — that each of the nine arms still fires against a violating fixture |
| **fixture scenarios** | `tests/scenario/*.scenario.test.ts` (6 capability files) + `tests/scenario/workflows/<workflow-id>/structural.scenario.test.ts` (7 T1a files) + `tests/scenario/dashboard/**` (3 T2 files) | vitest project `scenario` | every commit | `walkDescriptor` over a real descriptor with caller-supplied node outputs; fake stores or one isolated authority database; no browser | that one declared graph or dashboard command/projection path binds, refuses and terminates as authored, and that graph coverage points claimed are the ones walked |
| **integration walks** | `tests/scenario/*.walk.test.ts` (1) | vitest project `scenario` | every commit | ONE real authority database and the production read models | the JOINS only composition can falsify; it claims no coverage point and carries no manifest row (D185) |
| **dashboard unit tests** | `tests/unit/dashboard/**` (102 files) | vitest project `unit` | every commit | extracted `*-model.ts` decisions plus wiring-level `jsdom` tests that opt in per file; anything visual stays in parity | that a surface's pure half computes what it claims and its wiring dispatches/focuses as contracted |
| **parity** | `tests/parity/**` — 17 specs, **281 cases**, **222 reference triples** (`.png` + `.a11y.yml` + `.meta.json`) | `npm run test:parity` (Playwright, outside Vitest and coverage) | on a dashboard change, and before a slice closes | the built bundle over ephemeral fixture and seeded BFFs; never ports 3938/5174 | that the rendered pixel/a11y/browser contract has not moved; every stored reference half is asserted, `maxDiffPixels: 0`, and dual-adapter structure proves fixture relevance |
| **performance budgets** | `tests/perf/dashboard-benchmark.ts` | `npm run perf:dashboard` plus unit negative controls | before a slice closes and after a measured dashboard data-path change | one deterministic seeded authority database under a temp root; no production ports or runtime root | exact non-duration bounds on day-wire SQL, patch reparses, log scope, archive freeze and member-preview delta; elapsed timings remain observational because host contention is not a stable correctness oracle |
| **the recovery drill** | inside `storage-recovery.test.ts` | vitest project `unit` | every commit | temporary SQLite databases and the official `node:sqlite` online-backup API | that a corrupted authority database restores from the newest verified backup, rebuilds projections ONLY, and that D181's stopped-system proof is derivable from real runtime-lock files |
| **the controlled-commit proof** | `docs/rebuild/reference/write-safety.md` §Phase-2 controlled-commit as-built | **recorded, never re-run** | once, 2026-08-04 | a real Kuali document | that the write kernel fences, commits, verifies by reload read-back and refuses a replay in 2 ms. A recorded proof is evidence; re-running it would be a second real HR write, so it is cited, not executed. Each workflow still owes its own §3.2 controlled-commit proof at its migration. |
| **live selector re-verification** | no folder — a pre-authorized act at each migration | `playwright-cli`, by the agent | at every workflow's migration | real pages, read-only (`snapshot`) | that a ported selector still resolves. D150 retired the cross-repo accounting in favour of exactly this, because a selector checked against the live system beats one diffed against legacy's copy of it. |

### 10.2 The split: no-dry-run tests and dry-run tests

**A no-dry-run test needs nothing but this tree.** Unit, architecture guards, structural fixture
scenarios, dashboard feature scenarios, parity. They are deterministic, they touch no external
system, and they are cheap enough that the only sane policy is to run them.

**When they run:**

- **implementation commits/candidates and materially changed integration** — typecheck, lint and
  full coverage by default (D191; §3.14 assigns focused worker checks and full group gates to the finalizer, and owns the documentation-only exception). That is every no-dry-run test except parity, which is a Playwright lane outside the vitest projects.
- **a change to ONE workflow** — that workflow's structural scenario, plus everything the gate
  already runs. The guards are global by construction, so "only this workflow's tests" is never the
  whole answer; it is the *additional* thing the author must think about.
- **a change to the DASHBOARD** — **all** workflows' structural scenarios AND every dashboard
  feature scenario AND `npm run test:parity`. The asymmetry is deliberate and is the D218/D253
  lesson: a dashboard change is a change to the surface every workflow is read through, so scoping
  it to "the surface I touched" is how a projection defect reaches production while every gate
  stays green.

**A dry-run test needs a browser, the real systems, and a real subject.** Every test that must RUN a
workflow is one, and it is built on a **live dry run** — `envelope.dryRun=true` — never on a
simulation. There is no stub lane to run a workflow against (§7), and that is the right outcome: a
simulated run proves the graph agrees with the fixtures, while a dry run proves it agrees with
UCPath. These tests are **not** in the per-commit gate. They are invoked deliberately, they can be
`blocked` rather than `failed`, and their results are recorded durably so a green they produced last
week is still citable this week.

**The four tiers, named once so the rest of this section can use the names:**

| tier | what it is | needs a dry run | runner |
|---|---|---|---|
| **T1** | per workflow: ONE structural scenario + ONE dry-run scenario | the second half only | `test:coverage` / `cli dry-run-scenario` |
| **T2** | per dashboard feature: a feature scenario over the real projection, plus its parity references | no | `test:coverage` / `test:parity` |
| **T3** | a dashboard CONDITION attached to a dry-run scenario — drive the real ceremony while the run is parked, assert the timeline while it is running, read the receipt after it settles | yes | `test:combined` |
| **T4** | the agent-operated end-to-end tier: MANY dry-run scenarios in parallel | yes | `test:e2e` |

**The seed for the first pair (D266, 2026-08-21).** `kuali-timekeeper-annotation` — Phase 2's
one-node proving workflow — is dismantled by the operator's ruling that it *is* this framework's
business: its `kualiHarness` (a REAL write sequencer over a REAL authority database, asserting
zero `write_intents` / `write_attempts` / `durable_outbox` deltas while retaining the ordinary
upstream task `run_checkpoints`) and its four scenarios
(`dry-run-preview` · `subject-mismatch` · `committed` · `already-present`) become the first T1 pair,
for the Kuali finalization step of separations (`separations-kuali-finalization`): the structural
file keeps the sequencer walks over the real descriptor, and the `dry-run.scenario.ts` manifest
runs the real thing live against a registered canary. The successor named by D188's retirement of
`dry-run-composition-submit-free` (§3.1) moves with it — `separations-kuali-finalization/dry-run-preview`
is the executable scenario that asserts durable absence from then on, and `guard-inventory.json`'s
retired entry is re-pointed in the same commit.

### 10.3 T1a — the ONE honest structural scenario per workflow

**One file per workflow, and it may not pretend.** `tests/scenario/workflows/<workflow-id>/structural.scenario.test.ts`
walks the descriptor's declared paths through `walkDescriptor` (`tests/scenario/helpers/pure-walk.ts`)
against caller-supplied node outputs, re-parsing every value through its owning schema, and claims
the coverage points it walked. It proves three things and no others:

1. **the graph binds** — every node's `dependsOn` resolves, every branch case is reachable, every
   gate opens and resolves, every delegation fans out at each declared cardinality;
2. **the refusals refuse** — the paths where the workflow must stop (an ambiguous grid, a subject
   mismatch, a missing dependency, an unresolvable option) throw by name;
3. **idempotency** — a replayed node reuses its stored output rather than re-executing.

**What it may NOT claim.** A structural scenario runs over fake stores, so a value it feeds a node
is a value the author chose. It may therefore never assert anything about the WORLD — that a
particular EID has one active job, that a document number resolves, that a page renders a field.
Those are dry-run facts. Before R5a, the identity-check scenarios hardcoded a pair of employee ids,
including a real subject reused across seven tracked files as though the identifier carried current
meaning. R5a replaced every structural workflow identity and document key with schema-shaped
**synthetic** values and retained only the verified data/page shapes needed to exercise the
contracts. A real subject belongs exclusively to the registry (§10.5), where the dry-run scenario
addresses it by LABEL and durable authority records whether it was blocked, failed, or met.

**Consolidation.** Where a workflow has several `*.scenario.test.ts` files today, they fold into the
one structural file if what they assert is graph shape, and into the workflow's dry-run scenario if
what they assert is world shape. A path that is neither — an assertion about a store's parsing, say
— was never a scenario and belongs in `tests/unit/`.

### 10.4 T1b — one live scenario, with transaction-preview and transaction-free arms

**D318 — T1b is live proof, not a demand that every workflow contain a transaction.** A T1b
declaration chooses exactly one arm from the compiled graph: `dry-run-preview` when the graph has a
transaction node, or `live-read` when it has none. The runner refuses either mismatch before a
browser or effect. A no-op transaction added only to enter the preview arm is false graph authority
and forbidden.

The existing workflow artifact remains
`tests/scenario/workflows/<workflow-id>/dry-run.scenario.ts`; it exports a manifest, and nothing in the
vitest projects imports it, because running it starts a browser. It is executed by
`npm run cli -- dry-run-scenario <workflow> --subject <label>`. The filename and command are the
established T1b entrypoint; the manifest's explicit arm, not the filename, determines whether the
run is a transaction preview or a transaction-free live read.

#### Transaction-preview arm

**What the manifest declares.** This is `docs/rebuild/migrations/separations.md` §9.22's hand-run
double-entry, as a file — the pass that proved Track C, written down so it can be re-run instead of
re-typed:

- **`nodes`** — the node ids the run must reach, in order, and the ones it must NOT reach. A run that
  stops early fails naming the node it stopped at; a run that reaches a node the manifest excludes
  fails just as loudly, because "it did more than expected" is the interesting half.
- **`checkpoints`** — for each node that owns one, the `run_checkpoints` row that must exist, keyed
  the way authority keys it: `(workflow, item, node, attempt, claimGeneration?)` (D214/D221). The
  assertion is over the DATABASE, never over a log line or a span.
- **`gateResults`** — for a gated workflow, the `gate_results` row: which gate, which decision leaf,
  which `resolvedBy` (D202/D203/D204). A dry run takes a REAL approval through the real command
  endpoint — `envelope.dryRun` does not skip the gate — so this row is real evidence.
- **`writeIntents: 0`** — and `write_attempts: 0` and `durable_outbox: 0`, asserted as exact counts
  against authority BEFORE and AFTER, unchanged. This is D85 part 4 and §9.22's opening assertion:
  **no intent row means no fence, means no click.** It is the positive no-write proof, and it is
  stated as a delta rather than an absolute because the database legitimately holds rows from
  earlier real proofs.
- **`receipt`** — the shape `buildRunEvidenceReceipt` must derive: `result` and `confidence`
  (a rehearsal derives `partial` / `unknown`, never `verified` — D237/D238's refinement makes the
  forbidden pair unrepresentable), the verification row per node, and every declared cross-source
  obligation's verdict.
- **`terminal`** — the preview terminal. A dry run does reach a durable terminal state, and the
  manifest says which: run lifecycle **`done`**, `run_results` bound to
  `RunDryRunPreviewResultSchema`'s OWN schema hash (deliberately never the descriptor's declared
  result hash, so a preview can never be read as a completed workflow), `kind: "dry-run-preview"`,
  `externalCommit: "none"`, `stoppedAtNodeId` equal to the descriptor's derived `dryRun.stopsAt`.
- **`preview.outcome`** — which arm the transaction settled to, and why. `already-present` when
  beat ①'s durable lookup or live probe settles first — with `proofSource` naming which — and
  `would-prepare` when the real run would have fenced. D215's rule holds both ways: a preview that
  staged nothing spells no staged page and emits `subject: "not-observed"` on its
  `transaction.previewed` span; a preview that staged reports the prepare output's schema hash and
  the observed subject.

**Three facts about what a dry run actually does, because a manifest that assumes the wrong ones is
worse than none** (verified in `src/core/write-sequencer.ts` and `src/core/run-executor.ts`):

1. **Task, branch and gate nodes are unaffected.** They execute, checkpoint and park exactly as in a
   real run. Only the transaction node branches on `envelope.dryRun`, and it ends the run.
2. **A dry run DOES write.** Spans for every executed node plus one `transaction.previewed`;
   `run_checkpoints` for every upstream task node; a real `gate_results` row if it parks and is
   approved; and a real terminal settlement through `terminalizeSuccess` — `run_results`,
   `run_terminal_outbox`, `run_terminal_authorizations`, and the D110/D114 seal. What it never
   writes is the write-safety family. A manifest that asserts "a dry run writes nothing" would be
false and would fail on its first run.
3. **`executeDryRun` mirrors the real beat order deliberately** (D215): the durable-intent lookup,
   then the live probe, and only then the staged rehearsal — the real `prepare` task and the real
   subject observation against a live driver, with no fence minted and no `commit` invoked. A
   rehearsal that skipped beat ① would fail on the ordinary subject, which is the common case.

**One as-built defect this manifest will surface, recorded here rather than left to be discovered.**
`TransactionDryRunPreviewSchema`'s `subject: { state: "mismatch" }` arm is **unreachable**:
`executeDryRun` wraps any binding-proof failure — including a genuine subject mismatch, which
`buildBindingProof` always throws — into a generic error, so the run terminalizes `failed` instead of
previewing a refusal (`src/core/write-sequencer.ts:1873-1892`). `state: "mismatch"` is constructed
nowhere in `src/` or `tests/`. This is the D237 shape — a wire arm keyed on a value nothing produces
— and it is fail-closed rather than dangerous, so it is an honest open item, not a blocker. It has
**no live subject** (D284, 2026-08-28): no real document can truthfully be "the approved subject's
document with someone else's EID on it", so it is not a manifest case and the finalization manifest
no longer carries one. The defect is recorded — here, and restated in the manifest's header — and
the negative branch is owned by structural/unit coverage on synthetic subjects, until the arm is
either reached or removed.

#### Transaction-free `live-read` arm (D318)

A `live-read` case is admitted only when the compiled graph contains **zero transaction nodes**.
It starts the ordinary workflow path with `RunEnvelope.dryRun: false`; setting `dryRun: true` would
misstate D209 and must still refuse `no-transaction-node`. Its manifest/result authority records
`kind: "live-read"`, the nodes reached/excluded, ordinary task checkpoints, any genuine gate result,
the ordinary terminal workflow result and the evidence receipt. It has no preview terminal,
`stoppedAtNodeId`, staged page or `transaction.previewed` span because there is no transaction to
preview.

The positive no-write proof has two independent halves: graph admission proves no transaction node
exists, and authority comparison proves exact before/after deltas of zero for `write_intents`,
`write_attempts` and `durable_outbox`. Any new transaction in the compiled graph invalidates the
`live-read` manifest before execution and requires conversion to `dry-run-preview`. Conversely, a
transaction-free graph cannot select `dry-run-preview`. The ordinary read result may be `verified`
when its task evidence supports that verdict; it is not forced to the preview arm's
`partial|unknown` confidence because no external write is being previewed.

### 10.5 The subject registry — labels in the repo, values outside it

**D341, approved 2026-09-07; implemented by the test-data foundation detour and accepted, integrated
and converted on 2026-09-07 (local `master` merge `bc6dc9b54`; see the completion record at the end
of this section).** Task 1.6.7 consumes that integration. Configuration ownership,
privacy and conversion are defined in
[clock-config-secrets, D341](clock-config-secrets.md#d341--test-inputs-have-a-separate-owner).
As built: `config/test-data.json` (tracked; `subjects` is the former `config/test-subjects.json`
registry, plus named `files` and synthetic `samples`), ignored `config/test-data.local.json` with the
tracked example `config/test-data.local.example.json`, schemas in `src/domain/test-data.ts`, the ONE
reader `src/control/test-data.ts` (shared half) re-exporting the private half from
`src/infra/config/test-data-local.ts`, and the credential conversion in
`src/infra/config/credential-test-data-migration.ts`. `.env` and protected Settings are retired
test-target sources, refused by name.

**One public registry.** The target `config/test-data.json` incorporates subjects and their stable
labels, purposes, one dated availability claim (`available`, `consumed`, `gone`, `unknown`), usage
restrictions, provenance and workflow-specific kind/input arms. A subject shared by workflows is
one entry with multiple arms. Its private document/EID fields are closed references resolved only
from `config/test-data.local.json`. Derive current labels and kinds from the registry instead of
freezing their changing counts in prose. The Separations chain derives person facts live; its
standalone finalization arm retains its named pending block and cannot fabricate readiness.

**Admission.** Validate label/workflow/kind correspondence in both directions against live manifests.
Unavailable subjects and declared-pending leaves block before private reads or browser composition.
An empty pending declaration, simultaneously pending/observed field, mismatched workflow/kind or
undeclared missing canonical leaf is a defect by label/key/date. An absent configured live input
reports blocked, never an invented default or a successful skipped test. A dated availability claim
is not proof that the external system still satisfies the scenario. Use the actual descriptor's
ingress and canonical schema. Malformed private config and unreadable requested files fail explicitly.

**Shared fixtures.** Reusable data has one discoverable home under `tests/fixtures/`, consumed through
shared typed imports/configuration by unit, architecture, scenario, parity, performance and scripts.
Complete consolidation accounts for every existing shared-data source and consumer, including
cross-tier `tests/unit/fixtures` imports, and removes obsolete duplicates/shims. Case-specific
assertions, expected results, invalid-input examples, architecture violation sources and behavioral
helpers remain at their test owner when sharing would obscure the proof. Do not derive the expected
answer from the same shared input under test. Preserve synthetic-subject ranges, deterministic
clocks, dataset shapes/counts, case membership, isolation, timeouts and coverage floors.

**Files and privacy.** Offline imports must succeed without private configuration, credentials,
provider access, database startup or browsers. Tracked safe file paths resolve relative to their
config and stay inside the checkout. Private paths resolve only when explicitly requested and never
fall back to another worktree. Include a minimal synthetic PDF and a consumer proving actual readable
bytes; no tracked real HR documents or fabricated private corpus. Missing/invalid selected files,
duplicate/unknown config keys, path escapes and CWD dependence have negative tests. Shared data is
frozen and builder instances are independent.

**Proof and closure.** The detour owns Settings exclusion and retired-source negative controls,
availability-before-private-read ordering, source-bound redaction/fingerprints through new run
resume/rerun/archive, complete fixture accounting, credential-history conversion, destination/source
conflicts, interrupted/repeated migration, accepted identity non-reuse, and verified actual private-file
conversion. Follow D191 full candidate/integration gates plus desktop parity and generated freshness.
Task 1.6.7 owns live workflow acceptance; no live success is inferred from migration or input presence.
The detour supervisor records accepted commits, review, gate and conversion evidence here and the
Task-7 resume boundary before removing the temporary execution handoff. No new roadmap phase/node
or deferred consolidation remainder is authorized.

**Completion record (detour, 2026-09-07).** Proof matrix as built; every row is an offline test
run through the repository runner (`npm test -- <files>`), none needs a private file:

| Proof | Where it is proven |
| --- | --- |
| P1 clean checkout, isolated samples, synthetic PDF bytes | `tests/unit/test-data-config.test.ts` (copied checkout, child process from another CWD, frozen shared data, isolated `testDataSamples`) |
| P2 duplicate/unknown keys, invalid values, missing/unreadable file, path escapes, no CWD/upward/other-checkout fallback | `tests/unit/test-data-config.test.ts` |
| P3 label/workflow/kind admission before private read; malformed private config is a defect by key | `tests/unit/test-target-registry.test.ts`, `tests/unit/architecture/test-target-registry.test.ts`, `tests/unit/test-data-command.test.ts` (`test-data check` reports names/states only) |
| P4 canaries absent from catalog (86 rows), Settings schemas, readback and secret registries; retired env names and retired Settings names refused by name | `tests/unit/architecture/settings-catalog.test.ts` (P33), `tests/unit/architecture/strict-boundary-schemas.test.ts`, `tests/unit/secrets-redaction.test.ts`, `tests/unit/storage-upgrade-environment.test.ts` (`retired-test-target-env { key }`), `tests/unit/storage-upgrade-d331.test.ts` (`retired-test-target { key }` reached through a genuine seven-name journal row), `tests/unit/protected-settings-history.test.ts` (frozen pre-D341 command/audit arm: live grammar refuses, historical readers parse, pinned legacy hash, no value) |
| P5 `test-data-local` binding (name + opaque `sourceId`, never a value) through start, receipts, redaction, resume/rerun/archive | `tests/unit/dry-run-scenario-composition.test.ts` (binding captured at `runtime.start`), `tests/unit/source-bound-repeat.test.ts`, `tests/unit/rerun-protected-identity.test.ts`, `tests/unit/archive-protected-identity.test.ts`, `tests/unit/run-record-service/service.test.ts`, `tests/unit/write-sequencer.test.ts`, `tests/unit/run-executor.test.ts` |
| P6 destination missing/equal/conflict/invalid, source change under lock, failure after staging before source retirement, lock held, retry idempotence | `tests/unit/config/credential-test-data-migration.test.ts` |
| P7 synthetic v1 history and upgrade binding replayed under the frozen legacy schema (`LEGACY_PROTECTED_SETTINGS_SCHEMA_HASH` pinned), operational entries preserved, retired command/write/value identities fenced, ordinary reader refuses v1 until migrated; pre-D341 durable command/audit rows stay readable through `commands-history` | `tests/unit/config/credential-test-data-migration.test.ts`, `tests/unit/config/credential-store.test.ts`, `tests/unit/protected-settings-history.test.ts`, `tests/unit/storage-upgrade-d331.test.ts` |
| P8 fixture accounting: cross-tier imports of unit-only fixtures/helpers are refused except exact parity compatibility exports; three unchanged scenario/shared callers use the pinned descriptor-fixture export; three named shared resource harnesses remain explicit. Shared data fixtures stay pure, tracked inputs and ignored private files are checked, and the README maps owners. | `tests/architecture/test-data-ownership.test.ts` (guard `test-data-ownership`), `tests/fixtures/README.md` |
| P9 actual reset-root preflight, reviewed private conversion, readback, value-safe credential comparison, doctor | recorded below after integration; not inferred from P6/P7 |

Defects the proofs found and fixed in the candidate: the credential store's pre-rename live check
read the source through the v2-only reader and would have refused every real conversion; the
under-lock destination re-plan compared only action/count rather than entry identities; committed
pre-D341 protected-settings audits (seven-name value-free readback) must still parse in historical
databases, so the audit result grammar admits the legacy readback family beside the live one.
Actual-root facts rechecked 2026-09-07 (names/shape only): credential document schemaVersion 1,
revision 2, one history entry, applied upgrade binding, five names including the Separations
canary and no person-lookup EID; database schema 32 with zero commands; no private file present.
**Candidate frozen 2026-09-07 — awaiting independent review.** Base `f68dc9a5b355336d3a755081d8d99ddd7ad9fed3`;
implementation commits `d69cda56c` (source, config, scripts, generated manifest), `eec6a9c39` (tests,
fixture moves, `test-data-ownership` guard and inventory), `ec1a55432` (contracts, plans, skills,
instruction twins), `e2e6027a0` (deliberate parity refreeze); this recording commit is the candidate
tip. Gate evidence on the `e2e6027a0` tree: `npm run typecheck` clean; `npm run lint` clean at
`--max-warnings 0`; `git diff --check` clean; `npm test -- --coverage` through the two-worker adapter
(sha256 `1344b1c8…`, effective workers 2 at root and projects): 437 files / 5504 tests passed,
coverage statements 85.85 %, branches 77.49 %, functions 89.85 %, lines 87.97 % (floors met, exit 0);
`suite-size` unit 340 / scenario 17 / architecture 80, exit 0; `npm run test:parity` 259 passed after
the refreeze; `build:manifest:check`, `stores:catalog:check`, `roadmap:check` current; docs audit PASS;
instruction twins byte-identical. Parity drifted on 190 cases before the refreeze; every changed
reference line was classified before refreshing: header/metadata `descriptorHash` and the on-page
8-character descriptor fingerprint (the person-lookup contract fingerprint moved with the generated
manifest closure), task `impl` fingerprints and the receipt trace prefix, and explorer-transaction
totals `107 reads → 108 reads` because the `test-data-local` binding variant adds one `sourceId`
output leaf to `KualiFinalizationTargetSchema.protectedBindings`. 49 screenshots moved by 7–21
pixels each where that text renders, including dimmed rows behind modal variants; no layout, copy or
tolerance change (`maxDiffPixels` stays 0). Two coverage-gate tests read parity references, so the
coverage gate was rerun after the refreeze rather than reused.
**Independent review, round 1 (2026-09-07, fresh `sup-review`, Opus, high, bound to candidate
`a97c8832a` / implementation `e2e6027a0`): BLOCKED** — the reviewer's context compacted before its
coverage accounting finished (it listed the unreviewed boundaries) and it confirmed one required
finding. Dispositions, all fixed in `3a3fa427f`:

- F1 (required, P4/P7) — the live command grammar refused every journaled protected-settings
  command that named a retired canary, so the open-time record sweep, D331 journal authentication,
  settings history and backup authentication failed with an opaque parse error before the D341
  refusal by name; the candidate's own D331 guard had filtered retired names out of the journaled
  command, proving a case that cannot occur. Fixed by the frozen `HistoricalProtectedSettingsCommand`
  / audit arms in `src/domain/commands-history.ts` (seven-name marked patch, schema hash pinned to
  the legacy family, never a value), unioned at `storage-records` (record registry), the
  authority-database settings-history readers, `upgrade-sources`, `d331-protected-journal` and
  `backup-service`; the D331 guard now journals a genuine seven-name row and asserts only the frozen
  arm reads it; `tests/unit/protected-settings-history.test.ts` proves refusal by the live grammar,
  the pinned hash, fingerprint parity and the durable readers.
- F2 (required, P8) — the README row for `tests/unit/architecture/helpers/` named one cross-tier
  importer while three exist and the guard did not cover that root. Fixed: the guard pins the exact
  recorded importer set (a new or vanished importer fails) and the README names all three.
- A1 — orphaned private staging file `config/.test-data.local.<uuid>.tmp` was not ignored; now
  ignored and guarded. A2 — stale strict-boundary comment corrected. A3 — `.agents` hr-manage
  wording aligned with the as-built text (platform files, not twins). A4 — finalization-canary
  availability reason no longer says the number lives in protected Settings.
- Not findings (reviewer-verified counterexamples, kept so they are not re-raised): `bindUpgrade`
  cannot re-admit an import after conversion; identity reuse routes to refusal; availability
  admission precedes the private read; the destination TOCTOU is closed by the live-vs-prior
  comparison; conversion stages the destination before the source rewrite and reports names only.
- Reviewer limits carried to round 2: `secrets-redaction`, `test-target-registry` (unit and
  architecture), `storage-upgrade-environment` test diffs and ~150 import-path-only test rewrites
  were not individually diffed; PNG pixels were classified, not independently verified; no gate was
  independently rerun. Round 2 is a fresh complete assignment over the whole candidate.
**Candidate refrozen for review round 2 (2026-09-07) — awaiting independent review.** Implementation
head `3a3fa427f` (review fixes on top of `e2e6027a0`); this recording commit is the candidate tip.
Gate evidence on the `3a3fa427f` tree: typecheck clean; lint clean at `--max-warnings 0`;
`git diff --check` clean; full coverage through the same two-worker adapter: 438 files / 5509 tests
passed, statements 85.86 %, branches 77.49 %, functions 89.86 %, lines 87.98 % (floors met, exit 0);
`suite-size` unit 341 / scenario 17 / architecture 80, exit 0; `npm run test:parity` 259 passed with
no reference change (generated manifest unchanged, so no fingerprint moved); generated-output checks
current; docs audit PASS.
**Review round 2 (2026-09-07): BLOCKED** on candidate `92bd0883c` (implementation head `3a3fa427f`) —
the fresh reviewer's context compacted mid-review, so the verdict stops short of PASS by rule, not
by defect. Inspected scope: every changed source, config, script and schema diff; proof rows P1–P8
each recorded as satisfied (P9 open by design); F1/F2/A1/A3 verified fixed; round-1 non-findings
independently re-confirmed (`bindUpgrade` re-admission); all nine instruction twins byte-identical;
no legacy live state imported; availability admission precedes the private read. No required finding.
Advisories, all fixed in `63aa8cca6`:
- A5 — the registry `purpose` prose at `config/test-data.json` for the finalization canary and the
  person-lookup canary still named protected Settings as the value owner; both now name the ignored
  private file (D341). Description strings only; no loader reads them.
- A6 — `stageDestination` re-planned under the credential lock against the pre-lock destination
  snapshot; an equal ("unchanged") plan writes nothing, so the writer's live-vs-prior fence never ran
  and the source could be retired against a destination replaced by a concurrent writer. Fixed: the
  destination is re-read under the lock and compared to the planned snapshot before any decision, and
  the write path takes the live read as its prior. Proven by a concurrent-writer case (refused by
  the existing "changed while the migration was planned" reason, source untouched, the other writer's
  file survives byte-for-byte) plus the equal-destination conversion that leaves the file unchanged;
  the case fails against the pre-fix code.
- A7 — the duplicate-key scanner compared raw key text, so two escapings of one key were not
  duplicates while `JSON.parse` kept the last. Fixed: keys are decoded before comparison, and an
  invalid key escape is refused by label. Proven with `\u0049`/`\u0022` escapes and a private
  file whose escaped key repeats a real input name; the cases fail against the pre-fix code.
- Reviewer limits carried to round 3 (bounded, fresh context): no gate log opened or rerun; the 49
  PNG references classified by name and identical IHDR dimensions only; `dashboard-surfaces`,
  `workflow-authoring` and the 1.6 README diffs unread; substantive test diffs unread for
  `test-data-command`, `test-target-registry` (unit and architecture), `secure-env-bootstrap`,
  `separations-composition-wire`, `kuali-finalization-fields`, `settings-file-service`,
  `tests/fixtures/d331-settings-file.ts`, the three workflow `dry-run.scenario.ts` files and
  `tests/unit/helpers/test-data-source.ts`; the `src/control/test-data.ts` →
  `src/infra/config/test-data-local.ts` import not checked against the layering ratchet; round-1 A2
  only partially inspected.
**Candidate refrozen for review round 3 (2026-09-07) — awaiting independent review.** Implementation
head `63aa8cca6`; this recording commit is the candidate tip. Gate evidence on the `63aa8cca6` tree:
typecheck clean; lint clean at `--max-warnings 0`; `git diff --check` clean; full coverage through
the two-worker adapter: 438 files / 5510 tests passed, statements 85.86 %, branches 77.49 %,
functions 89.86 %, lines 87.98 % (floors met, exit 0); `suite-size` unit 341 / scenario 17 /
architecture 80; `npm run test:parity` 259 passed with no reference change; generated-output checks
current; docs audit PASS.
**Review round 3 (2026-09-07): PASS (bounded scope)** on candidate `fff3be61f` (implementation head
`63aa8cca6`). Fresh context; scope was the A5–A7 fix commit plus the six limits round 2 carried.
Reviewer verified A5/A6/A7 fixed and red-capable; independently reran typecheck (exit 0), lint
(exit 0) and `npm run test:parity` (259 passed, `tests/parity` unchanged, tolerance unchanged versus
base); read the gate logs (438 files / 5510 tests, floors 85.86 / 77.49 / 89.86 / 87.98, exit 0;
suite-size 341/17/80); read the three docs diffs against code; read every carried test diff; confirmed
the control → infra import is a permitted downward edge with no ratchet change; confirmed the A2
comment matches the code. No required finding. Whole-task acceptance rests on rounds 1–3 together
(round 2 inspected every source/config/script diff and P1–P8; round 3 closed its limits).
Advisories, fixed in `1e5b4b7b4`:
- A8 — the "never by value" proofs for a malformed configured number and a malformed EID had become
  vacuous: the mock source ignored the malformed value, so the absence assertion could not fail.
  Fixed: each malformed value is written to a real 0600 private file and read through the production
  loader, which refuses it by key; the unused mock helper is removed.
- A9 — the duplicate-key scanner called every undecodable key an "invalid string escape", including
  a raw control character. Fixed: "invalid key string", label only; the control-character case is
  covered.
- Unfixed residue reported by round 3: none.
**Candidate refrozen for review round 4 (2026-09-07) — awaiting independent review** of the A8/A9
delta only. Implementation head `1e5b4b7b4`; this recording commit is the candidate tip. Gate evidence
on the `1e5b4b7b4` tree: typecheck clean; lint clean at `--max-warnings 0`; `git diff --check` clean;
full coverage through the two-worker adapter: 438 files / 5510 tests passed, statements 85.86 %,
branches 77.49 %, functions 89.86 %, lines 87.98 % (floors met, exit 0); `suite-size` unit 341 /
scenario 17 / architecture 80; `npm run test:parity` 259 passed with no reference change.
**Review round 4 (2026-09-07): PASS (bounded, A8/A9 delta)** on candidate `51fcb938b` (implementation
head `1e5b4b7b4`): the malformed values now reach the production loader through real 0600 files (non-vacuous,
red-capable), cleanup and no-developer-file dependence confirmed, the removed mock has no user; A9 wording and
decoded-key semantics confirmed; gate logs read; typecheck, lint and the focused suite independently rerun.
No finding. Acceptance of the exact candidate `51fcb938b` rests on rounds 2–4 together: round 2 inspected
every source/config/script/schema diff and P1–P8, round 3 closed round 2's six limits and verified A5–A7,
round 4 verified A8/A9. Reviewer provenance: each round a fresh read-only `sup-review` subagent (Opus, high);
the round-4 reviewer also assessed the conversion addendum below. Rounds 1 and 2 ended BLOCKED by reviewer
context compaction, not by unresolved required findings.

**Plan as executed (the temporary handoff, source-pinned at
`4ef3b1eee:docs/handoffs/2026-09-07-test-data-foundation.md`, plan/base `f68dc9a5b`, removed at closure):** TD1 shared configuration and one typed reader (`config/test-data.json`,
`src/control/test-data.ts`); TD2 test inputs separated from application configuration (86-row catalog,
retired names refused by name, `test-data-local` binding with opaque `sourceId`); TD3 verified one-time
private conversion (credential document v2 with value-free baseline, `cli test-data migrate
--from-credentials [--plan] --json`, destination staged before source retirement); TD4 complete
shared-fixture consolidation (`tests/fixtures` ownership, `test-data-ownership` guard); TD5 proofs P1–P9 and
plan reconciliation (proof map above); TD6 independent review, `--no-ff` integration, actual conversion and
cleanup (this record). The handoff's execution log (freeze, rounds 1–4) is duplicated by the round entries
above.

**Integration (2026-09-07):** primary checkout `/Users/julianhein/Projects/hr-automation-rebuild`, `master`
at base `f68dc9a5b`, clean, unrelated `stash@{0}` untouched. `git merge --no-ff codex/test-data-foundation`
→ `bc6dc9b54` (parents `f68dc9a5b`, `51fcb938b`); merge tree `764d1c88a` equals the candidate tree. Follow-up
`4ef3b1eee` adds `.gitattributes` (`*.pdf binary`) because `git diff --check` against base flagged the new
synthetic PDF's spec-mandated xref trailing spaces (the candidate rounds had checked only the working tree);
no other change. Integration gates on `4ef3b1eee` (tree `be4d5cdc1`), coverage through a two-worker adapter
bound to this checkout's `vitest.config.ts`: typecheck clean; lint clean at `--max-warnings 0`;
`git diff --check f68dc9a5b HEAD` clean; coverage 438 files / 5510 tests, statements 85.86 %, branches
77.49 %, functions 89.86 %, lines 87.98 %, exit 0; `suite-size` unit 341 / scenario 17 / architecture 80;
`npm run test:parity` 259 passed, no reference change; `build:manifest:check`, `stores:catalog:check`,
`roadmap:check` current; docs audit PASS.

**Actual private conversion (P9, 2026-09-07, primary checkout, integrated CLI, no browser or live
transaction):** fresh preflight — no listener on 3938/5174, no `hrauto-rebuild` tmux, `.tracker/credentials/`
held only `protected.json` (0600, no lock); pre-conversion doctor: authority healthy (schema 32, zero
foreign-key violations, valid invariants), span authority reconciled with zero runs, all pending counts zero,
no new run data, backup missing (reported, not gated, D322), protected settings `unavailable` → exit 1. That
unavailability is the expected pre-conversion state: the v1 document's ordinary read raises the
migration-required error, which `src/infra/sqlite/storage-doctor.ts` reports as `authority-unavailable` and
`src/server/storage/compose.ts` gates to exit 1. Pre document: schemaVersion 1, revision 2, one history
entry, applied upgrade binding (so no pending retired name), four live names plus
`separationsKualiFinalizationCanaryDocumentNumber`; `personLookupCanaryEid` not provisioned (Task 1.6.7
prerequisite); no private file. `--plan`: planned, destination absent → create for the one retired name;
nothing written. Apply: `converted`; source current revision 3 (the report's `historyLength: 1` is the
pre-conversion source fact, not post state); post document schemaVersion 2, revision 3, exactly the four live
names, value-free baseline (`retired` carries command/write/value identities, entries by name and valueId,
the upgrade binding; no value), history folded (length 0); the four live values and valueIds unchanged
(compared in memory by a driver that prints names and booleans only); private file `config/test-data.local.json`
mode 0600, not a symlink, schemaVersion 1, one input equal in value and valueId to the retired source
entry. Verification: `test-data check --json --subject finalization-canary --workflow separations` →
local valid, document-number input present, `personLookupCanaryEid` absent, subject `ready`; re-plan →
`already-converted`, destination unchanged, disposition `equal` (captured); post doctor exit 0 — authority
healthy, span reconciled, protected settings available (four live names present, `activityPersonPseudonym`
absent as before), counts zero, database identity and content fingerprint identical to the pre-conversion
report. Residue checks: tree clean, private file ignored (`.gitignore`), no staging file, credentials
directory unchanged in membership.

**Conversion evidence addendum (2026-09-07): ACCEPTED** by the round-4 reviewer: evidence internally
consistent and matched to code (destination staged before `writeDocument` under the lock; identities
preserved; baseline value-free); no value or value-derived fingerprint in any evidence file (the two
SHA-256 digests in the doctor reports are authority-database fingerprints, not credential-derived);
`historyLength` reconciled as above. Advisory A10 (pre-existing `storage-doctor.ts` code, not in the
candidate): the migration-required error is reported under the generic `authority-unavailable` cause; a
distinct value-free `credential-migration-required` arm is a follow-up for whoever next owns the doctor
surface — historical for this install.

**Cleanup:** worktree `/Users/julianhein/Projects/hr-worktree-test-data` and branch
`codex/test-data-foundation` removed after the merge; the temporary handoff removed in the closure commit;
scratch gate adapters and sanitized evidence logs live only in the session scratchpad. Untouched: the paused
foundation-close worktree at `3bb9abdb3` and its handoff; `stash@{0}`; `.env`; the operator root beyond the
converted credential document and the new private file. Residue reported, not changed: stale Sep-3 locks
under `.tracker/locks` (`parity-json-report.lock`, `server.lock.json`, `workers/307f70a2-…` with a dead
pid) — none is a credential lock; `config/test-data.json` finalization-canary provenance still cites the
pre-rename path `docs/rebuild/03.2-finish-workflow-authoring.md` (inherited from `test-subjects.json`);
`tests/unit/secrets-redaction.test.ts` proves its no-disclosure claim through a mock at the smoke-command
layer (non-vacuous: exact output lines pinned). Task 1.6.7 prerequisites stay open: person-lookup EID
input, retired-environment cleanup, selected Separations replacement confirmation.

**Delivery assessment (one detour; no comparison sample):** approved plan `f68dc9a5b`; sequential fresh
`sup-review` rounds. Material events: (1) round-1 required findings F1 (historical protected journals
unreadable through the live grammar) and F2 (importer accounting) — implementation defects; the plan
named the pinned-old-schema obligation, the candidate's own guard proved an impossible case. One repair
round. (2) Parity refreeze (469 references) — planning omission: adding a protected-binding union member
moves the finalization descriptor fingerprint and the explorer read count (107 → 108), which the plan's
"parity unchanged" expectation did not anticipate; cost one deliberate refreeze plus one mandatory coverage
rerun (two coverage-gate tests read the references). (3) Reviewer context compaction in rounds 1 and 2 over
the 697-entry candidate — assignment resizing; rounds 3 and 4 finished under bounded assignments with
explicit read discipline. (4) Advisory-only repairs A5–A9 (two rounds) — implementation polish found by
review, each with red-capable tests. (5) `.gitattributes` at integration — evidence-procedure gap
(working-tree `diff --check` in candidate rounds). Mandatory reruns: coverage after each implementation
commit (D191) and after the refreeze; integration coverage/parity. Supervisor context compacted twice with
no lost state. Preventable rework: plan the parity refreeze explicitly when a wire/contract schema gains a
member, and start with bounded or partitioned review assignments for candidates above a few hundred changed
entries. Elapsed-time totals are not claimed; the session records do not separate waits from work.


**Reset evidence (2026-09-07).** At the operator's explicit request the rebuild database was replaced
with a fresh schema-32 database; only schema metadata/fresh-baseline marker remained. Doctor exited 0
with zero runs/spans/pending counts and valid integrity. Old run spans, artifacts and the old authority
backup were removed; credentials were verified byte-identical and ordinary settings remained defaults.
This is an operational snapshot, not lasting proof of emptiness. Recheck on resume. Deleted runs are
not migration inputs or live acceptance evidence; historical documentation remains historical.

### 10.6 The durable result — what a `PROOF` tick is allowed to cite

**A dry-run scenario's result is recorded, in two places, and the tree cites the second.**

- **`dry_run_scenario_results`** — an authority row (a schema bump owns it). Per run: the scenario
  id, the workflow, the subject LABEL (never its value), the manifest digest, the run id and trace
  id it executed as, the verdict (`met` · `blocked` · `failed`), the per-assertion outcomes, the
  measured wall time, and the instant. It is insert-only for the same reason every other evidence
  table is: a result that can be rewritten is not evidence. The row is what makes a green from last
  week citable this week.
- **a dated line in the workflow's migration record** (`docs/rebuild/migrations/<workflow>.md`) — one line
  per run, naming the date, the subject label, the verdict and the durable row. **This is what the
  tree's `PROOF` tick cites.** A `- [x] PROOF` line on a migration node with no such line behind it
  is an unsupported claim, and the reviewer's question is always the same one: *which recorded run?*

The manifest digest matters: a scenario whose manifest changed after a recorded result is a
different assertion wearing the same name, so the row keeps the digest and a later reader can see
that the green predates the change (D199's shape — a durable record is stamped with a fact about
ITSELF).

### 10.7 T3 — dashboard conditions attached to a dry-run scenario

A **combined** test is a dashboard assertion made against a REAL run, while that run is in a state
only a real run reaches. It lives at
`tests/scenario/combined/<dashboard-feature>+<workflow>.combined.test.ts` and it attaches to a
dry-run scenario rather than duplicating it — the workflow runs once; the dashboard conditions ride
along at the moments the manifest declares.

Three attachment points, because they are the three states worth catching:

- **while PARKED** — drive the real ceremony through the real command endpoint. The gate dialog's
  packet, its disconfirming-evidence-first ordering, the server-computed `approvalShape`, the
  digest an approval binds to (D211), and the CAS `conflict` arm that D253 found unhandled.
- **while RUNNING** — assert the timeline follows. The projector's fold is fed by an offset-aware
  disk tail across processes (D218), so "the worker wrote a span and the dashboard shows it" is a
  cross-process claim that no unit test can make.
- **after it SETTLES** — read the receipt, the outcome bar, the archive row. D238's rule is the one
  to catch here: a rehearsal wears `partial` / `rehearsal`, never `verified-done`.

**The first combined pair is separations × the run lifecycle**, and it is §9.22 as a file: plan →
start → gate ceremony → resume → preview terminal → archive, every UI claim paired with the
authority or wire fact that independently supports it. §9.22's own table — `| Surface | UI claim |
Paired authority / wire fact | Verdict |` — is the assertion shape; the file is that table made
executable.

### 10.8 T4 — the agent-operated parallel end-to-end tier

**T4 is MANY dry-run scenarios running at once, operated by an agent, and it is the only tier that
tests the platform rather than a workflow.** Its subject is concurrency: N runs across DIFFERENT
workflows, and — the harder half — **two runs of the SAME workflow at once**.

**It needs two things this tree does not have yet, and it may not be scheduled before them.**

- **`{#parallel-runs}`** (R11) — a session is a dashboard-started group of N runs; every workflow
  follows the same browser-profile recipe but each worker owns its own profile INSTANCE, because
  Chromium locks a profile directory and doc 05 partitions on
  `(worker, system, instance, configFingerprint)`. Today there is one worker process per workflow;
  the pool is the build. Workers coordinate through AUTHORITY only — run claims, session leases,
  write fences, the concurrency matrix — never peer messaging.
- **`{#duo-lease}`** (R12) — a durable per-credential ceremony lease serializing every Duo ceremony
  across all workers and systems. D243's hazard is not hypothetical and it is exactly what parallel
  cold starts trigger: Duo's WebAuthn signature counter is per CREDENTIAL and Duo Autopilot's copy is
  per BROWSER PROFILE, so N cold profiles racing one credential is how a profile gets BURNED — and a
  burned profile stays refused across later logins, so the fix must prevent the first refusal rather
  than recover from it. Running T4 before the lease exists is running the experiment that breaks the
  credential.

**What T4 may and may not touch.** Every run is `dryRun=true` — the tier never performs a real
write, and the runner refuses a scenario whose descriptor does not derive `supportsDryRun`. It uses
registry subjects only, and it may not consume a `write-allowed-if-restored` target (that is the
controlled-commit proof's business, and that proof is recorded, not re-run — §10.1). Every run's
subject label is distinct where the workflow's fence is subject-keyed, because two concurrent runs
on one permanent key is a *deliberate* test that belongs in a manifest case with its expected
refusal, not an accident of scheduling.

**How an agent operates it** — the topology is `/custom-e2e-verify`'s, specialized here rather than
restated:

- **one driver, many read-only verifiers.** Exactly one agent owns the browser and the dashboard.
  Verifier agents read artifacts and read-only endpoints — spans, the authority database, the
  `dry_run_scenario_results` rows, the run-detail wire — and never touch the app. The driver finishes
  driving, waits, then triages. A single end-of-run auditor does the cross-cutting reconciliation,
  because splitting cross-cutting checks across agents lets an inconsistency fall between them.
- **double-entry ground truth.** Every UI assertion is paired with an independent source. The
  dashboard is itself under test, so a green screen proves nothing alone.
- **a workaround is a finding.** The driver acts only as an operator could. The moment it reaches
  for something no button offers, that is the defect — file it, take the minimum manual step, and
  stamp the affected assertion conditional. "It worked after I poked it" is the bug, not the
  all-clear.
- **an append-only issue ledger.** One JSONL object per line, never edited by an agent that did not
  write it: `id`, `kind` (`finding` · `corroboration` · `pass`), `foundBy`, `area`, a `dedupKey`
  naming the SYMPTOM and never the cause, `severity`, `title`, at least one evidence path, `status`.
- **red→green promotion.** A confirmed finding is promoted to a deterministic regression test in the
  LOWEST layer that can hold it — a unit test if a unit test can, a structural scenario if it must, a
  manifest case only if nothing cheaper reaches it. An unpinned fix will be rediscovered by the next
  expensive run, so it does not count as fixed.

### 10.9 Layout, naming, projects, and the run policy

**The layout.** Everything else in this section is a rule about one of these paths.

```
tests/
  unit/                                     deterministic policy and component wiring with injected ports
    dashboard/                              the surfaces' extracted *-model.ts halves
  integration/                              real storage, process, socket or composed workflow proofs
  architecture/                             recursive structural guards, helpers and violation fixtures
  scenario/
    helpers/                                pure-walk, coverage-claims, the fake stores
    workflows/<workflow-id>/
      structural.scenario.test.ts           T1a — ONE per workflow, no browser, claims coverage points
      dry-run.scenario.ts                   T1b — the checkpoint manifest + the subject labels (NOT a vitest file)
    dashboard/<feature>/*.scenario.test.ts  T2 — a feature over the real projection, no browser
    combined/<feature>+<workflow>.combined.test.ts   T3 — dashboard conditions on a live dry run
    *.walk.test.ts                          the integration walks — unchanged, still slice-crossing joins
  e2e/
    <journey>.e2e.spec.ts                   T4 — a journey = N dry-run scenarios in parallel
    runner/                                 the operator harness, the issue ledger, the report
  parity/                                   unchanged
  fixtures/                                 shared fixture DATA any tier may import (not test files)
  CLAUDE.md                                 the map: the tiers in one page, pointing here
```

**Naming, and why each one is load-bearing.** `*.scenario.test.ts` is a vitest file the `scenario`
project collects; `dry-run.scenario.ts` deliberately lacks `.test.` so no project can collect it —
a manifest that vitest picked up would start a browser inside the per-commit gate.
`*.combined.test.ts` and `*.e2e.spec.ts` are separately collected so `test:coverage` can exclude
them by GLOB rather than by discipline. `*.walk.test.ts` keeps D185's meaning exactly: a walk claims
no coverage point and the manifest's `file` regex refuses a walk path outright.

**Vitest projects.** Four. `vitest.config.ts` makes every authored offline Vitest file belong to
exactly one named project; `guard-manifest` enumerates the real corpus and rejects both orphaned and
multiply collected files. A future dry-run-dependent `combined` tier stays uncollected until it has
an executor and a deliberate script.

| project | include | in `test:coverage` |
|---|---|---|
| `unit` | `tests/unit/**/*.test.ts` | yes |
| `integration` | `tests/integration/**/*.test.ts` | yes |
| `architecture` | `tests/architecture/**/*.test.ts` | yes |
| `scenario` | `tests/scenario/**/*.test.ts`, excluding future live-dependent `tests/scenario/combined/**` | yes |

**jsdom, per file (D277, 2026-08-27).** `jsdom` is a devDependency and is never a project default: a test that needs a real DOM to pin wiring — what a press dispatches, where focus returns — declares `@vitest-environment jsdom` at the top of its own file inside `unit`. The environment is opted into by the file, so a pure `*-model.ts` test never pays for a DOM, and a DOM test can never be mistaken for a visual claim — visual claims belong to `tests/parity/**`.

The distinct roots keep guards out of `test:unit` and execute them once inside `test:coverage`.
`test:unit` and `test:integration` lock selection to their named projects and accept only positional
file filters; project/config overrides are refused. `test:architecture` selects only its named
project with non-empty collection. `guard-manifest` checks all four project includes, empty
excludes where applicable, unique ownership and non-empty collection; injected-listing policy
tests prove duplicate, orphan and empty refusals.

`tests/e2e/**` is outside the vitest projects entirely, like `tests/parity/**`, and both are excluded
from coverage instrumentation.

**Scripts, and the trigger for each.** The script is half the rule; the trigger is the other half,
and D190's lesson is that a lane nobody chains is a lane that cannot fail.

| script | runs | trigger |
|---|---|---|
| `npm run test:unit` | deterministic unit project only | focused local backend iterations in the supporting Phase 1–5 initiative |
| `npm run test:integration` | preserved integration project only | explicit later operator-reviewed integration execution |
| `npm run typecheck && npm run lint && npm run test:coverage` | unit + integration + architecture + T1 structural + T2 + the walks, with the floors | default implementation candidates and finalizer completion; focused parallel-worker and documentation-only exceptions in §3.14 D191 |
| `npm run test:parity` | 281 browser cases, including 222 reference triples and the dual-adapter comparison | every dashboard change; before a slice closes |
| `npm run perf:dashboard` | reproducible structural counters plus observational timings | after a measured dashboard data-path change; before a slice closes |
| `npm run cli -- dry-run-scenario <workflow> --subject <label>` | ONE T1b manifest against the real systems | at a workflow's migration; whenever its graph or its transaction node changes; to refresh a stale recorded result |
| `npm run test:combined` | T3, against a live dry run | when a dashboard surface a workflow depends on changes, and at that workflow's migration |
| `npm run test:e2e` | T4, agent-operated | deliberately, after `{#parallel-runs}` and `{#duo-lease}` land; before cutover |

**The `scenario-coverage` audit is kept exactly as built and extended across the new folders.**
Every scenario declares the coverage points it walked — an `it` title whose head (before `" — "`)
parses as a `ScenarioId` IS a claim, which is the corpus's own convention made mechanical — and
`auditScenarioCorpusLayout` closes both directions by NAME: a file of neither kind, a graph scenario
that claims nothing, an empty file, a duplicate listing, an unregistered id, an id declared in a file
its manifest row does not name, a manifest row nothing executes, a manifest row naming an absent
file, and a walk that claims a graph path. The audit is pure over an injected listing, so the move to
`workflows/<id>/` changes the listing and nothing else; each refusal keeps its negative control,
which moves exactly one thing in the REAL corpus. A typo stays slug-shaped and therefore stays a
claim and FAILS — reclassifying an unrecognised id as prose is precisely how
`person-lookup/ucpath-drill-subject-mismatch` executed unregistered until D185.

**Retention and output are part of the gate contract (operator decision, 2026-09-02).** Retain a
test when it uniquely protects a risk or contract. Two tests are duplicates only when they exercise
the same failure mode at the same seam with the same oracle; deletion or consolidation requires a
mapped survivor and red-capable evidence, or proof that the removed test could not fail meaningfully.
Use the runner/type-first layout and reserve scenarios for distinct graph or cross-boundary paths.
Targeted local iteration is allowed, while supervisor integration and merge require the complete
type/lint/coverage family. The affected-suite ≤30 s, full-coverage ≤90 s, and parity ≤75 s targets
are measured objectives, never permission to delete unique protection, weaken isolation/parallelism,
raise an allowance, lower a floor, or add an exclusion.

Runner scratch lives under the owned `/tmp/hrt-<uid>/run-*` directory: successful runs remove
their scratch, failed runs retain `failure.txt` and the tail, and `test:reap` checks ownership
before explicit reclamation. `coverage/`, `test-results/`, and `tests/parity/.output/` are ignored
generated output; reviewed parity references and reproducible fixtures stay tracked. Accepted
task evidence belongs under the external rebuild-evidence root. `test-artifact-ownership` checks
the current Git paths/ignore policy, with injected negative controls in the unit policy test.

One configured streaming `verbose` reporter owns Vitest output: project, file, suite, and the full
behavior/refusal title remain visible as work completes. Scripts do not layer a second reporter.
Only genuinely long or multi-stage harnesses emit stable named phase begin/complete markers; short
units do not chatter per assertion. Expected diagnostics are captured and asserted. Unexpected
failures name the exact operation with actionable non-secret context and are never globally hidden.

**`tests/scenario/AGENTS.md` and its byte-identical `CLAUDE.md` twin** map the three collected
scenario kinds and their current paths, state why T1b is not a Vitest file, and point here for the
normative tier/trigger contract. They are a map, not a second spec — a second spec is a second
opinion that can drift (D252).

### 10.10 Coverage floors — 80/80/80 global

**The floor follows the measurement, and the 2026-09-02 measurement at HEAD is:**
`npm run test:coverage` reports **87.34 % lines (26,293 / 30,103) · 85.40 % statements
(28,534 / 33,412) · 89.41 % functions (5,660 / 6,330) · 76.39 % branches
(15,367 / 20,115)**.

The global floors move **60 → 80** for lines, statements and functions. Nothing else changes: the
safety-critical per-glob floors stay at 80, the reviewed exclusion list is untouched (its SHA-256 is
pinned in `guard-inventory.json`, so changing it is a visible act), and
`guard-inventory.json`'s `coveragePolicy.minimumFloors.global` moves with it — `guard-manifest`
asserts the configured floors are `>=` the inventory's, so raising one without the other is caught.

Two things this deliberately does not do. It does **not** raise the safety-critical floor, which is
already met at 97 %+ after D190 and whose value is that it is per-glob. And it does **not** invent a
branch floor: D91's branch half is UNMET and its Phase-2-exit trigger has passed (§3.14 as-built), so
the honest move is the one D91 already specifies — adopt the **50 % global** branch gate that the
measured 76.39 % already clears — and defer the 70 % safety-critical half until it is measured
per-glob. Raising a floor above a number nobody has measured is the mirror image of D145's
uncalibrated allowance.

### 10.11 Checklist — how a NEW workflow adds its tests

For the agent doing an admitted migration. Ref workflow-model §1.6.2 cites this list; every item is a gate
that goes RED before it goes green.

**D311/D317 amendment — test the workflow/compiler boundary once, and workflow behavior where it differs.**
The workflow-definition implementation adds one registry-wide conformance suite that compiles every registered
workflow and refuses duplicate tasks, unresolved references, cycles, unstable group keys, descriptor /
module mismatches and incomplete generic dashboard projections. Person lookup proves the smallest
shape and separations proves reads, computed facts, a conditional gate, transactions, omissions and
all current generic surfaces. Once equivalence is green, superseded manual projection tests and
declarations are deleted; keeping both is not extra assurance because it creates two authorities.

Each workflow still owns the T1 structural scenario, T1b live manifest and every safety proof
below that its behavior requires. It adds T2/T3 dashboard coverage only when it is the first workflow
to introduce a new interaction or wire arm; reusing an already-proved generic surface is covered by
the registry-wide compiler conformance test. Coverage floors, architecture guards, live selector
verification and controlled-write evidence are unchanged.

**D312/D315/D316 acceptance additions.** The architecture lane enforces the exact four authored
artifacts for a workflow classified as reusing existing tasks/surfaces and refuses a hand-authored
descriptor, module/node assembly, registry wire or workflow-specific generic-dashboard adapter. The
compiler conformance matrix covers the closed `task | parallel | delegate | gate | transaction`
algebra, stable entry/leaf ids, explicit parallel join/failure policy, independent failed-leaf retry
and typed child-run delegation. Person Lookup must prove the minimum form and Separations the
complete form with public descriptor/module/wire equivalence; a deletion guard then refuses their
superseded declarations. A fixture changing only grouping, labels, run options or omission forms
must have exactly one authored workflow file changed: `workflow.ts`. There is no legacy-authoring
escape hatch.

**D313/D314 omission and recovery matrix.** Tests prove a complete schema-valid omission bundle is
admitted before start, while missing/invalid values refuse and no worker can request replacement
values mid-run; a separately declared verifier still executes. Recovery tests distinguish
checkpoint resume from restart-from-start: the former retries the failed node/parallel leaf, while
the latter reruns all reads/computations, reuses completed transaction proof without another
prepare/commit, probes unfinished intents first and refuses fresh-fact/write-proof mismatch.
Mutation tests must demonstrate that either recovery path goes red if a completed external write
can execute a second time.

1. **Create `tests/scenario/workflows/<workflow-id>/`.** Two files, no more.
2. **`structural.scenario.test.ts`** — walk every declared path through `walkDescriptor` and claim
   every coverage point `deriveGraphCoveragePoints` derives from the descriptor. `scenario-coverage`
   is RED until each is claimed AND walked, and RED again if you claim one you did not walk. Assert
   graph shape, refusals and idempotency; assert **nothing about the world**, and use synthetic
   subject values that no live system would resolve (§10.3).
3. **`dry-run.scenario.ts`** — the T1b checkpoint manifest of §10.4 chooses exactly one graph-valid
   arm. `dry-run-preview` declares nodes reached/excluded, checkpoints, gate results, zero
   write-authority deltas, receipt, preview terminal and transaction `proofSource`. `live-read`
   declares the same node/checkpoint/gate/zero-delta evidence plus the ordinary terminal result and
   receipt, and is admitted only for a zero-transaction graph. Declare one case per registry ARM
   this workflow addresses — a case is a state a REAL subject can truthfully be in, never a state
   invented for coverage (D284); the negative branches belong to the structural file on synthetic
   subjects.
4. **Register the subject** in `config/test-data.json` (`subjects`) — a label per SUBJECT, an arm per
   workflow, a case per arm: the arm's kind, the subject's ONE availability with today's date, the
   doc section that records what it is, and any canonical leaf a live read cannot yet supply declared
   `pending` with its reason. Private values go to ignored `config/test-data.local.json` under a
   name in `TEST_DATA_INPUT_NAMES` and are read only through `src/control/test-data.ts` (D341);
   never `.env` or Settings. A label the registry cannot resolve, or a declared-pending leaf, makes
   the case `blocked`, never `failed`.
5. **Run it live:** `npm run cli -- dry-run-scenario <workflow> --subject <label>`, once per case.
   The manifest arm determines transaction preview versus transaction-free read; the command name
   does not authorize `dryRun` on a zero-transaction graph.
   Record the result — the `dry_run_scenario_results` row is automatic; the dated line in
   `docs/rebuild/migrations/<workflow>.md` is yours to write, and it is what the tree's `PROOF` tick cites.
6. **Which T3 pairs it must add.** One per dashboard surface this workflow is the FIRST to exercise
   in a new way: a gate ceremony if it is the first gated workflow of its shape, a parked-write panel
   if it can park, a member/group view if it fans out, an archive/receipt read if its receipt has an
   arm no other workflow produces. If every surface it touches already has a combined pair against
   another workflow, it adds none — the pair tests the SURFACE, and a second workflow through the
   same surface is a duplicate, which is worse than absence (D185's rule about walks).
7. **Tick the tree.** The workflow's `order-N` node carries `- [ ] PROOF T1 scenario tests for
   <workflow> (+ its T3 pair)`; it goes `[x]` only with the commit AND the recorded run cited.

### 10.12 Checklist — how a NEW dashboard feature adds its tests

1. **`tests/scenario/dashboard/<feature>/<name>.scenario.test.ts`** — drive the feature through the
   REAL projection and the real command service over a real authority database, not through the
   component. The surfaces' pure halves are already covered by `tests/unit/dashboard/`; what a
   feature scenario adds is the seam — a command's effect on authority, a projection's response to a
   transition, a refusal arm reaching the surface. Both CommandResult refusal arms (`rejected` AND
   the CAS `conflict`) must be exercised, or `command-result-exhaustive` will tell you (D253).
2. **Parity references** — add the feature's states to `tests/parity/`'s state list and freeze them
   with `npm run test:parity:update`, the ONE switch that refreshes the pixel and semantic halves
   together (D132). Then **look at the screenshots**: D187's two-pixel run-detail panel passed a
   dozen green gates and two deliberate reference reviews because the a11y half reported every word
   of a column nobody could see. A reference corpus nobody looks at records defects instead of
   catching them.
3. **Re-run everything.** A dashboard change re-runs ALL workflows' structural scenarios and ALL
   dashboard feature scenarios (§10.2), plus `test:parity`.
4. **If the feature changes what an operator does to a RUN**, it needs a T3 pair (§10.7), not just a
   T2: a control that looks right against a fixture and 422s against a real run is the exact defect
   `wire-connectivity` and D253 were each written after.
5. **Tick the tree.** The generic workflow/compiler conformance proof is ticked once at
   `{#workflow-authoring-model}`. A migration carries a `PROOF T2/T3` line only for a new dashboard
   capability it introduces; the line names that capability rather than repeating every inherited
   surface.


---

## 11. Guard activation, phase by phase — the as-built ledger

History, and deliberately kept. Each block below records which guards a phase ACTIVATED, in the same
commit as their targets, and — the half that matters — which it did **not**, so a planned guard could
never be reported as green to make a phase look broader than its implementation. They were the first
265 lines of this document until 2026-08-20; they moved here so the doc opens with its contract. No
text inside them was edited: they say what was true on their own dates, and §5.1 says what is true
now.

### Phase 1b as-built guard delta (2026-07-31)

<!-- roadmap: p1-base -->

The rebuild guard lane is no longer a pre-tree promise. The reviewed manifest discovers every
architecture test recursively and runs active whole-`src` arms over real source; typecheck, ESLint,
unit/architecture tests, coverage floors, operational isolation, strict boundaries, clock/config/
secret single-source rules, runtime dependency/environment closure, redaction, and D94 legacy
change accounting all execute from the rebuild repo's plain gate family. Every active arm resolves
a non-empty file set, and each ratchet still proves itself against a violating fixture.

`fail-loud-catch-default` now uses the TypeScript AST across every executable statement in a catch
block and in both expression- and block-bodied Promise `.catch` handlers. Logging or branching
before a bare-default return/assignment/initializer no longer bypasses it. Pure adversarial fixtures
pin multi-statement handlers, nesting, comments/strings, and safe propagating or distinguishable
non-default returns. No allowlist was added. Guards belonging to later absent roots remain planned;
their future contracts are not reported as implemented by 1b.

---

### Phase 1c Stage A as-built guard delta (2026-07-31)

<!-- roadmap: p1-authority -->

The existing `strict-boundary-schemas.test.ts` catalog now registers every Stage-A durable/wire
schema and exercises every command, proof, probe, settlement, intent/attempt, notification,
gate-result, ledger, and outbox union arm. Its recursive unknown-key mutation now covers the new
nested objects as well as malformed IDs/timestamps and schema-bound canonical values. No new
architecture guard file was needed, so the guard inventory is unchanged rather than padded with a
duplicate guard.

Focused unit/adversarial tests pin D95 family closure, priority/version bump separation, strict
rename normalization, immutable manifest freezing, generic gate schema hashes, notification
routing, dry-run-impossible ledger payloads, erased proof rejection, and the rule that pre-window,
single, ambiguous, unknown, present, or inconsistent negative observations cannot unlock retry.
Storage/recovery, command-handler single-path, write-sequencer ordering, atomic-transaction crash
injection, and projector tests remain later Phase-1c/1f work; Stage A does not mark them green.

---

### Phase 1c Stage B as-built guard delta (2026-07-31)

<!-- roadmap: p1-authority -->

Stage B extends the existing `strict-boundary-schemas.test.ts` catalog with the adapter options,
metadata/inspection, immutable-insert disposition, and strict SQLite storage-record shells. It also
adds focused unit proof in `sqlite-authority-database.test.ts` for exact table classification and
pragmas, the exact committed-v1 → v2 migration fixture, existing-file/version/migration-marker/
schema/lock failure, foreign keys, idempotent commands, permanent committed/`observed-present`
write keys, every registered authority repository mutator, savepoint-isolated caught nested
fence/commit failures, empty/rollback generation accounting, and projection upsert/clear. A separate static
unit test, `sqlite-authority-boundary.test.ts`, proves that only the private adapter imports or names
`DatabaseSync` and that its public entrypoint exposes no raw connection or SQL escape hatch.

The planned `storage-recovery` guard remains planned and unchanged in
`docs/rebuild/guard-inventory.json`. Its contract also owns backup/checksum/manifest verification,
degraded boot, restore drills, and projection rebuild after restore; none of those Stage-C concerns
exist yet, so activating that umbrella now would overclaim recovery. Phase 1c remains incomplete,
as do command-handler single-path, write-sequencer crash injection, workers, projectors, browser,
HTTP/UI, and live lanes.

---

### Phase 1c Stage C as-built guard delta (2026-08-01)

<!-- roadmap: p1-authority -->

Stage C activates the existing `storage-recovery` inventory arm and gives it a non-empty focused
architecture suite over real temporary SQLite databases and the official native online-backup API.
The suite pins successful self-inspected copies and manifests, request coalescing plus the bounded
generation follow-up, backup interruption cleanup, byte/manifest tampering, corrupt/truncated/
foreign/newer/foreign-key/invariant-invalid degraded boot, all four mutation refusals, exact doctor
counts and candidate ordering, and stopped-proof restore with suspect-file preservation and
projection-only rebuild verification. Every authority record is strict-schema parsed during copy
inspection; JSON-valid/schema-invalid command, write-intent, and opaque-family corruption fixtures
make backup, boot/doctor, and restore fail closed. Restore proof fixtures cover stale, replayed,
runtime/process-generation-mismatched, forged, and active-process states and prove refusal before
suspect/staging mutation. The suite also exercises exact-candidate rejection, projection-rebuild
failure, and atomic-swap failure.

Static boundary proof keeps `DatabaseSync` and `node:sqlite` private to the adapter, requires the
official backup symbol, and bans `VACUUM INTO` and filesystem-copy backup fallbacks. The strict
boundary catalog registers every new recovery config, durable record, report, health-cause, and
union arm. This activation covers storage recovery only; command-handler single-path,
write-sequencer crash injection, workers, projectors, browser, HTTP/UI, and live lanes remain open
Stage-D or later work, so Phase 1c is still incomplete.

---

### Phase 1c Stage D as-built guard delta (2026-08-01)

<!-- roadmap: p1-authority -->

Stage D activates exactly three previously planned inventory entries in the same commit as their
implementations and focused suites:

- `permanent-key-dedupe` exercises sequential and independently opened competing SQLite
  connections, committed and `observed-present` permanence, the observed-present zero-attempt/
  zero-write-outbox rule, and natural-key/digest/binding-digest mismatch refusal.
- `recovery-negative-proof-settlement` crosses the exact propagation and read-spacing boundaries
  with an injected manual Clock and proves that early, single, duplicated, malformed, future,
  out-of-order, wrong-key/query/source/source-state, present, ambiguous, unknown, and operator-only
  evidence never grants retry authority.
- `atomic-write-outbox` validates the successful intent+attempt+ledger+terminal-span transaction,
  injects failure after every storage step and proves total rollback plus unchanged authority
  generation, rejects cross-outbox trace disagreement and subject-bound/unscoped ledger-evidence
  mismatch, and statically pins the narrow repository/no-standalone-insert surface.

The strict-boundary catalog also covers the new natural-key, generic-outcome, fence, permanent-key
resolution, atomic-input, storage-step, and commit-report schemas and recursively rejects unknown
keys. Hardened Stage-D acceptance evidence is: focused guard/catalog 24/24, full unit+architecture
187/187, architecture 99/99, typecheck and zero-warning lint green, and coverage at 87.99%
statements, 76.86% branches, 92.23% functions, and 90.75% lines. The remaining command-handler, worker,
browser/driver, sequencer/projector, HTTP/UI, scenario, and live-lane guards remain planned; none was
activated to make Phase 1c look broader than it is.

These results complete **Phase 1c**. They do not complete Phase 1, whose next item is 1d and whose
exit remains the live Person Lookup spine proof.

### Phase 1d guard-activation boundary (ratified 2026-08-01)

<!-- roadmap: p1-authority -->

Phase 1d activates only guards whose real seam exists: port provenance, semantic UI registry and
safe catalog freshness, task/driver boundary, effect-contract/example/error/freshness/provenance/
subject/capability/store/provider/artifact/no-`any` boundaries, and OnBase-only exclusivity. Each
active arm has a violating canary and a non-empty production target. Runtime descriptor/worker/
fence-ordering guards remain planned for 1e/1f; provider admission/budget guards remain planned for
1f; production provider-pool/consumer guards remain planned for 2h. A planned guard is never made
active merely to make 1d look broader than its implementation.

The selector port inventory is a strict checked-in architecture-lane input pinned to one clean
legacy commit plus exact source/catalog paths and blob ids. Candidate rows contain provenance and
search intent only—never locator strings, captured values, screenshots, secrets, or fallback
recipes—and cannot enter the runtime registry/catalog without D98's fixture **and** live-read-only
evidence. UI scenario refs resolve through D99's strict UI-owned verification corpus using the
canonical `ScenarioId` grammar and a global uniqueness audit.

#### Phase 1d Stage A as-built — selector provenance snapshot (2026-08-01)

`config/ports/legacy-selector-port-map.json` now records all **406** legacy catalog keys exactly
once at legacy commit `793abe1f8265f3213ffe8a80d6cfd9860a32a1dc`: CRM 12, I-9 41, Kuali
22, New Kronos 54, Old Kronos 23, OnBase 28, ServiceNow 11, SharePoint 10, and UCPath 205.
Every system pins the exact selector-source and generated-catalog path plus SHA-1 Git blob; every
row carries non-empty search intent, source line, and the same exact blob provenance. A candidate's
path-derived `candidateId` is explicitly an **unclassified, non-authoritative proposal**, never an
`ElementId`. The strict union permits only `candidate|ported|driver-internal|not-porting`;
`ported` alone carries a classified canonical id and requires D98's dual evidence. Stage B later
classified the reviewed Person Org operation plus the Phase-1f CRM Person Lookup rows: **387**
candidates remain, **18** rows are ported, and the PeopleSoft content frame is driver-internal.
The legacy generic `personOrgSummary.viewAllLink()` row is the sole contextual one-to-many port:
its closed, evidence-bound contexts map to the exact search-results and Employment Instances
toggles, while flattened canonical ids and contexts remain globally unique.

The active `legacy-selector-port-provenance` guard regenerates the safe inventory from the pinned
commit in the architecture lane, compares it byte-for-structure, and rejects omissions, duplicates,
stale blobs, invented keys, canonical-id collisions, evidence-free port claims, and unknown recipe/
capture fields. Its violating canaries prove those arms fail. Runtime code never reads across the
repository boundary and the snapshot contains no locator strings, captured values, screenshots,
secrets, or fallback recipes.

The Phase-1f CRM expansion promotes exactly five additional rows: search result rows/cells/name
link, the verified Visualforce `th` label-following-value recipe, and onboarding-history rows. Each
is bound to sanitized deterministic and fresh read-only live evidence dated 2026-08-02. The
broader record fallbacks, nth-row convenience selector, section navigation, and history button
remain candidates because the Person Lookup path neither needs nor has fresh proof for them.

#### Phase 1d Stage B as-built — semantic registry + typed driver seed (2026-08-01)

The server-only registries are `src/stores/ucpath/driver/ui-registry.ts` and
`src/stores/crm/driver/ui-registry.ts`. UCPath publishes two screens, fourteen elements, four page
states, and two observations; CRM publishes three screens, five elements, four page states, and one
observation. Raw selector recipes remain private to the driver roots. Task and workflow import
graphs reach only schema-first driver declarations and session-provider leaves, while the raw
Playwright interpreters own the selector-backed Person Lookup operations. No commit method or
external-write capability exists on either read-only driver; the concrete worker browser/session
factory remains a later Phase-1f integration step.

`npm run ui:catalog` generates a **35-entry** `generated/ui-catalog.json` plus per-system UCPath and
CRM `UI-CATALOG.md` files; `npm run selector:search -- "<intent>"` searches only that safe
projection. The outputs omit locator/state/read recipes and captured values. Both CLIs take an
explicit path — `ui:catalog -- --out-root <path>` and `selector:search -- --catalog <path>` — and
`ui:catalog` publishes through an atomic rename, because **no test may rewrite a tracked projection
in place.** Test files run in parallel forks over ONE working tree, so an in-place regenerate is
visible to every concurrent reader (`ui-registry`, `semantic-ui-registry`) and, worse, silently
heals a genuinely stale checkout mid-run. The behavioural CLI fixtures therefore generate into a
temp root and pin the checkout's bytes as unchanged from first import to last case. Checked-in fixture and
sanitized live/read-only manifests bind every published fact to exact port rows, record
`externalWriteAttempted:false`, and retain no captured HR values. UCPath additionally records the
two zero-match legacy accessible-name recipes and the fail-loud View All pagination proofs; CRM
records exact search/empty, displayed-EID, and history-transition evidence.

The active `semantic-ui-registry` and `task-driver-boundary` guards have violating canaries. They
enforce registry uniqueness, same-system dependency resolution, collision-free search terms,
global/non-vacuous UI scenarios, dual evidence, candidate exclusion, catalog byte freshness, and
raw Playwright confinement. UI catalog/evidence/scenario schemas are also in the recursive strict
boundary catalog.

#### Phase 1d Stage C as-built — sealed task contracts and contexts (2026-08-01)

The bundle-safe contract core now seals `read|prepare|commit` definitions only after runtime
validation of effect/verb, strict schemas, canonical examples, error taxonomy, freshness,
provenance, subject, and typed write-safety metadata. The active `task-contract-sealing` guard scans
the real contract source family, rejects server/Playwright imports and direct seal forgery, and has
a violating fixture. Its checked type fixture proves undeclared error codes, `z.any()` outputs, and
read-context mutation access fail `tsc`. Freshness/provenance/subject/effect schemas are registered
in the recursive strict-boundary catalog. Browser execution, store/session binding, and mutation
token mint/validation remain absent, so their 1f guards stay planned.

#### Phase 1d Stage D as-built — bounded stores, sessions, providers, and artifacts (2026-08-01)

`task-store-boundaries` now proves the closed nine-browser-system declaration set, exact
driver/session/store matching, fail-loud unwired login placeholders, OnBase-only exclusivity, and
the compile-time effect/access plus provider-client narrowing fixtures. The store registry exact
matches implementations to its contract corpus and exercises the contract reference resolver for
every registered task; synthetic unit tests prove missing scenarios and missing/mismatched corpus
tasks fail loud.

`artifact-effect-boundary` pins the path-free content-addressed ref, rebuild-only non-symlinked
root, temp→fsync→atomic-rename durability sequence, crash-boundary recovery, and byte-identical
idempotency; its AST canary rejects direct mutable filesystem access from task/workflow
implementations.
`provider-capability-boundary` confines raw network/provider modules and adapter implementations to
`infra/providers`, pins exact capability client narrowing, and has a direct-network/forged-adapter
canary. The recursive strict-boundary catalog now includes session, retry, artifact, provider, and
artifact-root schemas. These active guards cover only the real 1d interfaces/declarations,
artifact writer, and provider deterministic fakes: 1f admission/budget/worker/session-runtime
guards and 2h production provider-pool/consumer guards remain planned.

---

### Phase 1f guard-activation boundary (ratified 2026-08-02)

<!-- roadmap: p1-kernel -->

Phase 1f must activate guards against the real executor/command/session/provider targets in the
same commits as those targets. The acceptance set is non-vacuous and fail-both-ways:

- start planning preserves exact raw and canonical representations plus both schema hashes, and
  crash/conflict injection proves plan consumption + active-run policy + every run insert are one
  transaction;
- every failed task/run resolves a persisted ref operator-trust `FailureRecord`, every successful run resolves
  exactly one schema-bound terminal result, and neither can be reconstructed from display events.
  Crash injection covers authorization plus failure/result/outbox/run writes; recovery uses
  NULL-safe bidirectional invariants and direct partial-settlement fixtures. Initial success rejects
  hand-built schema-valid records without the descriptor-factory seal, rereads exact checkpoint
  rows, and pins each conditional not-run dependency to its authored reason. Exact replay proves the
  original expected version and claim from durable authorization rather than trusting terminal state;
- the executor supplies a real `recordData` collector and rejects missing/contradictory `live`
  provenance before checkpoint/result persistence while derived fields retain the oldest complete
  upstream provenance;
- worker-session reuse requires exact worker/system/resolved-instance/config-fingerprint identity,
  verified-neutral reset is distinct from explicit `session:"fresh"`, and config/fresh-boundary
  fixtures prove close-before-replace;
- expired-claim fixtures containing an `attempting` write intent enter recovery before any ordinary
  requeue/claim, including an authority-unavailable refusal case;
- beat ⑦ crash injection spans intent+attempt, transaction checkpoint, ledger and terminal outboxes,
  any required receipt ref, and run transition in one outer authority transaction;
- one exhaustive dispatcher handles every command union arm: Phase-1 arms execute through their
  authority service, while later arms return typed `capability-unavailable` with zero mutation;
- generic provider admission enforces the immutable snapshot's abort/timeout/concurrency/rate/
  daily-use/cost limits before every adapter call; exhaustion performs zero remote calls and holds
  no sleeping worker. Production pool/consumer coverage remains 2h.

The activated D112 guard walks every `src/**` import and each task's transitive local import graph:
raw network/vendor modules and adapter implementations remain under `infra/providers/**`; task and
store graphs cannot reach those adapters; only `core/provider-admission.ts` constructs the admitted
client or consumes the adapter interface. It audits the closed capability/config mapping in both
directions, pins one deterministic harness surface, proves denial/timeout/abort never fall through
to remote I/O or worker sleep, and fails if a production provider module or consumer appears before
Phase 2h. Durable tests pin exact fixed-window edges, restart/lease behavior, independent-connection
races, conservative cost accounting, replay/divergence, settlement uncertainty, and v9 recovery.

No existing Phase-1c four-row atomic-outbox test may stand in for the full beat-⑦ fixture, and no
schema-only command-family test may stand in for exhaustive runtime dispatch.
