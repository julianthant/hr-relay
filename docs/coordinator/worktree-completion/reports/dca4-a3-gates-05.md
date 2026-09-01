# DCA4 A3 — remaining gate05 control receive

## Final partial receive — full coverage red; heavy released

Parent personally authorized full coverage after receiving both controls/positives, scoped11 and
direct references. Full coverage ran to completion, **exit1:4 failed/321 passed files (325),
5 failed/3629 passed tests (3634),266.74s**. No full asserted parity ran. No repair, reference
change, pending binding, shared guard edit or credential copy. Parent explicitly released heavy
to coordinator after terminal direct app notification. **No active command; writer closed.**

Exact invocation, with explicit assigned workdir as throughout this receipt:

```sh
set -o pipefail
/usr/bin/lockf -k -t0 /tmp/hr-dashboard-full-gate.lock env VITEST_MAX_WORKERS=1 HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test:coverage 2>&1 | tee '/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4/docs/coordinator/worktree-completion/evidence/dca4-gates/full-coverage-05.log'
```

Owned execution session **19166**, functions cell26, initial chunk`9383d1`, terminal
chunk`e5087c`, UTC **16:23:27.940–16:27:55.326Z**, wall267.386s.
[Complete execution metadata](../evidence/dca4-gates/full-coverage-execution-05.json) retains
every returned chunk ID, exact command, session, timestamps and exit.

[Untouched direct raw log](../evidence/dca4-gates/full-coverage-05.log):
**22776 bytes,245 newline-terminated lines**, SHA256
`8d894ee26188f8e404485bedbcae88965f7259f7d125cc41e25485cc491217ab`.
It was captured by tee before tool transport; no tail reconstruction or log normalization.
It contains no tool-truncation marker. Model-visible polling output was truncated, but it was
NOT used to recreate the raw file. Named failure summary was read from that complete disk log.

| Exact failing test | Observed terminal message (not repair diagnosis) |
| --- | --- |
| `tests/unit/dry-run-scenario-composition.test.ts > dry-run scenario production composition boundary > composes both worker drains and the real gate command through terminal receipt evidence` | SecretFileError: duoWebauthnCredential unavailable; ENOENT at this worktree's registered `.auth/duo-webauthn.json`. |
| `tests/unit/dry-run-scenario-composition.test.ts > dry-run scenario production composition boundary > derives transaction reach and EID-safe failure evidence from every durable worker sink` | Same named missing credential-file failure. |
| `tests/unit/architecture/guard-manifest.test.ts > reviewed architecture guard manifest > executes every required rebuild ratchet arm and proves its violating fixture is caught` | frontend-tailwind-compliance: `src/dashboard/surfaces/archive.tsx: image without explicit loading`. |
| `tests/unit/architecture/redaction-surface-scan.test.ts > redaction surface scan — the declaration audit (ref guards-and-tests §3.15, D183) > covers every exported *WireSchema by a registered surface` | `ArchivedCaptureResourceWireSchema` leaves not carried by a registered surface:resource.downloadUrl/message/reason/state. |
| `tests/unit/architecture/wire-connectivity.test.ts > wire connectivity — declared arms, served arms, and the manifest between them > resolves every client-called path to a served route, and declares every uncalled route` | Reports unconsumed GET `/artifacts/v1/archive/:runId/:artifactId` and `/artifacts/v1/:artifactId`. |

[Bounded raw-log failure-name extraction](../evidence/dca4-gates/full-coverage-failure-summary-05.txt)
includes original line numbers. No failure was waived; no coverage-floor success is claimed.
Coordinator owns missing-Duo/shared-wire-guard triage; no repair scope inferred.

At terminal red the worker immediately app-messaged supervisor
`01a052ed-f880-7f20-8c9e-8a2f356b9c35` with release request before report polish, then followed
with exact five names/counts/session/exit from the complete raw log. Parent confirmed release.

