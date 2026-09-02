# R1 u01 — architecture/static gate inventory

## Bidirectional count and gate baseline

- Tree: 70 recursive `tests/unit/architecture/*.test.ts` files.
- Manifest: 81 rows = 70 active + 2 planned + 9 retired. Active files, names, and paths are
  unique and match the tree exactly in both directions; planned/retired files are absent.
- Registered guard-of-guard arms: nine; every arm scans the real tree and a violating fixture.
- Baseline with the legacy override: 70 files / 689 tests passed in 76.89 s.
- Baseline without the override: 50 files failed during import, 20 passed; four tests failed and
  152 passed. `helpers/guard-files.ts` eagerly resolved a missing sibling checkout.
- `typecheck`, build-manifest check, roadmap check, and diff check passed. Baseline lint was stopped
  after 150 s without output; u04 owns exact static-scope and later green evidence.

Codes: owners `CS` clock-config-secrets, `FI` frontend-backend-integration, `GT` guards-and-tests,
`OT` operator-trust, `WS` write-safety, `ES` execution-and-sessions, `WM` workflow-model, `DS`
dashboard-surfaces, `DI` data-intake-and-edit-data, `TC` task-contract, `RM` roadmap. Negative proof
codes: `VF` violating source fixture, `SM` schema/data mutation, `RF` runtime fault/tamper, `BF`
bidirectional closure. Overlap codes: `D` distinct seam/oracle, `M` mechanically coupled guard,
`R` retired predecessor, `U` unique at inventory. Cost is `lines / it-tests` at intake. `?` means
u05 must adjudicate whether the title under-scopes the actual refusal family.

## Active guards (70/70)

