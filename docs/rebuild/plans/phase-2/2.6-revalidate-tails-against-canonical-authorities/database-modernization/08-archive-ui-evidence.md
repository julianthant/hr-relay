# H saved archive UI — scoped release evidence

Assignment: **2.6.8.2 H**, H01–H06. This is a scoped development release, not Phase 2.6 acceptance.
The approved brief is [decisions.md](decisions.md#approved-h-execution-brief--2026-09-10), committed at
`a28f4f5c42be17d7507745c039fadf49fd023465`. No implementation workers or reviewers were dispatched.
Full typecheck, coverage, broad parity/build, recovery/performance proof and fresh independent review
remain exclusively **2.6.9**. No push or live database action occurred.

## Identities and scope

| Identity | Verified value |
| --- | --- |
| V common U/H base | `ea83e77d378d2b8c000c425205f44887c65a9a94` |
| V base tree | `79bc84b857740a9ad2bcc06e5b8e7eec5495e40b` |
| Required V integration ancestor | `4c9500bacc99fcccf96254b100a5f009acb666f0` |
| H candidate | `716016aa0cebebface1fe437afa0d2659bbb37bf` |
| H tested candidate tree | `9de9317f5d686121f854dc096d0943ee6a1d7378` |
| Clean master immediately before H merge | `c3595b0bd4a62efd05100af31aed99dff66e29fe` |
| H local integration | `f8ae343298647363808c2695e463d059a713d813` |
| Tested integration tree | `6e92b17290e64e8bbccd616c2bff582f0b082df1` |
| Owned implementation lane | `codex/archive-viewer`, `/Users/julianhein/Projects/hr-worktree-database-other` |

V's `/Users/julianhein/Projects/hr-automation-rebuild-evidence/hr-v-surfaces-evidence-20260910/release.json` matched the exact base,
tree and integration ancestry before edits. H was created from that base with branch/path absent and
capacity available. H changed only its two saved-report surface/model files, three new unit files,
two named dashboard regressions, and its dedicated parity spec/fixture/eight reference triplets:
33 candidate paths. Existing `archive.tsx` and `archive-model.ts` needed no changes. Shared
server/client/routes, version-planning implementation, generated inputs, U files and plan owners were
not changed by H. Integration preserved U's already incorporated work without conflicts.

## Acceptance evidence

| Step | Result and proof |
| --- | --- |
| H01 — admit frozen consumer | PASS: committed brief, V receipt/base/tree/ancestry, clean initial target, capacity, exclusive branch/path and exact ownership verified. |
| H02 — retained document | PASS: generic values (including zero, booleans and null), tables, escaped text/logs, unavailable sections and captured version/resolution facts render without descriptors, live records or live client reads. No relaunch/retry/restart/resolution control. |
| H03 — indexed browsing | PASS: typed workflow/title/version/outcome/completed/captured filters; date bounds explicitly UTC. Filter changes discard server cursor and selection, preserving other filters. Served ordering/pages/empty responses are not reconstructed locally. Loading and transport failure remain distinct. |
| H04 — safety | PASS: exact retained run/digest/native download response required; missing/error/loading, malformed URLs and foreign identities cannot expose links. A valid control downloads. Deletion confirms exact report/fingerprint, retains request identity across uncertain transport, clears only after applied, and late A settlement refreshes the list without clearing B. |
| H05 — desktop proof | PASS: 1024×720 and 1440×900, light/dark, keyboard selection/filtering, 125% CSS zoom with existing desktop overflow, truthful loading/empty/error/missing/deleted/unavailable states, refused attachment and stale detail response. |
| H06 — integration | PASS: local merge, all assigned scoped integration gates, evidence recording and owned cleanup verified. |

`/ui` used Components locally. Playwright CLI inspected the specimen and Archive, including
confirmation/cancel and missing attachment state; final Archive console had zero errors. The initial
Vite specimen could not serve symlinked dependency fonts (403); the isolated production bundle served
fonts successfully. Visual inspection covered the new reference pairs. Eight screenshot/a11y/metadata
triplets were deliberately created only under `tests/parity/references/archive-report-*`, then asserted
without changes. CSS zoom is recorded as CSS zoom, not a claim of browser chrome zoom automation.

## Commands and results

Commands ran in the H checkout for candidate proof and the primary checkout for integration.
Evidence logs and frozen manifest are in `/Users/julianhein/Projects/hr-automation-rebuild-evidence/hr-h-archive-evidence-20260910/`.
The original candidate manifest SHA256 is
`69bf331d4daa81fa6320dee487446f8bd21d4773f8aab425249a14a44f72d5d9`; `release.json` records final identities.

```sh
VITEST_MAX_WORKERS=1 npm run test -- --project unit --maxWorkers=1 tests/unit/archive-report-ui/render.test.ts tests/unit/archive-report-ui/no-live-schema.test.ts tests/unit/archive-report-ui/download.test.ts tests/unit/dashboard/archive-render.test.ts tests/unit/dashboard/archive-detail-render.test.ts
VITEST_MAX_WORKERS=1 npm run test -- --project architecture --maxWorkers=1 tests/unit/architecture/archive-invariants.test.ts tests/unit/architecture/wire-connectivity.test.ts tests/unit/architecture/dashboard-wire-boundary.test.ts tests/unit/architecture/dashboard-refresh-boundary.test.ts
npm run lint
npm run build:manifest && npm run build:manifest:check
npm run stores:catalog && npm run stores:catalog:check
npm run roadmap && npm run roadmap:check
```

| Gate | Candidate | Integration |
| --- | --- | --- |
| Owned unit batch | 85 PASS, exit 0 | 85 PASS, exit 0 |
| Named architecture batch | 66 PASS, exit 0 | 66 PASS, exit 0 |
| `npm run lint` | PASS, exit 0 | PASS, exit 0 |
| Three generators and freshness checks | PASS, exit 0; no generated drift | PASS, exit 0; no generated drift |
| H browser spec | 6 PASS, exit 0 | 6 PASS, exit 0; no reference drift |

One effective file worker was verified: candidate Vitest parent 71373 had sole fork 71456;
integration architecture parent/process group 73213 had sole fork 73214. Projects extend the root
configuration without a project worker override. Both Playwright executions reported one worker.
No assertions, membership, timeouts or coverage floors were weakened. Candidate generation results
were retained after the last UI-only repair: workflow manifest closure, store declarations and roadmap
inputs were unchanged. Integration reran all generators and checks on the final combined tree.

H's isolated browser bundle and invocation:

```sh
npx vite build --config vite.dashboard.config.ts --outDir /tmp/archive-h-dist
npx tsx -e 'import { writeBundleStamp } from "./tests/parity/helpers/bundle.ts"; writeBundleStamp({distDir:"/tmp/archive-h-dist"});'
ARCHIVE_H_DIST=/tmp/archive-h-dist PARITY_UPDATE=0 npx playwright test --config /tmp/archive-h-playwright.config.mts
```

The temporary `.mts` adapter imports the real parity configuration and changes only test selection,
setup (bundle already built/stamped), worker count and isolated output locations. The spec's server
checks the working-tree bundle stamp before listening. Candidate/integration configs, bundle stamps
and JSON reports are retained with the evidence. Only H's spec ran; no global parity or `web:build`
command ran. The existing large-chunk build warning remains; this is not performance acceptance.

## Reuse, recording and cleanup

Integration differed from the H candidate in U's three production files/two tests, instruction twins
and planning/evidence Markdown. All H paths were identical. Because the combined source tree changed,
H reran the full assigned scoped batch, lint, generation and its isolated browser proof; candidate
results were not substituted for integration execution. The subsequent receipt-only commit changes
no code, tests, configuration, dependency, reference or generation input. Reuse of those code gates
is limited to that inspected receipt-only diff, with documentation/binding, twin equality,
roadmap freshness and diff checks at recording time. Recording checks passed: 24 tests in
`roadmap-doc-binding.test.ts`, `npm run roadmap:check`, root/dashboard twin equality and
`git diff --check` (all exit 0).

Cleanup verified from the primary checkout: H's physical worktree, Git registration and branch are
absent. The owned dependency symlink was unlinked; primary dependencies remain. The consumed handoff
was removed after its recovery facts were incorporated here. Playwright CLI lists no open browsers;
owned Vite/synthetic-server/browser processes were stopped. H's exact `/tmp/archive-h-*` outputs were
inventoried and removed. Failed scratch `/private/tmp/hrt-501/run-RKf4Ju` was removed only after its
recorded process group 70548 had no members. Successful test runs removed their own scratch.
Durable external evidence and the committed H reference triplets remain. No other worktree/ref or
process was removed. H retains no authority to launch 2.6.9 or mark its review/full gates complete.

## Delivery assessment

No product-scope amendment or assignment resize was needed. Implementation repair rounds included
new-test syntax/lint corrections and the late-deletion race (A's applied response must refresh the index
without clearing selected B). The latter was an implementation defect under the already approved
safety proof, not a planning omission. Earlier setup errors were the temporary config's module format
and a duplicate test import; all final gates were rerun after repair. A stronger initial late-settlement
assertion including index refresh would have caught the defect sooner.

An external instruction edit temporarily dirtied master; H froze its candidate and paused, preserving
that edit. The owner committed it and U integrated before H resumed. The resulting combined-tree
checks were required integration validation, not another implementation repair round. Independent
review remains unrun by this task under the explicit H brief. No elapsed-time or savings estimate is claimed.
