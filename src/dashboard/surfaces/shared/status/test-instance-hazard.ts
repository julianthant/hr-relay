/** The TEST-instance hazard — ONE derivation and ONE run-scoped sentence.
 * Four surfaces draw this hazard — the queue card, the run-detail provenance */

/** One `(system, instance)` pair as every surface receives it on the wire. */
export interface ResolvedSystemInstance {
  readonly system: string;
  readonly instance: "prod" | "test";
}

/** Every system this run resolved to its TEST instance, in the SERVED order.
 * The order is the server's and is never sorted here */
export function testInstanceSystems(
  resolvedInstances: readonly ResolvedSystemInstance[],
): readonly string[] {
  return resolvedInstances.filter(({ instance }) => instance === "test").map(({ system }) => system);
}

/** The run-scoped hazard title. Present tense would be a lie on a settled run
 * and the past tense is what both its callers already said, so nothing here */
export function testInstanceHazardTitle(systems: readonly string[]): string {
  return `Ran against the TEST instance of ${systems.join(", ")} — nothing here reached production.`;
}