| Guard file | Invariant | Owner | Scan target | Negative proof | Overlap | Cost | Title |
|---|---|---|---|---|---|---:|---|
| `ai-advisory-no-authority.test.ts` | advice cannot reach authority | OT | advisory closure, failures, routes | VF+SM | D dashboard-wire | 348/10 | ? |
| `archive-invariants.test.ts` | archive append-only/self-contained; digest fixed | DS/FI | archive imports + SQLite | VF+RF | U | 326/5 | yes |
| `artifact-effect-boundary.test.ts` | immutable refs; isolated atomic writer | TC/GT | task/workflow AST + writer | VF+RF | U | 102/2 | yes |
| `atomic-write-outbox.test.ts` | fenced authority and outboxes roll back atomically | WS/DS | SQLite write path | RF | U | 248/7 | yes |
| `authentication-proof-not-url.test.ts` | login needs content proof, never URL | ES | login recipes/AST | VF | D single-flight | 165/5 | yes |
| `bounded-task-deadline.test.ts` | abortable deadline and poison-close | ES | executor/interpreter | RF | R sleep-budget | 121/2 | yes |
| `canonical-input-snapshot.test.ts` | transform-free canonical schema and sealed migrations | WM | descriptor schemas | SM | U | 188/6 | yes |
| `clock-single-source.test.ts` | all time reads use clock adapter | CS | all visible `src` | SM | U | 216/3 | yes |
| `command-result-exhaustive.test.ts` | result arms use exhaustive fold | FI | dashboard AST | VF | U | 232/5 | yes |
| `config-snapshot-generations.test.ts` | config leaves pinned per generation | CS | schema/digest | SM | D migration-history | 75/5 | yes |
| `control-command-single-path.test.ts` | one kernel owns journal/audit/dispatch | DS/GT | control/server imports | VF+BF | U | 487/9 | yes |
| `dashboard-memo-prop-stability.test.ts` | expensive panel props remain stable | FI | dashboard AST | VF | U | 172/3 | yes |
| `dashboard-refresh-boundary.test.ts` | surfaces/apps export components only | FI | dashboard AST | VF | D dashboard-wire | 140/2 | yes |
| `dashboard-wire-boundary.test.ts` | bundle has no mirrors/literals/Node reach | FI | HTML import closure | VF | D wire-connectivity | 424/8 | yes |
| `delegation-manifest.test.ts` | delegation IDs/policy/fingerprint closed | WM | descriptors/rows | SM | D descriptor coverage | 199/6 | yes |
| `descriptor-coverage.test.ts` | descriptor/module/registry/manifest equivalence | WM | all descriptors | SM+fixture | D editor | 626/17 | yes |
| `driver-lease-boundary.test.ts` | drivers exist only within manager lease | ES | stores/interpreter AST | VF | D task-driver | 95/5 | yes |
| `duo-ceremony-lease.test.ts` | credential ceremony is tokened/single-flight | ES | login recipes/SSO | VF | U | 206/5 | yes |
| `edit-data-field-policy.test.ts` | corrections require producing paths | DI/WM | descriptor edit policy | SM | U | 137/7 | yes |
| `evidence-receipt.test.ts` | terminal receipts are strict and evidence-bound | OT | schemas/builders | SM | D redaction | 664/22 | ? |
| `explorer-prose-declared.test.ts` | workflow/node prose is declared | OT | registry/projection | SM | U | 165/6 | yes |
| `fresh-session-boundary.test.ts` | fresh sessions are authored/identity-forced | ES/CS | session/executor | VF+RF | D driver lease | 191/5 | yes |
| `gate-coverage.test.ts` | static/coverage scripts target authored roots | GT | package/tsconfig/eslint | SM | M guard-manifest | 99/5 | yes |
| `guard-manifest.test.ts` | files/project/exclusions/ratchets stay wired | GT | manifest/tree/config | VF+SM | M gate-coverage | 287/6 | yes |
| `identity-gate-before-commit.test.ts` | sinks require identity gate | WS | graph/sequencer | VF+RF | D subject-before-fence | 233/8 | yes |
| `intake-canonical-field-registry.test.ts` | fields and scan provenance close both ways | DI | registry + provenance | SM+BF | D intake mapping | 216/13 | yes |
| `intake-mapping-boundary.test.ts` | suggestions cannot bind/confirm/reach Node | DI | mapping AST | VF | U | 197/9 | yes |
| `knowledge-fix-integrity.test.ts` | knowledge status/scope/evidence/supersession valid | OT | records/store | SM | U | 274/14 | yes |
| `ledger-projector.test.ts` | one serialized actor-attributed ledger writer | WS | imports/projector | VF+RF | U | 293/7 | yes |
| `legacy-capability-disposition.test.ts` | every D58 surface classified with rebuild proof | GT | capability inventory | SM | U/external | 512/15 | yes |
| `legacy-selector-port-provenance.test.ts` | 406 keys pin exact legacy blobs/lines | GT | frozen git provenance | SM+BF | D UCPath strict | 176/7 | yes |
| `legacy-test-disposition.test.ts` | legacy test dirs classified exactly once | GT | frozen git inventory | SM | U/external | 80/3 | yes |
| `manual-clock-test-only.test.ts` | `manualClock` remains test-only | CS | all visible `src` | SM | U | 48/3 | yes |
| `migration-history-immutability.test.ts` | released migrations are SHA-pinned | DS/GT | migration list | SM | D config generations | 142/4 | yes |
| `multi-worker-overlap.test.ts` | workers overlap without duplicate claims | ES | real workers/SQLite | RF | U | 467/4 | ? |
| `no-positional-identity.test.ts` | durable IDs reject indexes/ordinals | DS | ID schemas | SM | U | 178/7 | yes |
| `no-secret-values-in-logs.test.ts` | credentials cannot reach logs | CS | source AST/dataflow | VF+SM | D redaction | 1590/21 | yes |
| `notification-durability.test.ts` | persist-before-deliver and repeated folds | DS/OT | store/delivery | RF | U | 319/12 | yes |
| `ocr-producer-parity.test.ts` | OCR producers share policy | DI | OCR source AST | VF | U | 216/7 | yes |
| `one-projection-counts.test.ts` | dashboard counts descend from one projection | DS | projector/dashboard | VF+RF | D ledger | 286/3 | yes |
| `operational-isolation.test.ts` | roots/ports/locks/sessions differ | GT | package/config | VF+SM | R runtime isolation | 196/5 | yes |
| `parity-reference-authority.test.ts` | refs compare, never refresh silently; zero pixels | FI | parity config/scripts | VF+refs | U | 639/15 | yes |
| `permanent-key-dedupe.test.ts` | natural-key/digest dedupe across connections | WS | SQLite | RF | U | 169/4 | yes |
| `phone-capture-retired.test.ts` | retired mobile capture cannot return | DI/GT | tree/routes/config | VF | R capture | 110/2 | yes |
| `provider-capability-boundary.test.ts` | capability maps to admitted provider budget | TC/GT | source + registry | VF | D runtime dependency | 325/5 | yes |
| `recovery-negative-proof-settlement.test.ts` | retry needs exact timed evidence | WS | settlement evaluator | SM | U | 151/5 | yes |
| `redaction-surface-scan.test.ts` | classified values cannot reach output surfaces | GT | all output surfaces | VF+SM | D secret logs | 813/22 | yes |
| `roadmap-doc-binding.test.ts` | roadmap tree and docs bind both ways | RM | roadmap/docs | VF | U | 568/14 | yes |
| `runtime-dependency-coverage.test.ts` | systems/providers/preflight/env close over frozen legacy | GT | registry + frozen inventory | SM+BF | D provider boundary | 191/5 | yes |
| `runtime-environment-coverage.test.ts` | env reads are registered/owned/classified | CS | env-read AST | SM | D secrets source | 309/8 | yes |
| `scenario-coverage.test.ts` | scenario claim/execution/layout equivalence | WM | scenario tree/AST | VF+BF | D test target | 467/14 | yes |
| `secrets-single-source.test.ts` | only secrets module reads credentials | CS | env-read AST | VF+SM | D runtime env | 579/19 | yes |
| `semantic-ui-registry.test.ts` | UI IDs/dependencies/evidence/catalogs closed | OT/GT | registries/catalogs | SM+BF | D selector provenance | 405/9 | yes |
| `single-flight-login.test.ts` | one login call per worker/system session | ES | session import graph | VF | D authentication | 58/2 | yes |
| `step-omission-invariants.test.ts` | only tasks omit; gates/transactions always run | WM | omissions/planner | SM+fixture | U | 488/6 | yes |
| `storage-recovery.test.ts` | backup/verify/degraded boot/restore | DS | SQLite/files/backups | RF+tamper | R authority target | 3959/87 | ? |
| `strict-boundary-schemas.test.ts` | catalogued boundaries recursively strict | GT | schema registry/AST | SM | U | 1781/5 | yes |
| `subject-before-fence.test.ts` | fresh subject observation precedes mutation fence | WS | descriptors/sequencer | RF+SM | D identity gate | 344/6 | ? |
| `task-contract-sealing.test.ts` | effect contracts are deeply sealed | TC/GT | factories/source | SM | D descriptor coverage | 173/3 | yes |
| `task-driver-boundary.test.ts` | tasks cannot reach raw browser access | OT/GT | transitive imports | VF | R commit routes | 78/4 | yes |
| `task-store-boundaries.test.ts` | nine systems bind correct store/session boundaries | TC/ES/GT | registry/type fixture | SM | D provider boundary | 90/3 | yes |
| `test-runtime-root-isolation.test.ts` | tests cannot touch runtime roots | GT/CS | test AST/fs calls | VF+SM | U | 304/4 | yes |
| `test-target-registry.test.ts` | dry-run declarations/registry/CLI close both ways | GT | dry-run tree/registry | SM+BF | D scenario coverage | 502/15 | yes |
| `transaction-pairing.test.ts` | prepare/commit share system/lease/key/probe | WS | graph + write fixture | SM+RF | D subject-before-fence | 158/5 | yes |
| `ucpath-person-org-strict.test.ts` | UCPath port fails loud with exact provenance | TC/GT/OT | operation + UI registry | VF+mutation | D selector provenance | 160/6 | yes |
| `wire-connectivity.test.ts` | every advertised wire arm is served/reachable | FI | registry/routes/queries | VF+BF | D dashboard wire | 988/31 | yes |
| `worker-teardown-soak.test.ts` | teardown preserves claims/requeue/session poison | ES | workers/SQLite/session | RF | U | 493/4 | ? |
| `workflow-editor-compile-integrity.test.ts` | Explorer derives from composition root | OT | registries/projection | VF+SM | D descriptor coverage | 503/25 | ? |
| `workflow-layout.test.ts` | workflow path agrees with role/timeline/category | WM | tree + 13 fixtures | VF+BF | U | 628/5 | yes |
| `write-safety-contract.test.ts` | commit contracts require proof/extractor/recovery | WS | descriptor write contracts | SM+RF | R dry-run guard | 241/6 | yes |

