# DCC2 review — Security

Pinned candidate `d8bf813e71925756f1f238dd142886410ba3e5ff`, base `13175b13340fec7b5326207fe54f98078d481d7d`. Independent result, supervisor confirmed raw spanPath interpolation reaches diagnosis serialization; correction requested.

STATUS: Reviewed — one Security finding.
ROLE: sup_sol_dcc2_review_security
MODEL: native sup_sol
REASONING: high
COMMITS: None; read-only.
FILES: 44 changed paths; pinned d8bf813e71925756f1f238dd142886410ba3e5ff against baseline 13175b13340fec7b5326207fe54f98078d481d7d.

src/infra/sqlite/storage-doctor.ts:484 | medium | A schema-valid `run.queued` carrying a private path or sensitive text in `spanPath` now copies that value into `streamIssues`, then `spanAuthority.problems[].summary`. The browser wire rejects only full UCPath identifiers; other sensitive text passes unchanged, and CLI `--json` bypasses that filter entirely. Baseline reported the path contradiction without echoing its value. | Emit field-only mismatch diagnostics; remove raw spanPath/parentSpanPath values and regression-test browser and CLI output.

Count: 1 · Worst: medium

GATE: Not run, as instructed; static pinned-source verification only.
SCOUTS: None.
INVARIANT: Diagnosing malformed evidence must not disclose its sensitive contents.
REVIEW-HINT: Trace line 484 → authority-database.ts:1929 → queries/storage.ts:44 and storage/compose.ts:404. Test a valid root containing a synthetic private path, secret, and person identifier.
NOTES: Examined filesystem anchoring, diagnostic redaction, rerun Host/Origin/body/rate admission, and Vite nonce verification. No additional independently substantiated introduced Security findings; races and network behavior were not executed. No mutable candidate sources, credentials, live databases, or network accessed.
