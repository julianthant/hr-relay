# DCA4 A10: DCA3 authority and actual Receipt consumer

2026-08-30. FROZEN / LIGHT-GREEN. Implementation, affected review and serial light proof are complete. Browser, shared D291 and joined full-gate acceptance remain open.

## Authority and intake

- Assignment: root coordination brief `briefs/dca4-dca3-consumer-implementation.md` at 8fa96f6b. Operator's recommendations ratified as D290–D292 in 2e173e5c047679cf6958bc3eb0ecb4c36ad0ab51; only D292 applies to this implementation.
- Checkout: `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`; branch `feature/dca4-archive-evidence`; intake HEAD eda17b2708286e36542e1e18e9f8ef6a06cf3187, empty index and whitespace check green.
- Parent reverified the 33 prior candidate pins in `evidence/dca4-gates/parent-repairs-frozen-final.json` and the fully received A9 proposal (25041 bytes, SHA256 321f731344bfd1bc62268046075772e9114bf77b0ddf22d29b539863a95e9954) before dispatch. A9 is not repeated.
- Retained source tip: 7a85bbd596f00ba4052ce1dddd13cd40c8a897ac. Reconcile only relevant non-reference changes by intent, preserving current A5–A8. Patch provenance does not replace eventual ancestry integration.
- `/supervise` governs execution, native role guard passed. `/tdd` seams expressly confirmed by the brief. `/ui` routes the existing-system Receipt work through Operate; no redesign or new producer is authorized.

## Sequential units and ownership

| Unit | Existing native role | Bounded seam | State |
| --- | --- | --- | --- |
| A10.1 | sup_sol_dca4_a10_authority_origins (01a052f3-1069-7531-8ddb-949bd903ebd7), high | Retained authority/client plus strict all-origin membership; D292 owner text | Frozen, parent received; native closed |
| A10.2 | sup_terra_dca4_a10_receipt_consumer (01a052f9-aace-7530-b01c-fbb9293a2446), high | App-owned capture lifecycle and Receipt presentation | Frozen, parent received; writer relinquished |
| A10.3 | sup_terra_dca4_a10_consumer_accounting (same existing native), high | Actual mounted consumer accounting and exact fixture HTTP | Frozen, parent received; native closed |
| A10.4 | Existing independent native reviewers, then parent | Affected coherent-delta review, serial parent lights, frozen browser-readiness handback | Complete; stopped-owner handback ready |

Each writer must relinquish source and command ownership before the next starts. Parent owns this report; unit receipts use unique A10 paths. Read-only reviews target frozen diffs. No new user tasks or worktrees.

## Invariants and limits

One artifact tile retains ALL verified supporting bundle-id/closed-origin-kind memberships for the requested run. Failure framing on tile and preview is true iff a membership is literally `failure`; other origins and full byte metadata stay visible. Missing, foreign or conflicting authority refuses. No arbitrary winner, empty-origin default, actor/failure detail expansion or run-status inference.

Actual LoadedApp/Receipt controls, query/parser and native href/src consumption must establish generic-route reachability. Archive two-ID and generic one-ID routes remain distinct. No unused-builder credit, dummy caller, pending exception or Gallery redirect.

All focused Vitest runs use VITEST_MAX_WORKERS=1 and the profile's legacy path. Full typecheck and lint separately take `/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock`. One owned light command at a time. Raw stdout/stderr and exact execution receipts accompany proof; queue contention is not product evidence.

Shared materializer/content writer/production HTTP adapter/migrations, foreign checkouts, board, historical references, active Archive references and original evidence remain outside scope. No browser, dashboard build, coverage, parity, reference update, staging, commit, merge or cleanup is allocated. DCA2 receives the stopped common delta only after coordinator receive. D291 shared-serving and eventual D290 ancestry integration remain centrally coordinated.

## Historical gates retained, not current acceptance

Full coverage05 remains the last full run: exit1, 5 failed/3629 passed tests; raw SHA256 8d894ee26188f8e404485bedbcae88965f7259f7d125cc41e25485cc491217ab. Subsequent A5–A8 focused repairs and 24-pass/1-generic-route-red architecture proof do not convert it to a full pass. Completed Archive decoder/abort controls are retained and will not be repeated. New A10 browser behavior and joined full gates remain unproved.

## Receive ledger

A10.1 received: parent read the full 1160-line isolated patch, complete implementation report and execution ledger, direct two-failure wire log and final focused/light summaries. Parent checker fe27e5 exit0 independently matched all16 owned hashes, all1846 protected non-coordinator paths, report/patch/focused-log hashes, HEAD/index, reverse patch and whitespace checks. Protected digest 502f22006cec22f8676440dfc7dc7ef2cdaad7f5bdeda731ca38000a90dd6f2e. Existing native Sol stopped before next writer.

