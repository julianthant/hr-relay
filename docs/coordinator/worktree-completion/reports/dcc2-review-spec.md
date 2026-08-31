# DCC2 review — Spec

## Corrected axis result — Count 1 / Worst low (documentation)

Following supervisor primary-source verification of the frozen baseline's explicit malformed-authority policy, the same independent reviewer corrected the initial implementation finding. Initial output remains below only as audit history.

STATUS: Original medium implementation finding withdrawn; Spec wording correction remains.

ROLE: sup_terra, Spec only  
MODEL: GPT-5  
REASONING: Frozen `13175b13:src/infra/sqlite/storage-doctor.ts:148` explicitly stops absence classification on malformed evidence; lines 159–166 return malformed findings before the missing-span calculation at lines 354–378. Candidate `authority-database.ts:2034` and `storage-doctor.ts:650` preserve that authority-inventory rule. My earlier proposed union would change the selected baseline behavior, contrary to M2’s reconciliation scope.

docs/rebuild/reference/dashboard-surfaces.md:1408 | low | “Names every problem,” together with the unqualified missing-span description at line 1400, overstates the selected classification contract. | Qualify these statements to retain the baseline’s refusal to classify absences from malformed authority.

COMMITS: none  
FILES: none changed  
GATE: none run  
SCOUTS: none  
REVIEW-HINT: Smallest authorized resolution is documentation only: replace “malformed rows never become absence facts” with “If any current/archive authority record is malformed, report malformed evidence and withhold `missing` and `missing-span` classifications for that inspection”; replace “names every problem” with “names the problems permitted by that classification rule.” Keep implementation unchanged.

NOTES: This corrects the same Spec finding; no additional axis was reviewed. Count 1 / Worst low; implementation noncompliance count 0.

## Initial result (superseded)

Pinned candidate `d8bf813e71925756f1f238dd142886410ba3e5ff`, base `13175b13340fec7b5326207fe54f98078d481d7d`. Independent result; supervisor validation/disposition follows separately.

STATUS: FINDING  
ROLE: sup_terra Spec review  
MODEL: native sup_terra, high  
REASONING: D282 requires `spanAuthority` to name every problem; §6.2 requires distinct missing-span diagnosis.  
src/infra/sqlite/storage-doctor.ts:650 | medium | Any malformed authority record discards all otherwise-valid `missing`/`missing-span` diagnoses; authority-database.ts:2034 also erases `missingSpanRunIds`. A mixed corruption reports only malformed evidence, contradicting D282’s “names every problem.” | Retain valid missing-span IDs alongside malformed records, union all problem arms, and add a mixed-case regression.  

COMMITS: none  
FILES: none modified  
GATE: not run — temporary host resource hold prohibited gates  
SCOUTS: none  
REVIEW-HINT: Verified candidate D282 lines 1397–1414 and §6.2 lines 1081–1087; selected timeout settlement, ingress, Vite proof, and redaction dispositions remain present.  
NOTES: Pinned target `d8bf…` is a tree object, inspected via `git show`; no mutable files accessed for candidate sources. Count 1 / Worst medium.
