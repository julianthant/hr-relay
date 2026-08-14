/**
 * The server composition value for `separations-kuali-finalization`: the
 * bundle-safe descriptor plus the three stores that implement every contract it
 * names — `ucpath` for the two identity reads, `kuali` for the transaction's
 * prepare/commit (and the probe and verifier its `writeSafety` points at), and
 * the pure `separations` mini-store for the identity comparison, the approval
 * check and §4e's department-option fold.
 */
import { kualiStore } from "../../stores/kuali/index.js";
import { separationsStore } from "../../stores/separations/index.js";
import { ucpathStore } from "../../stores/ucpath/index.js";
import { separationsKualiFinalizationDescriptor } from "./descriptor.js";

export const separationsKualiFinalizationModule = Object.freeze({
  descriptor: separationsKualiFinalizationDescriptor,
  stores: Object.freeze([kualiStore, ucpathStore, separationsStore]),
});
