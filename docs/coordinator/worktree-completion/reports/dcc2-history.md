# DCC2 immutable history inventory

Source: `git log --reverse --format='%H %s' 13175b13..ac40292b` followed by `git diff --name-status 80da38158dea35f781eb69d5e682a779935f9c96 ac40292b`. Intake history has 70 branch-only commits. These are history identities, not a claim that every patch is still missing from integration.

```text
9bc5a2e562958ee2c59b3abd965e6f4b7a3b98f6 feat(preflight): compose exact rerun authority
0d0545fd3f96865ad0c4a58801cfcd5ad9811f61 fix(preflight): refuse surplus runners
ad54db66cfe34e620cc46f333a49875188d49dd4 fix(preflight): reject duplicate runner ownership
ca0531846d606c10a2b5608cb3db68713a3ea401 feat(preflight): retain bootstrap report
5120d2fee0912059f253eb5fbde7121501960526 feat(storage): diagnose missing span authority
cab1713b7331b9eaecb552fefe91f5838ecb5fe9 test(storage): pin archived and malformed diagnosis
f3700f02fdd1cae1a854a16fe094479d2ca6fe5b feat(storage): project span authority health
74f1f5007414f56839235809fb23324103e3b24b feat(preflight): serve retained bootstrap report
4c22735c8ad931160e3810d09372e0c32c280342 feat(preflight): make rerun commands idempotent
248ec5cc8d927f1eb6e86e0a977bbdf8c29cffa1 feat(preflight): add strict rerun route
84e9368902e7bf0aa531a5fde6e5bba854e61b81 feat(preflight): compose dashboard detectors
211b0ec83c05ce1cdf61d4652b1e9f8d844f9af9 feat(preflight): close bootstrap wire binding
c7c9cb36c219e545f54b00251a51d9574397c61a docs(agents): record preflight authority lesson
fa4e7148588308208d4ef685abc79087fca470ef fix(preflight): keep authority outside domain boundary
466af209f651816981c387ad70264e3d4858e5f9 fix(dashboard): secure artifact root permissions
55e6c50cedbd8c23f44028e17643a09adc5f0cf8 fix(preflight): enforce loopback rerun ingress
57dd7f83fe21b7deddd951bfea2c5fd5e895c8be fix(preflight): bound rerun request bodies
591cebf6859ae5495d0e6ab8d09a78f8d56d52c3 fix(preflight): bound rerun concurrency and rate
13beb09b6054ca7f5c68fba8913037c7d7d05e31 fix(preflight): retain failed command identity
5db771438a36dc9c999dcc0d7c1c2958b200fa2c fix(preflight): serialize authority refreshes
ba0429d5f9dad915e277b84fccb9497eafa7cd84 fix(preflight): bound immutable command retention
ffb1eab163de66b8ef87642e5ad1fcb726aca50f fix(preflight): verify owned Vite frontend
07e0c6087857ac4fd446287f4d4cf4248135115b fix(preflight): bound Vite identity responses
5d21b77f12d2c4bde08c9899cbcbc0144d153d3e fix(preflight): enforce Vite probe deadline
b2cc0176dae9687519575697dd4ea5dc328cf120 fix(storage): bound doctor authority evidence
2cae648bb6036784571a6a8f94b480b871ff3f3e docs: record hardened preflight authority lesson
f8fe8e08260a1817f03340d04e2ec089fbd2301a fix(storage): reject degraded snapshot drift
df47b787a8f1a293bb46d472ecb07e3c0ceb4f02 fix(storage): preserve exact malformed diagnosis
1172a2c4823801892e23d778ffce2e52ba7d9823 test(dashboard): keep artifact probe on ephemeral ports
768355f1185fb1eedaf2954e0282b41daffdf4eb test(dashboard): recognize preflight port contention
e2fdf4f00bc7495d5900bf15d63bec5f04cd4fad fix(preflight): require launcher-owned Vite proof
3dc0f684c42438819a97387e1e87278ff7fe6040 fix(preflight): bind Vite proof to launch identity
18e6dc0460afe17b84a361edf25fa84987c37862 fix(storage): reject symlinked span ancestors
e65dfc73c0983f9671fea010d72deac0779d0df6 feat(storage): fingerprint span authority snapshots
621cee86f1313aa2475cbc180f8b402e7eddc542 fix(storage): reject transient authority swaps
ca7613e4a935e1f76c728d8fa279511405e7e9dc docs: record preflight ownership and snapshot invariants
807ce15b117190dbba8d4e45c66d0e193b58fa98 style(preflight): normalize ownership module eof
986412a9703b10943c14d8e0ccc98595a776c8ba fix(storage): anchor span traversal to trusted directories
0c52c54dfe85e2861ad25c8a53b768c72f8572ec fix(storage): inspect authority in one read transaction
36ccec8e567a89031ed60360f09f4c9bdd980b2a docs: record trusted span and snapshot boundaries
45a47d1654e409277419c228f60e1584884245c2 fix(storage): close rejected corpus descriptors
f223d77e5051efb3384ecb7447b05008af819408 fix(storage): traverse span corpus descriptor-relatively
f27ebfafc4ad9fa22be5be65513b07b0f622d743 docs: require descriptor-relative span traversal
5ec3e3d87d5c31d1c316514e51a58dac84a7844a fix(storage): narrow directory identity stats
bbbb5bd79840193bc5bbb40180319d1b3d17a623 fix(preflight): enforce registered detector deadlines
a91cf96025528cde9bd2bc60d4f704e54e939cc0 fix(storage): reconcile complete span root authority
9ed9cbf232a904a8de0d47eda01bad91b9322af1 docs(agents): pin preflight and span authority invariants
bdeda89b7fd14512df38d8376d90445636114b01 fix(storage): retain item attempt allocation order
dd7e3d84fb1761b02c7b466ce0796c7fd07e1ad6 fix(storage): refuse erased span corpus after run birth
09e77fa3cf76760d7ea2a0cc3a7c6df5b504fb54 fix(storage): validate paired archive authority
3a4754ceec5bc6998e2f34bdb57bb22f6cc53df8 docs(agents): clarify archived span pairing
f00d71fd3f041c1514c9044d839761ae6879399b fix(storage): require terminal archive authority
1417a4769456d375a7fea8ce2d5c6fcc1b768f5e fix(storage): bind archived failure identity
5721a578c5b9917f776f86d0a9e7a8c5f2e125b1 fix(preflight): retain admission through detector settlement
eaa3a5d08caed587078094a8f239c99b6b8e40bf perf(storage): bound doctor snapshot work
141c8cf72376f7751688e551dc1e155a0b023b24 refactor(preflight): restore strict runtime boundaries
04c523cac03ca8ce8d3c64596dbff871f1a62504 fix(storage): retain strict doctor failure evidence
da7bbcc1df00322b6cb9e543281bb8f817c06171 fix(dashboard): distinguish preflight ingress failures
c1cc10871dd5e9fcdd25711bd02121b242d73461 docs: record strict preflight boundary lesson
44b162557a5dfe30843489b12e2a6a55f97bde1e docs(dashboard): reconcile DCC2 backend authority
7d00870300856d3e1b55d8e0fe2d6fcf1add88cc test(preflight): pin identity and settlement authority
1edaf238a4489e2ae0f20899855d0d3c74f62c8b test(dashboard): distinguish rerun body refusals
e97fcea870b7f5e9c89b5792d20533135cac6769 test(storage): enforce bounded span corpus
1586d98dbdba4f42bc16c78ac34e4912d78c77ae test(architecture): pin bootstrap environment ownership
731cec9ce8aacdfcc4b7f6537f0d4c32a1370671 fix(storage): serve span-stream diagnoses
5c7b994bd7247eb74c0cfea38989d175c43486a6 fix(preflight): redact runtime contract failures
02f9f9cfdd03df34969b9279ab43d13b7eb330c6 fix(preflight): redact filesystem failures
d75119a4d987aba06f94bc337cc20b2790b708e1 fix(preflight): redact process-lock failures
1c7e6f710505b24b4bfa378b3fe95e1ee4238f0a docs(preflight): record safe diagnosis boundary
ac40292b8e3e8ff9b66242bbf8f8288554335f40 docs(roadmap): reconcile DCC2 backend authority
M	AGENTS.md
M	config/pending-wire-bindings.json
M	docs/rebuild/04-close-the-deferrals.md
M	docs/rebuild/reference/clock-config-secrets.md
M	docs/rebuild/reference/dashboard-surfaces.md
M	docs/rebuild/reference/frontend-backend-integration.md
M	docs/roadmap/index.html
M	docs/roadmap/roadmap.md
M	scripts/dev-dashboard.ts
A	src/core/preflight-executor.ts
M	src/dashboard/client/commands.ts
A	src/domain/dashboard-frontend-owner.ts
M	src/domain/dashboard/bootstrap.ts
M	src/domain/dashboard/storage.ts
A	src/domain/preflight-check.ts
A	src/domain/preflight-wire.ts
M	src/domain/preflight.ts
A	src/domain/runtime-capability.ts
M	src/domain/runtime-dependencies.ts
M	src/domain/runtime-environment.ts
A	src/infra/providers/local-vite-probe.ts
M	src/infra/sqlite/authority-database.ts
M	src/infra/sqlite/authority-health-runner.ts
M	src/infra/sqlite/index.ts
M	src/infra/sqlite/recovery-contracts.ts
M	src/infra/sqlite/runtime-process-locks.ts
M	src/infra/sqlite/storage-doctor.ts
M	src/server/dashboard/compose.ts
A	src/server/dashboard/frontend-owner.ts
A	src/server/dashboard/preflight-authority.ts
A	src/server/dashboard/preflight-runners.ts
M	src/server/dashboard/queries/bootstrap.ts
M	src/server/dashboard/queries/storage.ts
M	src/server/dashboard/routes/api.ts
M	src/server/storage/compose.ts
A	tests/fixtures/preflight-seams.ts
M	tests/parity/helpers/seeded-bff.ts
M	tests/unit/architecture/helpers/redaction-surface-audit.ts
M	tests/unit/architecture/provider-capability-boundary.test.ts
M	tests/unit/architecture/runtime-environment-coverage.test.ts
M	tests/unit/architecture/storage-recovery.test.ts
M	tests/unit/architecture/strict-boundary-schemas.test.ts
M	tests/unit/preflight-runtime-dependencies.test.ts
M	tests/unit/server/bff-flow.test.ts
M	tests/unit/server/bootstrap-start-surface.test.ts
M	tests/unit/server/bootstrap-storage-arms.test.ts
M	tests/unit/server/capture-surface.test.ts
M	tests/unit/server/compose-real-port.test.ts
A	tests/unit/server/preflight-runners.test.ts
M	tests/unit/server/worker-pool-composition.test.ts
M	tests/unit/server/worker-pool-parallel-proof.test.ts
M	vite.dashboard.config.ts

```

