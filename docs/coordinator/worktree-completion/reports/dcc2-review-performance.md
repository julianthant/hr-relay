# DCC2 review — Performance

Candidate `d8bf813e71925756f1f238dd142886410ba3e5ff`, base `13175b13340fec7b5326207fe54f98078d481d7d`. Independent axis result; validation/disposition pending.

STATUS: COMPLETE  
ROLE: sup_terra performance-only reviewer  
MODEL: GPT-5  
REASONING: Pinned candidate `d8bf813` vs `13175b`; read-only inspection only.

src/infra/sqlite/storage-doctor.ts:653 | medium | Per-malformed-record `resolutions.some(...)` makes reconciliation O(malformed authority rows × roots); roots cap at 10,000 while malformed rows are streamed but unbounded. | Pre-index malformed resolution identities in a `Set` before filtering.

src/infra/sqlite/runtime-process-locks.ts:877 | medium | Each selected `process.orphans` preflight materializes, sorts, parses, and scans the entire append-only worker-lock history; its cost grows without bound across worker restarts. | Use a strict bounded current-owner summary for preflight; retain exhaustive history validation for restore.

COMMITS: none  
FILES: none modified  
GATE: not run—temporary host resource hold prohibits gates  
SCOUTS: none  
REVIEW-HINT: Preserve D282’s complete diagnosis semantics while removing the quadratic dedupe.  
NOTES: Count 2 · Worst medium. Span corpus bounds and the 256 retained-command limit are present; no tests or runtime probes were run.
