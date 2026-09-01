# DCA4 A7 parent receive — exact Duo fixture port

2026-08-30. HEADeda17b2708286e36542e1e18e9f8ef6a06cf3187. Parent read complete receipt/isolatedpatch,
same named two-failure red and source omission chain. Exact three final hashes and patch matched.
Writer closed before parent gates/review. Only +4runtime/+3fixture/+7lesson, no replacements;
approved845ca5a115ee6eef3e10598e88ea0a7fdf361888 provenance, all nine branch tests preserved.

## Independent affected reviews

Correctness — sup_terra01a052fb-ba16-7803-82d7-1f7c41c361db, high. runtime173 forwards suppliedfactory
unchanged and omits undefinedkey; production callers omit, worker445 retains realfactory. Existing
drains/receipts/gates/safetyassertions unchanged. Exact original reconstruction/provenance verified.
Count:0 · Worst:none.

Tests — sup_luna01a052ff-4062-7b32-b0ba-4c6d27bbec85, high. Both injected fixtures retain realworker
and durableassertions; branch-only blocked-chain case remains, no timeout/assertionchange.
Same2fail/7pass→9pass rawlogs reviewed. Count:0 · Worst:none.

Security — sup_sol01a052fb-b984-73e0-bbf5-ed19d516706b, high. Trusted in-process injection only,
no wire/CLI/configselector or productionfixtureimplementation import. Omittedfactory still resolves
registeredcredential and failsloud; fixture retains synthetic-key realSQLiteleasestore.
Count:0 · Worst:none.

All three independent/read-only reviewers matched frozenfiles/patch before/after, now closed.
Default omission proof is source tracing plus originalpre-port missingcredentialstacks. The
separate syntheticreadinessrefusal test is NOT a newly executed post-port omission regression.
No such direct test exists/was added under the exact-seven-line authorization. No broader claim.
Other axes not repeated for the exact approved provenance port: no layout/performance/async/error
policy change, no simplification; lesson repeats the approved seam/default distinction.

## Parent evidence

Every shell command targeted assigned absoluteworkdir. Direct pipefail+tee logs:

| Command | Session/terminal/result |
| --- | --- |
| `VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dry-run-scenario-composition.test.ts tests/unit/browser-session-factory.test.ts` |6103/1696d9/exit0;18tests2files3.07s,09:55:42PDT |
| `/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run lint` |33647/04020b/exit0; admission waited for sharedlock then ran |
| diffcheck/index |0/empty |

Browserfactory tests use injected fake launcher/pages, not browser automation or live login.
duo-port-parent-tests.log SHA6deb1654a8b6a1e39f966ca92f885d1f3d16f22b65670a7428f191850f81b832;
duo-port-parent-lint.log contains exact successful lint invocation/no diagnostics.
Native fulltypecheck0 and readinessrefusal1pass receipts inspected.

Final runtime d745bad8399767640b730a6787c9794ada474f9661afb1659f8aab6471fafcfa;
test f47721d4384a347bfbb345f602c98bb4ce1486d45a34213630a74fadb8ee18eb;
rootAGENTS fc6dfe830fb7afcf8f3ac062cec3b96c7af616f4acc4dba5a2a13630264f943f;
patch9cd4f02311494bb83fbe4028028d2d1ae90336208f8a746f6b2611e210a04af9.
A6lesson and all other beforebytes preserved. No authprovisioning, DCC1join, manifest/ref/materializer
change, browser/fullgate, staging/commit. A7 received; A8 gets solelane next. Fullacceptance pending.
