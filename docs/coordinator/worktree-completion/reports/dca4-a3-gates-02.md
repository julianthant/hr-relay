# DCA4 A3 gate 02 — scoped RED, slot released

2026-08-30. **Initial unmodified scoped assertion: exit 1, 2 failed / 9 passed, 14.1s.**
The phone failure is non-reference, so the sequence stopped immediately after the owned command
exited and parent was notified to release the logical slot. No repair, mutant, reference update,
retry, coverage or full parity followed. No owned command/server or separately launched browser
remains active. Gate unit closed for parent receive and separate repair authorization.

## Exact run and artifacts

All commands used explicit workdir `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`.
The binding `briefs/dca4-gate-resume.md` was read under explicit heavy GO. `/ui` remained on the
established-product Operate/hardening/parity verification route; no product editing route was taken.

```sh
/usr/bin/lockf -k -t0 /tmp/hr-dashboard-full-gate.lock npm run test:parity -- tests/parity/archive-evidence.spec.ts
```

- Start: `2026-08-30T15:36:11.820Z` (08:36:11 PDT).
- Exit received: `2026-08-30T15:36:26.469Z` (08:36:26 PDT).
- Normal configuration: 11 tests, one worker, unchanged limits; `PARITY_UPDATE` unset.
- [Complete raw output](../evidence/dca4-gates/scoped-assertion-02.log), SHA-256
  `d64a5e8b451768ebb2a0aa52af3abebe345a49cc8da23bf654350def01a235f0`.
- [Desktop error context](../evidence/dca4-gates/desktop-image-error-context-02.md), SHA-256
  `cabb71b6a6c93b3f7b9725e8ac323d5c7c072e74d4d31d60f1b9f4b64d23b4e5`.
- [Phone error context](../evidence/dca4-gates/phone-image-error-context-02.md), SHA-256
  `9aef5b5a590c1defc317317cac9eec694556640c439a1df3beb41a32a14d26f4`.

Contexts were copied byte-for-byte into unique `-02` paths. Earlier gate logs/contexts and all six
preserved intake PNG/a11y/meta files remain untouched. Generated context instructions are evidence,
not authorization to repair.

## Results and exact stopping condition

| Case | Result |
| --- | --- |
| Desktop dark happy capture | **RED: a11y reference drift**, spec line 158 through reference-store. Actual title `screenshot at ucpath-person` vs old `cross-verify`; canonical fixture run label/time and preview naming also differ. |
| Phone coarse-touch happy capture | **RED: actual Close control width 41.84375px < required 44px**, spec line 107, called from line 156. This is not a reference mismatch. |
| Desktop loading→HTTP→decode geometry | Passed, 946ms |
| Phone loading→HTTP→decode geometry | Passed, 927ms |
| Desktop keyboard/Escape/reopen/focus return | Passed, 699ms |
| Narrow layout/control geometry | Passed, 853ms |
| Missing refusal | Passed, 695ms |
| Corrupt refusal | Passed, 697ms |
| Request refusal | Passed, 604ms |
| Exact HTTP abort / corresponding failed request | Passed, 771ms |
| Invoked decoder refusal / actual positive natural dimensions | Passed, 701ms |

Exact non-reference error:

```text
Error: Close
expect(received).toBeGreaterThanOrEqual(expected)
Expected: >= 44
Received:    41.84375
at assertControlGeometry (tests/parity/archive-evidence.spec.ts:107:43)
```

The assertion measures `getBoundingClientRect()` in the actual touch/coarse-pointer context and
keeps the 44px floor unchanged. Its failure label is `Close`; header and footer both have that name,
so this receipt does **not** assign the measured width to a particular one without additional
evidence. No CSS or test-oracle repair was attempted.

Both happy cases reached checks after real native image decode, exact natural dimensions, exact
download URL and byte-for-byte downloaded-stream equality; those assertions passed before their
respective stops. The desktop passed control geometry before reaching a11y comparison. The phone
passed the preceding nonoverflow/viewport/body-footer checks but its full touch/control proof is
not accepted. No screenshot is available: desktop stops at the a11y-first comparison; phone stops
before capture. Only the two error contexts were produced in the runner output directory.

## Candidate identity and provenance

Before running, all eight candidate identities matched the binding brief:

| Target | SHA-256 |
| --- | --- |
| Tracked UI seven-path diff | `2f351365ae5528949fcd6e0f1982b73badb28a8efcd8a4908dbc7144e3d89bb0` |
| Backend six-path diff | `19f0a93825bda594f033e24135b65667ac536a931bba11450eb438f284e37c6f` |
| Browser spec | `d158e014dd85b42ae6f42fb5d02aaf2a54408f348e4ab008627eb25ce8db6de1` |
| HTTP fixture test | `61aa88751464f01106ac34db39fa9792f37c32480170ec491cfe4abf2cdc1d1f` |
| Canonical fixture/PNG source | `3877360ad3540f5579a47c4f4e88be8c366b29332895f4772c53145474792757` |
| Client test | `24d91d3aba1b7d22748ac61c6d7ed944fa0b7b8e7c81b9382be464f34e8aeb4f` |
| Backend resource test | `6853648c074d7f97eae16d83a7f04dccfef4b838ed5879b62e3c4a6d801d1907` |
| Backend routes test | `e0d7d28094586d8adcebc5612820d5d3da8ccffb60badfca6b06a5eb55092a30` |

HEAD remains `eda17b2708286e36542e1e18e9f8ef6a06cf3187`. No source or test mutation occurred;
the spec hash was also checked after the run. `git diff --check` passed. Shared materializer,
parity config, capture/reference helpers and build-stamp enforcement remain unchanged against HEAD.
No foreign worktree changes were inspected or copied.

The parity lane rebuilt/stamped normally. [Preserved build stamp](../evidence/dca4-gates/scoped-assertion-build-stamp-02.json):

- Built at `2026-08-30T15:36:15.207Z`, script `web:build`.
- Input digest `6e1088af453f329fe4c9f282a60ae936e726b1b06803ad4bc83b83372558557c`.
- Output digest `043c90f5eabde8ade223303fcecd732eed8b6af5ad496d6e461a341b28dcc95f`.
- Stamp SHA-256 `a758962351282f7d3e6651aa4976a9a885d395dd075b8ee1002f0840944d62e0`.

All six original intake hashes matched their existing README before the run. The two original PNGs
remain BAD intake evidence, not new proof. No active or preserved reference file was refreshed.

## Pending / parent receive

- Parent must authorize bounded phone-control diagnosis/repair outside this released gate slot.
- The two permitted 404 mutants were **not started**: although positive decoder/abort cases passed,
  the independent phone defect requires release before any further gate. Negative controls and
  immediate restored-positive proof therefore remain pending a later allocation.
- No two-triplet refresh, direct current PNG/a11y review, scoped all-green, full coverage or full
  asserted parity is claimed. Desktop drift is attributable to prior reviewed fixture/UI changes,
  but mixed reference/non-reference red does not authorize refreshing it now.
- No commits/staging or shared materializer changes. **Ownership released; no continued gate work.**
