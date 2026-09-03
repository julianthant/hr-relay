# R1 report — architecture guards and static/type/lint gates

## Outcome

**COMPLETE WITH R7 RESIDUE.** R1 finished on `feature/test-r1-architecture-static` from base
`7982650c`. The architecture lane is now a self-contained, exact named Vitest project; it does not
collect through `unit`, fails on empty collection, emits project/file/full-test labels, and runs
without a legacy checkout or `HRAUTO_LEGACY_REPO`. Static gates now cover every authored root and
all three root TypeScript configs. All 70 architecture guard files remain active; one duplicated
assertion was consolidated, and red-capability gaps were repaired without weakening a threshold or
product invariant.

The consequential security review also caught and repaired direct identifier-shaped values in the
new frozen evidence. Original legacy commits, paths, and source-blob identities remain pinned;
consumers receive only identifier-redacted source snapshots authenticated individually and by a
code-owned digest of the complete payload.

R7 still owns broad authority/count/reporting reconciliation, the ≤90-second full-coverage budget,
existing React `act(...)` warning cleanup, and the integrated concurrent-dashboard coverage check.
Those are recorded precisely below; none requires an R1 product-truth decision.

## Before / after

| Measure | Intake | Final R1 |
|---|---:|---:|
| Architecture tree | 70 files | 70 files |
| Guard manifest | 81 rows: 70 active / 9 retired / 2 planned | unchanged and bidirectionally exact |
| Architecture tests | 689 | 703 |
| Architecture gate | path filter, also collected by `unit`, dot output | exact named project, excluded from `unit`, verbose, empty collection fails |
| External checkout | missing checkout failed 50 suites during import | no checkout/override needed; 70/70 files pass |
| Architecture runtime | 76.89 s intake baseline with legacy override | 22.97 s final without override |
| ESLint CLI roots | `src tests scripts` | those roots plus all 3 TypeScript root configs |
| Root-config typed lint | absent | exact typed block for all 3 configs |
| Frozen source evidence | external Git reads | in-repo redacted text + source-blob provenance + external full-payload anchor |

Reporter overhead was measured on the same post-rationalization lane: verbose took 24.80 s versus
24.39 s with dot, a 0.41 s increase. The later final verbose run completed in 22.97 s. It printed
the project, file, and full test title for every result and emitted no warning.

## Retained, deleted, moved, and merged

| Disposition | Count | Record |
|---|---:|---|
| Retained | 70 architecture files | Every file owns a distinct risk/seam/oracle in `u01-inventory.md` and `u05-changes.md`. |
| Deleted | 0 files | No unique `replacementRequired` invariant was removed. |
| Moved/renamed | 0 files | Reviewed names remain truthful. |
| Assertion merged | 1 | Exact `test:architecture` script assertion moved to sole owner `guard-manifest`; `gate-coverage` retains its distinct static-gate contract. |
| Added independent witness | 1 unit file / 3 tests | `architecture-project-empty-collection.test.ts` lives outside the architecture lane and launches the real command against an empty filter. |
| Added evidence/helper | 1 provenance payload + 1 strict helper | Replaces runtime access to the legacy checkout without skipping any frozen invariant. |

The apparent overlap families—selector/UCPath strictness, runtime/provider capability,
identity/subject/fence/pairing, dashboard wire/refresh/connectivity, receipt/redaction/secrets,
worker overlap/teardown/recovery, and descriptor/delegation/editor/layout—were retained because they
exercise different seams or use different oracles. R1 applies the coordinator rule that duplication
requires the same risk, same seam, and same oracle.

## Logical commits

| Commit | Purpose |
|---|---|
| `7de90372` | Isolate the exact named architecture project and exclude it from unit. |
| `961a91fe` | Record the bidirectional 70-file / 81-row inventory. |
| `242a8fa6` | Merge self-contained frozen legacy provenance. |
| `ad0b3052` | Merge static/type/lint root coverage. |
| `cd004cd6` | Pin exact public gate identity. |
| `8a96afec` | Align focused self-contained guard authority. |
| `f5cd9044` | Merge authenticated generated legacy path snapshots. |
| `5615db1d` | Merge external frozen-provenance anchors. |
| `43077abf` | Merge the independent empty-architecture refusal. |
| `a2132adc` | Close architecture gate bypasses. |
| `9c648439` | Forbid architecture project exclusions. |
| `f2b3a9d5` | Reconcile review evidence. |
| `29e66288` | Make guard diagnostics explicit. |
| `352a017c` | Preserve independent guard witnesses. |
| `0f5bb6ad` | Make the public architecture gate explicit. |
| `3906ddac` | Pin the final architecture membership owner and remove a weak regex. |
| `008f871c` | Redact frozen identifiers and authenticate the sanitized payload. |

