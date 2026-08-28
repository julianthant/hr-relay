# Decisions — R2 post-u1r registry residue — 2026-08-28
_Answer positionally: `1 A, 2 A`, add a note to any item, or answer `all recommended`. Unanswered items stay open._

## 1 · Where should the canary's display names live?

**Situation.** `config/test-subjects.json` currently contains `employeeName` and `timekeeperName`
because the finalization canonical input requires them. Doc 03b §The canary registry says names stay
out of the repository, but the D284 implementation retained these pre-existing public fields. This
does not block the composed dry run, but code and owning prose now disagree.

**Options.**

- **A. Move both names behind strict secret references.** Update the registry boundary and tests so
  git stores only named secret references and `.env` supplies the display strings. Cost: one focused
  schema/config/docs unit plus local secret provisioning; the written privacy rule remains intact.
- **B. Amend doc 03b to allow non-EID display names in the test registry.** No runtime change. Cost:
  names remain committed and the privacy rule becomes narrower than its current wording.
- **C. Defer.** Leave the contradiction explicit on the board. Cost: every later registry edit must
  reason around an unresolved privacy boundary.

**Recommendation.** **A** — the repository already has a closed secret-reference mechanism, and the
two strings are unnecessary to review in git.

**Notes.** _(your notes here)_

## 2 · When should the 4537 EID secret be provisioned?

**Situation.** `.env` lacks
`HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EID`. The composed `separations` rehearsal
does not need it, and the finalization resolver currently blocks earlier on three pending leaves.
Once UCPath filing ② clears those leaves, the standalone finalization fallback will defect by name
unless the secret exists.

**Options.**

- **A. Provision it before controlled commit ②.** Copy or set the verified canary EID only in the
  ignored local `.env`, then smoke the resolver without printing it. Cost: one local-secret step now;
  benefit: no configuration stop between the three controlled commits.
- **B. Wait until ② succeeds.** Provision it only when the transaction number exists and before ③.
  Cost: the write sequence pauses mid-ceremony and the fallback cannot be preflighted beforehand.
- **C. Do not provision it.** The composed path may still reach ③, but its declared standalone
  fallback remains unavailable. Cost: R2 cannot honestly claim its planned fallback readiness.

**Recommendation.** **A** — settle local configuration before any controlled write begins.

**Notes.** _(your notes here)_
