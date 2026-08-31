# DCC2 review — Correctness

## Final axis disposition: retracted, Count 0 / Worst none

The initial result below remains only as audit history. Supervisor checked frozen baseline storage-doctor lines 354–365 and candidate owning contract, then asked the same independent reviewer to revalidate. Reviewer correction:

STATUS: RETRACTED  
ROLE: sup_terra — Correctness only  
MODEL: Terra/high (dispatch)  
REASONING: The reported behavior is preserved baseline behavior and matches the owning contract:

- Frozen `storage-doctor.ts:360–364` explicitly excludes archived IDs from `missing-span`.
- Candidate `authority-database.ts:1916` preserves that exclusion.
- Candidate `dashboard-surfaces.md:1400–1401,1410–1411` explicitly requires queued roots for **current non-archived** runs.
- Frozen `clock-config-secrets.md:1074–1075` distinguishes current runs from archived identities; it does not establish that every retained `tasks` row remains “current.”

I incorrectly equated a retained `tasks` record with a current non-archived run. Although the empty-directory scenario follows from the code, it does not demonstrate an introduced regression or owner-contract violation. My proposed fix would broaden missing-span scope without authority. I retract the high finding.

COMMITS: none  
FILES: none modified  
GATE: none run  
SCOUTS: none  
REVIEW-HINT: Remove the previous finding and its proposed fix from the correctness report.  
NOTES: Revalidated only the same finding against frozen baseline `13175b13` and candidate `d8bf813e`; no broader clearance claimed.

Count: 0 / Worst: none.

## Initial result (superseded by reviewer correction above)

Pinned candidate: `d8bf813e71925756f1f238dd142886410ba3e5ff`, base `13175b13340fec7b5326207fe54f98078d481d7d`. Independent axis result; supervisor validation/disposition pending.

STATUS: FINDING  
ROLE: sup_terra correctness-only reviewer  
MODEL: GPT-5.6 Terra, high  
REASONING:  
src/infra/sqlite/authority-database.ts:1916 | high | A retained `tasks` record without a queued span root is excluded from `missingSpanRunIds` whenever any archive row shares its id. With an existing empty `spans/` directory, a valid archived row + its retained terminal task therefore yields `reconciled`; `AuthorityHealthPreflightRunner` publishes healthy despite lost evidence. | Always record a missing root for every valid retained task (and separately validate archive pairing), then add the archived/no-root regression.  

Count 1 / Worst high.  
COMMITS: none  
FILES: none modified  
GATE: not run (explicit temporary host-resource hold)  
SCOUTS: none  
REVIEW-HINT: Candidate line 1916 is newly introduced reconciliation logic; D282/clock §6.2 require every authority run to have a queued root.  
NOTES: Read-only pinned-tree review only. Candidate sources inspected via `git show d8bf…`; no mutable files, tests, gates, network, DB, or browser actions.