## Changed files

| File | Why it changed |
|---|---|
| `AGENTS.md`, `CLAUDE.md` | Keep paired instructions identical; record self-contained gates, named architecture membership, and identifier-safe frozen evidence. |
| `config/ports/legacy-architecture-provenance.json` | Add the strict in-repo source/path evidence that replaces checkout-time Git reads. |
| `docs/coordinator/test-suite-rationalization/artifacts/r1/u01-inventory.md` | Full 70-file / 81-row inventory and intake measurements. |
| `docs/coordinator/test-suite-rationalization/artifacts/r1/u02-self-contained.md` | External-dependency red/green, provenance integrity, and privacy repair evidence. |
| `docs/coordinator/test-suite-rationalization/artifacts/r1/u03-projects.md` | Exact project membership and duplicate-collection proof. |
| `docs/coordinator/test-suite-rationalization/artifacts/r1/u04-static-gates.md` | TypeScript/ESLint/package scope audit and red controls. |
| `docs/coordinator/test-suite-rationalization/artifacts/r1/u05-changes.md` | Retain/delete/merge adjudication and duplicate equivalence. |
| `docs/coordinator/test-suite-rationalization/artifacts/r1/u06-nonempty-project.md` | Empty-collection subprocess proof. |
| `docs/coordinator/test-suite-rationalization/artifacts/r1/u06-provenance-anchors.md` | Recomputed-digest and sanitized-payload anchor proof. |
| `docs/coordinator/test-suite-rationalization/artifacts/r1/u06-review.md` | Independent review axes, repairs, gates, and exact R7 residue. |
| `docs/coordinator/test-suite-rationalization/reports/r1-architecture-static.md` | This supervisor return. |
| `docs/rebuild/guard-inventory.json` | Make affected manifest invariants name their exact current contracts. |
| `docs/rebuild/reference/guards-and-tests.md` | Update only the focused guard-of-guard owner notes permitted by the brief. |
| `eslint.config.js` | Give the three root TypeScript configs the strict typed lint tier. |
| `package.json` | Expand lint targets and expose the exact explicit architecture command. |
| `vitest.config.ts` | Declare disjoint named projects, empty-collection refusal, explicit membership constants, and the warning-free worker runtime. |
| `tests/unit/architecture-project-empty-collection.test.ts` | Independently prove configuration membership and real empty-project failure. |
| `tests/unit/architecture/gate-coverage.test.ts` | Pin exact executable static commands and root-config lint/type closure; remove the duplicated architecture assertion. |
| `tests/unit/architecture/guard-manifest.test.ts` | Own recursive project membership, exact script identity, empty exclusions, active replacement integrity, and negative controls. |
| `tests/unit/architecture/helpers/frozen-legacy-architecture-provenance.ts` | Strictly parse, authenticate, anchor, freeze, and expose redacted frozen facts. |
| `tests/unit/architecture/helpers/guard-files.ts` | Remove eager external-checkout resolution and retain rebuild-only file helpers. |
| `tests/unit/architecture/helpers/legacy-selector-port-map-audit.ts` | Build selector provenance from authenticated snapshots and original source-blob identities. |
| `tests/unit/architecture/intake-canonical-field-registry.test.ts` | Resolve recorded legacy scan sources from frozen evidence. |
| `tests/unit/architecture/legacy-capability-disposition.test.ts` | Consume authenticated path snapshots instead of a sibling checkout. |
| `tests/unit/architecture/legacy-selector-port-provenance.test.ts` | Own snapshot integrity, external anchors, redaction, recomputed-digest refusal, and selector provenance. |
| `tests/unit/architecture/legacy-test-disposition.test.ts` | Consume exact baseline/current frozen path snapshots. |
| `tests/unit/architecture/operational-isolation.test.ts` | Derive legacy scripts from authenticated frozen `package.json` text. |
| `tests/unit/architecture/roadmap-doc-binding.test.ts` | Pin the exact `roadmap:check` registration. |
| `tests/unit/architecture/runtime-dependency-coverage.test.ts` | Consume frozen browser-system/provider evidence. |
| `tests/unit/architecture/runtime-environment-coverage.test.ts` | Remove the obsolete architecture-time external checkout dependency. |

