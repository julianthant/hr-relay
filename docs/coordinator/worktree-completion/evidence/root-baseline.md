# Coordinator root baseline — 2026-08-30

Scope: coordination documents only in root master, code at
`61ca853caad0c214f8240c0a1e94ae758cd916b5`. This is NOT evidence for the seven
supervisor branches or the final integrated result.

Exact command (root `/Users/julianhein/Projects/hr-automation-rebuild`):

```sh
npm run typecheck &&
npm run lint &&
/usr/bin/lockf -t 0 -k /tmp/hr-dashboard-full-gate.lock env VITEST_MAX_WORKERS=1 npm run test:coverage &&
npm run roadmap:check &&
git diff --check
```

Observed command exit: **0**, completed approximately 06:55 PDT. Typecheck and zero-warning lint
passed. Coverage: **318 test files / 3476 tests passed**, 394.09 seconds; statements 84.10%,
branches 74.62%, functions 86.63%, lines 86.10%. Roadmap output: `docs/roadmap/index.html is fresh.`
No tracked product-file changes resulted. React act-environment warnings and the PDF fixture's
indexing warning appeared on stderr but did not fail tests; no claim is made that stderr was empty.

Heavy-gate admission then passed to the R2 supervisor; other supervisors received an explicit
instruction to await coordinator allocation while completing light checks and reviews.
