# DCA4 D291 Archive adaptation — final supervisor report

## Outcome

The bounded D291 receive and Archive adaptation is complete and stopped, with focused tests and all
required light gates green. DCA4 now uses the D291 server-verified reader, single-use verified-byte
lease, response ownership, request cancellation, and HTTP shutdown lifetime semantics received by
intent from DCA2. Archive keeps its own frozen-run authority, complete artifact identity, missing / purged /
resource state distinctions, multi-origin presentation, and A8 mounted-consumer accounting.

No browser, parity, coverage, reference update, staging, commit, merge, cleanup, live HR action, or
root authority reconciliation occurred. The worktree remains an intentionally dirty aggregate of the
previously received A5–A10 work plus this D291 delta.

## Source receive and adaptation

The receive was pinned to these source authorities:

| Authority | SHA-256 |
|---|---|
| coordinator DCA2 receive | `3d154d88320bff11335e40ba28d3cded0eb5e62cc29a181fc33cd9c785df4d5d` |
| DCA2 D291 source report | `4626209f1dd0ef5dffc0266164ea8f831ce15d5a6fc9e2745cd754ee8db10714` |
| DCA2 stopped handoff | `f3a87a62570ff41d8a2cfbb413b5d060d0122a8b298865dd49f99672909520c5` |

Received by intent:

- the server-verified artifact reader and opaque disposable lease;
- private unlinked scratch preparation with digest, byte-count, media-type, and encoded-content proof;
- verify-only and fresh selected-response passes without reusing first-pass proof;
- response-owned disposal for GET, eager disposal for HEAD / refused Range, request abort propagation,
  and awaited HTTP shutdown cleanup;
- the exact shared query/error taxonomy and direct tests required by DCA4;
- fixture HTTP routing for generic artifact, exact bundle attachment, and exact Archive run/artifact
  resources, including PNG, JPEG, and data bytes without a broad catch-all or fixture fallback.

Archive-specific adaptation:

- availability binds the complete frozen Archive artifact ref to the requested run and artifact;
- the selected response prepares a fresh `ArchivedCaptureLease` for that exact ref;
- the dashboard client rejects a valid but foreign response `(runId, artifactId)` before use, without
  including the foreign values in its failure message;
- the real production reader and Node HTTP adapter prove exact Archive bytes and disposal after client
  disconnect;
- generic and bundle profiles cannot inherit Archive-only `Content-Disposition` behavior;
- lease-returning helper names expose ownership: `prepareVerifiedArtifactLease`,
  `prepareDiagnosticArtifactLease`, and `prepareArchivedCaptureLease`.

The fixture `Response` byte-body typing issue is closed with a safe copied `ArrayBuffer`; there is no
unchecked assertion, PNG substitution, materializer change, or fixture success fallback.

## Tests and gates

Every Vitest command used `VITEST_MAX_WORKERS=1`; full-repo typecheck and lint used the shared
`/usr/bin/lockf -k -t 45 /tmp/hr-worktree-light-gate.lock` lane.

