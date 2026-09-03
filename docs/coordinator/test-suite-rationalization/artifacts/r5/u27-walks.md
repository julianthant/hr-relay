# R5b u27 — ordinary scenarios and integration-walk review

## Authority and result

R5a's inventory at `4d5ecd713d47e9ecebee21712e761f4ef813ee7a` was the starting census. At
implementation candidate `74805a25`, every one of the six ordinary capability scenario files and
the one integration walk remains collected and retains all **35 cases**. No graph claim, manifest
row, or external-world claim was added.

Read-only scout:
`/root/sup_scout_test_suite_rationalization_cf24df892_r05b_u27_walk_map` (`sup_scout`). The scout
received no worktree or branch and made no edits.

## Disposition

| File | Cases | Disposition | Unique seam a cheaper unit does not prove | Red-capable retained proof |
| --- | ---: | --- | --- | --- |
| `fixture-graph.scenario.test.ts` | 7 | Retain | A composed descriptor walk agrees with all 15 graph-derived coverage points, including branch, gate, fan-out join, replay, and transaction arms. | `scenario-coverage.test.ts` rejects missing and invented points in both directions. |
| `intake-extraction.scenario.test.ts` | 6 | Retain | Real CSV/XLSX bytes cross the adapter/task boundary with header discovery, duplicate columns, and typed cells intact. | Empty/corrupt input and out-of-range header selection fail by name. |
| `intake-pdf-pages.scenario.test.ts` | 4 | Retain | The real PDF renderer and content-addressed writer agree on page identity and selected windows. | Corrupt bytes and an out-of-range page window fail with zero accepted output. |
| `normalization-contact.scenario.test.ts` | 7 | Retain | Ordered provider fallback, task disposition, advice provenance, and sensitive-field withholding meet in one boundary. | Provider exhaustion and ambiguous/withheld values remain explicit non-success arms. |
| `ocr-extraction.scenario.test.ts` | 4 | Retain | Provider output completeness is admitted against the task's complete field catalog and shared instruction. | A skipped mandatory field and provider exhaustion refuse rather than returning an empty record. |
| `roster-match.scenario.test.ts` | 5 | Retain | A complete roster crosses artifact parsing, operator mapping, matching, and final identity disposition. | Ambiguity, EID/name conflict, and no-match all retain `matchedEid: null`; none guesses. |
| `operator-lifecycle.walk.test.ts` | 2 | Retain | One authority database joins intake bytes → manifest fan-out → settlement → notification → version blocker → archive → relaunch, and separately joins a derived receipt to the frozen archive. | The walk directly proves the active-run bump refusal, undeclared-receipt refusal, immutable archive bytes, and fresh-run/same-item relaunch invariant. |

The walk's ten source phases are stable and named in execution order: upload; mapping/validation;
fan-out/manifest join; settlement; receipt refusal; notification; version-bump block; archive freeze;
descriptor-independent archive read; relaunch. Assertions and thrown errors name the exact operation
without printing subject identifiers. The verbose gate additionally prints project, file, suite,
and full behavior title. R7/u38 owns the eventual default streaming reporter, so u27 did not add a
second reporter or per-assertion chatter.

## Synthetic/offline boundary

The only u27 code change replaced external-looking fixture identifiers with the reserved offline
range `10800000`–`10800099` and visibly synthetic names/addresses. The integration walk still uses
real local adapters and authority, but it claims neither a workflow graph path nor current live
truth. `tests/unit/architecture/scenario-coverage.test.ts` now rejects any other EID-shaped value in
a collected scenario while emitting only file/line locations.

## Proof

- Focused nine-file scenario gate: **9 files / 44 cases passed**.
- Full scenario gate: **17 files / 132 cases passed** after u28 consolidation.
- Controlled guard red: the synthetic-EID check failed on the pre-change corpus and again under an
  unsafe helper-module mutation with only actionable file/line diagnostics; the corrected
  architecture file passed **17/17**.
- Existing expected diagnostic: corrupt-PDF coverage emits pdfjs's `Indexing all PDF objects`
  warning. It is scoped to the named unreadable-PDF case; R7 owns repository-wide diagnostic policy.
