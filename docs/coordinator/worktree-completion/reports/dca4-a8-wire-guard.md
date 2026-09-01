# DCA4 A8 — mounted Archive browser route guard

**Implementation/light-ready; frozen for five independent reviews. Writer/light lane relinquished.**
No active owned command/browser; no staging or commits. Full acceptance is NOT claimed:
the unchanged complete route audit remains red only for the generic artifact route (CENTRAL OPEN).

## Approved scope and mechanism

Read the complete A8 brief, mechanism proposal, exact project profile, applicable AGENTS and
frontend-backend-integration §8.8. Used /ui for the existing mounted frontend seam, /hr-debug
(with the current architecture red first) and /tdd at the explicitly approved collector/accounting
boundary. No dispatch, production public interface, shared UI, config, scanner-root, manifest,
inventory, materializer, byte, browser or reference changes.

Isolated received→final delta: **+437 / −32**, four files:
- New `tests/unit/architecture/helpers/archive-browser-route-references.ts`: +154. Mount real
  `ArchivedRunDetail` within `ToastProvider`, press its Evidence tab and actual What it was opener,
  and use real `createDashboardQueries(createDashboardTransport(...))` over an injected external
  HTTP response. Assert the exact requested pair and HTTP resource path, returned identity, and
  available state. Read only actual native `a[download][href]` and `img[src]` attributes; parse
  each through the strict same-pair wire schema and compare it with the returned retained URL.
  Returned references contain the observed attributes, never the URL fixture or unused builder.
- `tests/unit/architecture/helpers/wire-connectivity.ts`: +45. Mechanical extraction of the
  entire existing two-direction accounting body. After indentation and parameter-binding
  normalization it matches the preserved original exactly.
- `tests/unit/architecture/wire-connectivity.test.ts`: +231/−32. File-local jsdom only,
  async existing route case, derived observation/accounting orchestration and 19 A8 cases.
  A refused observation contributes an explicit fatal problem AND leaves ordinary route
  accounting free to report the orphan; it cannot silently yield a green empty reference set.
- `AGENTS.md`: +7. Local lesson distinguishing native consumption from unused URL declarations
  and from browser/bytes/decode proof. Received hash preserved byte-exactly in before evidence.

The caller still derives server routes, scanned references and pending entries from their
original owning files. CLIENT_PATH, CLIENT_ROOTS, routeMatches, scan under-run assertions,
all accounting comparisons, the pre-existing negative/mirror/manifest cases and inventory identity
are unchanged. The five original non-route cases pass under jsdom; no broader compatibility
shim or source change was needed.

## Controls and cleanup

All 19 A8 cases use the real collector and shared accounting:
two distinct schema-valid run/artifact pairs; actual download, image, and both sinks removed;
unused builder without native consumers; foreign href, mismatched src and generic href; foreign
response URL; schema-valid foreign runId/artifactId; extra root/resource wire keys; one-ID generic
reference unable to satisfy Archive's two-ID route; missing server route; stale consumed pending
entry; stale deleted-route pending entry; explicit observation exception.

Native-sink controls restore exact nodes via retained placeholders, or restore exact attribute
values, before React unmount. Every collector path finally unmounts the root, removes its host,
checks original body children/portal cleanup and aborted resource signals, and restores the prior
IS_REACT_ACT_ENVIRONMENT property descriptor. Primary and cleanup errors are retained in an
AggregateError, not suppressed. The exception control also verifies the descriptor and original
body children externally. No fake image load/decode or natural-dimension success is supplied.

An additional bounded test-only negative changed only the collector's final return to discard
its observed references. The real mounted positive went red on the missing href/src references.
Restoration ran in orchestration finally; helper/accounting/test hashes matched before and after.
No production mutation was used.

## Executions and raw logs

All commands used explicit workdir `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`. One light command at a time.
Raw logs match complete concatenated tool output byte-for-byte. Execution receipt timestamps
bound tool dispatch/completion observation, not an invented process-finish instant; native Vitest
duration/start output remains in each log.

| Step | Result | Raw log |
| --- | --- | --- |
| baseline | exit1; 1 failed / 5 passed; exact Archive + generic orphan routes | [wire-baseline.log](../evidence/dca4-gates/wire-baseline.log) |
| jsdom-accounting | exit1; 1 failed / 5 passed; same two orphans, other Node cases intact | [wire-jsdom-accounting.log](../evidence/dca4-gates/wire-jsdom-accounting.log) |
| mounted-first | exit1; 1 failed / 6 skipped; test expectation used a mistaken fixture UUID (not a product red) | [wire-mounted-first.log](../evidence/dca4-gates/wire-mounted-first.log) |
| mounted-green | exit0; 1 passed / 6 skipped after expectation corrected from the fixture declaration | [wire-mounted-green.log](../evidence/dca4-gates/wire-mounted-green.log) |
| controls | exit0; 19 passed / 6 skipped | [wire-controls.log](../evidence/dca4-gates/wire-controls.log) |
| credit-negative | exit1; 1 failed / 24 skipped; collected references deliberately not credited | [wire-credit-negative.log](../evidence/dca4-gates/wire-credit-negative.log) |
| restored-focused | exit0; 19 passed / 6 skipped; exact helper restoration verified | [wire-restored-focused.log](../evidence/dca4-gates/wire-restored-focused.log) |
| fullfile | exit1; 1 failed / 24 passed; generic-only orphan remains CENTRAL OPEN | [wire-fullfile.log](../evidence/dca4-gates/wire-fullfile.log) |
| typecheck | exit0; full locked tsc --noEmit | [wire-typecheck.log](../evidence/dca4-gates/wire-typecheck.log) |
| lint | exit0; full locked eslint --max-warnings 0 | [wire-lint.log](../evidence/dca4-gates/wire-lint.log) |

