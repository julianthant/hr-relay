# D290 DCR/DCC migration-history integration

Status: **BRANCH-LOCAL VERIFIED / READY FOR COORDINATOR RECEIVE**.

The integration branch receives DCR, DCC1, DCC2 and DCC4, preserves the three released post-v18
histories without rewriting them, selects DCR's v19-v24 line as the active continuation, appends the
exact DCC1 SQL as v25-v27, and refuses the retained alternate DCC1/DCC4 histories before mutation.
The final post-repair candidate passed 355/355 coverage files, 4,159/4,159 tests and 265/265 asserted
parity scenarios. No live database, HR workflow, credential, migration conversion, remote push or
root/integration-branch mutation occurred.

## Scope and branch identity

- Assigned checkout: `/Users/julianhein/.codex/worktrees/03b-history-integration`.
- Branch: `codex/r-03b-history-integration`.
- Frozen integration baseline: `9900e123724fb73423ff30150a62696f5d6c6b73` on
  `integration/03b`.
- Final product/reference commit: `143cd588e011818fb88f5a2b7b6d720652be8db4`.
- Gate-evidence commit: `fc51bcaded848386b683f2fc026f84603553a22b`.
- This report is the final docs-only category; the exact clean branch tip is returned with the
  coordinator handback.

The first-parent integration sequence is:

| Commit | Disposition |
|---|---|
| `9b601a0f` | Red DCC1 suffix-refusal test before implementation |
| `8d36ea70` | `--no-ff` receive of DCR parent `8839fddb` |
| `6e9415b8` | D290 active-lineage guard, exact alternate-history fixtures and documentation |
| `e0e9ccf1` | `--no-ff` receive of DCC1 parent `d65d38d` |
| `e92795ac` | `--no-ff` receive of DCC2 parent `c9af958a` |
| `87624f98` | `--no-ff` receive of DCC4 parent `68386456` |
| `484b2210` | Close three independently found fail-open integration defects |
| `6a6d529d` | Express absent Explorer path state outside the catch block without weakening the guard |
| `143cd588` | Reconcile the four separations Options PNGs after a merge-resolution omission |

The merge parents were verified directly. No source branch was rebased, squashed, deleted or
rewritten, and no whole security or migration commit was cherry-picked as a shortcut.

## Migration-history disposition

Versions 1-18 remain the common immutable prefix. The integrated active sequence is:

| Version | Meaning | SHA-256 |
|---:|---|---|
| 19-24 | DCR operator XLSX/reporting history | Preserved byte-for-byte from DCR |
| 25 | DCC1 `runtime_config` | `5566cba092c31714c90f00bd53f7750b06c8fd6604fe303eea88f1f77b47feaf` |
| 26 | DCC1 `settings_current` | `485ffaf7aa48240741edc2625d1f49df2691bf72047e97b95f9844174378f9da` |
| 27 | DCC1 bulk/settings continuation | `080e5b70b41760035fd662fcf99210199ca604c51839df7750e82bd4ba63962f` |

DCC1's immutable source suffix remains represented exactly as v19-v21 with digests
`f10c15c58161cf658eb6526c8b3994ef72b0d85473389114eebb4d54651429d5`,
`29bbfab1ce3efdc17ac7f5943f6681b2af4604baaf0a5c91c42f7dee09d466fd` and
`d2a0c8de6f97f1c737d85b3474df07b053357a12626b3c08659cf7369fa41ce6`.
DCC4's alternate v19 Explorer review/outbox SQL remains an exact test-only fixture with digest
`bef14546c5a4bba520dca00f2bd0d950bc6f3824c5f953f54729d233b1701b8d`.
An existing authority that presents either alternate suffix is refused before migration effects;
the DCC4 outbox protocol is not reactivated.

This implements the coordinator's approved branch-local disposition only. The bounded schema audit
found the conventional root database and 95 retained backups at v18 or below, but that is not
universal non-deployment proof. Final shared integration, any authority conversion and cleanup remain
coordinator-owned; this run performed none.

## Preserved product contracts

- D75 remains strict: a caller-supplied `requestedBy` mismatch refuses before dispatch, replay or
  effects. Valid absent/matching provenance is stamped and exact replay remains idempotent; no
  alternate branch may silently replace a mismatching actor with command provenance.