| Proof | Result | Durable receipt |
|---|---|---|
| client foreign identity red | intended `2 failed / 1 passed` | `evidence/dca4-d291-client-identity-red.log` |
| client foreign identity green | `3 / 3` | `evidence/dca4-d291-client-identity-green.log` |
| real reader + Archive HTTP | `44 / 44` after the retained cleanup-first red | `evidence/dca4-d291-archive-real-http-02.log` |
| review repair matrix | `184 / 184` | `evidence/dca4-d291-review-repairs-01.log` |
| final naming-affected matrix | `4 files / 181 tests`, exit 0 | `evidence/dca4-d291-final-naming-01.log` (`d767826b9b55d02576f97b7de574d2eca0a285305fe73ff8717d98fd0f858da9`) |
| first final focused launch | `14 files / 308 tests` passed; two architecture suites stopped at the declared missing default sibling legacy path before collection | `evidence/dca4-d291-focused-matrix-final.log` (`d915fa8816c60a3c45b716f6521f8dab961c050d986a4bb8178ef65fc17a82df`) |
| same 16-file focused matrix with authorized `HRAUTO_LEGACY_REPO` | `16 files / 384 tests`, exit 0 | `evidence/dca4-d291-focused-matrix-final-legacy-override.log` (`5221dbfb4b1e3e24e81c371013980b2d1859d0438d3c08c0d5fbf15b49eb9074`) |
| locked full typecheck | exit 0 | `evidence/dca4-d291-typecheck-final-naming.log` (`ffac772e97ce1b0aeb0f982c7ba9630aa798a27a12a6706d40b50bdb86f64036`) |
| locked full lint | exit 0 | `evidence/dca4-d291-lint-final-naming.log` (`cfb3a35a240932c8cf36ee05be81eca1cb9e8bee2e2516b0ca6ee56a8d482385`) |
| build manifest regeneration | exit 0; generated manifest unchanged | `evidence/dca4-d291-build-manifest-final.log` (`4c881ebbb1fe41db46be8dd58981514fcdb8c921e48b657da0018843dc0df8ad`) |
| roadmap freshness | exit 0 | `evidence/dca4-d291-roadmap-check-final.log` (`5f1fc3bf701099ca19ea3a53dbb9c5f686c1f79210542607773331a523270f37`) |
| whitespace check | `git diff --check`, exit 0 | terminal receipt |

The missing-default-sibling receipt is preserved as a setup failure, not represented as a semantic
test red or a green. The same exact matrix passed after supplying the repository-declared legacy path.

## Independent review disposition

The first review wave found three bounded issues, all repaired:

1. strict client identity did not reject a foreign valid Archive response;
2. the production reader + real Node HTTP Archive lifetime was not directly exercised, and generic /
   bundle profiles lacked a negative Archive-only header assertion;
3. lease ownership was hidden by byte-oriented result/helper names, while the nearest lesson still
   described a standalone buffer.

Spec, correctness, silent-failure, and tests re-reviews returned no findings after repair. Performance,
docs, and security review found no further bounded issue. The final independent standards review is
PASS with no findings and is preserved at
`evidence/dca4-d291-final-standards-review.md`.

## Frozen D291 identities

