import {
  DESCRIPTORS,
} from "../../control/workflow-registry.js";
import { HISTORICAL_STEP_PROOF_DESCRIPTORS } from "../../control/step-proof-modules.js";

import { RunRecordService } from "../../../runs/run-record-service.js";

import {
  AuthorityDatabase,
} from "../../../storage/sqlite/index.js";
import { createServerVerifiedArtifactReader } from "../../../storage/artifacts/server-verified-artifact-reader.js";

import { createReceiptService } from "../../../runs/trust/receipt-service.js";

export function createTrustReadDependencies(input: { database: AuthorityDatabase; artifactReader: ReturnType<typeof createServerVerifiedArtifactReader>; reader: Pick<RunRecordService, "read" | "list"> }) {
  const { database, artifactReader, reader } = input;
  return { trust: createReceiptService({ database, descriptors: [...DESCRIPTORS, ...HISTORICAL_STEP_PROOF_DESCRIPTORS], runReader: reader }), captures: { runReader: reader, authority: database.authority.diagnosticBundles, artifactReader }, diagnosticBundles: { runReader: reader, authority: database.authority.diagnosticBundles, artifactReader } };
}

export { readGateParks } from "./notifications.js";
