# DCA4 A5 parent receive — explicit loading

2026-08-30. Frozen working diff at HEAD `eda17b2708286e36542e1e18e9f8ef6a06cf3187`.
Parent read complete writer receipt, isolated three-file +12/−0 patch, actual DOM and unchanged
ratchet red logs; rehashed all three files/spec/patch and UI aggregate. Writer closed before review
or parent gates; no staging/commits. Fullcoverage05 remains historical red, fullparity unrun.

## Independent affected reviews

Standards — native sup_luna `01a05310-bd69-7630-93b1-88c6c475c29e`, high, read-only.
Explicit native loading attribute satisfies unchanged JSX rule; existing actual-render harness and
nearest lesson preserve decode ownership/no exemption. Reproduced isolated patch from saved originals.
Count: 0 · Worst: none.

Tests — native sup_luna `01a052ff-4062-7b32-b0ba-4c6d27bbec85`, high, read-only.
Actual mounted image is independently checked against literal eager at archive-render.test.ts:419;
omission/lazy fail and absent image throws. Raw null-vs-eager red and identical green verified,
corrected five-file82-test result distinguished from earlier filename typo. No mock or weakened assertion.
Count: 0 · Worst: none.

Both reviewers matched HEAD, three file hashes, UI aggregate and patch. Both are now closed.
Other axes are not repeated for this bounded default-preserving declaration: no state/identity/error,
security, sizing/layout or resource-lifetime behavior changed; existing broader A3/A4 reviews remain
historical. The five-line lesson explains only the guard/regression and adds no product contract.
No simplification: one production attribute is already the minimum implementation.

## Parent proof

Every command used assigned absolute workdir; direct pipefail+tee logs preserved.

| Command | Session / terminal / result |
| --- | --- |
| `VITEST_MAX_WORKERS=1 HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test -- tests/unit/dashboard/archive-render.test.ts tests/unit/architecture/guard-manifest.test.ts` |76793 /9b2270 /exit0;47tests2files,6.53s,09:36:25PDT |
| `/usr/bin/lockf -k -t45 /tmp/hr-worktree-light-gate.lock npm run lint` |56535 /e62ad4 /exit0, no diagnostics |
| `git diff --check`; materializer diff; index diff |all empty/exit0 |

Logs `evidence/dca4-gates/loading-parent-{tests,lint}.log`. Tests log SHA256
`1187fb2fa6f0cdefbd6415c7521b0c9a5eb2e22cc9c8b6a0f492120245cfe94c`.
Native full lockedtypecheck/lint and actual red→green receipts retained in dca4-a5-image-loading.md.

Reproduced UI7 `3c89958afe63d1b8c0b5b8e8d01fffff25e94d89a2cbbc517ec7b799cdb4d461`;
isolated delta `be50b42e0b50854b71e307aedf207a50ae0a7e756bb0d8fe83cf55db2900c381`.
Spec remains exact `e2c03cb1480d144a4e889e52e98f4dc302bcb4c51fa16042bd448ba35bbac1c0`.
No browser or timing claim; no heavy allocation. A6 receives the sole writer/light lane next.
