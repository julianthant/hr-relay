# R4d Smart HR settlement evidence

Date: 2026-09-02 (America/Los_Angeles)

## Read-only live observation

A dedicated `playwright-cli` session authenticated through Duo Autopilot and repeated the SS Smart
HR search for the same machine-verified R4c subject. The search settled by automatically opening the
single matching transaction's detail page. It did not render the legacy result-row shape or the
explicit no-results marker.

The committed observation is deliberately count-only and contains no person, EID, transaction, or
document value:

```json
{
  "route": "ss-smart-hr",
  "iframeCount": 0,
  "resultRowOldCount": 0,
  "detailRowCount": 1,
  "receiptVisibleCount": 1,
  "approvalStatusVisibleCount": 1,
  "detailStartDateVisibleCount": 1,
  "detailActionVisibleCount": 1,
  "detailNameVisibleCount": 1,
  "searchButtonVisibleCount": 0,
  "errorRegionNonEmptyCount": 0
}
```

This proves the R4c timeout's direct cause: the old settlement waiter recognized only a populated
result grid or explicit no-results state, while PeopleSoft's one-match response auto-drilled to a
keyed transaction detail page.

No workflow was started or retried. No gate was resolved, no external-commit control was clicked,
and no runtime authority row, registry entry, or environment value was changed. The session was
closed; the final `playwright-cli list` showed no owned browsers.

## Restricted captures

The identifying accessibility snapshot and screenshot remain ignored in the primary checkout:

| Restricted artifact | SHA-256 |
|---|---|
| `.tracker-rebuild/restricted/r4d/ss-smart-hr-single-result-detail.yml` | `b157a0b2e5f1fa9ade6cac083fb8f77c840e36d0532a9570b99dc09fa96a7dab` |
| `.tracker-rebuild/restricted/r4d/ss-smart-hr-single-result-detail.png` | `3bad932172278c0b1ac6dd7924dab3b1892c344d029ba1277f17ea893263ccd9` |

## Deterministic repair proof

The original R4c authority remains immutable:

- run `26e7eaa2-1111-4a88-be5e-b71e4432b4f7` / trace `sp-132417-26e7`;
- failure `85895513-780e-445f-87c3-6a5a42f69eb5`, code `UNEXPECTED_PAGE_STATE`;
- write state `not-attempted`, with zero exact-run gate rows, write intents, write attempts, and
  durable-outbox rows.

The regression fixture first reproduced the timeout against a single-result auto-detail response.
The repaired classifier now admits only one mutually exclusive visible state: result grid, explicit
no-results, or auto-drilled detail with one stable transaction identifier. It then uses the existing
keyed detail reread and unchanged D310 six-fact comparison. Stale, hidden, duplicated, incomplete,
or co-present markers fail loud; diagnostics redact EID/person/transaction values.

Focused proof:

```text
npx vitest run tests/unit/ucpath-smart-hr-operation.test.ts \
  tests/scenario/workflows/separations/structural.scenario.test.ts \
  tests/scenario/separations-ucpath-termination.scenario.test.ts --reporter=dot
3 files passed; 67 tests passed
```

Full proof:

| Gate | Result |
|---|---|
| `npm run typecheck` | passed |
| `npm run lint` | passed with zero warnings |
| `HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test:coverage` | passed; 390 files / 4,838 tests; statements 85.34%, branches 76.40%, functions 89.32%, lines 87.28% |
| `npm run build:manifest:check` | passed |
| `npm run roadmap:check` | passed |
| `HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test:parity` | passed in assertion mode; 287/287 references |
| `git diff --check` | passed |

The first coverage invocation refused because the fresh worktree did not have the legacy repository
at its default sibling path. The explicit documented `HRAUTO_LEGACY_REPO` override pointed to the
frozen legacy checkout and the full gate passed. Parity initially reported only twelve Explorer
implementation-fingerprint text changes. After explicit coordinator authorization, update mode
changed exactly those twelve one-line hashes; the final assertion-mode run passed 287/287. One
intermediate update-mode run hit an unrelated disposed-response failure after writing the references;
the final assertion run is the controlling result.

## Runtime preservation

The stopped-system read-only doctor before and after the repair observed the same authority:
schema 29, generation 2405, quick check `ok`, zero foreign-key or invariant violations, and 25/25
span streams reconciled. Pending commands, unresolved write intents, and durable outbox remained
0/0/0. Four leases and three run-terminal-outbox rows were pre-existing and unchanged. At close the
doctor's authority remained healthy, while the command exited nonzero because the latest verified
backup had aged into the tool's `backup-stale` condition with generation gap zero; R4d did not alter
or repair backup/runtime state.
