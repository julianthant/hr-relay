/**
 * The server composition value for kuali-timekeeper-annotation: the bundle-safe
 * descriptor plus the one store that implements every contract it names.
 *
 * The registry verifies at boot that each of the four Kuali contracts — probe,
 * verifier, prepare, commit — resolves through this exact factory-defined store
 * and that no other store is listed.
 */
import { kualiStore } from "../../stores/kuali/index.js";
import { kualiTimekeeperAnnotationDescriptor } from "./descriptor.js";

export const kualiTimekeeperAnnotationModule = Object.freeze({
  descriptor: kualiTimekeeperAnnotationDescriptor,
  stores: Object.freeze([kualiStore]),
});
