# DCA4 D291 frozen review target

- Worktree: `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`
- Branch / HEAD: `feature/dca4-archive-evidence` / `eda17b2708286e36542e1e18e9f8ef6a06cf3187`
- Originating brief: `/Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/worktree-completion/briefs/dca4-d291-archive-adaptation.md`
- Inspection: `git diff HEAD -- <paths below>` plus direct inspection of untracked paths. The diff also contains the already-received A5–A10 candidate; findings must be limited to D291 behavior and its direct consequences.
- Focused receipt: `dca4-d291-focused-matrix-01.log` — 15 files / 379 tests / exit 0.
- Locked typecheck: `dca4-d291-typecheck-02.log` — exit 0.
- Manifest regeneration: exit 0 and no generated-manifest diff. Roadmap check: exit 0.

## Exact current path identities

```text
dc8c63bb5db03a7e86d7823a3158f140646665f3a46bca788f104da17d647d5d  src/infra/artifacts/server-verified-artifact-reader.ts
6cd5604e407f320ad7ca6b50bc29217fe213917f10d39bf29d96ffa5a9cdd0ed  src/server/dashboard/routes/verified-byte-response.ts
a30e46afbc617ba7273a9f1130d96212ea7fa5679c026d6c1b692ea79409751c  src/server/dashboard/http-server.ts
ba450c8c3254219a942d99eb58d9e1b707603c3280f0fff028c719d92a590d66  src/server/dashboard/queries/artifact-bytes.ts
808cb077bd89ed131048e2b0ef4a501f304fa3aa658cda054ee2ea1278bc2ec1  src/server/dashboard/queries/diagnostic-bundle.ts
aed72a9ca3f0e5bef95dc4e53d84d2c184721a7fd11189d085f3604335fe3aca  src/server/dashboard/queries/run-detail.ts
5d66cfd690c6a7197b96c7a418893932bf41fa5f83416ecce51b174d93e4a8d3  src/server/dashboard/queries/archive.ts
7d0e028936269a5197fe267dc336d74e1e1b07b2d01f0e1da9044fa2f3b0c26a  src/server/dashboard/routes/api.ts
d8e474eca2955c8b371c06ed8ee152ee627cce19a36dd56c97919733421e43c3  src/server/dashboard/routes/failure-status.ts
165751b7493317f6d92e845a4a280ea3117dc5e72cd470cb7b0fe201aa1a82e9  src/server/dashboard/compose.ts
294d24f04d20bb5d2ded31555b3e947b6202e05d4e308975a37677a1fbf7a99e  src/server/failures.ts
4a042347173e0eb61d7715fc027a0679df62791e5a89bce2a57ee2b6a75e353c  src/dashboard/client/queries.ts
0ee532a2bf7161e70924a52f3614c2b92494fc101c52e862813c7cfdc3c3b47f  tests/parity/helpers/fixture-bff.ts
851b3bad8284ea9e2da9ca2d150f884e4562e5056c45c2a5996fc9502a35a5d7  tests/parity/helpers/fixture-day.ts
d06d8ad53cb218533c5f00b0c0832756d2562f09320855a03954f7467990aa87  tests/parity/helpers/diagnostic-jpeg-fixture.ts
04252c743d7ac57d65e1ab33e32bc8bcab491408b3473e4ed63dfc4c1892e9cf  tests/unit/infra/server-verified-artifact-reader.test.ts
31c8fb9d1642182514f8e9954a107d6cc066f3073d78ae93c7be6b43972c9e2d  tests/unit/server/verified-byte-response.test.ts
489473b3384b50b05af25283a50be4a65a567df111fa77b6bc585f53490b2336  tests/unit/server/dashboard-http-server.test.ts
b0d02fdbe0762d85917ef4ba1cbddc39882395d8e7151118b8140f0453252ef3  tests/unit/server/diagnostic-bundle-readback.test.ts
52ea2abd08eab5401de68577cf5be79a8a062bff4ad48cf8a04ae3bb9f75142b  tests/unit/server/failure-status.test.ts
792838c1272524fd28631b7f21a1e98251fab119af7966aba9201b212ba485a9  tests/unit/server/bff-flow.test.ts
5b247b18e76187ff1b4989aa40ae2df8519b84814eb38f5d87142cf17a6fc1d8  tests/unit/server/run-detail-captures.test.ts
7189afc996d430536dbc083293292562468ed2b3c302ce08211a3f19627eb23b  tests/unit/server/archive-capture-resource.test.ts
202f122ea1a58f37927daf0d3db0e979f963dfd58ea90ddd038d55f9235ce023  tests/unit/server/archive-capture-routes.test.ts
eb90de91185479944208acff7b311248c9162e639b5d625500af4ebc6770c399  tests/unit/dashboard/diagnostic-bundle-client.test.ts
c019512f43b01aa1e685330f1a86cb39bd71571cb92d3435c226da6190e862d0  tests/unit/dashboard/diagnostic-fixture-http.test.ts
61aa88751464f01106ac34db39fa9792f37c32480170ec491cfe4abf2cdc1d1f  tests/unit/dashboard/archive-evidence-fixture.test.ts
1231018c86497e39ebce33d41e50d5175af319e854ee3dcd0b395b0be4750463  tests/unit/dashboard/run-captures-fixture.test.ts
c323354e144bdd553ad98d0c22dde01e2161f23a1e2136708e9977592bcda64f  tests/unit/architecture/wire-connectivity.test.ts
70a6492d38b80d864ebb51958ac7807509ae44f5fc54dfa7cb8d6f6aa8ba1e0b  tests/unit/architecture/redaction-surface-scan.test.ts
```

No reviewer may edit, stage, commit, run heavy/browser gates, or inspect a different worktree as a substitute for this target.
