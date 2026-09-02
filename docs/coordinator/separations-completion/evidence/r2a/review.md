# R2a review

Target: `git diff HEAD -- vitest.config.ts AGENTS.md CLAUDE.md` at base `85d3b082`; exact patch retained losslessly as `review-target.patch.gz`. Only four config lines plus documented runner rule and preserving the pre-existing D308 lesson in its missing twin. Supervisor performed the consequential scheduling judgment. No worker was dispatched: this config-only seam's acceptance is the real full gate; a detached implementation/reviewer task would not add an independent implementation seam. Coordinator also inspected the exact diff and confirmed scope before the final gate.

- **Standards:** `Math.min(4, availableParallelism())` bounds file forks and respects smaller hosts. Twins are byte-identical. No unrelated code change. Count: 0 · Worst: none.
- **Spec:** R2a brief permits proven scheduling only with 30-second limits/floors/assertions/membership intact. Diff changes only scheduling plus required instructions. Count: 0 · Worst: none.
- **Correctness:** Both projects inherit the root test config. `pool: forks`, `isolate: true` and both `fileParallelism: true` values remain. Existing tests that spawn concurrent work internally retain it. Node's installed API supplies an integer at least one; no zero-worker arm. Count: 0 · Worst: none.
- **Silent failures:** No catch, retry, skip, timeout extension, exclusion, fallback, failure-status remapping or coverage-floor change. The first failed experiment and focused floor failure are retained honestly. Count: 0 · Worst: none.
- **Performance:** Full unchanged corpus changed from repeated 30-second timeouts at default ten forks to 388/4,795 green at four; this supports the scheduling repair on the measured host. CPU/memory/disk contributions are not separately established. Some hosts may trade peak throughput for headroom. Count: 0 · Worst: none.
- **Tests:** No new config-value-mirroring test; the unchanged original full coverage command is the regression and failed twice before the repair. Both project globs and every coverage policy constant are unchanged. Final default command is required after config change. Count: 0 · Worst: none.
- **Docs:** Runner rationale states observed host, date and corpus and preserves rather than overwrites D308 instruction text. Count: 0 · Worst: none.
- **Security:** Skipped — no auth, input, authority, dependency or production boundary changed.
- **Simplify:** Skipped — one bounded scheduling expression; no additional abstraction introduced.

No mandatory code-review findings. Independent worker review skipped for this gate-proven configuration change; no runtime behavior/authority/write-path implementation was changed. Existing R2 parity 287/287 applies to unchanged UI and is not rerun for runner-only configuration.

The original unified diff is gzip-compressed with a deterministic header to preserve its exact whitespace without introducing trailing whitespace into the repository’s text diff. Decompressed SHA-256: `ffa4f81ef8321ff9e370c1b6e3badb0f79826ad3ee82ca4d1c903b817f46bb54`. The original bytes were verified before replacing the text artifact.
