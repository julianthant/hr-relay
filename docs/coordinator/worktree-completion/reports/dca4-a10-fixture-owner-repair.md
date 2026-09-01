# A10.4F fixture bundle ownership repair

Status: complete and frozen; writer/light ownership released. No command remains active. No commit, production/UI-oracle edit, browser, build, parity, coverage, or reference update.

Changed only:

- `tests/parity/helpers/fixture-run-captures.ts` — done-run JPEG/data now share their own operator-request bundle `…b201`; failed-run `…b101`–`…b105`, artifact IDs, bytes, metadata, routes, and scenario remain unchanged.
- `tests/unit/dashboard/run-captures-fixture.test.ts` — real ephemeral HTTP traverses both run sections, pins exact tuples, enforces global bundle→one-run ownership, and preserves valid same-run sharing.
- `src/dashboard/AGENTS.md` — dated D292 fixture-ownership lesson.

Patch: `evidence/dca4-a10-fixture-owner-delta.patch`, SHA256 `a3b1767ba1b452d9c6db767f7c22622b983c39bd89ef1da0558858e821243b22`, +47/−1. Final scope hashes: fixture `b300ee0493d93bde2fc1d07a7f1760ee22a858cf43ed4cc43dffc09630bed695`; test `1231018c86497e39ebce33d41e50d5175af319e854ee3dcd0b395b0be4750463`; AGENTS `a2f6f1012e1b0df838f735fff20e64577092ad38fc1088b017b0ac68f81db676`.

Proof: red session 99966 exit1 named cross-run `…b101` (9 existing tests passed); green 4400 exit0, 10/10; related 7160 exit0, 28/28; locked typecheck 92642 exit0; locked lint 91301 exit0. Raw hashes/commands/times/chunks: `evidence/dca4-a10-fixture-owner-gates.json`.

HEAD/index remain `eda17b…`/empty. Candidate began `25975726…`. Protected 1,867 non-coordinator paths remain digest `9aaed7814926c2a43d0a9063f8d8195d4328b59ccf0d24905675b87e40d3d8f6`. Coordination-wide immutability is not claimed: parent concurrently added the oracle/docs repair briefs and updated the main A10 report. Final identity and disclosed receipt diagnostics are in `fixture-owner-final.json` and `fixture-owner-observations.json`.
