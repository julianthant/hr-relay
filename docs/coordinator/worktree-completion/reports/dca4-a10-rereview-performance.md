Performance re-review — sup_terra/high.

No remaining A10 affected-delta findings.

Initial finding disposition: **closed**. [run-detail.ts:918](/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4/src/server/dashboard/queries/run-detail.ts:918) now appends each origin once to a request-local array. [run-detail.ts:925](/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4/src/server/dashboard/queries/run-detail.ts:925) performs one strict projection and recursive freeze per completed artifact. This is linear in returned artifacts and origins, preserves deterministic order, complete metadata-conflict checks, and every membership. No new structural allocation/freeze cost found.

Open integration residue, not an A10 branch-local finding: [run-detail.ts:900](/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4/src/server/dashboard/queries/run-detail.ts:900) | medium | N bundles sharing an S-byte artifact still invoke full readback/byte verification N times per initial or lazy request | DCA2 must close this through the owned D291 request-local exact-reference verification seam; no cross-request cache or skipped bundle/index checks.

Count: 0 remaining A10 findings. Worst: none.  
Open integration residue: 1 medium (D291).

Frozen identity: HEAD `eda17b2708286e36542e1e18e9f8ef6a06cf3187`; index empty; checker confirmed 30 candidates, digest `1fea7985…b0b24`, protected 1840/digest `89aee037…401ca`. Final delta SHA `3b6068b0…ba6a`; isolated repair SHA `24a006e5…9838`; roadmap `3388956a→b6e9b038`.

Limits: static read-only review; repair controls and prior receipts inspected but no tests, gates, browser, build, or measurements rerun. Browser acceptance and D291 N×S remain open.