## Review results

| Axis | Result |
|---|---|
| Repository standards | 0 final findings. Paired instructions are identical; no board edit or remote push occurred. |
| Originating brief/spec | R1 scope complete. Broad historical authority reconciliation is explicitly returned to R7. |
| Correctness | 0 final findings after project-membership and provenance-anchor repairs. |
| Silent failures | 0 final findings; no missing checkout, malformed snapshot, empty collection, or failed check becomes green. |
| Performance | No attributable regression; final architecture gate is 22.97 s versus 76.89 s intake. |
| Tests | Red-capable controls exist for every changed behavior; the weak redundant regex was replaced. |
| Documentation | Focused owners current; exact R7 edits listed below. |
| Security | One identifier-exposure finding repaired; final evidence scan reports zero matching SSN/EID-shaped literals. |

## Verification

| Command | Result |
|---|---|
| `env -u HRAUTO_LEGACY_REPO npm run test:architecture` | PASS — 70 files / 703 tests, 22.97 s, explicit labels, no warnings |
| `npx vitest run --project unit tests/unit/architecture-project-empty-collection.test.ts --reporter=verbose --passWithNoTests=false` | PASS — 1 file / 3 tests |
| `npm run typecheck` | PASS — 18.40 s final verification |
| `npm run lint` | PASS — zero warnings, 30.01 s isolated completion |
| `npm run build:manifest:check` | PASS — manifest current |
| `npm run roadmap:check` | PASS — roadmap current |
| `git diff --check` and `cmp -s AGENTS.md CLAUDE.md` | PASS |
| frozen-evidence identifier scan | PASS — zero SSN-shaped / zero UCSD EID-shaped literals |

The pre-security full coverage measurement was green at 391 files / 4,854 tests, 85.34%
statements, 76.40% branches, 89.31% functions, and 87.28% lines. It took 120.03 s with tree output
(121.67 s verbose), exceeded the coordinator's 90-second budget, and emitted existing dashboard
React `act(...)` warnings. No dashboard listened on ports 3938/5174 during that run. R1 does not
misreport those three facts as green acceptance criteria.

## Exact R7 residue

R7 should update ref `guards-and-tests` and the cross-family public scripts in one reconciliation:

1. Replace stale counts/topology with 81 manifest rows (70 active / 9 retired / 2 planned), 70
   architecture files, and fresh final integrated scenario/coverage snapshots.
2. Record the disjoint `unit`, `architecture`, and `scenario` project membership and exact
   architecture command; retire two-project/path-filter prose.
3. Ratify self-contained identifier-redacted frozen provenance, including source-blob provenance,
   per-snapshot addresses, and the code-owned full-payload anchor.
4. Ratify same-risk/same-seam/same-oracle deletion proof and durable retained-owner/red-mutation
   mapping.
5. Ratify legible streaming output: project/file/full test labels, stable phase labels for long
   tests, and captured/asserted expected diagnostics rather than suppression.
6. Apply the affected ≤30 s, full coverage ≤90 s, and parity ≤75 s budgets without weakening
   coverage or test guarantees; the coverage budget is presently red at about 120 s.
7. Make broad `test` and `test:coverage` reporting consistent and eliminate the existing dashboard
   React `act(...)` warnings at their owning tests.
8. Run the integrated coverage lane while the dashboard owns 3938/5174 and preserve hermeticity.

## Integration handoff

- Branch: `feature/test-r1-architecture-static`
- Base: `7982650c`
- Implementation head before report commit: `008f871c`
- Coordinator board: untouched by R1
- Remote: not pushed
- Worker worktrees/branches: all R1-specific worker worktrees verified, merged, removed, and pruned
- Other repository worktrees/branches: left untouched
