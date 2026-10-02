# Shared test fixtures (D341)

One discoverable interface for synthetic inputs that more than one test tier uses. Pure data
fixtures stay free of private input, credentials, databases and browsers. Existing resource
harnesses are named below; they run only when a caller invokes them.
The architecture guard `tests/architecture/test-data-ownership.test.ts` enforces this map.

## Ownership map

| Location | What lives there | Who imports it |
| --- | --- | --- |
| `config/test-data.json` | Tracked shared test data: public subject registry, named file declarations, synthetic sample ranges. Loaded through `src/control/test-data.ts`. | Runtime (`dry-run-scenario`, `test-data check`), unit and scenario tests |
| `config/test-data.local.json` (ignored) | Private per-checkout inputs by name; the template is `config/test-data.local.example.json`. | Runtime only, through the opaque input source; never fixtures |
| `tests/fixtures/documents/synthetic-sample.pdf` | Minimal synthetic PDF declared as `synthetic-sample-pdf`; proves path resolution and readable bytes. | `tests/unit/test-data-config.test.ts`, `test-data check --file` |
| `tests/fixtures/*.ts` | Data fixtures shared across tiers: contract inputs (`phase1c-contract-fixtures`), run records (`phase1f-run-fixtures`, `receipt-run-fixtures`, `run-lifecycle-fixtures`), operator commands (`operator-command-fixtures`), archive rows (`archive-fixtures`), image inputs (`diagnostic-image-fixtures`, `image-geometry`), intake (`intake-workflow-fixture`), the D331 settings-file authority (`d331-settings-file`), the `*-seams` modules. | `tests/unit`, `tests/scenario`, `tests/integration`, `tests/parity` |
| `tests/fixtures/*.ts` moved from unit | Shared deterministic inputs: `advisory-prompt-fixtures`, `authority-build-variant`, `cross-date-search-corpus`, `dcc4-superseded-migration`, `ledger-projection-fixtures`, `plan1-browser-operation`, `plan1-operation-workflows`, `plan1-separation-operation`, `rerun-values-fixtures`, `run-launch-fixtures`, `settings-operation-fixtures`, `source-bound-read-fixtures`, `start-step-omission-fixtures`, `workflow-definition-fixtures`, `write-sequencer-fixtures`. | Unit, integration and parity callers as applicable |
| Existing shared seam fixtures | `descriptor-fixtures`, `explorer-authority`, `explorer-timeline-wire`, `run-operations`. | Unit, architecture and integration callers |
| `tests/helpers/*.ts` | Behavioural harnesses shared across tiers: executor harness (`phase1f-executor-harness`), composition builders (`separations-composition-fixtures`, `ucpath-termination-fixtures`, `kuali-finalization-fixtures`, `duo-ceremony-fixtures`), the synthetic protected-store source (`protected-secret-source`), `registered-workflows`, `t1b-manifests`, and `canonical-run-reader` (injected SQLite reader and explicit in-memory unit fake). | `tests/unit`, `tests/scenario`, `tests/integration` |
| `tests/helpers/*.ts` moved from unit | `timeline-write-fixture`. | Unit and integration callers |
| Exact shared resource harness exceptions | `tests/fixtures/preflight/corpus.ts` injects browser/process/storage faults; `tests/helpers/synthetic-storage-admission.ts` admits real test databases and credential-store adapters through synthetic roots; `tests/helpers/storage/transaction-history-fixture.ts` builds explicit historical SQLite fixtures when invoked. | Architecture and integration callers only |
| `tests/integration/{fixtures,helpers}/` | Real SQLite, filesystem, authority and composition harnesses moved with integration proofs, including the synthetic private input source `test-data-source`. | Integration tests |
| `tests/unit/fixtures/`, `tests/unit/helpers/` | Unit-only fixtures and helpers (case-specific assertions, violation fixtures and fake pages). | `tests/unit` only; no other tier may import them |
| `tests/unit/fixtures/{plan1-browser-operation,plan1-operation-workflows,plan1-separation-operation,run-launch-fixtures,workflow-definition-fixtures,write-sequencer-fixtures}.ts` | Exact re-exports of shared fixtures for unchanged parity source imports. | Parity only |
| `tests/architecture/helpers/`, `tests/unit/architecture/helpers/descriptor-fixtures.ts` | Architecture guards live under `tests/architecture/helpers/`; `descriptor-fixtures` is shared under `tests/fixtures/`. The compatibility export preserves three unchanged imports: `tests/fixtures/intake-workflow-fixture.ts`, `tests/scenario/fixture-graph.scenario.test.ts`, `tests/scenario/operator-lifecycle.walk.test.ts`. The `test-data-ownership` guard pins that exact set. | Architecture guards, plus the three recorded importers |

## Rules

- Keep case-specific assertions, behavioural helpers and violation fixtures at their owning test.
- Preserve synthetic ranges, clocks and dataset sizes when moving a fixture; a move is not a rewrite.
- A new cross-tier fixture lands here with a row in this table; a unit-only one stays under `tests/unit/`.
- Synthetic values never resemble real identifiers. Sample ranges come from `config/test-data.json`.

`../helpers/admission-fixture.ts` owns disposable installation admissions for runtime composition tests. It uses the current entrypoint initializer and read-only verifier, renews admission after a composed runtime releases it, and binds database and credential fixtures to the exact installation roots. Release fixture admission before removing its root. Direct storage fixtures retain explicit temp-root synthetic admissions.

`../helpers/synthetic-database-admission.ts` contains the temp-path AuthorityDatabase and ArchiveDatabase proxies without importing server command compositions. Dashboard harnesses use this narrow helper; `synthetic-storage-admission.ts` reexports the same proxies alongside its broader command adapters.

Recorded credential factory imports in `admission-fixture` and `synthetic-storage-admission` remain inside deferred function bodies; their producers are function declarations. `preflight/corpus` imports `chromium` only to install launch-refusal spies inside its explicit executor. The ownership guard rejects eager calls, aliases, namespace imports, unlisted symbols and eager callbacks. Creating proxy objects at import does not open their databases.

The shared admission helpers `admission-fixture` and `synthetic-database-admission` preserve
explicit synthetic authority. Credential factory capabilities in `admission-fixture` and
`synthetic-storage-admission` run only when the fixture function is called; AST controls refuse
eager calls, aliases, namespaces and unlisted symbols. Executable child entrypoints live in
`tests/process-fixtures/` (`runtime-lock-contender`, `worker-stub-cli`, `worker-browser-control-cli`)
and cannot be imported. Their exact consumers remain recorded by the ownership guard.
