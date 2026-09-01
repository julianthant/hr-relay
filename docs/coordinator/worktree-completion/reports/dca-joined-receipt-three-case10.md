# DCA joined Receipt three-case 10

Date: 2026-08-31 PDT

Status: the one allocated three-case browser run passed; direct PNG and accessibility review is clear; candidate remains frozen. The heavy slot was released at terminal before review. Full coverage and full asserted parity remain unrun and require a separate allocation.

## Command and result

Frozen pre-run identity:

- HEAD `eda17b2708286e36542e1e18e9f8ef6a06cf3187`
- helper `0e74acef4f223a146c8deb6e12c6255da769f6bdf0cff2b0b0edfd8fe8def764`
- spec `f24fbc41b641735da413b8ca2e3d47d517367d11f00eab38445919dd714fad69`
- 89-path non-coordination aggregate `e4a01b57b3f7876543ff95397601edc0ee096acf4fb962dab6c2dd9f74b3864d`
- index empty; `git diff --check` exit 0

Exact command, run once:

`/usr/bin/lockf -k -t0 /tmp/hr-dashboard-full-gate.lock env -u PARITY_UPDATE npm run test:parity -- tests/parity/run-captures.spec.ts --grep 'full Receipt keeps exact JPEG/data captures|coarse phone Receipt'`

Result: exit 0, three passed in 5.4 seconds:

- full Receipt exact JPEG/data/native bytes/keyboard focus: 959ms
- Paper coarse-phone short Receipt: 743ms
- Graphite coarse-phone short Receipt: 627ms

Direct raw log: `docs/coordinator/worktree-completion/evidence/dca-joined-receipt-three-case-10.log`, SHA-256 `cb8241365a55bc0081b2a59955e9cb4a6380ca2cde9c24f04bcfe570a4721e62`.

Playwright manifest: `.last-run.json` is `{"status":"passed","failedTests":[]}`, SHA-256 `91d1c43004802cd49950d78eb11c8fa7d05da8ffffe219a8b13b2f561bc00903`.

## Preserved rendered evidence

All source output and reporter attachment copies are preserved under `docs/coordinator/worktree-completion/evidence/dca-joined-receipt-three-case-10-output/`. Each reporter attachment is byte-identical to its source output counterpart.

| Evidence | SHA-256 | Direct review |
| --- | --- | --- |
| full Graphite Receipt PNG | `e4cfdeafc545a5dc4ab252165d538ad75c6596025d5261515ceac02fd4a3171f` | Receipt is selected; verified receipt and both capture tiles occupy the intended run-detail column; Workflow Panel does not cover the capture surface. |
| full Graphite Receipt a11y, 316 lines/14,269 bytes | `48ac5cd2f61006f64a5b68c7b9942fa283fc903a0beded1537a2adea6449b0e6` | Exact Run captures region contains JPEG Preview+Download then restricted data Download, exact metadata/digests/origins and native URLs. |
| JPEG Graphite dialog PNG | `4d921af4a6ad0423643604ba940781f86e5c225974efd59d1c22ddc20821aa22` | JPEG is fully contained; decoded caption occupies its own lane; metadata remains below; fixed footer exposes distinct Close and Download actions without overlap. |
| JPEG Graphite dialog a11y, 31 lines/1,141 bytes | `f3eee1b76d5c49cbabe017081d30520ccb5a32884db9dcfe5fdc3be4f6063fad` | Named dialog/banner/figure/image, “Image decoded,” exact 828-byte SHA/dimensions/origin, contentinfo Close and exact Download URL. |
| PNG Paper phone dialog PNG | `019aeef8191d8e4a9654962023895eb69f953c99a097715f449b505e56a39121` | Portrait PNG remains fully contained inside the literal failure frame; caption is separate; metadata scrolls under it; fixed footer actions fit the 390px viewport. |
| PNG Paper phone dialog a11y, 35 lines/1,422 bytes | `b67e8579b9d5905d347b48416f35f6c993895355c91621f03353397c2d5fdd05` | Named dialog/figure/image, exact 180-byte SHA/dimensions, all five ordered origins, Close and exact Download URL. |
| short Graphite phone PNG | `84fbe9bf10d1e6cfb927c78f6af96b5c621823ed16401e3a8b0f5f9db7dc5668` | Exact artifact action row is visibly inside the viewport; Preview and Download are distinct, aligned and unobscured inside the red failure frame. |
| short Graphite phone a11y, 290 lines/13,211 bytes | `0f828e0128047259d0ddb4801662a7c620cbe586480a8dbf31c01197651e222a` | Short Receipt truthfully includes No receipt plus Run captures, exact metadata, all five origins, Preview button and exact Download link. |

UI findings: 0. No clipped action, overlap, caption collision, missing image, missing origin, accessible-name loss, or native-URL mismatch is visible in the bounded evidence.

## Assertions exercised

The green command exercised, without reference updates or relaxed predicates:

- exact one-click data and JPEG native Download URL, stream, byte length and SHA-256;
- exact one-row real adapter `GET`/pathname/status 200 delta for each download;
- data Download active-element pin and real `Shift+Tab` traversal through JPEG Download to Preview;
- unchanged focus-visible/ring, Enter/dialog/decode/Escape/focus-restoration assertions;
- both phone themes' exact opener scroll, ratio-1 Preview and Download visibility, and unchanged 44px/edge/ownership/nonoverlap proof;
- Paper phone dialog decode, exact dimensions, literal failure frame and all five origins.

## Limits and preservation

- This is bounded browser acceptance for the selected three cases, not full parity, full coverage, reference acceptance, integration acceptance or commit authority.
- No reference files were read as update targets or changed; `PARITY_UPDATE` was unset.
- Diagnostic07/08 and repair09 logs, patches, outputs and reports remain untouched.
- No second browser command, source/test/reference edit, repair, full gate, stage, commit, merge, cleanup, live action or push followed.
- Post-run helper/spec hashes, index and diff check match the frozen inputs. The source candidate did not change.

## Separate full-gate readiness request

Direct review is clear and the candidate remains exact. Request a separate allocation for this sequence only:

1. `/usr/bin/lockf -k -t0 /tmp/hr-dashboard-full-gate.lock env VITEST_MAX_WORKERS=1 npm run test:coverage`
2. only if coverage is green and candidate identity is unchanged, separately locked full assertion with update unset: `/usr/bin/lockf -k -t0 /tmp/hr-dashboard-full-gate.lock env -u PARITY_UPDATE npm run test:parity`

Release immediately on any red or after the last terminal result. No automatic repair or reference update is implied.