Every row above maps one-to-one to the active manifest name obtained from its filename stem; the
manifest carries the complete normative invariant and exact owner citation.

## Planned and retired rows (11)

| Name | Status | Activation/replacement | Owner |
|---|---|---|---|
| `one-time-import-offline` | planned | activates at cutover | doc 05 |
| `preflight-coverage` | planned | no trigger yet | OT |
| `legacy-change-accounting` | retired | D150: live verification + provenance | GT |
| `authority-target-no-fallback` | retired | D188 → storage recovery | DS |
| `capture-durability-and-scope` | retired | D294 → phone-capture-retired | DI |
| `commit-routes-through-mutation` | retired | D188 → task-driver-boundary | WS |
| `dry-run-composition-submit-free` | retired | D188 → write-safety-contract | WS |
| `legacy-preservation` | retired | D93: no live cross-repo dependency | GT |
| `rebuild-gates` | retired | D93 → gate-coverage | GT |
| `runtime-isolation` | retired | D93 → operational-isolation | GT |
| `sleep-budget` | retired | D188 → bounded-task-deadline | ES |

## Static wiring and external dependencies

- At intake, TypeScript covered `src`, `tests`, `scripts`, and three root TS configs with no
  exclusion. ESLint covered only `src tests scripts`; u04 owns the root-config omission.
- u03 introduced the named `architecture` project and removed its duplicate collection by `unit`.
  Static `--filesOnly` lists after that change are 302 unit, 70 architecture, 18 scenario.
- External access was centralized but eager in `guard-files.ts`; direct consumers were capability
  disposition, selector provenance/helper (`git -C`), legacy-test disposition, runtime dependency,
  operational isolation, and scoped-path consumers. u02 owns the frozen-provenance replacement.
- `guards-and-tests` still contains historical 65-file/75-row and two-project/path-filter prose;
  final canonical taxonomy/count reconciliation is R7 residue.
