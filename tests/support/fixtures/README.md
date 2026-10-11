# Shared test fixtures (D341)

One discoverable interface for synthetic inputs shared by unit, integration and architecture
tests. Pure data fixtures stay free of private input, credentials, databases and browsers. Existing
resource harnesses run only when a caller invokes them. `tests/scenario/` and `tests/parity/` were
retired on 2026-10-02; retained fixtures are inputs to current tests, not evidence those suites
remain or that visual acceptance was repeated. Future scenario-test design is operator-led.
The architecture guard `tests/architecture/tooling/test-data-ownership.test.ts` enforces this map.

## Ownership map

| Location | What lives there | Who imports it |
| --- | --- | --- |
| `config/test-data.json` | Tracked shared test data: public subject registry, named file declarations, synthetic sample ranges. Loaded through `src/backend/app/registries/test-data.ts`. | Runtime test-data checks and current tests |
| `config/test-data.local.json` (ignored) | Private per-checkout inputs by name; the template is `config/test-data.local.example.json`. | Runtime only, through the opaque input source; never shared fixtures |
| `tests/support/fixtures/documents/synthetic-sample.pdf` | Minimal synthetic PDF declared as `synthetic-sample-pdf`; proves path resolution and readable bytes. | `tests/unit/test-data-config.test.ts`, `test-data check --file` |
| `tests/support/fixtures/*.ts` | Data fixtures shared across tiers: contract inputs (`phase1c-contract-fixtures`), run records (`phase1f-run-fixtures`, `receipt-run-fixtures`, `run-lifecycle-fixtures`), operator commands (`operator-command-fixtures`), image inputs (`diagnostic-image-fixtures`, `image-geometry`), intake (`intake-workflow-fixture`), the `*-seams` modules. | Unit, integration and architecture tests |
| `tests/support/fixtures/*.ts` moved from unit | Shared deterministic inputs: `advisory-prompt-fixtures`, `authority-build-variant`, `cross-date-search-corpus`, `dcc4-superseded-migration`, `ledger-projection-fixtures`, `plan1-browser-operation`, `plan1-operation-workflows`, `plan1-separation-operation`, `rerun-values-fixtures`, `run-launch-fixtures`, `settings-operation-fixtures`, `source-bound-read-fixtures`, `start-step-omission-fixtures`, `workflow-definition-fixtures`, `write-sequencer-fixtures`. | Unit and integration callers as applicable |
| Existing shared seam fixtures | `descriptor-fixtures`, `explorer-authority`, `explorer-timeline-wire`, `run-operations`. | Unit, architecture and integration callers |
| `tests/support/helpers/*.ts` | Behavioral harnesses shared by current tests: executor harness (`phase1f-executor-harness`), composition builders (`separations-composition-fixtures`, `ucpath-termination-fixtures`, `kuali-finalization-fixtures`, `duo-ceremony-fixtures`), synthetic protected-store source (`protected-secret-source`), `registered-workflows`, `t1b-manifests`, and `canonical-run-reader` (injected SQLite reader and explicit in-memory unit fake). | Unit, integration and architecture tests |
| `tests/support/helpers/*.ts` moved from unit | `timeline-write-fixture`. | Unit and integration callers |
| Exact shared resource harness exceptions | `tests/support/fixtures/preflight/corpus.ts` injects browser/process/storage faults; `tests/support/helpers/synthetic-storage-admission.ts` admits real test databases and credential-store adapters through synthetic roots; `tests/support/helpers/storage/transaction-history-fixture.ts` builds explicit historical SQLite fixtures when invoked; `tests/support/helpers/backend/dashboard-harness.ts` opens a synthetic timeline database only inside its fixture function. | Architecture and integration callers only |
| `tests/integration/**/fixtures/` and `helpers/` | Real SQLite, filesystem, authority and composition harnesses colocated with integration proofs, including the synthetic private input source `test-data-source`. | Integration tests |
| `tests/unit/<owner>/fixtures/` | Unit-only immutable fixtures and local fakes, including the frozen pre-D309 receipt input under Runs evidence. | Their owning unit tests only |
| `tests/support/helpers/dashboard/`, `tests/support/helpers/architecture/`, `tests/support/helpers/trust/` | Shared capture, descriptor and trust-wire fixtures at their consumer homes. | Unit, architecture and integration callers as applicable |
| `tests/architecture/helpers/` | Architecture guard inputs and scanners. | Architecture guards only |

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
`tests/support/processes/` (`runtime-lock-contender`, `worker-stub-cli`, `worker-browser-control-cli`)
and cannot be imported. Their exact consumers remain recorded by the ownership guard.