Unit report `reports/dca4-a10-authority.md`: b74912ed6d6078927581980cef89957f7ab38a64f058484ed05f2fd811f5d16a. Isolated16-path patch:49b77b304610ab008e0bce3b44f20d595624c020687f1df18c5f011df3ae66cf, +767/-36. Final185/8 tests exit0 (session22401), locked typecheck43201 and lint10901 exit0. Test-fixture/setup reds are disclosed separately from intended semantic reds. Independent coherent-delta review remains pending.

Exact current wire residue changed to **2 failed /23 passed** (session97080 exit1): existing synchronous section census does not recognize the newly served async capture capability, and the generic byte route remains unconsumed. Both are next-seam work; no pending exception was added and no green/full acceptance is inferred. Archive collector and historical evidence remain unchanged.

Next UI shape is `payload.artifacts[] = { artifact: ArtifactRefWire, origins: [{ bundleId, originKind }] }`; optional fourth `runSection` AbortSignal is available. Live availability is explicit; legacy archived optional compatibility remains. Parent accepts sequential implementation receive, not completed A10 or rendered acceptance.

A10.2 received: parent read the complete1100-line isolated patch, implementation report, focused/light execution records and control failure names/restored-positive summaries. Checker88e726 exit0 independently matched all10 owned pins,1857 protected paths/digest843361eca38113e12ace58078f1b6ed93da65d1ddf7c67899cf25d094fac4579, patch41c589ddc6fec62397da4c6a57c820ea5c3f77182bd9b8c0eb37adb2426a684b, HEAD/index/whitespace/reverse-patch checks and seven raw log hashes. UI report SHA4a009c7712f3fc0ea41d7779f2aab26d20bb755985c0e903d0dcade59983278f. Final126/9 tests49605 exit0, typecheck72960 and lint67697 exit0; six lifecycle and two literal-frame intended reds have exact restoration and positive proof. New40 tests comprise37 whole-app and3 first-commit hook/DOM cases. Source writer explicitly relinquished before A10.3.

A10.2's reusable whole-app fixture is test-only declaration proof, not canonical bytes. Its current unmount helper resets history to `/` and restores globals after unmount succeeds; A10.3 must preserve prior history and restore owned state even if mount/cleanup fails before this helper can underpin the architecture collector's stronger cleanup contract. This is bounded test-helper hardening at the already approved guard seam, not production behavior expansion. Independent review and rendered acceptance remain pending.

A10.3 received: parent read the complete948-line isolated patch, full report, raw three negative controls and final117/6 log. Checker16e713 exit0 matched9scope/all named pins,1861 protected6be0f2781b0cb09f5cfd4fb74e07ef7b8dbaeac8a8e5978eeabbe4126f8358f4, all23 raw log hashes, HEAD/index/check/reversepatch. Scope patch34a4c445981d2ee9f6dc4ad921a30ea7ef892c70a9cb9e66481efa021141b323 (+693/-37); report `reports/dca4-a10-accounting-http.md`. Current wire is now50pass, NOT the historical2fail23pass. Final117/6 unit52158, type7977, lint64739 exit0. Collector/dispatcher/byte-flip controls failed at intended assertions, restored exact hashes then positive. Cleanup now restores prior history/globals and checks foreign DOM identity even on actual mount/unmount failure. Writer/light ownership relinquished and native closed. Browser and shared-serving acceptance remain pending.

## Complete A10 review target

All29 paths are pinned in `evidence/dca4-a10-parent-review-freeze.json` (SHA dc45b7459870e755fc4da1962c6e15c43ec375a2707387943c0cf1963d06bea5), candidateDigest259757261c5a288a5f5072c9294090907739caa4ffc9be1e9f3d74ab462a9ee9. All1841 non-coordinator paths outside A10 match initial intake, digest7abd497e1810b5a398d3210794a5000f6b8b6bf8fff63de468662ebaeb5793fc. Dirty-intake unified patch `evidence/dca4-a10-parent-complete-delta-02.patch` SHA d6069d0652f973ba2c662d49cb8ea571fd7517bfeb17bd97acb842411e3074b6, reversecheck0 (77c677). The first non-02 export is PARTIAL/UNUSABLE: diff failed reopening an empty stdin for a new file; subsequent shell commands masked its terminal status. It remains preserved and is not review evidence. The corrected attempt uses /dev/null for new files, set-e/pipefail, and passes complete reversecheck. A prior optional require.resolve('diff') also failed; no package installed or source changed.

