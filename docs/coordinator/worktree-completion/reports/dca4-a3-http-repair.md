# DCA4 A3 — bounded fixture HTTP repair

2026-08-30. **Minimal HTTP adapter repair and light gates complete; writer released.** No owned
command or server remains active. No browser, parity, reference update, coverage, staging or commit
ran in this unit. DCC2's heavy slot was not touched. The original browser failure still requires
an allocated rerun; this receipt does not claim DCA4 acceptance.

## Scope and method

Worktree for every command and source edit:
`/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`.
HEAD stayed `eda17b2708286e36542e1e18e9f8ef6a06cf3187` on `feature/dca4-archive-evidence`.

Read `/ui`, repo `/hr-debug`, global `/debug`, the local wrapper, `/tdd` and its test-quality
reference. Applied established-product Operate/hardening verification, debug's gate-first careful
loop, and real-boundary regression tests at the parent-confirmed seam. Pertinent lessons were
D215's bypassed boundary, D187's representation gap, and D132's explicit parity/build provenance.
The skills required preserving the original red and proving the actual serving boundary; they did
not override the prohibition on browser/heavy gates. No additional worker, task, worktree or model
sibling was created.

Only these three implementation/documentation files changed:

| File | This unit's change |
| --- | --- |
| `tests/parity/helpers/fixture-bff.ts` | Four lines replace one API-only dispatch condition: recognize only `/artifacts/v1/archive/:runId/:artifactId`, then use the existing Hono/Response forwarding. No handler/body/header/static-serving changes. |
| `tests/unit/dashboard/archive-evidence-fixture.test.ts` | Four real HTTP regressions plus owned ephemeral-server/static-fixture setup; original five tests retained. 94 → 230 lines. |
| `src/dashboard/AGENTS.md` | Seven-line dated lesson: in-process route proof misses the HTTP dispatcher; never substitute bytes or static files for an archived capture. |

No runtime/UI/backend/domain/owning-reference changes. `artifact-bytes.ts`, the exact PNG fixture,
its canonical record, the broad Archive fixture, and the browser spec's eleven cases are untouched.

## Original red and hypotheses before probing

Original command (previous allocated gate; **not rerun in this unit**):

```sh
/usr/bin/lockf -k -t0 /tmp/hr-dashboard-full-gate.lock npm run test:parity -- tests/parity/archive-evidence.spec.ts
```

It exited 1, **6 failed / 5 passed, 52.6s**. Both geometry tests never observed decoder invocation;
the image/keyboard/narrow cases showed visible image refusal rather than success. Exact original
output and error contexts remain in [the gate receipt](dca4-a3-gates.md).

Three ranked falsifiable hypotheses were shown before the HTTP regression ran:

1. **Dispatch gap:** the artifact path bypasses Hono for static serving. Killed by an actual HTTP
   200 with the exact pinned PNG.
2. **Lost evidence scenario:** server construction drops the selected profile. Killed by exact
   successful resource metadata over the real server.
3. **Transfer corruption:** the handler runs but HTTP alters bytes or headers. Killed by exact
   HTTP body/header equality; a static refusal instead locates an earlier failure.

## Proven cause — actual status, MIME and body

The first regression used **the real `startFixtureServer`**, its OS-assigned ephemeral loopback port,
and native `fetch`. No `app.request` substitute or mock stands in for this path. A temporary static
root is explicitly declared `proof: "unverified"` with the existing API-only-probe reason; nothing
is rendered or built. Every case closes only its server and removes only its own generated temp root
in nested `finally` blocks, including assertion/startup failures.

Resource metadata returned **200**, strict-schema-valid, exact run/artifact IDs and the exact URL:
`/artifacts/v1/archive/99999999-0009-4000-8000-999900000009/aa11bb22-000a-4000-8000-aa11bb22000a`.
Following that URL over HTTP before the fix produced:

| Observation | Before fix | After fix, pinned by the same regression |
| --- | --- | --- |
| HTTP status | **404** | **200** |
| Content-Type | **absent (`null`)** | **`image/png`** |
| Body | exactly UTF-8 **`not found`**, 9 bytes | byte-for-byte equal to the frozen **3281-byte PNG** |
| SHA-256 | `907ba78b4545338d3539683e63ecb51cf51c10adc9dabd86e92bd52339f298b9` | `f3ede4591dd6034661d8d63aef43ce4734610be67edbc7e30ce68834ebcd3847` |

The prior “static HTML” suggestion is disproved: the observed body is the exact **static 404 text**.
`startFixtureServer` dispatched only `/api/` to Hono; the declared artifact route lived on Hono but
was unreachable through this HTTP adapter. `serveStatic` therefore tried a nonexistent disk file
and returned `not found`. Successful direct-Hono byte tests had bypassed this branch.

The fix changes only dispatch, using the anchored exact route shape
`/^\/artifacts\/v1\/archive\/[^/]+\/[^/]+$/u`. Existing exact-ID/scenario checks own acceptance or
refusal; ordinary assets outside that route still use static serving. No catch-all, file fallback,
PNG replacement, header relaxation, port workaround, timeout or assertion change was added.

The happy HTTP test also pins Content-Length `3281`, `no-store`, `nosniff`, and exact attachment
filename. The PNG source, digest, frozen dimensions **1440×900**, metadata and canonical record did
not change. Browser decode remains separately unproved by this HTTP test.

## Regression and negative-control proof

All Vitest commands used **`VITEST_MAX_WORKERS=1`**, one own light command at a time.
Logs linked below preserve the complete command output. No temporary runtime logging was needed:
the regression's assertion includes the bounded response-body prefix and exact status/MIME/digest.

```sh
VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dashboard/archive-evidence-fixture.test.ts -t 'serves the exact resource download over real HTTP'
VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dashboard/archive-evidence-fixture.test.ts
VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dashboard/archive-evidence-fixture.test.ts -t 'preserves ordinary static'
VITEST_MAX_WORKERS=1 npm run test -- tests/unit/dashboard/archive-evidence-fixture.test.ts tests/unit/dashboard/parity-fixtures.test.ts
```

| Run (local start) | Result | Output |
| --- | --- | --- |
| First command, before fix (08:12:25) | **1 failed / 5 deselected, 1.99s**; exact 404/no MIME/9-byte `not found` mismatch | [red](../evidence/dca4-gates/http-repair-red-01.log) |
| Second command, exact-route fix (08:12:44) | **6 passed, 3.04s** | [first green](../evidence/dca4-gates/http-repair-green-01.log) |
| Fourth command, expanded HTTP matrix (08:13:24) | **2 files / 18 passed, 2.88s** | [expanded green](../evidence/dca4-gates/http-repair-green-02.log) |
| Second command, temporarily restore old API-only dispatch (08:13:36) | **3 failed / 6 passed, 2.31s**: exact download returns static 404; foreign/default cases incorrectly serve colliding static files with 200 | [old-dispatch control](../evidence/dca4-gates/http-repair-negative-old-dispatch.log) |
| Third command, temporarily dispatch all `/artifacts/` (08:13:59) | **1 failed / 8 deselected, 2.74s**: ordinary `/artifacts/logo.svg` incorrectly becomes 404 | [broad-dispatch control](../evidence/dca4-gates/http-repair-negative-broad-dispatch.log) |
| Fourth command, restored FINAL exact-route source (08:14:21) | **2 files / 18 passed, 2.70s** | [final focused](../evidence/dca4-gates/http-repair-final-focused.log) |

Both mutations were restored before the final focused run and full light gates. No skipped test
declarations, weakened expectations, changed thresholds/waits or debug instrumentation remain.

The four added real-HTTP cases prove:

1. Exact available metadata → real HTTP download, literal pinned digest/size/MIME and byte equality.
2. Foreign run and artifact IDs return strict `ARCHIVE_CAPTURE_UNKNOWN` JSON 404, even when a static
   file exists at the same path; metadata refusal is also pinned.
3. Default profile preserves the original archive index/detail and refuses evidence metadata/bytes,
   even with a coincident static file. Only explicit evidence selection enables the exact capture.