- D293 remains destination-free in the Start modal. The dashboard request omits
  `requestedInstance`; lower-level authorized ingress remains separate. DCC4 introduced no later
  destination/requested-instance UI delta.
- DCR search, report, receipt-comparison and XLSX contracts remain present. Search may carry the
  navigation identities it needs; XLSX omits those identifiers from workbook content.
- DCC1 settings mutations preserve strict loopback/same-origin ingress, exact persisted identity,
  primary-plus-close failure evidence and append-only active migration history.
- DCC2 preflight/storage authority is received. Its separately declared
  `dcc-storage-span-visibility` dashboard visibility gap remains open integration residue; this run
  did not invent UI authority to close it.
- DCC4 Explorer path inspection treats only `ENOENT` as absence. Access and I/O failures refuse,
  and descriptor operation/read/fsync/close failures retain primary-first aggregate evidence.

## Independent findings and repairs

Independent command/security review found three integration fail-open defects, all repaired in
`484b2210` and independently re-reviewed with zero findings:

1. Explorer path probes previously collapsed every access error into absence. They now accept only
   `ENOENT` as missing and propagate other failures.
2. `POST /api/v1/exports/xlsx` lacked the existing same-origin loopback mutation guard. The route now
   refuses before request-body processing or effects.
3. Simultaneous settings operation/read/fsync and close failures could lose one cause. The descriptor
   now preserves both in primary-first `AggregateError` order.

The first full coverage attempt exposed a guard-shape issue: an `ENOENT` catch returned bare `false`,
which violated `fail-loud-catch-default`. Repair `6a6d529d` returns the frozen discriminated
`{ state: "absent", reason: "path-not-found" }` value and derives the boolean outside the catch.
No guard, timeout or assertion was weakened.

The first integrated asserted-parity run then exposed four stale PNGs. Merge `8d36ea70` had combined
DCR's plural `Separations` descriptor/a11y/meta with D293's destination-free layout, but retained the
first parent's singular-label PNGs. The stable red captures differed only in the final `s` glyph at
three labels (88-132 pixels per image). `143cd588` replaces exactly the four Options PNGs with the
observed composite; source, tests, a11y, metadata and runtime are unchanged, and `PARITY_UPDATE` was
never enabled. Independent `/ui` release review returned zero findings.

## Verification

All commands ran in the assigned checkout. Focused Vitest commands used
`VITEST_MAX_WORKERS=1`; full typecheck/lint commands used the shared light lock; full coverage/parity
used explicit coordinator allocations and `/tmp/hr-dashboard-full-gate.lock`. The logical slot was
released on each red and immediately after the final terminal result.

| Gate | Result |
|---|---|
| Integrated focused suite | 10 files / 299 tests passed |
| Fail-open repair focused suite | 3 files / 132 tests passed |
| Catch-shape focused suite | 2 files / 33 tests passed; final targeted proof 2/2 passed |
| Locked `npm run typecheck` | Exit 0 |
| Locked `npm run lint` | Exit 0, zero warnings |
| `npm run roadmap:check` | Exit 0 |
| `npm run build:manifest:check` | Exit 0 |
| First full coverage at `484b2210` | Red: 354/355 files, 4,158/4,159 tests; sole guard-shape failure |
| Full coverage at `00963e85` | Green: 355/355 files, 4,159/4,159 tests, 345.17s |
| Asserted parity at `00963e85` | Red: 261 passed / 4 stale separations Options PNGs |
| Post-PNG full coverage from base `e6802029` | Green: 355/355 files, 4,159/4,159 tests, 338.32s |
| Post-PNG asserted parity | Green: 265/265, 3.6m; repaired cases 27-30 passed |

Final coverage floors are statements 84.84% (26,732/31,507), branches 75.43%
(14,012/18,574), functions 88.47% (5,383/6,084), and lines 86.76%
(24,680/28,444). Suite inventory is 268 unit files / 96,901 lines, 18 scenario files /
7,125 lines, and 69 architecture files / 24,371 lines.

## Immutable gate evidence and limitations

Evidence lives under `../evidence/d290-history-integration/`.