Independent axes selected for the complete coherent delta: Standards(substantive), Spec(D292), Correctness(runtime/identity), Silent(fail-loud async), Performance(authority I/O/render), Tests(new guards/lifecycle/HTTP), Docs(owner claims), Security(strict diagnostic egress). Each uses a separate existing native reviewer; no axis skipped. Simplify skipped: no request or established unnecessary complexity. Reviews do not certify pixels/browser behavior. Parent serial focused/light proof follows on this frozen source.

## Initial review and parent light results (before repairs)

All eight independent returns are persisted verbatim at `reports/dca4-a10-review-{standards,spec,correctness,silent,performance,tests,docs,security}.md`; each native closed before repair ownership. Counts/worst: Standards1low; Spec0; Correctness1low; Silent0; Performance2medium; Tests2medium; Docs2medium; Security0. Standards and Correctness independently name the same cross-run fixture bundle identity. They remain independent counts, not two product defects. Parent confirmed each cited source/test line. No browser proof implied.

Parent source-frozen checks:302tests/14files59954 exit0 (17.91s, raw74bb38960f62c2f1817e92dc5c564057be128fe0621f12505c2229153c7966f7); additional25tests/3files guardmanifest/refresh-boundary/descriptor16983 exit0 (8.91s, raw5dfde3f737c8b8f42a56578767a7cbe6dc6665d2f81fd5384193a2c4bed37f94). Lockedtype59633 and lockedlint79893 exit0. Nonmutating manifest--check95457 and roadmap:check537d9c exit0. Full execution metadata in `evidence/dca4-a10-parent-light-terminal-01.json`. Recomputed freeze stdout hashes exactly dc45b745. These are pre-repair lights, not acceptance of later code.

Repairs: A10.4F same Terra now owns only fixture bundle/run uniqueness and real HTTP regression. A10.4T will strengthen same-image pending-decode refusal and exact origin tuple UI tests. A10.4D will reconcile stale availability summaries/new archive-freeze comment. Parent additionally observed dashboard-surfaces §9.3's pre-D292 summary still lists captures as never served; that directly affected owning summary belongs in the docs correction. No extra product behavior is authorized.

Performance disposition: origin accumulation O(N²) is local to approved query scope. Repeated full-byte verification enters unchanged `diagnostic-bundle.ts` (not an A10 path): per bundle, it validates durable row/digest/index then unconditionally verifies every attachment; its return has no verified-read session hook. Parent requested coordinator disposition for a real per-request verification-sharing seam before touching that shared module. No fake stream, skipped verification, cross-request cache, materializer or productionHTTP repair will be invented. Local fixture/tests/docs repairs continue within authority; no readiness handback until this conflict is disposed.

## Repair receive and affected review closure

A10.4F closes the fixture's impossible cross-run bundle ownership. Report
`reports/dca4-a10-fixture-owner-repair.md`; isolated patch SHA256
`a3b1767ba1b452d9c6db767f7c22622b983c39bd89ef1da0558858e821243b22`. The unchanged fixture
produced the named `…b101` cross-run red, the repaired HTTP path passed 10/10, related fixture paths
passed 28/28, and locked typecheck/lint exited 0. Final fixture/test hashes are `b300ee04…` and
`1231018c…`. Correctness re-review reports zero remaining findings.

A10.4T closes both Tests-axis gaps. Report `reports/dca4-a10-oracle-repair.md`; isolated patch
SHA256 `6c06a455d49b0faf1d59a2c10b0e36e4427f5d888737aa1a93ff687ad99c273b`.
The same mounted image now proves pending decode cannot override a later error; tile and preview
compare exact independently authored `(originKind,bundleId)` rows. The decoder-invalidation mutant
failed one case and the origin-label rotation failed two; exact product hashes were restored before
positive proof. Focused 101/4 and locked typecheck/lint passed. Tests re-review reports zero findings
and explicitly limits this to DOM/unit proof.

A10.4P closes only the local quadratic origin copying. Report
`reports/dca4-a10-origin-accumulator.md` SHA256
`5add57aa4f767f57dd8c389a332cc9b637add544cc9e0cdaea9f6c88aedfcfa3`; isolated patch SHA256
`24a006e50075a29ee7622c95a870f973006dc546b5480275e50ec54ef4839838`. One request-local mutable
origin list per artifact is strictly parsed and recursively frozen once after all existing
bundle/index/digest/manifest/byte and metadata-conflict checks. A real SQLite/public-query 12-origin
regression and the existing two-origin case both failed under the overwrite mutant; query 29/29,
affected 73/4 and locked typecheck/lint passed. Performance re-review closes the A10 finding with no
new local structural cost.