The initial mounted expectation typo is preserved transparently; it is not counted as the
behavioral red. The baseline two-route audit and the explicit discarded-credit negative are the
red proofs. Final `git diff --check` over the changed tracked paths also exited0.

Exact gate commands (each run used `set -o pipefail` and direct `2>&1 | tee` to its log above;
every complete invocation/session/exit/log hash is in [execution receipts](../evidence/dca4-gates/wire-execution-receipts.json)):

```sh
VITEST_MAX_WORKERS=1 HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test -- tests/unit/architecture/wire-connectivity.test.ts
VITEST_MAX_WORKERS=1 HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test -- tests/unit/architecture/wire-connectivity.test.ts -t A8
VITEST_MAX_WORKERS=1 HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test -- tests/unit/architecture/wire-connectivity.test.ts -t 'A8 credits the actual'
/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run typecheck
/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run lint
git diff --check -- AGENTS.md tests/unit/architecture/helpers/wire-connectivity.ts tests/unit/architecture/wire-connectivity.test.ts
```

**Residual, not a waiver:** final full-file route assertion still expects zero problems and reports
`src/server/dashboard/routes/api.ts serves GET /artifacts/v1/:artifactId …`.
Archive's `GET /artifacts/v1/archive/:runId/:artifactId` diagnostic is gone. No exception,
fictional consumer, route deletion or weakened comparison hides the generic dependency.

## Frozen identity and review evidence

HEAD: `eda17b2708286e36542e1e18e9f8ef6a06cf3187`.
UI seven-path aggregate unchanged: `3c89958afe63d1b8c0b5b8e8d01fffff25e94d89a2cbbc517ec7b799cdb4d461`.
Browser spec unchanged: `e2c03cb1480d144a4e889e52e98f4dc302bcb4c51fa16042bd448ba35bbac1c0`.
The two approved browser404 controls already completed and restored this exact spec before
fullcoverage05. No further404 control is currently authorized; A8 ran no browser control.

| Path | Received SHA256 | Fixed SHA256 |
| --- | --- | --- |
| `AGENTS.md` | `fc6dfe830fb7afcf8f3ac062cec3b96c7af616f4acc4dba5a2a13630264f943f` | `cd2d36269a801de05af6fa4a6033bd5c6c52b712d7305dbab182faf004991c97` |
| `tests/unit/architecture/helpers/wire-connectivity.ts` | `a64d01f0be7cb2d0335468d1c165c0307dec1d6c7261fd60cd44286f6ed44130` | `a44d56a9919991c3f2441bae0c84befd70cb72bd9e3d8240e73a42d26725fa82` |
| `tests/unit/architecture/helpers/archive-browser-route-references.ts` | new | `dfc1d690788463fb31708f0254c167dd1e8781aa6944e777b14e73da95ddde28` |
| `tests/unit/architecture/wire-connectivity.test.ts` | `eae519b1171e1c52f7de4e0ec08a4e06d80f642375d7e69b73c7caab16921bce` | `3b124157ec7e39084c4c8102508fd85c6865d2625f1f564475c87eb8d6618cf4` |

[Isolated delta](../evidence/dca4-gates/wire-delta.patch) SHA256:
`7ea193bfc1794ff045d3abd8520fb2d72ad28756cf4dcc644b6c1ec5cd11cd17`.
Generated with git diff --no-index against the three exact before files, plus /dev/null for
the new collector. This excludes inherited root AGENTS changes.

[Before map](../evidence/dca4-gates/wire-before-hashes.json): 1629 candidate files.
[After map](../evidence/dca4-gates/wire-after-hashes.json): 1630 candidate files.
Only the four approved paths differ. Excluding those paths, all **1626** protected files match,
with sorted path→SHA256 JSON digest `db758be755d311d2ee062a4242c17686b5829364bce6a1dd8a66f8c6dc25d329`.
This includes all production source, UI/spec/reference bytes, fixture materializer, configs,
pending bindings, inventory and runtime. The coordination report/evidence paths are separate.

[Scope proof](../evidence/dca4-gates/wire-scope-proof.json) records the exact accounting-body,
scanner/matcher, roots and old-case comparisons. Before artifacts:
`wire-before-AGENTS.md.txt`, `wire-before-helper.ts.txt`, `wire-before-test.ts.txt`.
Raw log SHA256s/byte lengths are recorded in the execution receipts.

## Acceptance boundary / next owner

Ready for parent receive and independent Tests, Standards, Correctness, Security and Silent failures.
No source ownership or light process remains. The remaining generic-route diagnostic belongs to
the central owner; it is not full-file success, full acceptance or commit permission.
No browser, build, parity, reference update,404 mutant or full coverage ran. This proves
ArchivedRunDetail→native DOM consumption only, not shell reachability, physical downloads,
decoding, layout or accepted pixels. No claims from unaccepted prior screenshots changed.
