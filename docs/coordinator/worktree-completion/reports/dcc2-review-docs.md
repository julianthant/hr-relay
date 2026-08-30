# DCC2 review — Docs

Pinned candidate `d8bf813e71925756f1f238dd142886410ba3e5ff`, base `13175b13340fec7b5326207fe54f98078d481d7d`. Independent result; fix is shared diagnostic boundary implementation plus accurate normative wording, not weakening redaction claim.

STATUS: complete — 1 Docs-axis finding  
ROLE: sup_luna_dcc2_review_docs  
MODEL: sup_luna; high reasoning  

REASONING:  
docs/rebuild/reference/dashboard-surfaces.md:1413 | medium | Claims caught parser errors are not wire messages, but target `storage-doctor.ts:598-606` places `message(error)` into `unavailable.cause.summary`, which `queries/storage.ts:30-48` serves through the wire; the schema only rejects full UCPath IDs. This is a documentation-contract regression, not a newly introduced leak (baseline already exposed malformed details). | Sanitize parser causes to code/basename-only output before retaining the claim, or revise the claim to match implementation.

Count 1 / Worst medium.

COMMITS: none (read-only)  
FILES: Reviewed target diffs for `AGENTS.md`, clock-config-secrets, dashboard-surfaces, frontend-backend-integration, roadmap, and generated roadmap index.  
GATE: Not run; explicitly prohibited.  
SCOUTS: none  
NOTES: Pinned target and baseline used exclusively; no mutable candidate sources, runtime gates, external state, or writes. Roadmap/index coherence otherwise matched.
