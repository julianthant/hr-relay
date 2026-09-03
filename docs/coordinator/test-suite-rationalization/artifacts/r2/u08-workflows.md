# R2 u08 — workflow authoring, compiler, graph, task, omission, and provenance units

## Owned ledger

At intake this family owned 18 files / 152 tests: `canonical-input` 10, `completion-program` 6,
`delegation` 20, `flow-builder` 22, `node-condition` 13, `scenario-coverage` 12, `step-omission` 8,
`task-contracts` 12, `task-provenance` 10, `workflow-match-key-identity` 1, `workflow-recipe` 7,
`workflow-recipe-conformance` 4, `workflow-recipe-equivalence` 4, `workflow-role-audit` 7,
`workflows/descriptor-registry` 2, `person-lookup-tasks` 6, `separations-dates-provenance` 1, and
`separations-step-omissions` 7. All paths are under `tests/unit/` and end in `.test.ts`.

The final family is 19 files / 157 tests because `workflow-transaction-outcome.test.ts` adds the
missing direct public seam for `projectTransactionOutcome`.

## Risk and disposition

| Seam | Failure condition | Disposition |
| --- | --- | --- |
| canonical input and graph/compiler | schema drift, unresolved reference, duplicate task/group, dependency cycle | Retain pure unit refusals |
| task sealing and provenance | undeclared contract field, missing provenance leaf, wrong store/contract binding | Retain task-context tests |
| omission, conditions, delegation, scenarios | a skipped/conditional/delegated node manufactures authority or coverage | Retain ordinary unit plus distinct architecture/scenario guards |
| compiler conformance | registry tuple stops matching compiler-derived descriptor/projections | Retain; not equivalent to the fixed public characterization |
| public equivalence characterization | person-lookup or separations public descriptor/module/graph surface drifts | Retain until Phase 3c completes D317 conversion |
| durable transaction outcome projection | nested output/proof schema hash or parsed value drifts | Added five direct tests |

`workflow-recipe-conformance.test.ts:76-149` crosses BFF/bootstrap/detail/Explorer projections. It is
valuable but belongs in the later R3/R7 taxonomy move; R2 leaves it untouched so a server-owned test
is not edited opportunistically. D317 calls the current recipe API transitional and assigns the final
`defineWorkflow` rename/deletion to the active Phase 3c work, so R2 labels these suites
`transitional` without changing that product seam.

## Negative-control proof

The intake run passed 18/18 files and 152/152 tests in 6.59 seconds. The new file passed 5/5 in
1.60 seconds. Temporarily reversing the production commit-output hash comparison made all five new
cases fail with the exact `unit` project, file, full title, and source location; restoring the line
returned 5/5 green. The mutation was not committed.
