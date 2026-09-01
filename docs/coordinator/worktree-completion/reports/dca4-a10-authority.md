# DCA4 A10.1 — authority/client and complete capture origins

2026-08-30. **Authority/client seam implemented and frozen; writer/light lane relinquished on return.**
No backend implementation remains in this assigned seam. Product acceptance is NOT green:
wire connectivity is **2 failed / 23 passed**, and historical full-coverage-05 remains RED.
Mounted UI, guard recognition, fixture join, D291 shared serving and required full gates remain separately owned.

## STATUS / ROLE / MODEL / REASONING / COMMITS

- STATUS: frozen uncommitted delta, ready for sequential A10.2 UI ownership.
- ROLE: sup_sol_dca4_a10_authority_origins; requested native Sol/high, 240k/220k.
- COMMITS: none; index empty; HEAD unchanged at `eda17b2708286e36542e1e18e9f8ef6a06cf3187`,
  branch `feature/dca4-archive-evidence`. Dirty A5–A8 work was preserved, not discarded.
- Workdir for every shell command and root for every edit:
  `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`.
- Full supplied implementation brief, exact root profile/board/run-plan, local A9 proposal,
  relevant AGENTS, /tdd and good-tests were read. TDD used the operator-confirmed public
  query/schema/client seams; /ui routing was restricted to client behavior, with no rendered claim.
- No independent agents/reviews, foreign-tree writes, live authority/auth, staging, commits,
  builds, manifest regeneration, browser, parity or coverage.

## Delivered seam and downstream interface

The reconciled live route uses real diagnostic authority through async `readRunDetail` and
`readRunSection`. Initial availability is available/absent/error, never an eager artifact list.
The lazy captures payload is:

```ts
{
  section: "captures",
  payload: {
    runId,
    artifacts: [{
      artifact: ArtifactRefWire, // complete existing byte/presentation metadata
      origins: [{ bundleId, originKind }] // nonempty, strict, every verified membership
    }]
  }
}
```

Exactly five origin kinds: failure, unexpected-state, subject-mismatch, recovery-park,
operator-request. No actor/failure-details egress. One artifact per id; refs must agree exactly.
The complete run index is strictly parsed and checked for foreign/duplicate identities before
byte opening. Exact bundle id, canonical manifest (including origin), attachment index, digest
and byte verification precede publication. Invalid/missing provenance refuses. Missing bytes
keep DCA3's DIAGNOSTIC_BUNDLE_CORRUPT wrapping; no purge/retention policy was invented.
Old archived details may omit availability; no current enrichment of their immutable record.

Client parses the strict origin projection, rejects foreign initial/lazy run ids and a different
section returned for a captures request. `runSection(runId, section, cursor?, signal?)` forwards
the optional fourth signal. Existing omitted-signal behavior and other aggregate hooks are untouched.
`artifactUrl(artifactId)` remains exact UUID-based generic DCA1 identity, not bundle/Archive identity.

D183 classifies all new free text (availability message/reason in live, archived-detail and
stream/replacement surfaces) as repository-authored. Obsolete capture-resource message/reason
paths disappear only because the lazy schema no longer contains those arms. New origin leaves
are UUID/closed-enum constrained and mechanically classified; no waiver, policy exception,
scanner narrowing or new egress. A6's archived resource registry/canaries remain intact.

Only D292 owner blocks/pointer from ratification
`2e173e5c047679cf6958bc3eb0ecb4c36ad0ab51` were ported by intent. As-built text explicitly
separates delivered authority/client from pending mounted consumption. D290/D291 text was not ported.

## FILES / exact frozen identity

Isolated A10.1 patch (against the dirty intake, NOT against HEAD):
[delta.patch](/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4/docs/coordinator/worktree-completion/evidence/dca4-a10-authority-delta.patch),
65,677 bytes, SHA256 `49b77b304610ab008e0bce3b44f20d595624c020687f1df18c5f011df3ae66cf`.
16 allowed paths; 767 insertions, 36 deletions. Read-only reverse-apply check passed.

