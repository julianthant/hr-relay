# DCA4 heavy-gate readiness — 2026-08-30

Disposition: explicit heavy slot allocated after DCA2 released. Not final acceptance.
Source: `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`.

| Claim | Classification | Coordinator evidence |
|---|---|---|
| HEAD remains eda17b2708286e36542e1e18e9f8ef6a06cf3187 | proved | git rev-parse HEAD |
| Tracked UI diff54895c9b4210a5444cd9bdb9dbf02ef4be56f8562329bc5f9e882c31875c1f44 | proved | Reproduced seven-path binary diff hash from A3 repair receipt |
| Backend diff19f0a93825bda594f033e24135b65667ac536a931bba11450eb438f284e37c6f | proved | Reproduced six-path backend/doc binary diff hash from A2 receipt |
| Four new UI files and two backend test identities | proved | SHA256 matched A3-repair/A4 receipts; values below |
| Final static review findings closed | review evidence verified | Read individual UI Correctness/Silent/Security/Performance/Tests/Standards/Docs and Spec reports plus A4 ledger; runtime geometry remains unproved |
| Final comment-only change preserves emitted behavior | supervisor proof recorded | Docs report records identical comment-stripped emission565c751d…dcc0e and same-reviewer final closure; coordinator did not rerun transpilation |
| Parent151 focused tests and full locked typecheck/lint0 | supervisor gate receipts | A4 ledger and A3-repair exact command/session records; not rerun by coordinator |
| Roadmap current; manifest unchanged; diff whitespace clean | proved | Coordinator roadmap:check0, manifest path diff0 and diff --check0 |
| Shared materializer unchanged | proved | Exact artifact-bytes.ts diff0 |
| Six inherited reference/provenance files preserved | inventoried, supervisor byte proof | Intake README records six digests and files exist; final cleanup must retain them |
| Browser/coverage/full parity | residue | Still unrun at allocation; existing inherited broken images are not accepted references |

New file content hashes:

- archive-evidence.spec.ts: `7ad10d2f52012775228411cad869c96dd1195edcb8fbee4cf70e56e4017b12d0`
- fixture-archive-evidence.ts: `3877360ad3540f5579a47c4f4e88be8c366b29332895f4772c53145474792757`
- archive-capture-resource-client.test.ts: `24d91d3aba1b7d22748ac61c6d7ed944fa0b7b8e7c81b9382be464f34e8aeb4f`
- archive-evidence-fixture.test.ts: `1c9dd28762e252ff3108ba933de010fb8399d7e64dbe17d4576dffd5b4688017`
- archive-capture-resource.test.ts: `6853648c074d7f97eae16d83a7f04dccfef4b838ed5879b62e3c4a6d801d1907`
- archive-capture-routes.test.ts: `e0d7d28094586d8adcebc5612820d5d3da8ccffb60badfca6b06a5eb55092a30`

Allocation: scoped11-case Archive parity first, attributable two-triplet update only if needed,
direct PNG/a11y review and assertion, then full coverage/full asserted parity. Existing OS heavy
lock remains mandatory; any non-reference browser failure/source repair pause immediately releases
the logical slot. No hidden normalization, masks/threshold changes or fixed-port workaround.
No commits before required gates; no source-tree removal or shared integration authorized.
The future dca-shared-bytes repair and migration decision remain unresolved integration residue.
