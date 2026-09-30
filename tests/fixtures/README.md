# Shared test fixtures (D341)

One discoverable interface for synthetic inputs that more than one test tier uses. Inputs are
synthetic. Importable fixtures and helpers defer runtime effects: no module under `tests/fixtures/`
or `tests/helpers/` reads
`config/test-data.local.json`, the credential store, `.env`, the authority database or a browser.
The architecture guard `tests/unit/architecture/test-data-ownership.test.ts` enforces this map.

## Ownership map

| Location | What lives there | Who imports it |
| --- | --- | --- |
| `config/test-data.json` | Tracked shared test data: public subject registry, named file declarations, synthetic sample ranges. Loaded through `src/control/test-data.ts`. | Runtime (`dry-run-scenario`, `test-data check`), unit and scenario tests |
| `config/test-data.local.json` (ignored) | Private per-checkout inputs by name; the template is `config/test-data.local.example.json`. | Runtime only, through the opaque input source; never fixtures |
| `tests/fixtures/documents/synthetic-sample.pdf` | Minimal synthetic PDF declared as `synthetic-sample-pdf`; proves path resolution and readable bytes. | `tests/unit/test-data-config.test.ts`, `test-data check --file` |
| `tests/fixtures/*.ts` | Data fixtures shared across tiers: contract inputs (`phase1c-contract-fixtures`), run records (`phase1f-run-fixtures`, `receipt-run-fixtures`, `run-lifecycle-fixtures`), operator commands (`operator-command-fixtures`), archive rows (`archive-fixtures`), image inputs (`diagnostic-image-fixtures`, `image-geometry`), intake (`intake-workflow-fixture`), the D331 settings-file authority (`d331-settings-file`), launch/write/source-bound inputs (`run-launch-fixtures`, `write-sequencer-fixtures`, `source-bound-fixtures`, `source-bound-read-fixtures`), Explorer wire/authority inputs (`explorer-authority`, `explorer-timeline-wire`), `run-operations` and the `*-seams` modules. | `tests/unit`, `tests/scenario`, `tests/integration`, `tests/parity` |
| `tests/helpers/*.ts` | Behavioural harnesses shared across tiers: executor harness (`phase1f-executor-harness`), composition builders (`separations-composition-fixtures`, `ucpath-termination-fixtures`, `kuali-finalization-fixtures`, `duo-ceremony-fixtures`), the synthetic protected-store source (`protected-secret-source`), `registered-workflows`, `t1b-manifests`, and `canonical-run-reader` (injected SQLite reader and explicit in-memory unit fake). | `tests/unit`, `tests/scenario`, `tests/integration` |
| `tests/process-fixtures/*.ts` | Executable child entrypoints (`runtime-lock-contender`, `worker-stub-cli`, `worker-browser-control-cli`). They acquire isolated test admissions and may open synthetic databases or Chromium when explicitly spawned; no module imports this tier. | Child-process launchers in storage-restore-drill, worker-pool-parallel-proof, worker-browser-control-process and parity session-runtime |
| `tests/unit/fixtures/`, `tests/unit/helpers/` | Unit-only fixtures and helpers (case-specific assertions, violation fixtures, fake pages, the synthetic private input source `test-data-source`). | `tests/unit` only; no other tier may import them |
| `tests/unit/architecture/helpers/` | Guard helpers. Three cross-tier importers of `descriptor-fixtures` predate D341 and stay until the descriptor fixtures move with their owner: `tests/fixtures/intake-workflow-fixture.ts`, `tests/scenario/fixture-graph.scenario.test.ts`, `tests/scenario/operator-lifecycle.walk.test.ts`. The `test-data-ownership` guard pins that exact set. | Architecture guards, plus the three recorded importers |

## Rules

- Keep case-specific assertions, behavioural helpers and violation fixtures at their owning test.
- Preserve synthetic ranges, clocks and dataset sizes when moving a fixture; a move is not a rewrite.
- A new cross-tier fixture lands here with a row in this table; a unit-only one stays under `tests/unit/`.
- Synthetic values never resemble real identifiers. Sample ranges come from `config/test-data.json`.

`../helpers/admission-fixture.ts` owns disposable installation admissions for runtime composition tests. It uses the current entrypoint initializer and read-only verifier, renews admission after a composed runtime releases it, and binds database and credential fixtures to the exact installation roots. Release fixture admission before removing its root. Direct storage fixtures retain explicit temp-root synthetic admissions.

`../helpers/synthetic-database-admission.ts` contains the temp-path AuthorityDatabase and ArchiveDatabase proxies without importing server command compositions. Dashboard harnesses use this narrow helper; `synthetic-storage-admission.ts` reexports the same proxies alongside its broader command adapters.

Recorded credential factory imports in `admission-fixture` and `synthetic-storage-admission` remain inside deferred function bodies; their producers are function declarations. `preflight/corpus` imports `chromium` only to install launch-refusal spies inside its explicit executor. The ownership guard rejects eager calls, aliases, namespace imports, unlisted symbols and eager callbacks. Creating proxy objects at import does not open their databases.
