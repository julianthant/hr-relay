# Shared test fixtures (D341)

One discoverable interface for synthetic inputs that more than one test tier uses. Everything here is
synthetic and frozen at import: no module under `tests/fixtures/` or `tests/helpers/` reads
`config/test-data.local.json`, the credential store, `.env`, the authority database or a browser.
The architecture guard `tests/unit/architecture/test-data-ownership.test.ts` enforces this map.

## Ownership map

| Location | What lives there | Who imports it |
| --- | --- | --- |
| `config/test-data.json` | Tracked shared test data: public subject registry, named file declarations, synthetic sample ranges. Loaded through `src/control/test-data.ts`. | Runtime (`dry-run-scenario`, `test-data check`), unit and scenario tests |
| `config/test-data.local.json` (ignored) | Private per-checkout inputs by name; the template is `config/test-data.local.example.json`. | Runtime only, through the opaque input source; never fixtures |
| `tests/fixtures/documents/synthetic-sample.pdf` | Minimal synthetic PDF declared as `synthetic-sample-pdf`; proves path resolution and readable bytes. | `tests/unit/test-data-config.test.ts`, `test-data check --file` |
| `tests/fixtures/*.ts` | Data fixtures shared across tiers: contract inputs (`phase1c-contract-fixtures`), run records (`phase1f-run-fixtures`, `receipt-run-fixtures`, `run-lifecycle-fixtures`), operator commands (`operator-command-fixtures`), archive rows (`archive-fixtures`), image inputs (`diagnostic-image-fixtures`, `image-geometry`), intake (`intake-workflow-fixture`), the D331 settings-file authority (`d331-settings-file`), process fixtures (`runtime-lock-contender`, `worker-stub-cli`) and the `*-seams` modules. | `tests/unit`, `tests/scenario`, `tests/integration`, `tests/parity` |
| `tests/helpers/*.ts` | Behavioural harnesses shared across tiers: executor harness (`phase1f-executor-harness`), composition builders (`separations-composition-fixtures`, `ucpath-termination-fixtures`, `kuali-finalization-fixtures`, `duo-ceremony-fixtures`), the synthetic protected-store source (`protected-secret-source`), `registered-workflows`, `t1b-manifests`, and `canonical-run-reader` (injected SQLite reader and explicit in-memory unit fake). | `tests/unit`, `tests/scenario`, `tests/integration` |
| `tests/unit/fixtures/`, `tests/unit/helpers/` | Unit-only fixtures and helpers (case-specific assertions, violation fixtures, fake pages, the synthetic private input source `test-data-source`). | `tests/unit` only; no other tier may import them |
| `tests/unit/architecture/helpers/` | Guard helpers. Three cross-tier importers of `descriptor-fixtures` predate D341 and stay until the descriptor fixtures move with their owner: `tests/fixtures/intake-workflow-fixture.ts`, `tests/scenario/fixture-graph.scenario.test.ts`, `tests/scenario/operator-lifecycle.walk.test.ts`. The `test-data-ownership` guard pins that exact set. | Architecture guards, plus the three recorded importers |

## Rules

- Keep case-specific assertions, behavioural helpers and violation fixtures at their owning test.
- Preserve synthetic ranges, clocks and dataset sizes when moving a fixture; a move is not a rewrite.
- A new cross-tier fixture lands here with a row in this table; a unit-only one stays under `tests/unit/`.
- Synthetic values never resemble real identifiers. Sample ranges come from `config/test-data.json`.