[Before bytes and hashes](/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4/docs/coordinator/worktree-completion/evidence/dca4-a10-authority-before.json):
SHA256 `000796fc2d06609f48ec8c7cd32ccbc68ee57ee3989d26eb25450ea278bf1241`.
[After per-file bytes and hashes](/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4/docs/coordinator/worktree-completion/evidence/dca4-a10-authority-after.json):
SHA256 `d3e2a1ce74bfac3469b2058176c475d4dddc97b439f02213f0f4b1ae2925b5d6`.
These contain every allowed path's exact before/after identity, including the two new test files.

| Owned category | Paths relative to the assigned tree |
|---|---|
| Authority/schema | src/domain/dashboard/artifacts.ts; src/domain/dashboard/run-detail.ts; src/server/dashboard/compose.ts; src/server/dashboard/queries/run-detail.ts; src/server/dashboard/routes/api.ts |
| Client only | src/dashboard/client/queries.ts |
| Tests | tests/unit/dashboard-wire.test.ts; tests/unit/server/bff-flow.test.ts; tests/unit/server/run-detail-captures.test.ts; tests/unit/dashboard/run-detail-captures-client.test.ts |
| D183/pending | tests/unit/architecture/helpers/redaction-surface-audit.ts; config/pending-wire-bindings.json (only captures entry removed) |
| Owner docs | AGENTS.md; docs/rebuild/reference/dashboard-surfaces.md; docs/rebuild/reference/frontend-backend-integration.md; docs/rebuild/reference/decisions.md |

Protected inventory: **1,846** Git-visible non-coordinator paths outside those 16 are byte-identical.
Sorted path→SHA256 object digest before = after:
`502f22006cec22f8676440dfc7dc7ef2cdaad7f5bdeda731ca38000a90dd6f2e`.
No excluded UI/fixture/reference, Archive product, wire-connectivity helper/test, shared materializer,
content writer, HTTP adapter or migration change. The six active visual references and all other
Git-visible reference copies are protected by this inventory. Parent's disjoint coordinator
artifacts are intentionally excluded. Ignored runtime paths are not a clean-tree assertion.
All33 parent pins and A9 proposal hash matched at intake.

Generated build manifest stayed at
`66d399b7cc1370018778a9101dd9fedd6dcc478b02bd35b214aabe60288a5a49`.
No regeneration claim: build/derived roadmap work remains for parent allocation.

## Retained provenance

[Provenance record](/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4/docs/coordinator/worktree-completion/evidence/dca4-a10-authority-provenance.json)
contains exact retained bytes/hashes for the 12 in-scope retained source/test/config paths.
Reviewed scoped hunks were reconciled with current dirty files, never whole-file copied.
Original four server cases and three client cases were adapted by intent; server proof now uses
real SQLite bundle/index authority, public failure terminalization and public queries.
D292 additions are new and are not attributed to the old tip.

Retained source history (preserved; not merged or replaced by this patch):
`fd1cc3022792d6d5980f43bd15f1d7c3294a2173`,
`709cd5d55338554614613ac5db4d14b787b60df7`,
`385675836e1177c5335153502d5027a5d1681f35`,
`add58fb1a2eabd976786428a7962fbf86d586754`,
`9132ad7a298e3b7619e913937c46794e24393288`,
`fc6581c6f89661ae1546e013b87497fdcfa3232f`,
`37825254d507207b71aeb808f20674ca1b273276`,
tip `7a85bbd596f00ba4052ce1dddd13cd40c8a897ac`.
Eventual DCA3 ancestry remains an integration responsibility.

## GATE — actual serial receipts

[Gate receipts](/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4/docs/coordinator/worktree-completion/evidence/dca4-a10-authority-gate-receipts.json)
records every exact shell command, workdir, log, start/final tool chunk, session and exit code.
All raw logs are direct `tee` stdout/stderr captured before transport, with `set -o pipefail`;
none was reconstructed from truncated tool output.

Every Vitest used:
`VITEST_MAX_WORKERS=1 HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test --`.
Final focused arguments were the eight paths below plus `--reporter=verbose`.
Dot and verbose reporters repeat the final summary, not the tests.