```text
6e7e2116483fd4b8cbb5788a581cc578c4f22344cc171a263291049241926de7  AGENTS.md
dc8c63bb5db03a7e86d7823a3158f140646665f3a46bca788f104da17d647d5d  src/infra/artifacts/server-verified-artifact-reader.ts
6cd5604e407f320ad7ca6b50bc29217fe213917f10d39bf29d96ffa5a9cdd0ed  src/server/dashboard/routes/verified-byte-response.ts
a30e46afbc617ba7273a9f1130d96212ea7fa5679c026d6c1b692ea79409751c  src/server/dashboard/http-server.ts
aba95d1c0d49611537646a1afd9cec518404065c7d0068dd9a97dfa83f5dc23b  src/server/dashboard/queries/artifact-bytes.ts
ea3914a2e81d6d71f257849047a1377918c054dead939bf258780249430c8252  src/server/dashboard/queries/diagnostic-bundle.ts
aed72a9ca3f0e5bef95dc4e53d84d2c184721a7fd11189d085f3604335fe3aca  src/server/dashboard/queries/run-detail.ts
ec61a91dbbcedc63a5410ee40d4a6f7e2d42617f1ccbc89c96f713452fcef046  src/server/dashboard/queries/archive.ts
8bad945f5199dd2b730f489f7ddd5c920cb606a50ab7943f7328f19346dc3f0b  src/server/dashboard/routes/api.ts
d8e474eca2955c8b371c06ed8ee152ee627cce19a36dd56c97919733421e43c3  src/server/dashboard/routes/failure-status.ts
165751b7493317f6d92e845a4a280ea3117dc5e72cd470cb7b0fe201aa1a82e9  src/server/dashboard/compose.ts
294d24f04d20bb5d2ded31555b3e947b6202e05d4e308975a37677a1fbf7a99e  src/server/failures.ts
7b32fcd72d3a8d1388d917c040d68932e3f60c11e2c9fea17e06e5c84b9b4c47  src/dashboard/client/queries.ts
0ee532a2bf7161e70924a52f3614c2b92494fc101c52e862813c7cfdc3c3b47f  tests/parity/helpers/fixture-bff.ts
851b3bad8284ea9e2da9ca2d150f884e4562e5056c45c2a5996fc9502a35a5d7  tests/parity/helpers/fixture-day.ts
d06d8ad53cb218533c5f00b0c0832756d2562f09320855a03954f7467990aa87  tests/parity/helpers/diagnostic-jpeg-fixture.ts
04252c743d7ac57d65e1ab33e32bc8bcab491408b3473e4ed63dfc4c1892e9cf  tests/unit/infra/server-verified-artifact-reader.test.ts
31c8fb9d1642182514f8e9954a107d6cc066f3073d78ae93c7be6b43972c9e2d  tests/unit/server/verified-byte-response.test.ts
489473b3384b50b05af25283a50be4a65a567df111fa77b6bc585f53490b2336  tests/unit/server/dashboard-http-server.test.ts
90896f2275fe563485606a6382a1e810d88a14857c07cd27857d243baeb11d94  tests/unit/server/diagnostic-bundle-readback.test.ts
52ea2abd08eab5401de68577cf5be79a8a062bff4ad48cf8a04ae3bb9f75142b  tests/unit/server/failure-status.test.ts
a5c8c8f1a2dbd58a19beb0e9b9c110e6a4544db3998976d10cd94f42e2cfe7eb  tests/unit/server/bff-flow.test.ts
5b247b18e76187ff1b4989aa40ae2df8519b84814eb38f5d87142cf17a6fc1d8  tests/unit/server/run-detail-captures.test.ts
3a5b6a5fef30b22b5a0a685e1a8c5774eb5fd388cfe4de585e1358968269b0c2  tests/unit/server/archive-capture-resource.test.ts
35c11e062534721c2bb222ea0c85488d6ffb13d526e9726abde3ef60e748820d  tests/unit/server/archive-capture-routes.test.ts
03ff45d1dfc950b62f23d58b06bbb518391cd00c9c433fb3d13d1b5336bee531  tests/unit/dashboard/archive-capture-resource-client.test.ts
eb90de91185479944208acff7b311248c9162e639b5d625500af4ebc6770c399  tests/unit/dashboard/diagnostic-bundle-client.test.ts
c019512f43b01aa1e685330f1a86cb39bd71571cb92d3435c226da6190e862d0  tests/unit/dashboard/diagnostic-fixture-http.test.ts
61aa88751464f01106ac34db39fa9792f37c32480170ec491cfe4abf2cdc1d1f  tests/unit/dashboard/archive-evidence-fixture.test.ts
1231018c86497e39ebce33d41e50d5175af319e854ee3dcd0b395b0be4750463  tests/unit/dashboard/run-captures-fixture.test.ts
d69d69e5fda20816f2b3c416190409407d066700254a119f937dbe2bb11e1d3a  tests/unit/architecture/wire-connectivity.test.ts
70a6492d38b80d864ebb51958ac7807509ae44f5fc54dfa7cb8d6f6aa8ba1e0b  tests/unit/architecture/redaction-surface-scan.test.ts
```

Git state at freeze:

- branch: `feature/dca4-archive-evidence`
- HEAD: `eda17b2708286e36542e1e18e9f8ef6a06cf3187`
- index: empty
- commits created: none
- all other dirty and untracked A5–A10 / Archive paths are preserved; this report does not relabel
  those inherited changes as D291 work.

## Remaining coordinator-owned boundaries

- receive this stopped DCA4 aggregate together with the stopped DCA2 D291 aggregate and reconcile the
  shared fixture-BFF/JPEG delta by intent;
- reconcile D291/D292/dashboard-surface/root-plan authorities in their owning root checkout;
- allocate and run the joined browser, full coverage, and asserted parity gates on the final integrated
  identity; current focused/light receipts do not certify those gates;
- decide staging, logical commits, integration, worktree removal, and branch cleanup only after the
  joined candidate is accepted.

Historical DCA4 browser and gate receipts remain preserved evidence; none is promoted into acceptance
for this newer D291 identity.
