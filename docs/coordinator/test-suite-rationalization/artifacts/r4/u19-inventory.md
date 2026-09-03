# R4 u19 — dashboard unit inventory

## Scope and baseline

The intake baseline was the coordinator-reserved commit `a638e8c3543199f9baa93e18113ec4eeb716bdb5`.
The exact command was:

```text
/usr/bin/time -p npx vitest run --project unit tests/unit/dashboard --reporter=json --outputFile=/tmp/r4-dashboard-baseline.json --passWithNoTests=false
```

It passed 104 result files and 1,056 cases in 42.62 seconds wall time. Of those, 103 files and
1,044 cases live below `tests/unit/dashboard/`; the extra result is the dashboard-owned root file
`tests/unit/dashboard-wire.test.ts` with 12 cases. The baseline JSON had SHA-256
`ebd82ef11227a41d4849e29d8b2f55ef69f77adf33dc11c31522f2147ad21a9b`.

The directory split was 82 Node files / 786 cases and 21 jsdom files / 258 cases. Summed Vitest
per-file durations were 8.384 seconds for Node and 23.402 seconds for jsdom; the three slowest
files were `run-captures-app.test.ts` (7.787 seconds / 41 cases), `run-start-dialog.test.ts`
(5.017 seconds / 26 cases), and `explorer-edit-dialog.test.ts` (3.512 seconds / 8 cases).

## Assertion classification

Every collected assertion inherits one of the following owners from its file. Mixed files are
listed in every applicable row; their titles make the specific arm explicit in verbose output.

| Classification | File families | Required oracle |
| --- | --- | --- |
| Pure decision | `*-model`, ordering, timing, grouping, view-selection, edit-policy, rename-draft, proof-contract, queue facts/bands/gates | Literal/domain output or named refusal in Node |
| DOM wiring | all 21 jsdom files: presses, focus, blur, Escape, lifecycle cleanup, request races, disclosures, dialogs | Real React root plus native DOM event/focus state |
| Visual/layout | design-token references, region breakpoints, shell structure, member/scope touch-target source-token tests | Real browser geometry/pixels; only the two touch-target source-token families were duplicate |
| Accessibility semantics | primitive names, roles, labels, `aria-controls`/`aria-expanded`, semantic regions in render/component files | Static markup for generic semantics; jsdom for stateful semantics; browser accessibility tree where rendered layout is material |
| Server/projection transition | `*-client`, transport, result feed, seeded BFF, day splice, run follow, identity ceremony, settings/storage and capture reads | Strict wire parser plus request/projection transition; T2 for real authority effects |
| Fixture duplication | parity, archive evidence, diagnostic HTTP, run-capture and seeded fixture contract files | Strict fixture construction/closed boundary, not product behavior |

No two runtime cases had the same full test title. The read-only inventory found no assertion-free
or unambiguously cannot-fail test. The only exact browser-geometry overlaps were:

1. seven cases in `queue-touch-target.test.ts`, whose member/name/info geometry is more strongly
   owned by `tests/parity/member-touch-target.spec.ts`;
2. the one case in `top-bar-search-a11y.test.ts`, which tested no accessibility semantics and is
   more strongly owned by `tests/parity/top-bar-search-touch-target.spec.ts`.

Seventeen root unit files also touch dashboard contracts or storage/command composition. They stay
outside this run because their owning seam is not a dashboard component/model test: `archive-model`,
`archive-wire-model`, `command-kernel`, `dashboard-wire`, `dry-run-scenario-composition`,
`idempotency-key-privacy`, `notification-backfill-gap`, `notification-gate-park`,
`notification-inbox`, `operator-xlsx-export`, `receipt-derivation-binding`,
`run-queued-span-step-omission`, `separations-composition-wire`, `sqlite-authority-database`,
`storage-diagnostic-redaction`, `storage-span-authority-reconciliation`, and
`workflow-recipe-conformance`.

## Authority drift for R7

`guards-and-tests.md` still says 25 dashboard files / nine jsdom files and describes five Vitest
projects. Intake truth is 103 directory files / 21 jsdom files, while `vitest.config.ts` declares
three projects. R4 does not edit this cross-run authority; R7 owns reconciliation.