| Artifact | Raw SHA-256 | Compressed SHA-256 | Result |
|---|---|---|---|
| `coverage-484b2210.log.gz` | `67065636f2ca78ef0faea9c094fef80f6cfefac7b149477e9cabaaee339c3a00` | `8c83c42a839db9dc0bf2506d1b085a7a96c4d42b9704eaf48eb1dd311fe6c28d` | First red coverage |
| `coverage-00963e85.log.gz` | `af488a3977d06775974a1552aefac2b97e261645de6e5e230fa73aee1a266891` | `ef5be485183eda84f1e6c7808be5c069d8285ca379ea03674150ddce354af738` | Green pre-PNG coverage |
| `parity-00963e85.log.gz` | `3df2b7fc575d7570ce15a705cf05bdc4982499b16e75f4baada3433ce539d096` | `e2bdef756c27fb794084d99971748b42e355dda90b879d926d2462b600b95c44` | Four-image red parity |
| `coverage-e6802029-repair.log.gz` | `9667d04fbe02402c9e7980e975b7272993014bffbbe365083927715b2fa78037` | `135b5f0a19ee581520384e9a59168331b280f9d278d722da10564a4e9db553e3` | Final green coverage |
| `parity-e6802029-repair.log.gz` | `5fcd3b7e80acdfdb8033a3be154b82a72bd187955125cb06ccd6b68b5104950f` | `5ca67df9cac7e4941d932220ab3b070b6cba7d9523992d0a7c7b0e709266aa02` | Final green parity |

The final coverage transcript directly records `COVERAGE_GATE_EXIT=0`; the wrapper itself returned
0. Its `COVERAGE_LOGGER_EXIT` field is blank because the wrapper read Bash `PIPESTATUS` in two
successive assignments and the first assignment replaced the array. The complete tee transcript is
present, but the logger exit was **not directly captured** and is not reported as an exact value.
Final parity directly records gate and logger exits 0, and its wrapper returned 0. Raw bytes are
preserved; no transcript was rewritten to hide this limitation.

Committed-range `git diff --check 9900e123..HEAD` exits 2 solely for inherited immutable evidence:
DCR contributes 452 diagnostics across five paths and DCC2 contributes 667 diagnostics across 74
paths. There are zero diagnostics outside those exact 79 paths, and excluding only those exact paths
returns 0. This is a classified exception, not a whole-diff green claim or whitespace-policy waiver.
The new D290 gzip evidence and four binary references introduce no additional diagnostic.

Gate-order disclosure: DCR's inherited `845ca5a1` repair was committed before its later passing full
coverage, as its source report records. D290's integration/repair commits through `6a6d529d` likewise
preceded the first fresh full-repository coverage of their exact integrated candidate; later green
gates prove those candidates but cannot retroactively prove pre-commit order. The final four-PNG
product/reference commit `143cd588` did comply: both post-repair full gates completed before commit.
No history was rewritten to conceal either deviation.

## Reviews and resources

Independent migration-authority, tests/docs/UI, command/security, repair-correctness/security and
repair-tests/standards reviews all completed. The first command/security review's three findings are
the closed defects above; every fresh repair/release review returned Count 0 / Worst none. The final
four-PNG review independently compared both parent intents, confirmed zero differing pixels outside
the intended label/destination regions, and found no broad refresh.

`/worktree-sweep` ran in read-only audit mode. The DCA2 and DCA4 feature worktrees were dirty and
protected; the three DCC feature worktrees were clean but retained for coordinator ownership. No
worktree or branch was merged, removed, pruned or deleted by the sweep. The assigned branch is the
only item this run changed.

Generated local `coverage/`, `dist/` and `tests/parity/.output/` remain ignored gate artifacts. No
credential/profile file was copied or read, no foreign process was killed, and no owned browser
session remains open.

## Coordinator receive

The branch is integration-ready. The coordinator should verify the returned clean tip contains
`143cd588` and `fc51bcad`, verify the four merge-parent pairs and evidence hashes above, then receive
this branch into `integration/03b` with `--no-ff` under the declared repository policy. Shared
integration gates and eventual source-worktree removal remain coordinator-owned. The open DCC2
storage-span UI residue must remain named; no master merge, migration deployment/conversion, live
authority mutation or remote push is authorized by this handback.