A10.4D reconciles the owning as-built summaries and source comment. Report
`reports/dca4-a10-docs-repair.md` SHA256
`9fbae944df61c88495cfc053bc9e5342567bf447aa754311c3248e4c3bb5ad84`; patches
`da4547cace5a07bbdf827152b52314aadf75dd7514bca9fad73b1868acc56a01` and
`47b67ca2a3d080afd3d0c3f6acd9596d2b50192c67a3a660a1835dc5f2588580`.
The first non-mutating roadmap check correctly exposed stale generated HTML; the parent regenerated
it from exact pre-hash `3388956a…a437b` to `b6e9b038…beda` and obtained freshness. Independent
Spec/docs review then found two remaining matrix rows; the follow-up changed only those rows. The
generated HTML stayed byte-identical and a fresh roadmap check passed. Final Spec/docs re-review is
0 findings and retains generic resource-status/gallery, browser, full-gate and D291 limits.

Verbatim affected returns are preserved at `reports/dca4-a10-rereview-{correctness,tests,performance}.md`,
`reports/dca4-a10-rereview-spec-docs-01.md` and
`reports/dca4-a10-rereview-spec-docs-final.md`. Final counts for repaired A10 findings are zero.
Performance separately retains one medium integration residue, DCA2-owned D291 N×S repeated
shared-artifact byte verification; it is not an A10 branch-local finding or waiver.

## Final frozen identity and parent light proof

`evidence/dca4-a10-parent-final-freeze.json` pins 30 paths at candidate digest
`2b961630ea35821d2f93ed7d36f47c44e30752af686ab53783eab578e8faa209`; its SHA256 is
`f87f373088540f40386e243a13431b0887becc3da843c67a8b4a6cf82d17efd9` before this coordination-only
report update. All 1,840 non-coordination paths outside A10 match the initial intake at digest
`89aee0371c2b3fa8d0e9f37ff4078792800a30392173dcc7d3e6f074835401ca`. The reconstructable 29-path
intake delta is `evidence/dca4-a10-parent-final-delta.patch`, SHA256
`998ef6061c2529caa034fe864a0f23898016623a12f41134713fef5d0d409eaf`, reverse-check 0. The generated
roadmap file is the thirtieth path and is separately continuous by exact before/after hashes plus
freshness proof; the 29-path patch does not pretend to contain its unavailable intake bytes.

Fresh parent gates on the repaired source: focused 305/305 across 14 files; architecture guards
25/25 across 3 files; globally locked full typecheck and lint exit 0; build manifest check exit 0;
roadmap generation/check exit 0; whitespace and index checks exit 0. Exact commands, chunks, logs
and hashes are in `evidence/dca4-a10-parent-light-terminal-final.json`. The two matrix rows changed
after code gates; they are prose-only, and their final roadmap regeneration/check and diff check
are separately recorded. HEAD remains `eda17b2708286e36542e1e18e9f8ef6a06cf3187`; index is empty; no
commit or stage exists.

## Stopped-owner handback and remaining sequence

A10 is ready for coordinator receive as the stopped common delta, not for commit or full acceptance.
DCA2 next receives the controlled common overlap, including `fixture-bff.ts`/JPEG intent, then owns
the D291 request-local exact-reference verification repair. DCA4 must subsequently receive that
shared implementation and adapt Archive without weakening the fresh selected verification pass,
bundle/index/digest/manifest checks or exact byte identity. Joined light review precedes any heavy
request.

The scoped browser artifact is intentionally **not yet created**. Proposed future file:
`tests/parity/run-captures.spec.ts`; proposed locked command:
`/usr/bin/lockf -k -t0 /tmp/hr-dashboard-full-gate.lock env -u PARITY_UPDATE npm run test:parity -- tests/parity/run-captures.spec.ts`.
Its bounded cases are actual-app full and short Receipt, absent/no speculative fetch, native keyboard
focus/rings/Escape/restoration, coarse 44px targets, edge ownership/nonoverlap, two themes, complete
labels/provenance, exact decoded dimensions, native served-byte download, and stale-selection
refusal. No golden/reference adoption is proposed until the coordinator separately allocates and
accepts an attributable plan.

No browser, dashboard build, coverage, parity, reference update, shared materializer/reader repair,
live HR/auth/database/migration mutation, commit, merge, cleanup or push occurred in A10.
