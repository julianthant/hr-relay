# Kuali store

Read and stage the RRSS separation document through one task-safe driver declaration. Raw browser
operations and locators stay in `driver/`; tasks never acquire a second declaration for this store.
Task names, effects, and schemas are in the source and the generated store catalog, not a copied list.

## Rules that must survive a change

- The read binds the document number and discovers the person; writes bind the displayed person
  identity. Never substitute the searched input for an observed subject.
- Action List search is substring-based. Match the exact anchored document number, require one
  distinct action ID (two links for that action are normal), and prove the number again on the
  document heading. Read the link href; do not navigate just to discover the ID. An action ID can
  change across workflow steps. A missing action is a named refusal, never a guessed replacement.
- Read the form type explicitly. Return valid blanks as explicit absence, malformed nonblank values
  as refusals, and complete dropdown options as observed. Keep termination-type mapping in domain
  logic. Read tasks never fill or save, including during dry runs.
- Require exactly one matching control. Trim observed strings. Stage each value and verify it;
  use only a verified retry path when a control drops input. A failed read-back is unknown, not absence.
- A DOM value is not proof that Kuali's model holds it. Wait for the control's model update and
  validate the submitted payload by its verified form key/encoding; DOM IDs are not form keys.
- A commit waits for the mutation response and propagates explicit refusal. A success banner,
  HTTP 200, or an `Ok` payload is never landing proof. Reload and compare the actual stored values.
- Finalization stages all twelve fields in one pass from the exact typed variables already read,
  then saves once and reload-compares every written field. Re-reading may refuse stale input; it
  must not silently replace the staged variables. Compare exactly, with no tolerance arm.
- Preserve the ratified assertions and reconciled date inputs in the finalization schema. A missing
  transaction number refuses before staging; never save a partial draft for manual completion.
- Keep finalization behind the fresh UCPath filing-presence proof (D310). An asserted receipt does
  not become controlled-filing evidence. `Send Back` and `Mark Complete` are not authorized by this
  store's Save operations.
- Post-fence absence uses the transaction's verified policy. Never invent a propagation window or
  replace unknown with failure/success. A historical live pass does not authorize a new live write.

## Read for the affected seam

- Before finalization changes: `docs/rebuild/migrations/separations.md` §4e/§4g and §9.39; the exact fields
  and assertions are in `src/models/ui/kuali-separation-finalization.ts`.
- Before locator, wire, or timing changes: `driver/interpreter.ts` and `driver/ui-registry.ts`
  carry the implementation, verified encodings, and port provenance; consult the migration's dated
  verification entries. Keep commit/source provenance in ported code.
- Before task/driver boundary changes: `docs/rebuild/reference/task-contract.md` and
  `docs/rebuild/reference/stores.md` (derived catalog; code wins).
- Before repeating a known failure: search [LESSONS.md](LESSONS.md) for the seam and read the matching
  entries. Requested new lessons go there. Do not copy current task inventories or old canary state here.

Root safety, authorization, and validation rules apply.
