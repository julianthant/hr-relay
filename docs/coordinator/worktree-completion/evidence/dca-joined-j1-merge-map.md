# DCA joined J1 merge map — native return

Task: `sup_scout_j1_dca_aggregate_merge_map`

Agent: `01a0586b-e7ff-70d0-a455-631d32da9166`

Role: `sup_scout` (Luna, high)

Status: COMPLETE — read-only map; no edits or tests.

Both stopped candidates share HEAD `eda17b2708286e36542e1e18e9f8ef6a06cf3187`, are zero commits ahead, and had empty indices. Product/test/docs inventory:

- shared-identical: 21 paths, manifest `0a9e2c46335b210505071d35bef8df0b856b8285c1eb9c4f2539a6ce6a12f66c`;
- shared-divergent: 25 paths, manifest `4d795f3b98ef72fe8c5e81680ca12cd6c1145b2e3b315d70d0725906f776d1ce`;
- DCA2-only: 18 paths, manifest `d966fd5d358d8b942982b89777f8c341534b31b244c251ceb559e169d02d561a`;
- DCA4-only: 23 paths, manifest `36c937417c239d44c9b29a43f7c47be7b8cce58e60282bbc2f3f0875521c1ab6`.

The DCA2-only paths are the Gallery/Receipt surfaces, trust changes, dialog/origin helpers, six references, and four tests. The DCA4-only paths are the Archive surfaces/domain/query, Archive docs, evidence fixture/spec/references, guards, and seven tests. Fifteen tracked shared-divergent files have same-line overlap. The important shared conflicts are:

- synchronous run-detail optional omission versus live explicit absence;
- DCA2 status/touch semantics versus DCA4 run-capture formatting;
- documentation and fixture API differences caused by distinct serving capabilities.

The scout found no irreconcilable owner conflict. Preserve DCA4's Archive two-ID routes and guards, DCA2's generic and exact-bundle routes, and union fixture HTTP/JPEG behavior, request-lease behavior, run-capture authority, and tests. Unique product/test paths are safe mechanical receives. The byte reader (`dc8c63bb…`), response owner (`6cd5604e…`), and JPEG fixture (`d06d8ad5…`) are byte-identical.

`git diff --check` exited 0. No tests or gates were run by this scout.

Receive provenance: DCA2 receive `3d154d…`, source report `4626209f…`, handoff `f3a87a62…`; DCA4 receive `15e1720d…`, source report `78667d36…`, handoff `e7898319…`. Embedded hashes matched direct SHA-256.

Historical note: the scout observed current board SHA `771a17df…` while source reports retained historical `80d0dfdc…`; this read-only return does not infer drift from that difference.
