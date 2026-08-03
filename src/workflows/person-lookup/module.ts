/**
 * The server composition value for person-lookup: the bundle-safe descriptor
 * plus the lazy store loaders the daemon needs (doc 02 §1.2).
 *
 * The split is what keeps `descriptor.ts` client-safe. This module may reach
 * into stores; the descriptor may not, and the coverage guard walks its import
 * graph to prove it.
 *
 * All three implementing stores land with 1f. The control registry verifies at boot that every
 * descriptor contract resolves through one of these exact factory-defined stores.
 */
import { crmStore } from "../../stores/crm/index.js";
import { personLookupStore } from "../../stores/person-lookup/index.js";
import { ucpathStore } from "../../stores/ucpath/index.js";
import { personLookupDescriptor } from "./descriptor.js";

export const personLookupModule = Object.freeze({
  descriptor: personLookupDescriptor,
  stores: Object.freeze([ucpathStore, crmStore, personLookupStore]),
});