[Bounded post-coverage identity](../evidence/dca4-gates/frozen-after-coverage-05.json) confirms
HEAD`eda17b2708286e36542e1e18e9f8ef6a06cf3187`,
UI`28f06f9bebdc1bbc85ac7a62367281b0ad3e086ebd7eb92b6936bc95949434bf`,
backend`19f0a93825bda594f033e24135b65667ac536a931bba11450eb438f284e37c6f`;
all1,622 protected paths retain digest
`68ea761f5fb644c0cbf83a42bc4edf005489f1d9a662daea650a6b60efd1b1f6`.
Exact e2c03 spec/23317 bytes; refs/companions unchanged; materializer diff and diffcheck empty.
No source writes after control restoration, no commits. Full acceptance remains incomplete.

## Earlier control receive (completed before personal full-coverage GO)

2026-08-30. Fresh explicit allocation for remaining sequence only. **Abort404 control failed for
the intended missing exact failed-request tuple; immediate byte-exact restoration and separately
locked restored positive passed.** No decoder/scoped11/update/light reruns. No active command.
Parent received direct app message; the later personal full-coverage GO/result is recorded above.

Every command used explicit workdir
`/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`.
Both test executions used:

```sh
set -o pipefail
/usr/bin/lockf -k -t0 /tmp/hr-dashboard-full-gate.lock env -u PARITY_UPDATE npm run test:parity -- tests/parity/archive-evidence.spec.ts --grep 'visible image-http refusal' 2>&1 | tee '<absolute unique log>'
```

The exact commands including absolute log paths and all captured session/chunk IDs are in
[negative execution](../evidence/dca4-gates/abort-negative-execution-05.json) and
[positive execution](../evidence/dca4-gates/abort-positive-execution-05.json).
Raw stdout/stderr was written directly by tee BEFORE tool-output transport; no raw-log
reconstruction from model-visible output. Pipefail preserves original nonzero exit.

| Run | UTC / session / terminal chunk | Result |
| --- | --- | --- |
| Abort404 |16:22:15.930–16:22:23.835Z;22340;`fdf951` |Exit1, expected1 failure; test5.6s, wall7.905s |
| Finally restoration |16:22:23.835–16:22:23.939Z;`e5f2a3` |Exit0; exact e2c03 SHA,23317 bytes, complete saved-baseline equality |
| Restored positive |16:22:38.621–16:22:41.480Z;42089;`dd245c` |Exit0;1 passed,2.4s, wall2.859s |

The [case-local patch](../evidence/dca4-gates/abort-control-05.patch) replaced only
`route.abort("failed")` with a named404 fulfillment. Exact intercepted URL, GET, image type and
completion marker matched, but `failure` was undefined and `sameRequest` false; spec420 refused
that tuple. This proves an ordinary HTTP404 image error cannot satisfy the intended injected-abort
oracle. Every assertion remained. See [raw expected red](../evidence/dca4-gates/abort-negative-05.log)
and [raw restored positive](../evidence/dca4-gates/abort-positive-05.log).

The inverse patch ran in finally immediately after command completion, before the positive gate.
Restored SHA `e2c03cb1480d144a4e889e52e98f4dc302bcb4c51fa16042bd448ba35bbac1c0`,
23317 bytes; exact baseline is the04 saved original spec. No product/reference change retained.

[Bounded pre-control identity](../evidence/dca4-gates/frozen-current-05.json) proves current
HEADeda17b, UI28f06, backend19f0a938, all companion/ref hashes and1,622-path digest
`68ea761f5fb644c0cbf83a42bc4edf005489f1d9a662daea650a6b60efd1b1f6`.
It emits only bounded digests/counts, not a large map/spec body. Initial identity tool chunk45f84e.
[Post-control identity and log hashes](../evidence/dca4-gates/frozen-after-controls-05.json)
matches protected digest/count and all sources/references. No giant output or historical04 artifact
rewritten. The04 evidence/protocol disposition remains in its own report and parent's provenance
receipt; fresh allocation is not retroactive approval.

Full coverage subsequently ran as above and failed. Full asserted parity remains unrun.
Any repair/retest requires parent/coordinator disposition and fresh authority/allocation. No commits.
