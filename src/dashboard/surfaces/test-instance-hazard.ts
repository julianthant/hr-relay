/**
 * The TEST-instance hazard — ONE derivation and ONE run-scoped sentence
 * (Track D row D2, audit M8).
 *
 * Four surfaces drew this hazard and each filtered `resolvedInstances` itself:
 * the queue card, the run-detail provenance bar, the receipt, and the archive.
 * The derivation is trivial, which is exactly why it forked — and the SENTENCE
 * had already diverged, so the same run could read "Ran against the TEST
 * instance of kuali" on one surface and "Written to the TEST instance of
 * KUALI" on another. On a hazard whose whole job is to stop an operator
 * mistaking a rehearsal for a filing, two spellings of one fact is the defect.
 *
 * It lives in its own module rather than in a surface because a
 * `surfaces/*.tsx` module may export components only (ref frontend-backend-integration §8.14's Fast
 * Refresh boundary rule), and in its own module rather than in `format.ts`
 * because it is not formatting: it selects which systems a run touched.
 *
 * Two sentences survive on purpose. `testInstanceHazardTitle` is the RUN-scoped
 * one — what this run did — and the queue card and the provenance bar both use
 * it. The receipt says something stronger and different (what was WRITTEN is
 * not a filing) and keeps its own words; what it no longer keeps is its own
 * spelling of the system names, which were uppercased there and lowercase
 * everywhere else.
 */

/** One `(system, instance)` pair as every surface receives it on the wire. */
export interface ResolvedSystemInstance {
  readonly system: string;
  readonly instance: "prod" | "test";
}

/**
 * Every system this run resolved to its TEST instance, in the SERVED order.
 *
 * The order is the server's and is never sorted here: the wire lists the
 * systems in the order the run resolved them, and re-ordering for display would
 * make two surfaces disagree about a sequence the operator can check.
 */
export function testInstanceSystems(
  resolvedInstances: readonly ResolvedSystemInstance[],
): readonly string[] {
  return resolvedInstances.filter(({ instance }) => instance === "test").map(({ system }) => system);
}

/**
 * The run-scoped hazard title. Present tense would be a lie on a settled run
 * and the past tense is what both its callers already said, so nothing here
 * changes what the queue card or the provenance bar renders — it makes them
 * unable to drift apart.
 */
export function testInstanceHazardTitle(systems: readonly string[]): string {
  return `Ran against the TEST instance of ${systems.join(", ")} — nothing here reached production.`;
}