4. Ordinary HTML/CSS/SVG/JSON assets, neighboring `archive-help`/`archive-notes` paths, and a deeper
   non-route static path retain exact status/MIME/body; absent files remain actual 404 `not found`.

The existing `parity-fixtures.test.ts` also passed unchanged, covering normal HTTP bootstrap/day
and static root behavior plus fixture/SSE contracts.

## Full light gates and cleanup

```sh
/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run typecheck
/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run lint
```

- Full typecheck: **exit 0**, [output](../evidence/dca4-gates/http-repair-typecheck.log).
- Full lint: **exit 0, zero warnings**, [output](../evidence/dca4-gates/http-repair-lint.log).
- `git diff --check`: passed. Frozen broad fixture, shared byte helper, parity config/capture helper
  remain clean against HEAD. No `[DEBUG-`, `eslint-disable` or `.skip(` matches in the edited helper/test.
- No descriptor/runtime source changed, so no manifest regeneration was needed or performed.
- Original scoped browser rerun is **pending allocation**, not waived by debug's completion checklist.

## Frozen receive hashes

Tracked UI aggregate uses the same exact seven-path command as the prior receipts:

```sh
git diff --binary -- src/dashboard/AGENTS.md src/dashboard/client/queries.ts src/dashboard/surfaces/archive-model.ts src/dashboard/surfaces/archive.tsx tests/parity/helpers/fixture-bff.ts tests/unit/dashboard/archive-detail-render.test.ts tests/unit/dashboard/archive-render.test.ts | shasum -a 256
```

- Before: `54895c9b4210a5444cd9bdb9dbf02ef4be56f8562329bc5f9e882c31875c1f44`.
- After: `2f351365ae5528949fcd6e0f1982b73badb28a8efcd8a4908dbc7144e3d89bb0`.
- Backend aggregate unchanged: `19f0a93825bda594f033e24135b65667ac536a931bba11450eb438f284e37c6f`.

| Changed file | Before SHA-256 | After SHA-256 |
| --- | --- | --- |
| `tests/parity/helpers/fixture-bff.ts` | `83fcaa503ea3e8e4ea015ae8c58fe21dabf0fb5211249cfbcfad38664a43baee` | `7164312f74475708a8b26ddbf354be3c2f67e0f6e57566e4d5d568945b68c072` |
| `tests/unit/dashboard/archive-evidence-fixture.test.ts` (untracked, outside aggregate) | `1c9dd28762e252ff3108ba933de010fb8399d7e64dbe17d4576dffd5b4688017` | `61aa88751464f01106ac34db39fa9792f37c32480170ec491cfe4abf2cdc1d1f` |
| `src/dashboard/AGENTS.md` | `1111471e54c0839a6f37fadd1bdf439b9af9398b443f72ab9fac297dbd3a8de5` | `6b18e5483c89c44ecc7e29623a724f449a0f1bcd6b6f22c6f6d8d82d05d78379` |

Frozen new-file identities unchanged:

- Exact fixture/PNG source: `3877360ad3540f5579a47c4f4e88be8c366b29332895f4772c53145474792757`.
- Eleven-case browser spec: `7ad10d2f52012775228411cad869c96dd1195edcb8fbee4cf70e56e4017b12d0`.
- Resource-client test: `24d91d3aba1b7d22748ac61c6d7ed944fa0b7b8e7c81b9382be464f34e8aeb4f`.

## Pending parent work

Parent owns independent affected-delta review/light reruns, then any new heavy allocation. The
separate accepted **two medium browser-refusal test findings** in
`dca4-a4-browser-refusal-tests.md` remain queued: decoder invocation/positive dimensions and exact
HTTP abort/requestfailed evidence. This unit did not edit those assertions or claim their completion.

After those separately authorized changes, rerun the original scoped browser assertion under its
allocated heavy lock, inspect actual pixels/a11y, and only then follow the parent's reference/full
gate sequence. No current screenshot or full acceptance claim is made. No commit until required
full gates pass. **Writer closed and ownership relinquished for parent receive.**
