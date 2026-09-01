# DCA4 D291 review-repair target

This is the narrow second-review target after the findings against `dca4-d291-review-target.md`.
HEAD remains `eda17b2708286e36542e1e18e9f8ef6a06cf3187`; index remains intentionally empty.

Repairs:

- bind a strict archived-resource response to the exact requested run/artifact pair at the client query boundary;
- add real production-reader + node HTTP Archive exact-byte and disconnect/lease cleanup tests;
- reject Archive-only content disposition on generic/bundle profiles;
- rename lease-returning internal result types/functions so disposal ownership is explicit;
- update the two A8 foreign-response controls for the earlier client-boundary refusal.

Exact current identities:

```text
7b32fcd72d3a8d1388d917c040d68932e3f60c11e2c9fea17e06e5c84b9b4c47  src/dashboard/client/queries.ts
4f4fe15605f4ddb4819ed395f035c4a3a0e1a39ba7380785e8985b85aa1229ec  src/server/dashboard/queries/artifact-bytes.ts
3dfd84e1c517e01ed04823d9cb2883b0508ad23693287072779c997c0d2f7ee0  src/server/dashboard/queries/archive.ts
50934a4e7bbd7275c7b40118345515a8501dd78006e44e6ac5c0753136760814  src/server/dashboard/routes/api.ts
03ff45d1dfc950b62f23d58b06bbb518391cd00c9c433fb3d13d1b5336bee531  tests/unit/dashboard/archive-capture-resource-client.test.ts
8adaba6cd68bda7a5bb0237e08b9441b4c1cdb48a66d18aa250cfbceb027d3bf  tests/unit/server/archive-capture-resource.test.ts
35c11e062534721c2bb222ea0c85488d6ffb13d526e9726abde3ef60e748820d  tests/unit/server/archive-capture-routes.test.ts
5e9eadade7eb3f4f371eff7a477f889a1493709d72ba8d09ade8fa31f4c45d29  tests/unit/server/diagnostic-bundle-readback.test.ts
a5c8c8f1a2dbd58a19beb0e9b9c110e6a4544db3998976d10cd94f42e2cfe7eb  tests/unit/server/bff-flow.test.ts
d69d69e5fda20816f2b3c416190409407d066700254a119f937dbe2bb11e1d3a  tests/unit/architecture/wire-connectivity.test.ts
```

Evidence: `dca4-d291-client-identity-red.log` (2 intended failures), `dca4-d291-client-identity-green.log` (3 pass), `dca4-d291-archive-real-http-02.log` (44 pass), `dca4-d291-focused-matrix-03.log` (384 pass), final locked typecheck/lint exit 0, manifest unchanged and roadmap fresh.

Review is read-only; no gates, edits, staging, commits, or external mutations.