| Exact focused test path | Passed |
|---|---:|
| tests/unit/server/run-detail-captures.test.ts | 28 |
| tests/unit/dashboard/run-detail-captures-client.test.ts | 12 |
| tests/unit/dashboard-wire.test.ts | 12 |
| tests/unit/server/bff-flow.test.ts | 27 |
| tests/unit/architecture/redaction-surface-scan.test.ts | 26 |
| tests/unit/architecture/strict-boundary-schemas.test.ts | 5 |
| tests/unit/server/archive-capture-resource.test.ts | 33 |
| tests/unit/server/archive-capture-routes.test.ts | 42 |
| Total | **185/185** |

Final raw log `evidence/dca4-a10-authority-focused-final.log`,
SHA256 `b946f002cc9fd1b1fc7f6a0f96b6a4b38ab51def43ad93ca7eeffa56375c9779`;
session22401, terminal chunk b36ad7, **exit0**.

| Gate | Exact invocation / receipt |
|---|---|
| Full typecheck | `/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run typecheck`; session43201, d7f3db, exit0; typecheck-final.log |
| Full lint | `/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run lint`; session10901, 66deff, exit0; lint-final.log |
| Wire connectivity | prefix above + `tests/unit/architecture/wire-connectivity.test.ts`; session97080, 97bda9, exit1; **2 failed /23 passed**, wire-residue.log |
| Preservation | after.json generation chunk56e3fa, exit0; HEAD/index/control hashes/outside paths checked |
| Patch check | `git apply --reverse --check .../dca4-a10-authority-delta.patch`; chunk a53e0c, exit0; `git diff --check` also exit0 |

Wire residue is **not merely generic-only**:
1. line403: the existing synchronous lifecycle census does not observe async available capture
   capability after the now-truthful captures pending entry is removed.
2. line467: generic `GET /artifacts/v1/:artifactId` is served but not yet consumed by a mounted UI.
No guard edit or pending exception was made to mask either. A10.2/A10.3 own the next steps.

## Red-capable proof and exact restoration

| Probe / prior state | Actual outcome |
|---|---|
| Missing initial live capture availability | initial-red.log: 1 failed/26 passed, then initial-green.log 27/27 |
| Retained flat refs drop origins | origins-red-02.log: one deep-equality failure at the public query; origins-green.log 1/1 |
| Wrong returned section and unforwarded signal | client-red.log: both intended assertions fail; corrected in final12 client tests |
| Temporary last-wins membership | control-origin-loss.log: **1 failed/27 passed**; shared-artifact mixed-origin assertion identifies lost failure membership |
| Temporary non-operator→failure relabeling | control-origin-label.log: **3 failed/25 passed**; each non-failure kind with a failure id is distinguished |

Controls changed only the authorized query, one at a time, never tests/assertions. Immediately
after each control, exact restoration was proven by `shasum -a 256 -c` (exit0):
domain run-detail `6e988a9379b0446891c0b030dbe94aad4ec0e175653acb1c4fcd66e85c4a5777`;
query run-detail `97b26234cf19e2764bddbb85d3038e8b722ac0f2cda1e1af471226ee414b2e07`.
The final185 green and locked lights ran after restoration.

Excluded from semantic red claims: origins-red.log first failed a fixture foreign key; client-red.log
also exposed one incorrect test expectation of the artifact-open argument (it is a complete ref);
typecheck-01.log found branded test-input types. All were corrected and their raw failures retained.

## REVIEW-HINT / NOTES / pending proof

Review the isolated patch, not the inherited HEAD diff. Focus on all-membership accumulation,
whole-index prevalidation, exact canonical readback including origin, complete ref conflicts,
strict unique memberships, and client section/run identity. Tests separately pin re-digested
origin disagreement (not merely stale digest), real cross-run filtering, missing/malformed
origins, foreign exact readback, missing/changed attachment index, missing/digest/size bytes,
closed kinds, field egress and shared-image dimension disagreement using an existing real PNG.

The authority error vocabulary and Archive compatibility are preserved. No cap, retention policy,
byte writer, materializer or HTTP adapter change. No backend work remains in A10.1.
Parent must allocate mounted UI/guard/fixture work and independent review of the coherent A10 delta;
full gates and D291 joined serving remain pending. No rendered acceptance or commit authorization
is inferred from these light receipts. Source and tests are frozen; ownership is released on return.
