# `src/control` — the registries a run is judged against before it starts

Two frozen, config-backed registries. Neither drives a browser; both are read before anything
composes a runtime, so a bad answer here is a refusal, not a live mistake.

- `workflow-registry.ts` — the built workflows.
- `test-target-registry.ts` — the **test subject registry** (`ref guards-and-tests` §10.5). It parses
  and recursively freezes `config/test-subjects.json` at module load and exports
  `TEST_TARGET_REGISTRY`, `readTestTargetRegistry` (the repo-root form the CLI uses) and one
  resolver per workflow arm: `resolveSeparationsKualiFinalizationTestTarget` and
  `resolveSeparationsTestTarget`.

## The test subject registry, in one screen

- **Labels in the repo, values outside it.** An entry names a label, its owning workflow, its kind,
  its `purpose`, a dated `availability` claim, the migration section that observed it, and D85's
  usage rules. A Kuali document number is not a person and lives here; an **EID never does** — it is
  a `secretInput` reference resolved only through `src/domain/secrets.ts` from an ignored `.env`.
- **The entry schema is a discriminated union on `workflow`.** The `separations-kuali-finalization`
  arm carries the finalization ingress minus its two EID leaves; the `separations` arm carries the
  chain subject's document (`present` with a number, or `absent` with a reason). Adding a workflow
  means adding an arm, not loosening a field.
- **A gone subject keeps its row.** `availability.state` is `available` · `consumed` · `gone` ·
  `unknown` with the date it was last observed. Deleting an evaporated subject deletes the history
  that it evaporated — doc 03b records that happening twice (docs 4510 and 4524).
- **Blocked, never failed** — an unresolvable label reports `blocked: needs <label>`, because a
  canary leaving the university is not a defect in the workflow.
- **One resolver per arm, because the ingress shapes differ.** The finalization resolver assembles a
  canonical input field by field and merges two EID references. The chain's ingress is ONE typed
  Kuali document number (D261), so `resolveSeparationsTestTarget` feeds that number through
  `separationsDescriptor.surfaces.inputRun.parser` — the operator's real start box — and parses the
  result through the descriptor's own ingress and canonical schemas. `timekeeperName` therefore comes
  from the descriptor's `constants[]` and `searchTimeoutMs` from the ingress default; a rehearsal
  cannot start from an input a real run would never produce. No EID crosses this arm at all.
- The guard is `tests/unit/architecture/test-target-registry.test.ts` — which also WALKS every
  `tests/scenario/workflows/*/dry-run.scenario.ts`, evaluates each declaration without importing it,
  and pins the manifests, `config/test-subjects.json` and `src/cli.ts`'s registration against each
  other in both directions; the unit half is `tests/unit/test-target-registry.test.ts`.

## Lessons

- **2026-08-27 — a label that exists but belongs to another workflow is not a decayed canary.**
  `resolveSeparationsKualiFinalizationTestTarget` finds a target by label alone. When the registry
  grew subjects for the composed `separations` chain, asking the finalization resolver for one of
  them fell through to "missing secret EID reference" — a registry-defect message about the wrong
  thing, and reporting it `blocked` would have read as *the subject left the university*. It now
  refuses BY NAME with both workflows in the message. The rule generalises: when a lookup key stops
  being unique across a dimension, the resolver must check that dimension before it interprets what
  it found (D85 · `ref guards-and-tests` §10.5).
