/**
 * The server composition value for person-lookup: the bundle-safe descriptor
 * plus the lazy store loaders the daemon needs (doc 02 §1.2).
 *
 * The split is what keeps `descriptor.ts` client-safe. This module may reach
 * into stores; the descriptor may not, and the coverage guard walks its import
 * graph to prove it.
 *
 * `stores` is empty on purpose: task IMPLEMENTATIONS land with the workers in
 * 1f, and every contract this graph uses is accounted for in
 * `config/pending-impl-bindings.json` until then. An unlisted contract, or a
 * listed one that has since been bound, fails `descriptor-coverage` — so the
 * gap cannot go quiet.
 */
import { personLookupDescriptor } from "./descriptor.js";

export const personLookupModule = Object.freeze({
  descriptor: personLookupDescriptor,
  stores: Object.freeze([]),
});
