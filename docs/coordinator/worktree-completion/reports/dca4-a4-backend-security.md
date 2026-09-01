# DCA4 A4 — independent backend Security axis

Reviewer: native `sup_sol`, high; thread `01a052fb-b984-73e0-bbf5-ed19d516706b`.
Read-only findings persisted by parent, no reviewer mutations or nested agents.

Target: original HEAD `eda17b2708286e36542e1e18e9f8ef6a06cf3187` plus the frozen eight-file
backend/doc/test change recorded in `dca4-a2.md`. Tracked patch SHA-256
`5d273caa52780898f7af96a5a5d58f34d3359636fef51f1c28068189ffc38728` and both test hashes matched
before and after review. Scoped diff whitespace passed; frontend was excluded.

## Security

Count: 0 · Worst: none.

| Coverage | Reviewer evidence |
| --- | --- |
| Authorization and caller input | `src/server/dashboard/queries/archive.ts:171`: UUIDs, requested archive identity, content digest and matching duplicate byte references precede artifact access |
| MIME/download handling | `src/server/dashboard/routes/api.ts:218`: verified bytes; restricted capture MIME, attachment disposition, nosniff, no-store |
| Error leakage | `src/server/dashboard/queries/archive.ts:211`: safe ids and normalized authority/byte failures, not raw storage paths/messages |
| Capture-host boundary | Existing middleware precedes both new routes; neither belongs to the phone allowlist |
| Download URL binding | `src/domain/dashboard/archive.ts:351`: exact runId/artifactId URL refinement |

No concrete security defect found in the pinned backend diff. Capture-host review relies on the
existing configured-host boundary plus source/tests; no live ingress was exercised. No tests/lint or
heavy gates were run by this read-only reviewer. Parent separately reran the 71 query/HTTP tests.
