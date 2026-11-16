import type { ObservationId } from "../../rules/identity/ids.js";
import type { OnbasePrepared, OnbaseTarget, OnbaseImportVerdict } from "../systems/onbase/import-document.js";
import type { MutationCapability, UiActionProof } from "./driver.js";

export interface OnbaseDriver {
  readonly system: "onbase";
  bindSourcePage(target: OnbaseTarget, bytes: Uint8Array): void;
  read(id: ObservationId): Promise<string>;
  prepareImport(target: OnbaseTarget): Promise<OnbasePrepared>;
  readSavedImport(target: OnbaseTarget): Promise<OnbaseImportVerdict>;
  commitImport(target: OnbaseTarget, capability: MutationCapability): Promise<UiActionProof>;
}
