import { kualiStore } from "../../stores/kuali/index.js";
import { separationsStore } from "../../stores/separations/index.js";
import { separationsKualiReadDescriptor } from "./descriptor.js";

/**
 * The server composition value: the bundle-safe descriptor plus the concrete
 * stores its contracts resolve through. Two stores — the Kuali browser store
 * for the page visit, and the `separations` pure mini-store for §4a's
 * resolution, which contributes no browser session by construction.
 */
export const separationsKualiReadModule = Object.freeze({
  descriptor: separationsKualiReadDescriptor,
  stores: Object.freeze([kualiStore, separationsStore]),
});
