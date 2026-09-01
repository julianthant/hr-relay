# DCA4 A6 parent receive — D183 resource registration

2026-08-30. Fixed dirty-diff review at HEAD eda17b2708286e36542e1e18e9f8ef6a06cf3187;
exact three-file +182/-2 delta30d746aa6ef76765a58ad1e110bad45c7f5150b1d874ec3b03cb604e26b7ded9.
Full writer receipt/patch and actual red/canary-negative rawlogs read by parent. All three final
hashes independently matched before receive. Writer closed before parent tests or reviewers.

## Independent selected axes

Correctness — sup_terra01a052fb-ba16-7803-82d7-1f7c41c361db, high. Complete schema and exact origins;
real sealed SQLite archive/query/verifier, all9sentinels planted before derivation, exact references
and copy, typed versus normalized raw failures distinguished. In-memory reconstruction from saved
originals reproduced all three files. Count:0 · Worst:none.

Tests — sup_luna01a052ff-4062-7b32-b0ba-4c6d27bbec85, high. Tests148/482/530/553/566 pin six leaves,
three origins, actual persisted fixture and real producer; only storage-open injected. Expected
values are independent literals. Same canary assertion rejects schema-valid leaking outputs;
three omission/two leak reds and restored26greens confirmed. Count:0 · Worst:none.

Security — sup_sol01a052fb-b984-73e0-bbf5-ed19d516706b, high. No policy/exception/scanner waiver;
URL exact IDs and fixed messages keep captured metadata, raw exceptions and bytes out of resource
output. All nine sentinels reach source; typed failures survive normalization. Count:0 · Worst:none.

All reviewers were independent/read-only, matched exact three hashes/patch before and after and
are closed. None reran gates. Test-only leaking-output controls are NOT executed productionmutants.
Other axes not repeated: no production/runtime/async/layout/performance behavior changed; existing
declaration policy and broader feature reviews remain untouched. Lesson only records this proof.
No simplification needed; no public contract or configuration changes.

## Parent gates and preservation

Assigned absolute workdir for each command, direct pipefail+tee raw logs:

| Command | Actual result |
| --- | --- |
| `VITEST_MAX_WORKERS=1 HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test -- tests/unit/architecture/redaction-surface-scan.test.ts tests/unit/server/archive-capture-resource.test.ts tests/unit/server/archive-capture-routes.test.ts` |session7276/terminalb3d286/exit0;101tests3files4.14s,09:46:53PDT |
| `/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run lint` |session55742/terminal7dcae8/exit0 |
| whitespace/index/materializer |diffcheck0, index empty, shared materializer no diff |

evidence/dca4-gates/redaction-parent-tests.log SHA25c1d5db3a9f44dfad3ecd1f548957d06aa546ee45830c90fb0ca53526c33a45;
redaction-parent-lint.log SHAcfb3a35a240932c8cf36ee05be81eca1cb9e8bee2e2516b0ca6ee56a8d482385.
Native lockedtypecheck0 receipt spotchecked. Exact unchanged spec e2c03/23317bytes and full05 raw
8d894ee26188f8e404485bedbcae88965f7259f7d125cc41e25485cc491217ab rehashed. No browser/fullgate.

A6 received; no allocated A6 work remains. A7 now gets sequential writer/light lane. Final branch
fullgates/centralgenericroute disposition and commits remain pending, no waiver or acceptance.
